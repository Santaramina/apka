import os
from datetime import timedelta

import bcrypt
import jwt
from fastapi import Header, HTTPException

from db import db, now_utc

JWT_SECRET = os.environ.get("JWT_SECRET", "dev_secret")
JWT_ALG = "HS256"
JWT_TTL_DAYS = 30


def hash_password(password: str) -> str:
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode("utf-8"))
    except Exception:
        return False


def create_jwt(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": now_utc(),
        "exp": now_utc() + timedelta(days=JWT_TTL_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def user_from_token(token: str):
    if not token:
        return None
    token = token.strip()

    # 1) Google/Emergent session token
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if sess:
        exp = sess.get("expires_at")
        if exp is not None:
            if exp.tzinfo is None:
                from datetime import timezone

                exp = exp.replace(tzinfo=timezone.utc)
            if exp < now_utc():
                return None
        user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
        if user:
            return user

    # 2) Email/password JWT
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        uid = payload.get("sub")
        user = await db.users.find_one({"user_id": uid}, {"_id": 0})
        if user:
            return user
    except Exception:
        pass
    return None


async def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Brak autoryzacji")
    user = await user_from_token(authorization[7:])
    if not user:
        raise HTTPException(status_code=401, detail="Nieprawidłowy token")
    return user
