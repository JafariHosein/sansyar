#!/usr/bin/env python3
"""
Generate a signed Telegram Mini App initData string for testing.

The generated string passes the exact validation algorithm in validate_init_data.py
and validate-init-data.js — use it to write unit tests, integration tests, or to
manually smoke-test your backend without needing a real Telegram client.

Usage:
    python generate_test_init_data.py <BOT_TOKEN> [options]

    # Verify round-trip immediately:
    INIT=$(python generate_test_init_data.py "$BOT_TOKEN")
    python validate_init_data.py "$BOT_TOKEN" "$INIT"

    # Generate an expired fixture (for testing 401 rejection):
    python generate_test_init_data.py "$BOT_TOKEN" --age-offset 7200

Options:
    --user-id INT       Fake user ID (default: 123456789)
    --first-name STR    (default: Test)
    --last-name STR     (default: User)
    --username STR      (default: testuser)
    --language-code STR (default: en)
    --age-offset SECS   Subtract from auth_date to simulate stale data (default: 0)
"""

import argparse
import hashlib
import hmac
import json
import sys
import time
from urllib.parse import urlencode


def generate_init_data(
    bot_token: str,
    user_id: int = 123456789,
    first_name: str = "Test",
    last_name: str = "User",
    username: str = "testuser",
    language_code: str = "en",
    auth_date: int | None = None,
) -> str:
    """
    Generate a correctly-signed initData string.
    The algorithm mirrors validate_init_data.py exactly — any drift here
    means the generated fixtures won't validate, which is the whole point.
    """
    if auth_date is None:
        auth_date = int(time.time())

    user_obj = {
        "id": user_id,
        "first_name": first_name,
        "last_name": last_name,
        "username": username,
        "language_code": language_code,
    }
    # JSON with no spaces (matches Telegram's wire format)
    user_json = json.dumps(user_obj, separators=(",", ":"), ensure_ascii=False)

    params = {
        "auth_date": str(auth_date),
        "user": user_json,
    }

    # 1. Sort alphabetically and build check string (must match validators exactly)
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))

    # 2. secret = HMAC-SHA256("WebAppData", bot_token)
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()

    # 3. hash = HMAC-SHA256(secret, check_string)
    hash_hex = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()

    params["hash"] = hash_hex
    return urlencode(params)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate a signed Telegram initData string for testing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("bot_token", help="Bot token from BotFather")
    parser.add_argument("--user-id", type=int, default=123456789, metavar="N")
    parser.add_argument("--first-name", default="Test", metavar="STR")
    parser.add_argument("--last-name", default="User", metavar="STR")
    parser.add_argument("--username", default="testuser", metavar="STR")
    parser.add_argument("--language-code", default="en", metavar="CODE")
    parser.add_argument(
        "--age-offset",
        type=int,
        default=0,
        metavar="SECS",
        help="Subtract from auth_date to simulate stale data (e.g. 7200 → 2h old → rejected by default 1h window)",
    )
    args = parser.parse_args()

    if not args.bot_token.strip():
        print("Error: bot_token cannot be empty", file=sys.stderr)
        sys.exit(1)

    auth_date = int(time.time()) - args.age_offset
    result = generate_init_data(
        bot_token=args.bot_token,
        user_id=args.user_id,
        first_name=args.first_name,
        last_name=args.last_name,
        username=args.username,
        language_code=args.language_code,
        auth_date=auth_date,
    )
    print(result)
