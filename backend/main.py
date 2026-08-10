import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
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

ALLOWED_RECEIPT_EXTS = {"jpg", "jpeg", "png", "webp", "gif"}
MAX_RECEIPT_BYTES = 15 * 1024 * 1024


@asynccontextmanager
async def lifespan(app):
    storage.ensure_dirs()
    if not storage.list_users():
        email = os.environ.get("CASH_SHARING_ADMIN_EMAIL", "admin@example.com")
        password = os.environ.get("CASH_SHARING_ADMIN_PASSWORD", "admin123")
        storage.save_user({
            "email": email,
            "password_hash": hash_password(password),
            "display_name": email,
        })
        print(f"Created default user: {email} / {password} — change it!")
    yield


app = FastAPI(title="CashSharing", lifespan=lifespan)


class LoginBody(BaseModel):
    email: str
    password: str


class RegisterBody(BaseModel):
    email: str
    password: str


class CreateGroupBody(BaseModel):
    name: str
    currency: str = "ZAR"


class SetCurrencyBody(BaseModel):
    currency: str


class AddMemberBody(BaseModel):
    member: str


class AddTransactionBody(BaseModel):
    description: str
    total_amount: float | None = None
    paid_by: Any
    split: dict
    tag: str = ""
    split_mode: str = "percent"


class AddTagBody(BaseModel):
    tag: str


class SetDisplayNameBody(BaseModel):
    display_name: str


def normalize_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not email or len(email) > 254 or "@" not in email:
        raise HTTPException(status_code=400, detail="Not a valid email address")
    return email


def current_user(request: Request) -> str:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not logged in")
    try:
        return decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Session expired, please log in again")


def member_group(gid: str, email: str):
    group = storage.get_group(gid)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if email not in group["members"]:
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    return group


def owner_group(gid: str, email: str):
    group = member_group(gid, email)
    if group["owner"] != email:
        raise HTTPException(status_code=403, detail="Only the group owner can do that")
    return group


def group_balance(group, email: str) -> float:
    transactions = [from_dict(t) for t in storage.read_transactions(group["id"])]
    manager = ExpenseManager(transactions)
    return round(manager.balances().get(email, 0.0), 2)


@app.post("/login")
def login(body: LoginBody, response: Response):
    email = normalize_email(body.email)
    user = storage.get_user(email)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(email)
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=TOKEN_TTL_HOURS * 3600,
    )
    return {"ok": True, "email": email}


@app.post("/register")
def register(body: RegisterBody, response: Response):
    email = normalize_email(body.email)
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if storage.get_user(email):
        raise HTTPException(status_code=409, detail="An account with that email already exists")
    storage.save_user({
        "email": email,
        "password_hash": hash_password(body.password),
        "display_name": email,
    })
    token = create_token(email)
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=TOKEN_TTL_HOURS * 3600,
    )
    return {"ok": True, "email": email}


@app.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@app.get("/me")
def me(email: str = Depends(current_user)):
    user = storage.get_user(email)
    groups = [
        {
            "id": g["id"],
            "name": g["name"],
            "owner": g["owner"],
            "members": g["members"],
            "currency": g["currency"],
            "balance": group_balance(g, email),
        }
        for g in storage.list_groups()
        if email in g["members"]
    ]
    return {
        "email": email,
        "display_name": user.get("display_name") if user else email,
        "groups": groups,
    }


@app.put("/me")
def set_me(body: SetDisplayNameBody, email: str = Depends(current_user)):
    display_name = body.display_name.strip()
    if not display_name or len(display_name) > 64:
        raise HTTPException(status_code=400, detail="Display name must be 1-64 characters")
    user = storage.get_user(email)
    if not user:
        raise HTTPException(status_code=404, detail="No such account")
    user["display_name"] = display_name
    storage.save_user(user)
    return {"ok": True, "display_name": display_name}


@app.get("/api/groups")
def list_my_groups(email: str = Depends(current_user)):
    return [
        {
            "id": g["id"],
            "name": g["name"],
            "owner": g["owner"],
            "members": g["members"],
            "currency": g["currency"],
            "balance": group_balance(g, email),
        }
        for g in storage.list_groups()
        if email in g["members"]
    ]


@app.post("/api/groups")
def create_group(body: CreateGroupBody, email: str = Depends(current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    currency = body.currency.strip().upper()
    if not currency or len(currency) != 3 or not currency.isalpha():
        raise HTTPException(status_code=400, detail="Currency must be a 3-letter code")
    group = storage.create_group(name, email, currency=currency)
    return {
        "id": group["id"],
        "name": group["name"],
        "owner": group["owner"],
        "members": group["members"],
        "currency": group["currency"],
    }


@app.get("/api/groups/{gid}")
def get_group(gid: str, email: str = Depends(current_user)):
    group = member_group(gid, email)
    registered = set(storage.list_users())
    return {
        "id": group["id"],
        "name": group["name"],
        "owner": group["owner"],
        "members": group["members"],
        "currency": group["currency"],
        "registered_members": [m for m in group["members"] if m in registered],
        "tags": group["tags"],
    }


@app.put("/api/groups/{gid}/currency")
def set_currency(gid: str, body: SetCurrencyBody, email: str = Depends(current_user)):
    group = owner_group(gid, email)
    currency = body.currency.strip().upper()
    if not currency or len(currency) != 3 or not currency.isalpha():
        raise HTTPException(status_code=400, detail="Currency must be a 3-letter code")
    group["currency"] = currency
    storage.save_group(group)
    return {"currency": group["currency"]}


@app.post("/api/groups/{gid}/members")
def add_member(gid: str, body: AddMemberBody, email: str = Depends(current_user)):
    group = owner_group(gid, email)
    new_member = body.member.strip().lower()
    if not new_member:
        raise HTTPException(status_code=400, detail="Member name is required")
    if new_member in group["members"]:
        raise HTTPException(status_code=400, detail="Already a member")
    group["members"].append(new_member)
    storage.save_group(group)
    return {"members": group["members"]}


@app.delete("/api/groups/{gid}/members/{member}")
def remove_member(gid: str, member: str, email: str = Depends(current_user)):
    group = owner_group(gid, email)
    if member == group["owner"]:
        raise HTTPException(status_code=400, detail="Cannot remove the owner")
    if member not in group["members"]:
        raise HTTPException(status_code=404, detail="Not a member")
    group["members"].remove(member)
    storage.save_group(group)
    return {"members": group["members"]}


@app.delete("/api/groups/{gid}")
def delete_group(gid: str, email: str = Depends(current_user)):
    owner_group(gid, email)
    storage.delete_group(gid)
    return {"ok": True}


@app.get("/api/groups/{gid}/transactions")
def list_transactions(gid: str, email: str = Depends(current_user)):
    member_group(gid, email)
    return storage.read_transactions(gid)


def _build_transaction(group, body, tid=None):
    mode = body.split_mode
    if mode not in ("percent", "amount"):
        raise HTTPException(status_code=400, detail="split_mode must be 'percent' or 'amount'")

    split = {p: float(v) for p, v in body.split.items()}
    if set(split) != set(group["members"]):
        raise HTTPException(status_code=400, detail="Every member must appear in the split")
    if any(v < 0 for v in split.values()):
        raise HTTPException(status_code=400, detail="Split values must not be negative")

    if mode == "percent":
        total = float(body.total_amount or 0)
        if total <= 0:
            raise HTTPException(status_code=400, detail="Amount must be greater than zero")
        if round(sum(split.values()), 4) != 100:
            raise HTTPException(status_code=400, detail="Split percentages must add up to 100")
        split_amounts = {p: (v / 100.0) * total for p, v in split.items()}
        split_percent = split
    else:
        total = sum(split.values())
        if total <= 0:
            raise HTTPException(status_code=400, detail="Amounts must add up to more than zero")
        split_amounts = split
        split_percent = {
            p: round(v / total * 100, 4) for p, v in split.items()
        }

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

    return {
        "id": tid or uuid.uuid4().hex[:8],
        "description": body.description,
        "total_amount": total,
        "paid_by": paid_by,
        "split_percent": split_percent,
        "split_amounts": split_amounts,
        "split_mode": mode,
        "receipt": "",
        "tag": tag,
    }


@app.post("/api/groups/{gid}/transactions")
def add_transaction(gid: str, body: AddTransactionBody, email: str = Depends(current_user)):
    group = member_group(gid, email)
    transaction = _build_transaction(group, body)
    storage.add_transaction(gid, transaction)
    return {"ok": True, "id": transaction["id"]}


@app.put("/api/groups/{gid}/transactions/{tid}")
def edit_transaction(gid: str, tid: str, body: AddTransactionBody, email: str = Depends(current_user)):
    group = member_group(gid, email)
    txns = storage.read_transactions(gid)
    existing = next((t for t in txns if t["id"] == tid), None)
    if not existing:
        raise HTTPException(status_code=404, detail="Transaction not found")
    transaction = _build_transaction(group, body, tid=tid)
    transaction["receipt"] = existing.get("receipt", "")
    if not storage.replace_transaction(gid, tid, transaction):
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"ok": True, "id": tid}


@app.delete("/api/groups/{gid}/transactions/{tid}")
def delete_transaction(gid: str, tid: str, email: str = Depends(current_user)):
    member_group(gid, email)
    txns = storage.read_transactions(gid)
    entry = next((t for t in txns if t["id"] == tid), None)
    if not entry or not storage.delete_transaction(gid, tid):
        raise HTTPException(status_code=404, detail="Transaction not found")
    if entry.get("receipt"):
        path = os.path.join(storage.RECEIPTS_DIR, gid, entry["receipt"])
        if os.path.isfile(path):
            os.remove(path)
    return {"ok": True}


@app.post("/api/groups/{gid}/transactions/{tid}/receipt")
async def upload_receipt(
    gid: str,
    tid: str,
    file: UploadFile = File(...),
    email: str = Depends(current_user),
):
    member_group(gid, email)
    if not gid.isalnum() or not tid.isalnum():
        raise HTTPException(status_code=400, detail="Invalid id")
    file_type = (file.content_type or "").lower()
    if not file_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    ext = file_type.split("/")[-1].lower()
    if ext not in ALLOWED_RECEIPT_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported image type")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_RECEIPT_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large (max 15 MB)")
    txns = storage.read_transactions(gid)
    if not any(t["id"] == tid for t in txns):
        raise HTTPException(status_code=404, detail="Transaction not found")

    receipt_dir = os.path.join(storage.RECEIPTS_DIR, gid)
    os.makedirs(receipt_dir, exist_ok=True)
    path = os.path.join(receipt_dir, f"{tid}.{ext}")
    with open(path, "wb") as f:
        f.write(content)
    storage.set_transaction_receipt(gid, tid, f"{tid}.{ext}")
    return {"ok": True, "receipt": f"{tid}.{ext}"}


@app.get("/api/groups/{gid}/transactions/{tid}/receipt")
def get_receipt(gid: str, tid: str, email: str = Depends(current_user)):
    member_group(gid, email)
    if not gid.isalnum() or not tid.isalnum():
        raise HTTPException(status_code=400, detail="Invalid id")
    txns = storage.read_transactions(gid)
    entry = next((t for t in txns if t["id"] == tid), None)
    if not entry or not entry.get("receipt"):
        raise HTTPException(status_code=404, detail="No receipt for this transaction")
    path = os.path.join(storage.RECEIPTS_DIR, gid, entry["receipt"])
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Receipt file missing")
    return FileResponse(path)


@app.delete("/api/groups/{gid}/transactions/{tid}/receipt")
def delete_receipt(gid: str, tid: str, email: str = Depends(current_user)):
    member_group(gid, email)
    if not gid.isalnum() or not tid.isalnum():
        raise HTTPException(status_code=400, detail="Invalid id")
    txns = storage.read_transactions(gid)
    entry = next((t for t in txns if t["id"] == tid), None)
    if not entry or not entry.get("receipt"):
        raise HTTPException(status_code=404, detail="No receipt for this transaction")
    path = os.path.join(storage.RECEIPTS_DIR, gid, entry["receipt"])
    if os.path.isfile(path):
        os.remove(path)
    storage.clear_transaction_receipt(gid, tid)
    return {"ok": True}


@app.get("/api/groups/{gid}/summary")
def summary(gid: str, email: str = Depends(current_user)):
    group = member_group(gid, email)
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
def add_tag(gid: str, body: AddTagBody, email: str = Depends(current_user)):
    group = member_group(gid, email)
    tag = body.tag.strip()
    if not tag:
        raise HTTPException(status_code=400, detail="Tag is required")
    if tag not in group["tags"]:
        group["tags"].append(tag)
        storage.save_group(group)
    return {"tags": group["tags"]}


@app.delete("/api/groups/{gid}/tags/{tag}")
def remove_tag(gid: str, tag: str, email: str = Depends(current_user)):
    group = member_group(gid, email)
    if tag in group["tags"]:
        group["tags"].remove(tag)
        storage.save_group(group)
    return {"tags": group["tags"]}


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")