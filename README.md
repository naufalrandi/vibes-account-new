# OmniTenant API

Express + Sequelize + PostgreSQL modular monolith for OmniTenant User Management.

## Setup
1. `cp .env.example .env` and set `DATABASE_URL` / `DATABASE_URL_TEST`.
2. Ensure PostgreSQL is running and the `omnitenant` + `omnitenant_test` databases exist.
3. `npm install`
4. `npm run db:migrate`
5. `SEED_PASSWORD='<your own, 12+ chars>' npm run db:seed` (creates SO org AXIA + admin
   `soadmin` plus sample data; every seeded login gets `SEED_PASSWORD`. Seeding refuses to run
   without it — there is no default password. `db:reset` / `migrate:fresh` drop every table and
   refuse to run with `NODE_ENV=production`.)
6. `npm run dev` → http://localhost:4000

## Production checklist
- **Required env** (`src/config/env.ts`, all listed in `.env.example`): `NODE_ENV=production`,
  `DATABASE_URL`, `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (32+ chars each, e.g.
  `openssl rand -hex 32`), `APP_BASE_URL` (the public frontend URL — boot refuses localhost),
  `SMTP_HOST` + `MAIL_FROM` (boot refuses without them), `CORS_ALLOWED_ORIGINS` (the real
  frontend origin(s)).
- **TLS + `TRUST_PROXY`**: terminate HTTPS in front of the API and set `TRUST_PROXY` to that
  proxy's hop count or address, or every client shares the proxy's IP for rate limiting and
  login history. Use `DB_SSL=true` when Postgres is reached over a network.
- **`SEED_PASSWORD`**: only for `npm run db:seed`; pick a strong one (12+ chars) or don't seed
  production at all. `db:reset` / `migrate:fresh` refuse to run with `NODE_ENV=production`.
- **Probes**: `/health` is liveness (never touches the DB); `/ready` is readiness (`SELECT 1`,
  503 while the DB is unreachable) — point the load balancer at `/ready`.
- **Migrations** run on boot under a Postgres advisory lock, so replicas starting together
  don't race; keep `DB_POOL_MAX` ≥ 2 (the lock and the migrations use separate connections).
- **Uploads**: CMS media is written to `/app/uploads` — mount a persistent volume there
  (`docker-compose.yml` does), or uploads vanish on every redeploy.

## AI connection
One platform-level AI provider connection (Anthropic or any OpenAI-compatible endpoint), set by
the Service Owner under Organization Settings → AI and stored in `ai_connections`.
- Set `AI_ENCRYPTION_KEY` (`openssl rand -base64 32`) before saving a key; the key is stored
  AES-256-GCM-encrypted and never returned by the API (only a `…abcd` hint) nor audited.
- Endpoints: `GET|PUT|DELETE /v1/ai/connection`, `POST /v1/ai/connection/test|models`
  (grants `ai.settings.read` / `ai.settings.manage`, Service Owner only) and
  `GET /v1/ai/status` (any signed-in user → `{ available }`).
- `aiComplete({ system?, messages, maxTokens? })` in `src/lib/ai` (and `aiCompleteJson` in
  `src/lib/ai/json.ts`) is the low-level call — feature code uses `ctx.ai` (below) instead; it
  throws `AI_NOT_CONFIGURED` (409) when no enabled connection exists and `AI_PROVIDER_ERROR`
  (502) on provider failure.

## AI features
Feature framework on top of the connection: `src/modules/ai/features/` (how to add one:
its `README.md`). Each `<key>.feature.ts` there is auto-loaded; actions are drafts for human
review and every model call is recorded in `ai_generations` and audited (`ai.generation`).
- `GET /v1/ai/features` → `{ available, features: [{ key, label, description, enabled, actions }] }`
  (`actions` = the ones the caller may run).
- `POST /v1/ai/features/:feature/:action` → the action's output (incl. `generationId`), or
  `202 { jobId }` for job actions. 404 `AI_FEATURE_NOT_FOUND`, 409 `AI_NOT_CONFIGURED`,
  403 `AI_FEATURE_DISABLED` / missing grant, 400 `VALIDATION_ERROR`, 502 `AI_PROVIDER_ERROR`.
- `GET /v1/ai/jobs/:id`, `POST /v1/ai/generations/:id/feedback { status }` (own org),
  `GET /v1/ai/usage?from&to[&orgId]` (`ai.settings.read`),
  `GET|PUT /v1/ai/feature-flags` (`ai.settings.manage`, Service Owner; a Service Owner org row
  is the platform default, another org's row overrides it, no row = enabled).
- Job actions and scheduled tasks run in the worker: `npm run worker` (`npm run worker:dev`
  locally); docker-compose runs it as the `worker` service. **The worker must be running** —
  without it job actions stay `queued` and no deadline digests are sent. A job orphaned by a
  crashed worker is retried after 15 min, or failed ("Worker stopped while running this job")
  once its attempts are used up.

Feature keys (each can be switched off per org via `/v1/ai/feature-flags`):
- `summarize` — summarize any block of text (open to every signed-in user).
- `ask-vibes` — read-only Q&A over the caller's registers, with citations (tools check the caller's read grants).
- `deadline-agent` — daily digest (bell + email, hourly worker schedule, 07:00 org time) and a "My deadlines" preview.
- `doc-writer` — drafts policy fields and procedures, improves selected text, suggests version change summaries.
- `gap-report` — certification-readiness gap report and 30/60/90-day roadmap from a finalized gap assessment.
- `onboarding` — first scope, context issues, interested parties, processes and objectives from a company profile.
- `triage` — concern classification with likely duplicates, CSAT comment analysis, ticket categories and replies.
- `capa-copilot` — root-cause analyses, corrective action plans and incident investigations.
- `audit-copilot` — internal-audit session checklists, findings from notes, report summaries.
- `mr-autopilot` — management review inputs from live data; minutes, decisions and actions from notes.
- `isra-copilot` — risk scenarios, control rationales, treatment plans, SoA justifications, risk action plans.
- `competence-assist` — role profiles, exam questions, awareness quizzes, suggested grades for written answers.
- `hr-assist` — job adverts, candidate professional-record summaries, plain-language contract explanations.
- `kb-assistant` — KB answers with citations (also the public `/v1/public/ai/kb/:orgId` endpoint) and KB drafts from tickets.
- `sales-assist` — lead qualification, inquiry scope, proposal content, contract clauses (prices stay system-calculated).
- `procurement-assist` — supplier quote comparison, QC notes, PO / receipt / invoice mismatch explanations.
- `cab-assist` — Exelera CAB certification audit reports and impartiality-threat analysis.
- `pentest-assist` — Datana penetration-test finding write-ups and engagement executive summaries.

## Test
`npm run test` (requires a reachable `omnitenant_test` Postgres DB). `test/setup.ts` loads
`.env.test` (committed, points at `127.0.0.1:5432`) before any developer `.env`, so `npm test`
boots without any local setup as long as Postgres is reachable at that address with the
`omnitenant_test` DB migrated (`npm run db:migrate` against `DATABASE_URL_TEST`). No CI
pipeline exists yet in this repo; when one is added it should provision Postgres the same way
and either reuse `.env.test` or override `DATABASE_URL_TEST`/`JWT_*` secrets as CI env vars.

## Endpoints (v1)
- `POST /v1/auth/login|refresh|logout|activate|password/forgot|password/reset`
- `GET/POST /v1/organizations`, `GET /v1/organizations/:id`, `POST /v1/organizations/:id/activate|suspend`
- `POST /v1/registration-requests`, `POST /v1/registration-requests/:id/approve|reject`
- `GET/POST /v1/users`, `PATCH /v1/users/:id/status`, `POST /v1/users/:id/roles`, `DELETE /v1/users/:id/roles/:roleId`
- `GET /v1/audit`, `GET /v1/audit/login-history/:id`
- `GET /v1/roles`, `GET /v1/roles/:id/grants`, `PUT /v1/roles/:id/grants`
- `GET /v1/menu` (current user's role-filtered menu tree + access map), `GET /v1/menu/all`, `POST /v1/menu`

Authorization is a **menu/action grant matrix**: routes are gated by `requireAction('<key>')`; a super-admin role bypasses. All responses use `{ success, data, error, meta }`. Auth via `Authorization: Bearer <accessToken>`.
