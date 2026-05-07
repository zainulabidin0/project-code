# AddressFix (project-2)

MicroSaaS scaffold: Next.js 14 (App Router), Drizzle + PostgreSQL, Redis (optional; in-memory rate limits when absent), JWT access + rotating refresh cookies, Groq AI layer, and an `sdk/` npm package.

## Setup

1. Copy `.env.example` to `.env.local` and set `DATABASE_URL`, `JWT_*` secrets, and optionally `REDIS_URL` and `GROQ_API_KEY`.
2. Push schema: `npm run db:push` (or generate migrations with `npm run db:generate`).
3. `npm run dev` — open http://localhost:3000

Register, create a project, generate an API key, then call `POST /api/v1/correct` with header `x-api-key`.

## SDK

```bash
cd sdk && npm run build
```

Point `baseUrl` at your app origin when self-hosting (see `sdk/src/client.ts`).
