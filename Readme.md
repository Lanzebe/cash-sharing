# CashSharing

A simple expense tracker: split costs with friends, in multiple groups, with login.

Built from the old `main.py` logic — same split math and minimum-settlement algorithm, now a web app.

## Features

- Login with username + password (JWT in an HTTP-only cookie)
- Multiple groups; every transaction belongs to a group
- Create groups and add other users as members
- Add transactions with a payer and per-member split percentages
- Auto-calculated balances, minimum settlements, and spending-by-tag
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
cd ..
uvicorn backend.main:app --host 0.0.0.0 --port 8081
```

Open http://localhost:8081

First run creates a default user (see Environment variables below). Log in and use it.

## Run locally with Docker

```bash
docker compose up --build
```

Open http://localhost:8081

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CASH_SHARING_DATA` | `../database` | Where data is stored |
| `CASH_SHARING_SECRET` | `change-me-in-production` | JWT signing secret — always change it |
| `CASH_SHARING_ADMIN_USER` | `admin` | First user created when the DB is empty |
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
git remote add origin https://github.com/YOUR_USERNAME/CashSharing.git
git push -u origin main
```

The workflow in `.github/workflows/docker-image.yml` builds the image and pushes it to the **GitHub Container Registry** as `ghcr.io/YOUR_USERNAME/cash-sharing`.

### 2. Make the image public

The action needs the repo's write permission (already set in the workflow) and the package must be readable by TrueNAS. On the GHCR package page, set **Package visibility** to **Public**.

### 3. Add a Custom App in TrueNAS

1. **Apps → Discover Apps → Custom App / Launch Docker Image**.
2. Container image: `ghcr.io/YOUR_USERNAME/cash-sharing`, tag `latest`, pull policy `Always`.
3. Host port **8888** → container port **8081** (or any host port you like).
4. Mount your ZFS dataset (e.g. `/mnt/tank/configs/CashSharing`) to `/data` — this is where all data lives and persists.
5. Set the environment variables (a strong `CASH_SHARING_SECRET`, and your own `CASH_SHARING_ADMIN_USER/PASSWORD`):

   | Variable | Value |
   |----------|-------|
   | `CASH_SHARING_DATA` | `/data` |
   | `CASH_SHARING_SECRET` | a long random string (`openssl rand -hex 32`) |
   | `CASH_SHARING_ADMIN_USER` | `admin` |
   | `CASH_SHARING_ADMIN_PASSWORD` | a strong password |

### 4. First login

Open `http://your-server-ip:8888`, log in with the admin user, create a group, add members, add transactions, and settle up.

## Notes

- No reverse proxy or HTTPS yet by design — add that later when ready.
- Real data lives only in `database/`, which is git-ignored, so your CSVs never hit GitHub.
- Keep it simple on purpose; when you want sessions, password resets, or a reverse proxy, this is a good base.