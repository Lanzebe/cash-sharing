import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from auth import (
    COOKIE_NAME,
    COOKIE_SECURE,
    TOKEN_TTL_HOURS,
    create_token,
    decode_token,
    hash_password,
    verify_password,
)
from core import ExpenseManager, from_dict, to_dict
import storage

FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend"
)


@asynccontextmanager
async def lifespan(app):
    storage.ensure_dirs()
    if not storage.list_users():
        username = os.environ.get("CASH_SHARING_ADMIN_USER", "admin")
        password = os.environ.get("CASH_SHARING_ADMIN_PASSWORD", "admin123")
        storage.save_user({
            "username": username,
            "password_hash": hash_password(password),
            "display_name": username,
        })
        print(f"Created default user: {username} / {password} — change it!")
    yield


app = FastAPI(title="CashSharing", lifespan=lifespan)


class LoginBody(BaseModel):
    username: str
    password: str


class CreateGroupBody(BaseModel):
    name: str


class AddMemberBody(BaseModel):
    username: str


class AddTransactionBody(BaseModel):
    description: str
    total_amount: float
    paid_by: Any
    split_percent: dict
    tag: str = ""


class AddTagBody(BaseModel):
    tag: str


def current_user(request: Request) -> str:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not logged in")
    try:
        return decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Session expired, please log in again")


def member_group(gid: str, username: str):
    group = storage.get_group(gid)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if username not in group["members"]:
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    return group


def owner_group(gid: str, username: str):
    group = member_group(gid, username)
    if group["owner"] != username:
        raise HTTPException(status_code=403, detail="Only the group owner can do that")
    return group


@app.post("/login")
def login(body: LoginBody, response: Response):
    username = body.username.strip()
    user = storage.get_user(username)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_token(username)
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=TOKEN_TTL_HOURS * 3600,
    )
    return {"ok": True, "username": username}


@app.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@app.get("/me")
def me(username: str = Depends(current_user)):
    groups = [
        {"id": g["id"], "name": g["name"], "members": g["members"]}
        for g in storage.list_groups()
        if username in g["members"]
    ]
    return {"username": username, "groups": groups}


@app.get("/api/groups")
def list_my_groups(username: str = Depends(current_user)):
    return [
        {"id": g["id"], "name": g["name"], "owner": g["owner"], "members": g["members"]}
        for g in storage.list_groups()
        if username in g["members"]
    ]


@app.post("/api/groups")
def create_group(body: CreateGroupBody, username: str = Depends(current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    group = storage.create_group(name, username)
    return {"id": group["id"], "name": group["name"], "owner": group["owner"], "members": group["members"]}


@app.get("/api/groups/{gid}")
def get_group(gid: str, username: str = Depends(current_user)):
    group = member_group(gid, username)
    return {
        "id": group["id"],
        "name": group["name"],
        "owner": group["owner"],
        "members": group["members"],
        "tags": group["tags"],
    }


@app.post("/api/groups/{gid}/members")
def add_member(gid: str, body: AddMemberBody, username: str = Depends(current_user)):
    group = owner_group(gid, username)
    new_member = body.username.strip()
    if not storage.get_user(new_member):
        raise HTTPException(status_code=404, detail=f"No user named '{new_member}'")
    if new_member in group["members"]:
        raise HTTPException(status_code=400, detail="Already a member")
    group["members"].append(new_member)
    storage.save_group(group)
    return {"members": group["members"]}


@app.delete("/api/groups/{gid}/members/{member}")
def remove_member(gid: str, member: str, username: str = Depends(current_user)):
    group = owner_group(gid, username)
    if member == group["owner"]:
        raise HTTPException(status_code=400, detail="Cannot remove the owner")
    if member not in group["members"]:
        raise HTTPException(status_code=404, detail="Not a member")
    group["members"].remove(member)
    storage.save_group(group)
    return {"members": group["members"]}


@app.delete("/api/groups/{gid}")
def delete_group(gid: str, username: str = Depends(current_user)):
    owner_group(gid, username)
    storage.delete_group(gid)
    return {"ok": True}


@app.get("/api/groups/{gid}/transactions")
def list_transactions(gid: str, username: str = Depends(current_user)):
    member_group(gid, username)
    return storage.read_transactions(gid)


@app.post("/api/groups/{gid}/transactions")
def add_transaction(gid: str, body: AddTransactionBody, username: str = Depends(current_user)):
    group = member_group(gid, username)

    total = float(body.total_amount)
    if total <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    split = {p: float(v) for p, v in body.split_percent.items()}
    if set(split) != set(group["members"]):
        raise HTTPException(status_code=400, detail="Every member must appear in the split")
    if sum(split.values()) != 100:
        raise HTTPException(status_code=400, detail="Split percentages must add up to 100")

    paid_by = body.paid_by
    if isinstance(paid_by, str):
        if paid_by not in group["members"]:
            raise HTTPException(status_code=400, detail="Payer must be a group member")
        paid_by = {paid_by: total}
    elif isinstance(paid_by, dict):
        if not paid_by or set(paid_by) - set(group["members"]):
            raise HTTPException(status_code=400, detail="Payer must be a group member")
        paid_by = {p: float(a) for p, a in paid_by.items()}
    else:
        raise HTTPException(status_code=400, detail="paid_by must be a member name or a mapping")

    tag = body.tag.strip()
    if not tag:
        raise HTTPException(status_code=400, detail="Tag is required")
    if tag not in group["tags"]:
        group["tags"].append(tag)
        storage.save_group(group)

    transaction = {
        "id": uuid.uuid4().hex[:8],
        "description": body.description,
        "total_amount": total,
        "paid_by": paid_by,
        "split_percent": split,
        "split_amounts": {p: (v / 100.0) * total for p, v in split.items()},
        "tag": tag,
    }
    storage.add_transaction(gid, transaction)
    return {"ok": True, "id": transaction["id"]}


@app.delete("/api/groups/{gid}/transactions/{tid}")
def delete_transaction(gid: str, tid: str, username: str = Depends(current_user)):
    member_group(gid, username)
    if not storage.delete_transaction(gid, tid):
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"ok": True}


@app.get("/api/groups/{gid}/summary")
def summary(gid: str, username: str = Depends(current_user)):
    group = member_group(gid, username)
    transactions = [from_dict(t) for t in storage.read_transactions(gid)]
    manager = ExpenseManager(transactions)
    return {
        "group": {"id": group["id"], "name": group["name"]},
        "balances": manager.balances(),
        "settlements": manager.settle_debts(),
        "tags": manager.tag_summary(),
        "total_spend": manager.total_spend(),
        "transactions": [to_dict(t) for t in transactions],
    }


@app.post("/api/groups/{gid}/tags")
def add_tag(gid: str, body: AddTagBody, username: str = Depends(current_user)):
    group = member_group(gid, username)
    tag = body.tag.strip()
    if not tag:
        raise HTTPException(status_code=400, detail="Tag is required")
    if tag not in group["tags"]:
        group["tags"].append(tag)
        storage.save_group(group)
    return {"tags": group["tags"]}


@app.delete("/api/groups/{gid}/tags/{tag}")
def remove_tag(gid: str, tag: str, username: str = Depends(current_user)):
    group = member_group(gid, username)
    if tag in group["tags"]:
        group["tags"].remove(tag)
        storage.save_group(group)
    return {"tags": group["tags"]}


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")