# Loyalty Program

A complete loyalty programme for an online store: points, levels, rewards, redemptions, an
internal panel with editable roles and a customer portal. It downloads customers, orders and
payments from fakeapi.dev, stores them in its own database and calculates everything as of the
fixed cutoff date **2026-04-30**.

Everything in this repository, including code comments and UI copy, is written in English.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router, React 19, TypeScript) | Deploys to Vercel with no extra infrastructure and keeps every secret on the server. |
| Styling | Tailwind CSS 4 plus a small token layer in `app/globals.css` | One stylesheet, `light-dark()` tokens, no client runtime for styling. |
| Database | Postgres (Drizzle ORM) | Real transactions and serializable isolation, which the redemption rule needs. |
| Local database | PGlite | In-process Postgres, so local setup needs no server and the test suite runs on the same SQL. |
| Auth | scrypt hashes plus hashed opaque session tokens | No native build dependency, no JWT secret to leak, revocation is a database delete. |
| Images | Vercel Blob | Photos never live in the database; only the public URL is stored. |

## Run it locally

```bash
npm install
cp .env.example .env      # fill ADMIN_PASSWORD, MANAGER_PASSWORD, SUPPORT_PASSWORD
npm run db:migrate        # applies drizzle/*.sql to .data/pglite
npm run db:seed           # creates the three preset roles, one user per role, starter rewards
npm run dev               # http://localhost:3000
```

With no `DATABASE_URL` the app uses the embedded database in `.data/pglite`. To use a hosted
Postgres, set `DATABASE_URL` and run `npm run db:migrate` again.

`npm run verify` runs the rules, sync aggregation and redemption tests against an in-memory
database.

### Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | in production | Postgres connection string. Empty for PGlite. |
| `FAKEAPI_API_KEY` | yes, for sync | Bearer key for fakeapi.dev. Server only. |
| `FAKEAPI_BASE_URL` | no | Defaults to `https://fakeapi.dev/api/v1`. |
| `CRON_SECRET` | yes, in production | Shared secret Vercel Cron sends to `/api/cron/sync`. |
| `BLOB_READ_WRITE_TOKEN` | optional | Enables reward photo uploads. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | for seeding | Credentials of the seeded administrator. |
| `MANAGER_EMAIL` / `MANAGER_PASSWORD` | for seeding | Credentials of the seeded manager. |
| `SUPPORT_EMAIL` / `SUPPORT_PASSWORD` | for seeding | Credentials of the seeded support user. |

Credentials belong in the delivery email, never in this repository. The seed script only reads
them from the environment and stores hashes.

## Data model

```mermaid
erDiagram
  roles ||--o{ staff_users : "grants"
  customers ||--o| client_accounts : "portal access"
  customers ||--o{ orders : "places"
  customers ||--o{ payments : "pays"
  customers ||--o{ point_movements : "earns"
  customers ||--o| customer_metrics : "cached totals"
  customers ||--o{ redemptions : "redeems"
  rewards ||--o{ redemptions : "is redeemed as"
  redemptions ||--o| coupons : "issues"
  staff_users ||--o{ sessions : "signs in"
  client_accounts ||--o{ sessions : "signs in"
  staff_users ||--o{ api_tokens : "creates"
  sync_runs }o--|| sync_runs : "logged"

  roles { uuid id text name text_array permissions }
  staff_users { uuid id text email text password_hash uuid role_id bool active }
  customers { int id text name text email text dob }
  client_accounts { uuid id int customer_id text email text password_hash bool must_change_password }
  orders { int id int customer_id text status text payment_status }
  payments { int id int customer_id int amount_mxn_cents text status timestamptz paid_at }
  point_movements { uuid id int customer_id text type text reference int points text occurred_on }
  customer_metrics { int customer_id int points_earned int spend_cents text level bool at_risk }
  rewards { uuid id text kind int points_cost int stock text min_level int per_customer_limit }
  redemptions { uuid id int customer_id uuid reward_id int points_cost text status }
  coupons { uuid id text code uuid redemption_id timestamptz expires_at text status }
  sync_runs { uuid id text trigger text status int requests int records }
```

`point_movements` has a unique key on `(customer_id, type, reference)`. That single constraint is
what makes the sync idempotent and stops a replayed payment from paying points twice.

## Architecture

```mermaid
flowchart LR
  cron[Vercel Cron daily] -->|Bearer CRON_SECRET| sync[/api/cron/sync/]
  panel[Internal panel\nroles + permissions] -->|manual sync| sync
  sync -->|paged requests, per_page=100| source[(fakeapi.dev\nusers, orders, payments)]
  sync --> db[(Postgres\nnormalised rows + ledger)]
  panel --> db
  portal[Customer portal] --> db
  evaluator[Evaluation browser] -->|Bearer API token| api[/api/fidelizacion/*/]
  api --> db
  db --> blob[(Vercel Blob\nreward photos)]
```

The panel and the portal only read the local database. The source API is contacted by the sync
job and by nothing else.

## Business rules

Cutoff **2026-04-30**, dates converted from UTC to Mexico time (UTC-6, no daylight saving).

| Rule | Implementation |
| --- | --- |
| Currency conversion | Fixed rates: USD 18.50, EUR 20.00, GBP 23.50, CAD 13.50, AUD 12.00. Unknown currency is ignored. |
| Points per payment | `floor(mxn / 10)` per payment with `status = succeeded`. |
| Refund | `refunded` creates the positive movement plus a negative movement, netting zero. |
| Order bonus | `+250` for `delivered` and `paid`, dated at the order `created_at`. |
| Spend and level | Succeeded payments in the 365 days up to the cutoff. Bronce below 150,000 MXN, Plata from 150,000, Oro above 400,000. |
| At risk | At least one succeeded payment and 90 or more days without activity. |
| Birthdays | `dob` month and day inside the cutoff plus 7 days, both inclusive. |
| Ignored rows | Payments and orders after the cutoff, and rows whose customer is absent from `/users`. |

Money is stored in integer cents, so no calculation uses floating point. `lib/loyalty.ts` holds
these rules as pure functions and `tests/loyalty.test.ts` checks each boundary.

## Redemptions

`lib/redeem.ts` runs one serializable transaction that re-checks everything:

1. the reward exists and is active;
2. the customer level is at least the reward minimum;
3. available points cover the cost;
4. the per customer limit is not reached;
5. the stock decrement is `UPDATE ... WHERE stock > 0`, so the database refuses to oversell;
6. the negative `canje` movement, the redemption and the coupon are inserted together.

A serialization failure is retried up to three times, so two simultaneous requests for the last
unit leave exactly one winner. Cancelling restores the stock and adds a positive `devolucion`
movement; a sync never touches either.

## API

All three endpoints require `Authorization: Bearer <token>`, created in **API tokens**, and answer
`Access-Control-Allow-Origin: *` plus an `OPTIONS` preflight.

| Endpoint | Returns |
| --- | --- |
| `GET /api/fidelizacion/clientes/{id}` | `cliente_id`, `puntos`, `puntos_disponibles`, `nivel`, `gasto_12m`, `en_riesgo`, `dias_sin_actividad`, `movimientos[]` |
| `GET /api/fidelizacion/riesgo` | Complete list of `{ cliente_id, dias_sin_actividad }` |
| `GET /api/fidelizacion/cumpleanos` | Complete list of `{ cliente_id, fecha_cumpleanos }` |

```bash
curl -H "Authorization: Bearer $TOKEN" https://your-app.vercel.app/api/fidelizacion/clientes/241
```

`puntos` counts source activity only, while `puntos_disponibles` subtracts redemptions, matching
the specification.

## Roles

The permission catalogue lives in `lib/constants.ts`; roles are editable rows. Presets:

| Permission | Administrator | Manager | Customer Support |
| --- | --- | --- | --- |
| View dashboard | yes | yes | yes |
| Search customers | yes | yes | yes |
| View money amounts | yes | yes | no |
| Risk and birthday lists | yes | yes | yes |
| Export CSV | yes | yes | no |
| Manage rewards | yes | yes | no |
| Manage redemptions | yes | yes | yes |
| Generate portal access | yes | yes | yes |
| Run synchronisation | yes | no | no |
| Manage users | yes | no | no |
| Manage roles | yes | no | no |
| Manage API tokens | yes | no | no |

Every page and every server action calls `requirePermission`; only the navigation hides links.

## Security decisions

- Passwords: scrypt with a random salt, compared in constant time. Portal passwords are generated
  with 14 random characters, shown once in a `no-store` HTML page, and only the hash is stored.
- Sessions: 32 random bytes in an httpOnly, sameSite=lax cookie. The database stores a SHA-256
  hash, sessions expire, and sign out deletes the row.
- Portal isolation: the customer id comes from the session in every portal query and action.
- API tokens: SHA-256 hash only, revocable, never rendered after creation.
- Source key and cron secret: read only on the server, never sent to the browser.
- CSV export and the raw HTML pages set `Cache-Control: no-store`.

## Deploy to Vercel

The repository is already prepared for the free tier: `vercel.json` registers the daily cron,
`package.json` declares `vercel-build`, and one synchronisation run finishes in about 25 seconds,
inside the 60 second function limit.

### 1. Create the database

1. Sign up at neon.com and create a free project in the region closest to the function, for
   example `us-east-1`, which pairs with Vercel's default `iad1`.
2. Press **Connect** and copy the connection string. It looks like
   `postgresql://user:password@ep-xxxx.us-east-1.aws.neon.tech/neondb?sslmode=require`.
3. Keep it for step 3. This is the only credential the application cannot generate itself.

### 2. Import the project

1. Push the repository to GitHub. `.env`, `.data/` and `.notes/` are gitignored, so no credential
   is uploaded.
2. In Vercel choose **Add New**, then **Project**, then **Import** the repository.
3. Keep the Framework preset **Next.js** and leave Root Directory, Install Command and Output
   Directory at their defaults. Do not set a Build Command: `vercel-build` already exists.

### 3. Environment variables

Project, Settings, Environment Variables. Add every name for **Production**, and again for
**Preview** if the preview deployment should work too:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the Neon connection string, including `?sslmode=require` |
| `FAKEAPI_API_KEY` | the source API key |
| `CRON_SECRET` | output of `openssl rand -hex 32` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | the administrator account you will sign in with |
| `MANAGER_EMAIL`, `MANAGER_PASSWORD` | the manager account |
| `SUPPORT_EMAIL`, `SUPPORT_PASSWORD` | the support account |
| `BLOB_READ_WRITE_TOKEN` | optional, only for reward photo uploads |

`FAKEAPI_BASE_URL` is not needed in production: it defaults to `https://fakeapi.dev/api/v1`. The
values typed in this screen never belong in a file in the repository; the delivery email carries
the staff credentials only.

### 4. First deployment

Press **Deploy**. `vercel-build` runs three steps in order:

1. `npm run db:migrate` creates the 13 tables in the Neon database.
2. `npm run db:seed` creates the three preset roles, one staff user per role from the variables
   above and the four starter rewards.
3. `next build` compiles the application.

Both scripts skip what already exists, so later deployments are safe and never reset a password or
overwrite an edited reward.

### 5. Load the data

1. Open `https://<project>.vercel.app/login` and sign in with `ADMIN_EMAIL`.
2. Go to **Synchronisation** and press **Run synchronisation** once.
3. Confirm the dashboard shows 1000 customers and the level split Bronce 505, Plata 427, Oro 68.

From then on Vercel Cron calls `/api/cron/sync` every day at 09:00 UTC with
`Authorization: Bearer $CRON_SECRET`, and the run is recorded in the same screen.

### 6. Create an API token for the evaluator

1. Open **API tokens** and create one token.
2. Copy it immediately: only its hash is stored and it is shown once.
3. Send the deployment URL and the token in the delivery email.

### 7. Check the delivery

1. Open the URL in a private window with no Vercel session. A password prompt there means
   Deployment Protection is on: turn it off in Settings, Deployment Protection.
2. Run `curl -H "Authorization: Bearer $TOKEN" https://<project>.vercel.app/api/fidelizacion/riesgo`;
   it must answer JSON. The same URL without the header must answer 401.
3. Post-deployment logs (Deployments, Functions) show the cron run and its record count.

Vercel Hobby allows one cron run per day and runs it within the hour, which is enough because the
job is idempotent. A run started from the panel has the same 60 second limit.

## Verification

`npm run verify` covers currency conversion, point floor, refunds, order bonuses, the spend
window, level thresholds, risk, birthdays, sync idempotency, stock enforcement and cancellation
refunds. `npm run typecheck`, `npm run lint` and `npm run build` are the remaining checks.

## Not implemented

Optional extras from the specification were left out on purpose: incremental sync, audit log,
login throttling, email or WhatsApp messages, in-portal notifications, the /products import and a
source inconsistency report.
