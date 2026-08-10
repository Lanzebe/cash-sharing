# CashSharing

A simple expense tracker: split costs with friends, in multiple groups, with login.

Built from the old `main.py` logic — same split math and minimum-settlement algorithm, now a web app.

## Features

- Own accounts: self-registration on the login screen (email + password, password min 6 chars, JWT in an HTTP-only cookie). A display name is set right after the first login
- Guest members: add anyone to a group by name or email — even if they have no account — and they can appear in splits and payments. If the name you used matches the email of someone who later registers, they pick up those groups automatically
- Multiple groups; every transaction belongs to a group
- Create groups and add other users (or guests) as members
- Per-group currency (default `ZAR`), set at creation and changeable by the group owner
- Add transactions with a single payer and two split modes: by percentage, or by a fixed amount each person owes (total is the sum of those amounts). Edit any transaction after the fact
- Attach a photo of a slip or tax invoice to any transaction (PNG/JPG/WebP/GIF, up to 15 MB), viewable from the transactions table
- Auto-calculated balances, minimum settlements, and spending-by-tag
- Dark mode by default, with a light/dark switch in the top banner that remembers your choice
- Per-group storage as a `.csv` file

## Tech stack

- Backend: **Python + FastAPI** on port `8081`
- Frontend: plain **HTML/CSS/JS** served by the backend at `/`
- Storage: one `.csv` per group + `users.json` + `groups.json` (mounted data)
- Auth: JWT in an HTTP-only cookie

## Folder structure

```
CashSharing/
├── backend/          # FastAPI app + Dockerfile
├── frontend/         # static HTML/CSS/JS
├── database/         # users.json, groups.json, groups/<group>.csv (persisted)
├── .github/workflows # builds the container image
└── docker-compose.yml
```

## Run locally without Docker

Requires Python 3.10+.

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8081
```

Open http://localhost:8081

First run creates a default admin user (see Environment variables below), and the login screen lets anyone create their own account. Use either to get started.

## Run locally with Docker

```bash
docker compose up --build
```

Open http://localhost:8081

## Admin: data access, audit, and user management

There is no admin web UI. Everything lives in plain files under the data directory (`users.json`, `groups.json`, `groups/<id>.csv`, `receipts/<group>/`), and `backend/manage.py` is a small CLI for everyday tasks.

Run it locally:

```bash
cd backend
python manage.py list-users
python manage.py list-groups
python manage.py show-group <gid>
python manage.py create-user <email> <password>
python manage.py reset-password <email> <new-password>
python manage.py delete-user <email>            # members stay in groups as guests
python manage.py delete-group <gid>
```

On a host running `docker compose`:

```bash
docker compose exec cashsharing python backend/manage.py list-users
```

On TrueNAS (or any host with plain Docker): `manage.py` is inside the container at `/app/backend/`, not on the data volume — the mount only contains data. Find the container and exec into it:

```bash
sudo docker ps                                        # list containers; find the app one (TrueNAS names it ix-<app>-1)
sudo docker exec -it <container> python backend/manage.py list-users
sudo docker exec -it <container> python backend/manage.py show-group <gid>
```

Example on TrueNAS (app name "cash-sharing"):

```bash
sudo docker exec -it ix-cash-sharing-cash-sharing-1 python backend/manage.py list-users
```

Notes:
- `sudo` is needed because your shell user is not in the `docker` group (you'll see *permission denied* on `docker ps` without it).
- `docker compose exec ...` does **not** work here: TrueNAS deploys the app directly, so there is no compose file on the host.
- The container already has `CASH_SHARING_DATA=/data` set, so the commands act on your mounted data.
- The path is `backend/manage.py` because the container's working directory is `/app`.

For a full audit you can also read the files directly (they are human-readable JSON/CSV):

```bash
cat users.json                  # accounts: email, display_name, password_hash
cat groups.json                 # groups: id, name, owner, members, currency, tags
cat "groups/<gid>.csv"          # all transactions of a group
ls -R receipts                  # uploaded receipt images, one file per transaction
```

The examples above assume you are inside the data directory (e.g. `cd /mnt/tank/configs/CashSharing` on TrueNAS).

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CASH_SHARING_DATA` | `../database` | Where data is stored |
| `CASH_SHARING_SECRET` | `change-me-in-production` | JWT signing secret — always change it |
| `CASH_SHARING_ADMIN_EMAIL` | `admin@example.com` | First user created when the DB is empty |
| `CASH_SHARING_ADMIN_PASSWORD` | `admin123` | Password for that first user |
| `CASH_SHARING_COOKIE_SECURE` | `0` | Set to `1` once you serve over HTTPS |
| `CASH_SHARING_TTL_HOURS` | `168` | How long a login lasts (hours) |

## Deploy on TrueNAS

### 1. Push to GitHub

```bash
cd CashSharing
git init
git add .
git commit -m "Add CashSharing"
git branch -M main
git remote add origin <your repo URL>  # e.g. git@github.com:Lanzebe/cash-sharing.git
git push -u origin main
```

The workflow in `.github/workflows/docker-image.yml` builds the image and pushes it to the **GitHub Container Registry** as `ghcr.io/lanzebe/cash-sharing`.

### 2. Make the image public

The action needs the repo's write permission (already set in the workflow) and the package must be readable by TrueNAS. On the GHCR package page, set **Package visibility** to **Public**.

### 3. Add a Custom App in TrueNAS

1. **Apps → Discover Apps → Custom App / Launch Docker Image**.
2. Container image: `ghcr.io/lanzebe/cash-sharing`, tag `latest`, pull policy `Always`.
3. Host port **8888** → container port **8081** (or any host port you like).
4. Mount your ZFS dataset (e.g. `/mnt/tank/configs/CashSharing`) to `/data` — this is where all data lives and persists.
5. Set the environment variables (a strong `CASH_SHARING_SECRET`, and your own `CASH_SHARING_ADMIN_EMAIL/PASSWORD`):

   | Variable | Value |
   |----------|-------|
   | `CASH_SHARING_DATA` | `/data` |
   | `CASH_SHARING_SECRET` | a long random string (`openssl rand -hex 32`) |
   | `CASH_SHARING_ADMIN_EMAIL` | `admin@example.com` |
   | `CASH_SHARING_ADMIN_PASSWORD` | a strong password |

### 4. First login

Open `http://your-server-ip:8888`. Either create your own account (right-hand tab) or use the admin account from the environment variables. After the first login you will be asked to set a display name. Create a group (pick its currency), add members — registered users or guests — add transactions, and settle up. Guests show up with a "(guest)" label until they register under a matching email.

## Notes

- No reverse proxy or HTTPS yet by design — add that later when ready.
- Registration is always open; anyone reaching the app can create an account. Keep the server private or add auth/reverse-proxy before exposing it publicly.
- Real data lives only in `database/` (or your mounted `/data`) — CSVs, users, groups, and uploaded receipts under `receipts/<group>/`. These are git-ignored, so they never hit GitHub.
- Keep it simple on purpose; when you want sessions, password resets, or a reverse proxy, this is a good base.