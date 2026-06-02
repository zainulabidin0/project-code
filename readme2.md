# AddressFix Deployment Guide (Vercel)

This guide explains **what to install**, **which commands to run in order**, and **why each step is required** to deploy `project-2` on Vercel.

---

## 1) Tools You Need To Install

### A. Node.js (LTS) + npm
- Install from: [https://nodejs.org](https://nodejs.org)
- Verify:

```bash
node -v
npm -v
```

**Why:** The app is a Next.js project and builds with Node/npm.

### B. Git
- Install from: [https://git-scm.com](https://git-scm.com)
- Verify:

```bash
git --version
```

**Why:** Vercel deploys from your Git repository (GitHub/GitLab/Bitbucket).

### C. Vercel CLI (recommended)

```bash
npm install -g vercel
vercel --version
```

**Why:** Lets you link the project, test deployments, and manage env vars from terminal.

### D. PostgreSQL database (hosted)
Use any managed Postgres service (Neon, Supabase, Railway, etc.) and keep the connection string ready.

**Why:** This app requires PostgreSQL for users, projects, API keys, usage logs, Shopify data, etc.

### E. Python service host (for sentiment)
Deploy `python-service` separately to a Python host (Railway/Render/Fly/etc.) with an HTTP URL.

**Why:** Vercel cannot run the local auto-spawned Python `uvicorn` process used in development.

---

## 2) Prepare the Project Locally

Run from `project-2`:

### 1. Install dependencies

```bash
npm install
```

**Why:** Ensures your lockfile and dependencies are ready before deploy/build checks.

### 2. Optional local production check

```bash
npm run build
```

**Why:** Confirms the app compiles before pushing and avoids failing Vercel builds.

### 3. Commit and push to Git provider

```bash
git add .
git commit -m "Prepare Vercel deployment"
git push
```

**Why:** Vercel pulls source code directly from your remote repository.

---

## 3) Deploy on Vercel (Recommended Flow)

## Option A: Vercel Dashboard (simplest)
1. Go to [https://vercel.com/new](https://vercel.com/new)
2. Import your repository containing `project-2`.
3. Set **Root Directory** to `project-2` (if repo has multiple folders).
4. Framework should detect as **Next.js** automatically.
5. Add environment variables (section below).
6. Click **Deploy**.

**Why this flow:** Fastest setup with minimal CLI steps.

## Option B: Vercel CLI

### 1. Login

```bash
vercel login
```

**Why:** Authenticates CLI to your Vercel account.

### 2. Link project

```bash
vercel link
```

**Why:** Connects local folder to a Vercel project.

### 3. Add environment variables (example)

```bash
vercel env add DATABASE_URL production
vercel env add JWT_ACCESS_SECRET production
vercel env add JWT_REFRESH_SECRET production
vercel env add NEXT_PUBLIC_APP_URL production
vercel env add ENCRYPTION_KEY production
vercel env add CRON_SECRET production
vercel env add SENTIMENT_SERVICE_URL production
```

Add optional ones as needed:

```bash
vercel env add REDIS_URL production
vercel env add GROQ_API_KEY production
vercel env add SHOPIFY_CLIENT_ID production
vercel env add SHOPIFY_CLIENT_SECRET production
vercel env add SHOPIFY_WEBHOOK_SECRET production
vercel env add SHOPIFY_STOREFRONT_TOKEN production
vercel env add NEXT_PUBLIC_WIDGET_URL production
```

**Why:** Production serverless functions read config from Vercel env vars, not local `.env`.

### 4. Deploy preview

```bash
vercel
```

**Why:** Creates a preview deployment to validate before promoting.

### 5. Deploy to production

```bash
vercel --prod
```

**Why:** Pushes the active production deployment.

---

## 4) Required Environment Variables for Vercel

Set these in Vercel Project Settings -> Environment Variables:

- `DATABASE_URL` (required)
- `JWT_ACCESS_SECRET` (required)
- `JWT_REFRESH_SECRET` (required)
- `NEXT_PUBLIC_APP_URL` (required, your Vercel domain/custom domain)
- `ENCRYPTION_KEY` (required for Shopify token encryption/decryption)
- `CRON_SECRET` (required to protect cron endpoint)
- `SENTIMENT_SERVICE_URL` (required in production; URL of deployed Python service)

### Optional (feature dependent)
- `REDIS_URL` (recommended for distributed rate limiting)
- `GROQ_API_KEY` (required for AI features)
- Shopify settings:
  - `SHOPIFY_CLIENT_ID`
  - `SHOPIFY_CLIENT_SECRET`
  - `SHOPIFY_WEBHOOK_SECRET`
  - `SHOPIFY_STOREFRONT_TOKEN`
  - `NEXT_PUBLIC_WIDGET_URL`

**Why:** Missing required variables will break runtime paths (auth/DB/encryption/cron/sentiment).

---

## 5) Database Setup for Production

From local machine (with production `DATABASE_URL` available), run:

```bash
npm run db:push
```

or migration flow:

```bash
npm run db:generate
npm run db:migrate
```

**Why:** Vercel deploy does not auto-create your DB schema. Tables/enums must exist before app requests hit production.

---

## 6) Python Sentiment Service Deployment Notes

Deploy `python-service` as a separate Python web service and expose:
- `GET /health`
- `POST /predict`
- `POST /predict/batch`

Also ensure these files exist in that service:
- `sentiment_model.pkl`
- `vectorizer.pkl`

Set Vercel env var:
- `SENTIMENT_SERVICE_URL=https://your-python-service-domain`

**Why:** In production, this project expects an external sentiment endpoint via `SENTIMENT_SERVICE_URL`.

---

## 7) Post-Deploy Checks

After production deploy:
1. Open app URL and verify homepage loads.
2. Register/login flow works.
3. Create a project and API key.
4. Test `POST /api/v1/correct` with `x-api-key`.
5. Test one sentiment-related endpoint/flow.
6. If using Shopify, verify OAuth callback and webhook signature handling.

**Why:** Confirms app, DB, auth, and external integrations are functioning in real environment.

---

## 8) Common Vercel Issues and Fixes

- **Build fails on missing env var** -> Add missing variable in Vercel settings and redeploy.
- **Database connection errors** -> Verify `DATABASE_URL`, SSL requirements, and DB network rules.
- **Sentiment features fail** -> Check `SENTIMENT_SERVICE_URL` and Python service `/health`.
- **Rate-limit inconsistency across instances** -> Use `REDIS_URL` instead of in-memory fallback.
- **Shopify auth/webhooks fail** -> Recheck app URL, redirect URLs, and Shopify secrets.

---

## 9) Minimal Command Order (Quick Reference)

```bash
npm install
npm run build
git add .
git commit -m "Deploy prep"
git push
vercel login
vercel link
vercel env add DATABASE_URL production
vercel env add JWT_ACCESS_SECRET production
vercel env add JWT_REFRESH_SECRET production
vercel env add NEXT_PUBLIC_APP_URL production
vercel env add ENCRYPTION_KEY production
vercel env add CRON_SECRET production
vercel env add SENTIMENT_SERVICE_URL production
vercel --prod
```

Then run DB schema apply (`db:push` or migration flow) against your production database if not already done.
# AddressFix Deployment Guide (Vercel)

This guide explains:
- what to install
- which commands to run (in order)
- why each command/step is required

It is tailored for `project-2` (Next.js + PostgreSQL + optional Redis + external Python sentiment service).

## 1) Tools You Need To Install

### A. Git
- **Why:** Vercel deploys directly from your Git repository (GitHub/GitLab/Bitbucket).

### B. Node.js 18+ and npm
- **Why:** required to install dependencies, build locally, and run Vercel CLI checks.

### C. Vercel account
- **Why:** this is the hosting platform for your Next.js app.

### D. Vercel CLI (recommended)
```bash
npm i -g vercel
```
- **Why:** lets you link the project, set environment variables, run production-like builds, and trigger deployments from terminal.

### E. Managed PostgreSQL provider (required)
- Examples: Neon, Supabase, Railway, Render Postgres.
- **Why:** Vercel does not provide built-in persistent Postgres for this app; `DATABASE_URL` must point to a hosted database.

### F. Managed Redis provider (optional)
- Example: Upstash Redis.
- **Why:** optional rate limiting cache; if omitted, app falls back to in-memory limiter (not ideal for distributed production).

### G. Separate Python hosting for sentiment service (required for sentiment endpoints)
- Examples: Railway, Render, Fly.io, or another VM/container host.
- **Why:** this project’s Node code uses a local `uvicorn` process only in local/dev style workflows. On Vercel serverless, you should set `SENTIMENT_SERVICE_URL` to an external FastAPI service.

## 2) Pre-Deploy Commands (Local, In Order)

Run from project root (`project-2`).

### Step 1: Install dependencies
```bash
npm install
```
- **Why:** installs build/runtime dependencies (`next`, `drizzle`, `pg`, etc.) needed for a successful Vercel build.

### Step 2: Prepare environment template
```bash
cp .env.example .env.local
```
PowerShell:
```powershell
Copy-Item .env.example .env.local
```
- **Why:** gives you a local env file to validate all required variables before deploying.

### Step 3: Apply schema to your hosted Postgres
```bash
npm run db:push
```
- **Why:** creates required tables/enums in production database so app routes do not fail on first requests.

Alternative:
```bash
npm run db:generate
npm run db:migrate
```
- **Why:** migration-based flow if you prefer tracked SQL migration history.

### Step 4: Run a production build locally
```bash
npm run build
```
- **Why:** catches build-time errors before pushing/deploying to Vercel.

## 3) Required Environment Variables In Vercel

Set these in **Vercel Project Settings -> Environment Variables** (for Production, and Preview if needed):

### Core (required)
- `DATABASE_URL`  
  **Why:** app database connection for all core data flows.
- `JWT_ACCESS_SECRET`  
  **Why:** signs/verifies short-lived access tokens.
- `JWT_REFRESH_SECRET`  
  **Why:** signs/verifies rotating refresh tokens.
- `NEXT_PUBLIC_APP_URL` (your Vercel domain, e.g. `https://your-app.vercel.app`)  
  **Why:** used in docs/pages and callback URL generation.
- `CRON_SECRET`  
  **Why:** protects cron cleanup endpoint.
- `ENCRYPTION_KEY` (32-byte hex string)  
  **Why:** encrypts Shopify admin access tokens at rest.

### AI / Sentiment (feature-dependent)
- `GROQ_API_KEY`  
  **Why:** required for AI-enabled correction/chat features.
- `SENTIMENT_SERVICE_URL` (public URL of your deployed FastAPI service, no trailing slash)  
  **Why:** in production/serverless, this should point to external Python API rather than local spawn.

### Optional
- `REDIS_URL`  
  **Why:** distributed rate limiting/cache in production.

### Shopify (required only for Shopify integration)
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_WEBHOOK_SECRET`
- `SHOPIFY_STOREFRONT_TOKEN`
- `NEXT_PUBLIC_WIDGET_URL`
- **Why:** required for OAuth, webhook verification, storefront interactions, and widget behavior.

## 4) Deploy To Vercel (Command Flow)

### Option A: Git Integration (recommended)
1. Push code to GitHub/GitLab/Bitbucket.
2. Import repository in Vercel dashboard.
3. Add environment variables.
4. Deploy.

- **Why:** easiest ongoing workflow with automatic deployments per push/PR.

### Option B: Vercel CLI

#### First-time link/login
```bash
vercel login
vercel link
```
- **Why:** authenticates CLI and connects local folder to a Vercel project.

#### Deploy preview
```bash
vercel
```
- **Why:** creates a preview deployment for validation.

#### Deploy production
```bash
vercel --prod
```
- **Why:** promotes the current build to production environment.

## 5) Python Sentiment Service Deployment (Required for Sentiment APIs)

Deploy `python-service/` separately (Railway/Render/Fly/etc.) with:
- Python runtime
- install command:
```bash
pip install -r requirements.txt
```
- start command:
```bash
uvicorn model:app --host 0.0.0.0 --port $PORT
```

Also make sure these files exist in that service:
- `sentiment_model.pkl`
- `vectorizer.pkl`

- **Why:** `/health`, `/predict`, and `/predict/batch` depend on model artifacts loaded at startup.

## 6) Post-Deploy Verification

After deployment, test:
1. App loads from Vercel domain.
2. Auth works (register/login/refresh/logout).
3. DB writes succeed (create project/API key).
4. `POST /api/v1/correct` works with `x-api-key`.
5. If sentiment features enabled, check sentiment endpoint path that uses external service.
6. If Shopify enabled, test OAuth install callback + webhook signature flow.

- **Why:** confirms all critical runtime dependencies (DB, auth secrets, external APIs, and optional integrations) are wired correctly.

## 7) Useful Maintenance Commands

```bash
npm run lint
```
- **Why:** catches code quality issues before redeploy.

```bash
vercel env pull .env.local
```
- **Why:** syncs Vercel env vars to local for debugging parity.

```bash
vercel logs <deployment-url>
```
- **Why:** inspect runtime/serverless logs when debugging production issues.
