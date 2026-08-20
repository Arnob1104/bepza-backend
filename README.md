# BEPZA Autofiller — Extension + Backend

Chrome extension that extracts data from BEPZA export documents (PDF)
using AI and autofills the BEPZA web form. AI extraction and all
credentials now run through a private backend — the extension itself
never holds an AI provider key, model name, or endpoint.

```
Chrome Extension  →  Supabase Auth (login/refresh, direct)
Chrome Extension  →  Your Backend  →  AI Provider (hidden)
```

## Project structure

```
project/
├── extension/            Chrome extension (load unpacked, or zip to ship)
│   ├── manifest.json
│   ├── popup.html / popup.js / popup.css   (login + upload + review UI)
│   ├── auth.js                             (Supabase login/refresh + backend auth)
│   ├── groq_extraction.js                  (calls backend /api/extract; business rules)
│   ├── content_script.js                   (fills the BEPZA web form)
│   ├── pdf_reader.js
│   └── lib/pdf.min.js, lib/pdf.worker.min.js
│
├── backend/
│   ├── main.py                 FastAPI app
│   ├── config.py                Settings from environment variables
│   ├── auth/
│   │   ├── dependencies.py      Per-request auth check (token + is_active)
│   │   └── supabase_verify.py   Verifies Supabase tokens via JWKS
│   ├── routes/
│   │   ├── extract_routes.py    POST /api/extract (protected, rate-limited)
│   │   └── admin_routes.py      User management (protected by X-Admin-Key)
│   ├── services/
│   │   ├── ai_service.py        The ONLY module that calls the AI provider
│   │   ├── prompts.py           The 4 extraction prompts (server-side only)
│   │   ├── supabase_client.py   Supabase Admin API + profiles table
│   │   └── rate_limiter.py
│   ├── models/schemas.py
│   ├── database/supabase_schema.sql   Run once in Supabase SQL Editor
│   ├── requirements.txt
│   └── .env.example
│
└── README.md   (this file)
```

## Why Supabase

Auth (accounts, password hashing, login, refresh tokens) is handled
entirely by **Supabase Auth**. The backend doesn't store passwords or
issue its own tokens — it just verifies the token Supabase already
signed, and layers one extra thing on top: an `is_active` flag (see
`database/supabase_schema.sql`) so you can disable a user without
deleting their account. The extension talks to Supabase directly for
login/refresh using the public **publishable** key (safe to ship in a
client) — it only talks to *your* backend for the AI extraction call,
which is the one thing that needs to stay hidden.

---

## 1. Set up Supabase

1. You already have a Supabase project (from the credentials you gave me).
   Open **Supabase Dashboard → SQL Editor**.
2. Paste in the contents of `backend/database/supabase_schema.sql` and run it.
   This creates a `profiles` table (with an `is_active` column) and a
   trigger that auto-creates a profile row for every new user.
3. That's it — Supabase Auth is otherwise ready to go out of the box.

## 2. Run the backend locally

```bash
cd project/backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env — fill in AI_API_KEY / AI_API_URL / AI_MODEL, your Supabase
# values, a random ADMIN_API_KEY, and ALLOWED_ORIGINS (see step 4 below)

uvicorn backend.main:app --reload --port 8000
```

Visit `http://127.0.0.1:8000/health` — you should see `{"status": "ok"}`.
Interactive API docs are at `http://127.0.0.1:8000/docs`.

## 3. Load the extension locally

1. Open `chrome://extensions`, enable **Developer mode** (top right).
2. Click **Load unpacked**, select the `project/extension/` folder.
3. Note the extension's ID shown on its card (a 32-character string) —
   you need it for step 4.
4. `extension/auth.js` already has `BACKEND_URL = "http://localhost:8000"`
   for local dev — no change needed while testing locally.

## 4. Configure CORS to allow the extension

Back in `backend/.env`, set:

```
ALLOWED_ORIGINS=chrome-extension://<the-extension-id-from-step-3>
```

Restart the backend (`uvicorn` picks up `--reload` automatically, or
restart it manually) so the new origin takes effect.

## 5. Create your first user

Since Supabase Auth owns accounts, creating a user means calling the
Admin API on your own backend (which proxies to Supabase):

```bash
curl -X POST http://127.0.0.1:8000/api/admin/users \
  -H "X-Admin-Key: <your ADMIN_API_KEY from .env>" \
  -H "Content-Type: application/json" \
  -d '{"email": "arnob@texzippers.com", "password": "a-strong-password"}'
```

## 6. Log in from the extension

Click the extension icon → enter the email/password from step 5 → **Log in**.
You should land on the upload screen. Upload your BEPZA documents,
click **Extract Data**, review, then **Autofill BEPZA Form** as before —
that part of the workflow is completely unchanged.

## 7. Disable / re-enable a user

```bash
# Disable
curl -X PATCH http://127.0.0.1:8000/api/admin/users/<user-id>/status \
  -H "X-Admin-Key: <ADMIN_API_KEY>" -H "Content-Type: application/json" \
  -d '{"is_active": false}'

# Re-enable
curl -X PATCH http://127.0.0.1:8000/api/admin/users/<user-id>/status \
  -H "X-Admin-Key: <ADMIN_API_KEY>" -H "Content-Type: application/json" \
  -d '{"is_active": true}'
```

Get `<user-id>` from `GET /api/admin/users` (same `X-Admin-Key` header).
A disabled user is locked out on their **very next** request — the
backend re-checks `is_active` against Supabase on every call, not just
at login, so it doesn't matter that their existing token hasn't expired.

## 8. Reset a user's password

```bash
curl -X POST http://127.0.0.1:8000/api/admin/users/<user-id>/reset-password \
  -H "X-Admin-Key: <ADMIN_API_KEY>" -H "Content-Type: application/json" \
  -d '{"new_password": "a-new-strong-password"}'
```

---

## Deploying the backend

Any normal Python-hosting platform or VPS works (Render, Railway, Fly.io,
a plain Ubuntu box with systemd + nginx, etc). Broad strokes:

1. Push the `backend/` folder to your host.
2. Set all the variables from `.env.example` as real environment
   variables on the platform — **do not** upload a `.env` file to
   production; use the platform's environment-variable settings instead.
3. Install dependencies: `pip install -r requirements.txt`
4. Run with a production ASGI setup, e.g.:
   ```bash
   uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 2
   ```
   (Behind nginx/Caddy for TLS termination, or use your platform's
   built-in HTTPS if it provides one.)
5. Point a domain at it with HTTPS, e.g. `https://api.yourdomain.com`.

**Note on rate limiting at scale:** the rate limiter is in-memory,
correct for a single backend process. If you later run multiple worker
processes or replicas, each will track its own counters — move
`services/rate_limiter.py` to Redis at that point so limits are enforced
globally.

### Configure the extension for production

In `extension/auth.js`, change:
```js
const BACKEND_URL = "https://api.yourdomain.com"; // your real deployed URL
```

In `extension/manifest.json`, `host_permissions` already includes a
`https://your-backend-domain.com/*` placeholder — update it to your real
domain (and you can remove the `http://localhost:8000/*` entry once
you're done testing locally).

Then re-zip/re-load the extension and distribute it to your selected
users (e.g. via the Chrome Web Store as an unlisted/private listing, or
by sharing the unpacked folder directly for manual "Load unpacked" install).

Finally, update `ALLOWED_ORIGINS` on the deployed backend to the
extension's ID as loaded by your actual users (it stays the same ID
as long as you don't change the extension's key/signing — see Chrome's
docs on consistent extension IDs if distributing outside the Web Store).

---

## Security checklist

- [x] HTTPS in production (terminate TLS at your host/reverse proxy)
- [x] Passwords never touch this backend — Supabase Auth hashes and stores them
- [x] Tokens are Supabase-issued JWTs, verified via JWKS (no shared secret to leak)
- [x] `is_active` re-checked on every request, not just at login
- [x] Rate limiting per user (`RATE_LIMIT_PER_MINUTE`, default 10/min)
- [x] CORS restricted to your exact extension origin — never `allow_origins=["*"]`
- [x] `AI_API_KEY` / `AI_API_URL` / `AI_MODEL` — only in `backend/.env` (or host env vars), never in the extension
- [x] `SUPABASE_SECRET_KEY` — only in `backend/.env`, never in the extension
- [x] Raw AI-provider and Supabase error bodies are logged server-side only; the client always gets a generic message (verified in testing — see below)
- [x] `backend/.env` is git-ignored
- [x] Admin routes require `X-Admin-Key`, a secret never shipped to the extension

**Already verified in this environment:** I ran the full login → extract →
disable-user → rate-limit flow end-to-end with a synthetic Supabase token
(couldn't reach the real Supabase API from this sandbox — its network is
locked to a specific domain allowlist that doesn't include supabase.co).
Confirmed correct: 401 with no token, 403 immediately after disabling a
user (even with their still-valid token), 429 after 10 requests/minute,
and generic (non-leaking) error messages when the AI provider call fails.
**You should still do one real end-to-end test** (real Supabase login,
real AI extraction) once you're running this outside a sandboxed network,
since I could only verify the code logic, not the live Supabase/Mistral
connections themselves.

## Credentials note

The AI and Supabase keys used to build this were shared in plaintext in
our conversation. I've written them into `backend/.env` (git-ignored) as
requested, but since they passed through chat, it's worth rotating the
Mistral API key and the Supabase secret key once you've confirmed
everything works — regenerate them from Mistral's console and Supabase's
project settings respectively, then update `.env` with the new values.
