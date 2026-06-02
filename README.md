# OmniTenant API

Express + Sequelize + PostgreSQL modular monolith for OmniTenant User Management.

## Setup
1. `cp .env.example .env` and set `DATABASE_URL` / `DATABASE_URL_TEST`.
2. Ensure PostgreSQL is running and the `omnitenant` + `omnitenant_test` databases exist.
3. `npm install`
4. `npm run db:migrate`
5. `npm run db:seed` (creates SO org AXIA + admin `soadmin` / `ChangeMe123`)
6. `npm run dev` → http://localhost:4000

## Test
`npm run test` (requires `omnitenant_test`).

## Endpoints (v1)
- `POST /v1/auth/login|refresh|logout|activate|password/forgot|password/reset`
- `GET/POST /v1/organizations`, `GET /v1/organizations/:id`, `POST /v1/organizations/:id/activate|suspend`
- `POST /v1/registration-requests`, `POST /v1/registration-requests/:id/approve|reject`
- `GET/POST /v1/users`, `PATCH /v1/users/:id/status`, `POST /v1/users/:id/roles`, `DELETE /v1/users/:id/roles/:roleId`
- `GET /v1/audit`, `GET /v1/audit/login-history/:id`
- `GET /v1/roles`, `GET /v1/roles/:id/grants`, `PUT /v1/roles/:id/grants`
- `GET /v1/menu` (current user's role-filtered menu tree + access map), `GET /v1/menu/all`, `POST /v1/menu`

Authorization is a **menu/action grant matrix**: routes are gated by `requireAction('<key>')`; a super-admin role bypasses. All responses use `{ success, data, error, meta }`. Auth via `Authorization: Bearer <accessToken>`.
