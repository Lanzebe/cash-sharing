#!/usr/bin/env python3
"""Admin tool for CashSharing data: listing, deletion, and password resets.

Run from the `backend/` directory:

    python manage.py list-users
    python manage.py list-groups
    python manage.py show-group <gid>
    python manage.py reset-password <email> <new-password>
    python manage.py delete-user <email>
    python manage.py delete-group <gid>

All changes write straight to the data files (users.json / groups.json).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from auth import hash_password
import storage


def cmd_list_users(args):
    users = storage.list_users()
    if not users:
        print("No users.")
        return
    for email, u in sorted(users.items()):
        print(f"{email}  (display: {u.get('display_name', '')})")


def cmd_list_groups(args):
    groups = storage.list_groups()
    if not groups:
        print("No groups.")
        return
    for g in groups:
        print(
            f"{g['id']}  {g['name']}  "
            f"currency={g['currency']}  owner={g['owner']}  "
            f"members={len(g['members'])}"
        )


def cmd_show_group(args):
    group = storage.get_group(args.gid)
    if not group:
        sys.exit(f"Group not found: {args.gid}")
    print(json.dumps(group, indent=2, ensure_ascii=False))
    txns = storage.read_transactions(args.gid)
    print(f"--- transactions ({len(txns)}) ---")
    for t in txns:
        print(json.dumps(t, indent=2, ensure_ascii=False))


def cmd_reset_password(args):
    email = args.email.strip().lower()
    user = storage.get_user(email)
    if not user:
        sys.exit(f"No such user: {email}")
    if len(args.password) < 6:
        sys.exit("Password must be at least 6 characters")
    storage.save_user({
        "email": email,
        "password_hash": hash_password(args.password),
        "display_name": user.get("display_name", email),
    })
    print(f"Password updated for {email}")


def cmd_delete_user(args):
    email = args.email.strip().lower()
    user = storage.get_user(email)
    if not user:
        sys.exit(f"No such user: {email}")
    groups_with_member = [
        g for g in storage.list_groups() if email in g["members"]
    ]
    with storage._lock:
        users = storage.list_users()
        users.pop(email, None)
        tmp = storage.USERS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(users, f, indent=2)
        os.replace(tmp, storage.USERS_FILE)

    if groups_with_member:
        print(
            f"Removed account {email}. It is still listed in "
            f"{len(groups_with_member)} group(s) as a guest member: "
            f"{', '.join(g['name'] for g in groups_with_member)}"
        )
    else:
        print(f"Deleted user {email}. Not a member of any group.")


def cmd_delete_group(args):
    group = storage.get_group(args.gid)
    if not group:
        sys.exit(f"Group not found: {args.gid}")
    storage.delete_group(args.gid)
    print(f"Deleted group {args.gid} ({group['name']}) and its transactions/receipts.")


def cmd_create_user(args):
    email = args.email.strip().lower()
    if not email or "@" not in email:
        sys.exit("Not a valid email address")
    if len(args.password) < 6:
        sys.exit("Password must be at least 6 characters")
    if storage.get_user(email):
        sys.exit(f"An account with {email} already exists (use reset-password)")
    storage.save_user({
        "email": email,
        "password_hash": hash_password(args.password),
        "display_name": args.display or email,
    })
    print(f"Created user {email}")


def build_parser():
    p = argparse.ArgumentParser(prog="manage.py", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("list-users", help="list all accounts")
    sub.add_parser("list-groups", help="list all groups")

    sp = sub.add_parser("show-group", help="dump a group + its transactions")
    sp.add_argument("gid")

    sp = sub.add_parser("reset-password", help="set a new password for an account")
    sp.add_argument("email")
    sp.add_argument("password")

    sp = sub.add_parser("delete-user", help="delete an account (members stay as guests)")
    sp.add_argument("email")

    sp = sub.add_parser("delete-group", help="delete a group and its data")
    sp.add_argument("gid")

    sp = sub.add_parser("create-user", help="create an account from the shell")
    sp.add_argument("email")
    sp.add_argument("password")
    sp.add_argument("-d", "--display", default=None, help="display name (defaults to email)")
    return p


def main():
    args = build_parser().parse_args()
    handlers = {
        "list-users": cmd_list_users,
        "list-groups": cmd_list_groups,
        "show-group": cmd_show_group,
        "reset-password": cmd_reset_password,
        "delete-user": cmd_delete_user,
        "delete-group": cmd_delete_group,
        "create-user": cmd_create_user,
    }
    handlers[args.command](args)


if __name__ == "__main__":
    main()