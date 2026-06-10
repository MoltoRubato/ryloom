# Deploying Ryloom

Three pieces: **Supabase** (auth + Postgres + storage), **Vercel** (web app),
and a **Docker worker** (FFmpeg + AI). ~30 minutes end to end.

---

## 1. Supabase project

1. Create a project at [database.new](https://database.new). Note your **project ref**
   and **database password**.
2. Apply the migrations (from the repo root):
   ```bash
   npm i -g supabase            # or brew install supabase/tap/supabase
   supabase init                # creates supabase/config.toml (keep our migrations/)
   supabase link --project-ref <YOUR_PROJECT_REF>
   supabase db push             # applies supabase/migrations/*.sql in order
   ```
   This creates all tables, RLS policies, the 7 storage buckets, the
   `auth.users → profiles` trigger, and full-text-search columns.
3. Collect keys from **Project Settings → API**:
   - `NEXT_PUBLIC_SUPABASE_URL` — Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon public key
   - `SUPABASE_SERVICE_ROLE_KEY` — service role key (server/worker only!)
4. Connection strings from **Project Settings → Database → Connection string**:
   - `DATABASE_URL` (web): **Transaction pooler**, port **6543**
   - `WORKER_DATABASE_URL` (worker): **Session/direct**, port **5432**
     (the worker uses `LISTEN/NOTIFY`, which doesn't work through the transaction pooler)

### Auth configuration (Dashboard → Authentication)

- **URL Configuration**: set *Site URL* to your production URL
  (e.g. `https://ryloom.example.com`) and add
  `https://ryloom.example.com/auth/callback` + `http://localhost:3000/auth/callback`
  to *Redirect URLs*.
- **Providers → Email**: enabled by default (email confirmations recommended).
- **Providers → Google** (optional): create an OAuth client in Google Cloud Console
  (type *Web application*; authorized redirect URI =
  `https://<PROJECT_REF>.supabase.co/auth/v1/callback`), paste client ID/secret.
- **SAML SSO (Enterprise feature)**: available on Supabase Pro plans —
  [docs](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml).
  After configuring a SAML provider, put its provider ID in
  *Workspace settings → Security → SSO* in Ryloom.

## 2. Web app on Vercel

1. Push this repo to GitHub and import it in Vercel.
2. **Root Directory**: `apps/web` (Vercel auto-detects the pnpm workspace).
3. Environment variables (Production + Preview):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from step 1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
   | `DATABASE_URL` | pooled (6543) string |
   | `NEXT_PUBLIC_APP_URL` | `https://your-domain` |
   | `IP_HASH_SALT` | any long random string |
   | `RESEND_API_KEY` / `EMAIL_FROM` | optional — invite/notification emails |
   | `STRIPE_*` | optional — see step 4 |

4. Deploy. Sign up, complete onboarding, record a test video
   (it will sit in "Processing" until the worker is running).

## 3. Worker (Fly.io, Railway, Render, or any Docker host)

The worker is a long-running container — **do not** try to run it on Vercel.

Env vars (all hosts): `WORKER_DATABASE_URL` (direct, 5432), `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` (transcription + AI; optional but
recommended), `AI_MODEL` (default `gpt-4o-mini`), `WORKER_CONCURRENCY` (default 2).

**Fly.io**
```bash
cd <repo root>
fly launch --no-deploy --copy-config --config apps/worker/fly.toml
fly secrets set WORKER_DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=...
fly deploy --dockerfile apps/worker/Dockerfile
```
Recommended VM: `shared-cpu-2x` / 2GB+ for 1080p; scale up for 4K/HLS workloads.

**Railway**: new service → Deploy from repo → set *Dockerfile path* to
`apps/worker/Dockerfile` → add the env vars → deploy.

**Anywhere with Docker**
```bash
docker build -f apps/worker/Dockerfile -t ryloom-worker .
docker run -d --restart unless-stopped --env-file apps/worker/.env ryloom-worker
```

## 4. Stripe billing (optional)

Without Stripe, everything still works — workspace owners can set plans manually in
*Settings → Billing* (self-hosting mode). With Stripe:

1. Create 3 products (Pro, Business, Business + AI), each with a monthly and a
   yearly recurring price. Copy the 6 price IDs into the `STRIPE_PRICE_*` env vars.
2. Set `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint `https://your-domain/api/webhooks/stripe` with events
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`;
   set `STRIPE_WEBHOOK_SECRET` from the signing secret.
4. Redeploy. Upgrades now flow through Checkout; plan changes sync via the webhook.

## 5. Chrome extension (optional)

`chrome://extensions` → enable *Developer mode* → *Load unpacked* → select the
`extension/` folder. Open the extension options and set your app URL
(defaults to `http://localhost:3000`). `Alt+Shift+R` starts a recording.

## 6. SCIM provisioning (Enterprise)

1. Set env `SCIM_ENABLED=true` on Vercel.
2. In Ryloom: *Workspace settings → Security → SCIM* → create a token (shown once).
3. In your IdP (Okta/Entra): SCIM base URL `https://your-domain/api/scim/v2`,
   bearer auth with that token. Supported: GET/POST/PATCH/PUT/DELETE `/Users`.

## Notes & limits

- **Uploads** go browser → Supabase Storage via TUS (6MB chunks, resumable).
  The 4.5MB Vercel body limit is never in play.
- **Private playback**: MP4s use short-lived signed URLs; HLS uses a token-checked
  proxy route (`/api/hls/...`) that 302s segments to signed URLs.
- **Supabase free tier** caps storage at 1GB and file uploads at 50MB — fine for
  testing; use a paid plan (or point storage at R2/S3 via a future adapter) for real use.
- **Retention policies** run inside the worker (12-hourly sweep). Legal hold
  blocks permanent deletion regardless of retention settings.
- Raw viewer IPs are never stored — only salted hashes (`IP_HASH_SALT`).
