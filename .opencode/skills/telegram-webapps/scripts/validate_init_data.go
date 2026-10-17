// validate_init_data.go — Telegram Mini App initData validation for Go.
//
// Drop this file into your project.
//
// CLI test (no compilation needed):
//   go run scripts/validate_init_data.go "$BOT_TOKEN" "$RAW_INIT_DATA"
//
// As a library: copy ValidateInitData() and RequireTelegramAuth() into your
// package (rename "package main" to match your module first).
//
// Usage:
//   user, data, err := ValidateInitData(rawInitData, os.Getenv("BOT_TOKEN"), 0)
//
//   // net/http middleware:
//   mux.Handle("/api/action", RequireTelegramAuth(handleAction))
//   // Retrieve verified user inside the handler:
//   user := TelegramUserFromContext(r)

package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

// TelegramUser holds parsed fields from the initData "user" JSON field.
type TelegramUser struct {
	ID           int64  `json:"id"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name,omitempty"`
	Username     string `json:"username,omitempty"`
	LanguageCode string `json:"language_code,omitempty"`
	IsPremium    bool   `json:"is_premium,omitempty"`
}

// ValidateInitData validates Telegram Mini App initData.
// maxAgeSec is the max allowed age in seconds (0 → default 3600).
// Returns (user, allParams, nil) on success, or (nil, nil, error) on failure.
func ValidateInitData(rawInitData, botToken string, maxAgeSec int64) (*TelegramUser, map[string]string, error) {
	if rawInitData == "" || botToken == "" {
		return nil, nil, fmt.Errorf("rawInitData and botToken are required")
	}
	if maxAgeSec <= 0 {
		maxAgeSec = 3600
	}

	params, err := url.ParseQuery(rawInitData)
	if err != nil {
		return nil, nil, fmt.Errorf("malformed initData: %w", err)
	}

	receivedHash := params.Get("hash")
	if receivedHash == "" {
		return nil, nil, fmt.Errorf("missing hash field")
	}
	params.Del("hash")

	// 1. Sort fields alphabetically and join as "key=value\n..."
	// Note: only "hash" is excluded for HMAC. The "signature" field (Bot API 8.0+), if present,
	// IS included in the check string for HMAC validation (unlike Ed25519 where both are excluded).
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = k + "=" + params.Get(k)
	}
	checkString := strings.Join(parts, "\n")

	// 2. secret = HMAC-SHA256("WebAppData", botToken)
	mac1 := hmac.New(sha256.New, []byte("WebAppData"))
	mac1.Write([]byte(botToken))
	secretKey := mac1.Sum(nil)

	// 3. expected = HMAC-SHA256(secret, checkString)
	mac2 := hmac.New(sha256.New, secretKey)
	mac2.Write([]byte(checkString))
	expectedBytes := mac2.Sum(nil)

	// 4. Constant-time compare over raw bytes (not hex strings) — prevents timing oracle
	receivedBytes, err := hex.DecodeString(receivedHash)
	if err != nil || !hmac.Equal(receivedBytes, expectedBytes) {
		return nil, nil, fmt.Errorf("hash mismatch — data may have been tampered")
	}

	// 5. Check freshness
	authDate, err := strconv.ParseInt(params.Get("auth_date"), 10, 64)
	if err != nil || authDate == 0 {
		return nil, nil, fmt.Errorf("missing or invalid auth_date")
	}
	if time.Now().Unix()-authDate > maxAgeSec {
		return nil, nil, fmt.Errorf("initData expired (auth_date too old)")
	}

	// 6. Parse user JSON
	var telegramUser *TelegramUser
	if userStr := params.Get("user"); userStr != "" {
		var u TelegramUser
		if err := json.Unmarshal([]byte(userStr), &u); err != nil {
			return nil, nil, fmt.Errorf("invalid user JSON: %w", err)
		}
		telegramUser = &u
	}

	// Build flat string map for caller convenience
	flat := make(map[string]string, len(params))
	for k, vs := range params {
		if len(vs) > 0 {
			flat[k] = vs[0]
		}
	}

	return telegramUser, flat, nil
}

// ── net/http middleware ───────────────────────────────────────────────────────

type contextKey string

const telegramUserKey contextKey = "telegramUser"

// RequireTelegramAuth wraps an http.HandlerFunc with Telegram initData validation.
// Reads "Authorization: tma <initData>", validates, injects user into context.
// Returns 401 JSON on auth failure, 500 JSON if BOT_TOKEN is unset.
func RequireTelegramAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "tma ") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"Authorization header must start with 'tma '"}`))
			return
		}

		botToken := os.Getenv("BOT_TOKEN")
		if botToken == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"BOT_TOKEN not configured"}`))
			return
		}

		user, _, err := ValidateInitData(header[4:], botToken, 0)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"Invalid or expired initData"}`))
			return
		}

		ctx := context.WithValue(r.Context(), telegramUserKey, user)
		next(w, r.WithContext(ctx))
	}
}

// TelegramUserFromContext retrieves the validated TelegramUser from context.
// Returns nil if the middleware was not applied or validation failed.
func TelegramUserFromContext(r *http.Request) *TelegramUser {
	u, _ := r.Context().Value(telegramUserKey).(*TelegramUser)
	return u
}

// ── CLI ───────────────────────────────────────────────────────────────────────

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "Usage: go run validate_init_data.go <BOT_TOKEN> <raw_init_data>")
		os.Exit(1)
	}
	token, raw := os.Args[1], os.Args[2]

	user, data, err := ValidateInitData(raw, token, 86400) // 24h window for manual testing
	if err != nil {
		fmt.Fprintf(os.Stderr, "INVALID: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("VALID")
	if user != nil {
		b, _ := json.MarshalIndent(user, "", "  ")
		fmt.Printf("User: %s\n", b)
	}
	b, _ := json.MarshalIndent(data, "", "  ")
	fmt.Printf("Data: %s\n", b)
}
