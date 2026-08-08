import csv
import json
import os
import threading
import uuid

from tags import default_tags

DATA_DIR = os.path.abspath(
    os.environ.get(
        "CASH_SHARING_DATA",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "database"),
    )
)
GROUPS_DIR = os.path.join(DATA_DIR, "groups")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
GROUPS_FILE = os.path.join(DATA_DIR, "groups.json")

CSV_COLUMNS = [
    "Id",
    "Description",
    "Tag",
    "Total Amount",
    "Paid By",
    "Split Person",
    "Split Percent",
    "Split Amount",
]

_lock = threading.Lock()


def ensure_dirs():
    os.makedirs(GROUPS_DIR, exist_ok=True)


def _load(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return default


def _save(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def list_users():
    return _load(USERS_FILE, {})


def get_user(username):
    return list_users().get(username)


def save_user(user):
    with _lock:
        users = list_users()
        users[user["username"]] = user
        _save(USERS_FILE, users)


def list_groups():
    return _load(GROUPS_FILE, [])


def get_group(gid):
    for g in list_groups():
        if g["id"] == gid:
            return g
    return None


def create_group(name, owner):
    with _lock:
        group = {
            "id": uuid.uuid4().hex[:8],
            "name": name,
            "owner": owner,
            "members": [owner],
            "tags": list(default_tags),
        }
        groups = list_groups()
        groups.append(group)
        _save(GROUPS_FILE, groups)
        return group


def save_group(group):
    with _lock:
        groups = list_groups()
        for i, g in enumerate(groups):
            if g["id"] == group["id"]:
                groups[i] = group
                _save(GROUPS_FILE, groups)
                return group
        raise ValueError("Group not found")


def delete_group(gid):
    with _lock:
        groups = [g for g in list_groups() if g["id"] != gid]
        _save(GROUPS_FILE, groups)


def _group_csv(gid):
    return os.path.join(GROUPS_DIR, f"{gid}.csv")


def _parse_paid_by(value):
    result = {}
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        if ":" in part:
            name, _, amount = part.partition(":")
            result[name.strip()] = float(amount.strip())
        else:
            result[part] = 0.0
    return result


def read_transactions(gid):
    path = _group_csv(gid)
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    grouped, order = {}, []
    for r in rows:
        tid = r.get("Id") or ""
        if tid not in grouped:
            grouped[tid] = {
                "id": tid,
                "description": r["Description"],
                "tag": r["Tag"],
                "total_amount": float(r["Total Amount"]),
                "paid_by": _parse_paid_by(r["Paid By"]),
                "split_percent": {},
                "split_amounts": {},
            }
            order.append(tid)
        pct = float(r["Split Percent"])
        grouped[tid]["split_percent"][r["Split Person"]] = pct
        grouped[tid]["split_amounts"][r["Split Person"]] = float(r["Split Amount"])
    return [grouped[t] for t in order]


def write_transactions(gid, transactions):
    rows = []
    for t in transactions:
        paid_by_str = ", ".join(f"{p}: {a:.2f}" for p, a in t["paid_by"].items())
        for person in t["split_percent"]:
            rows.append({
                "Id": t["id"],
                "Description": t["description"],
                "Tag": t["tag"],
                "Total Amount": t["total_amount"],
                "Paid By": paid_by_str,
                "Split Person": person,
                "Split Percent": t["split_percent"][person],
                "Split Amount": t["split_amounts"].get(person, 0),
            })
    with open(_group_csv(gid), "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def add_transaction(gid, transaction):
    with _lock:
        txns = read_transactions(gid)
        txns.append(transaction)
        write_transactions(gid, txns)


def delete_transaction(gid, tid):
    with _lock:
        txns = read_transactions(gid)
        remaining = [t for t in txns if t["id"] != tid]
        write_transactions(gid, remaining)
        return len(txns) != len(remaining)