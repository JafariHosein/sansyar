"""
Telegram Mini App initData validation — drop this file into the project as-is.

Usage:
    from validate_init_data import validate_init_data, telegram_auth

    # FastAPI:
    @app.post("/api/action")
    async def action(user=Depends(telegram_auth)):
        print(user["id"])  # verified

    # Manual:
    result = validate_init_data(raw_init_data, os.environ["BOT_TOKEN"])
    if result is None:
        raise ValueError("invalid")
    print(result["user"])
"""

import hashlib
import hmac
import json
import os
import time
from urllib.parse import parse_qsl


def validate_init_data(raw_init_data: str, bot_token: str, max_age: int = 3600) -> dict | None:
    """
    Returns parsed data dict if valid, None if invalid/expired.
    data["user"] is a dict (already JSON-parsed).
    """
    if not raw_init_data or not bot_token:
        return None

    params = dict(parse_qsl(raw_init_data, keep_blank_values=True))
    received_hash = params.pop("hash", None)
    if not received_hash:
        return None

    # 1. Sort fields alphabetically, join as "key=value\n..."
    # Note: only "hash" is excluded for HMAC. The "signature" field (Bot API 8.0+), if present,
    # IS included in the check string for HMAC validation (unlike Ed25519 where both are excluded).
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))

    # 2. secret = HMAC-SHA256("WebAppData", bot_token)
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()

    # 3. expected = HMAC-SHA256(secret, check_string)
    expected_hash = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()

    # 4. Constant-time compare (prevents timing oracle attacks)
    if not hmac.compare_digest(expected_hash, received_hash):
        return None

    # 5. Check freshness
    try:
        auth_date = int(params.get("auth_date", 0))
    except ValueError:
        return None
    if time.time() - auth_date > max_age:
        return None

    # 6. Parse user JSON
    if "user" in params:
        try:
            params["user"] = json.loads(params["user"])
        except (json.JSONDecodeError, TypeError):
            return None

    return params


# ── FastAPI dependency ────────────────────────────────────────────────────────

try:
    from fastapi import Header, HTTPException

    async def telegram_auth(authorization: str = Header(...)) -> dict:
        """
        FastAPI dependency. Use as:
            @app.post("/api/action")
            async def action(user=Depends(telegram_auth)):
                ...
        """
        if not authorization.startswith("tma "):
            raise HTTPException(401, "Authorization header must start with 'tma '")

        bot_token = os.environ.get("BOT_TOKEN")
        if not bot_token:
            raise HTTPException(500, "BOT_TOKEN not configured")

        data = validate_init_data(authorization[4:], bot_token)
        if data is None:
            raise HTTPException(401, "Invalid or expired initData")

        return data.get("user") or data

except ImportError:
    pass  # FastAPI not installed — that's fine, use validate_init_data() directly


# ── Flask decorator ───────────────────────────────────────────────────────────

try:
    from functools import wraps
    from flask import request, jsonify

    def flask_telegram_auth(f):
        """
        Flask decorator. Use as:
            @app.route("/api/action", methods=["POST"])
            @flask_telegram_auth
            def action():
                user = request.telegram_user
                ...
        """
        @wraps(f)
        def decorated(*args, **kwargs):
            header = request.headers.get("Authorization", "")
            if not header.startswith("tma "):
                return jsonify(error="Missing or invalid Authorization header"), 401

            bot_token = os.environ.get("BOT_TOKEN")
            if not bot_token:
                return jsonify(error="BOT_TOKEN not configured"), 500

            data = validate_init_data(header[4:], bot_token)
            if data is None:
                return jsonify(error="Invalid or expired initData"), 401

            request.telegram_user = data.get("user") or data
            request.telegram_init_data = data
            return f(*args, **kwargs)
        return decorated

except ImportError:
    pass  # Flask not installed — that's fine


# ── CLI test helper ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python validate_init_data.py <BOT_TOKEN> <raw_init_data>")
        sys.exit(1)

    token, raw = sys.argv[1], sys.argv[2]
    result = validate_init_data(raw, token, max_age=86400)  # 24h for testing
    if result:
        print("VALID")
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print("INVALID")
        sys.exit(1)
