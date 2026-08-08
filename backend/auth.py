import datetime
import hashlib
import os
import secrets

import jwt

COOKIE_NAME = "cash_sharing_token"
SECRET = os.environ.get("CASH_SHARING_SECRET", "change-me-in-production")
COOKIE_SECURE = os.environ.get("CASH_SHARING_COOKIE_SECURE", "0") == "1"
TOKEN_TTL_HOURS = int(os.environ.get("CASH_SHARING_TTL_HOURS", "168"))


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000
    ).hex()
    return f"{salt}${digest}"


def verify_password(password, stored):
    try:
        salt = stored.split("$", 1)[0]
        return secrets.compare_digest(hash_password(password, salt), stored)
    except (ValueError, AttributeError):
        return False


def create_token(username):
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": username,
        "iat": now,
        "exp": now + datetime.timedelta(hours=TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, SECRET, algorithm="HS256")


def decode_token(token):
    payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    return payload["sub"]