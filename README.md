# AddressFix (project-2)

AddressFix is a Next.js 14 app with:
- PostgreSQL + Drizzle ORM
- Optional Redis (fallback to in-memory rate limiting when Redis is not configured)
- Python sentiment microservice (FastAPI + scikit-learn model files)
- Groq integration for AI-assisted features
- An `sdk/` package for external API consumption

## What Must Be Running

To run this project locally, you need:
- **Node.js + npm** (for Next.js app)
- **PostgreSQL** (required by the app)
- **Python 3** (needed because the app starts `uvicorn` for sentiment features when sentiment endpoints are used)

Redis is optional.

## Commands To Run (In Order)

Run these from the project root (`project-2`):

### 1) Install Node dependencies

```bash
npm install
```

**Why:** installs Next.js, Drizzle, pg, ioredis, and all runtime/dev dependencies required to start the app.

### 2) Create your env file

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Then edit `.env.local`.

**Why:** the app reads DB/auth/API configuration from environment variables at startup.

Minimum values you should set first:
- `DATABASE_URL` (required)
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (required for auth)
- `NEXT_PUBLIC_APP_URL` (usually `http://localhost:3000` in local dev)
- `ENCRYPTION_KEY` (required for Shopify token encryption logic)
- `CRON_SECRET` (required by cron endpoint auth checks)

Optional depending on features:
- `REDIS_URL` (optional; app falls back to in-memory limiter without it)
- `GROQ_API_KEY` (needed for AI-powered correction/chat features)
- Shopify vars (`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_WEBHOOK_SECRET`, etc.) when testing Shopify flows

### 3) Install Python sentiment service dependencies

```bash
pip install -r python-service/requirements.txt
```

If your machine uses `py` launcher:

```powershell
py -3 -m pip install -r python-service/requirements.txt
```

**Why:** sentiment endpoints call a local FastAPI service started via `uvicorn`; those packages must be installed for that process to run.

### 4) Ensure sentiment model files exist

Expected files under `python-service/`:
- `sentiment_model.pkl`
- `vectorizer.pkl`

**Why:** FastAPI service loads these files on startup. Without them, sentiment routes will fail when invoked.

### 5) Apply database schema

```bash
npm run db:push
```

**Why:** creates/updates PostgreSQL tables and enums from Drizzle schema so the app can read/write data.

Alternative migration flow:
- `npm run db:generate` to create SQL migrations
- `npm run db:migrate` to apply generated migrations

### 6) Start the app

```bash
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)

**Why:** starts the Next.js development server with hot reload.

## First Local Smoke Test

1. Register/login in the app.
2. Create a project.
3. Generate an API key.
4. Call `POST /api/v1/correct` with header `x-api-key`.

**Why:** confirms auth, database access, API key flow, and core correction endpoint are wired correctly.

## Production-Style Run

```bash
npm run build
npm run start
```

**Why:** validates the optimized production build and serves it without dev tooling.

## SDK (Optional)

If you need the local SDK package build:

```bash
cd sdk
npm install
npm run build
```

**Why:** compiles TypeScript SDK into `dist/` so other projects can consume it.

Set SDK `baseUrl` to your running AddressFix app origin when self-hosting.
