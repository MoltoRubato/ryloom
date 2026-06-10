# Deploying Ryloom (step by step)

Ryloom has three deployable pieces and one buildable artifact:

| Piece | What it is | Where it runs |
|---|---|---|
| **Supabase project** | Auth, Postgres, file storage | supabase.com (managed) |
| **Web app** (`apps/web`) | Dashboard, share pages, API | Vercel |
| **Worker** (`apps/worker`) | FFmpeg + AI processing | Any Docker host (Railway/Fly/Render) |
| **Desktop app** (`apps/desktop`) | The macOS recorder | Built once, shared with the team |

Total time: roughly 30–45 minutes. Do the steps in order — each one verifies
before the next begins.

> **Access control:** Ryloom is locked to `@lyratechnologies.com.au` accounts
> by default (the `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` env var). Anyone else who
> signs in is rejected at the door. There is no billing — every workspace has
> every feature, unlimited.

---

## Step 0 — Prerequisites (5 min)

On your Mac:

```bash
# Node 20+ (check)
node --version

# pnpm
npm install -g pnpm

# Supabase CLI
brew install supabase/tap/supabase   # or: npm install -g supabase

# Clone + install
git clone <your-github-repo-url> ryloom
cd ryloom
pnpm install
```

Accounts you'll need: [supabase.com](https://supabase.com) (free tier works for
testing; Pro recommended for real usage because of storage limits),
[vercel.com](https://vercel.com), and one of [railway.app](https://railway.app) /
[fly.io](https://fly.io) for the worker. An [OpenAI API key](https://platform.openai.com/api-keys)
powers transcription + AI features.

---

## Step 1 — Supabase project (10 min)

### 1.1 Create the project

1. Go to [database.new](https://database.new).
2. Name: `ryloom`. Pick the region closest to your team (e.g. `ap-southeast-2`
   Sydney). Generate a strong **database password and save it** — you need it
   for connection strings.
3. Wait ~2 minutes for provisioning.

### 1.2 Apply the database migrations

From the repo root:

```bash
supabase init        # creates supabase/config.toml — keep our migrations/ folder
supabase link --project-ref <YOUR_PROJECT_REF>   # ref = the id in your project URL
supabase db push     # applies all files in supabase/migrations/ in order
```

This creates the 25+ tables, row-level-security policies, the 7 storage
buckets, the `auth.users → profiles` trigger, job-queue notifications, and
full-text search. **Verify:** in the dashboard, *Table Editor* should show
`videos`, `workspaces`, `processing_jobs`, etc., and *Storage* should show
`raw-recordings`, `processed-videos`, `thumbnails`, and 4 more buckets.

### 1.3 Collect your keys

Project Settings → **API**:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` *(server-side secret — never expose)*

Project Settings → **Database** → *Connection string*:

- **Transaction pooler** (port `6543`) → `DATABASE_URL` (used by the web app)
- **Session pooler / Direct** (port `5432`) → `WORKER_DATABASE_URL` (used by the
  worker — it needs LISTEN/NOTIFY, which the transaction pooler doesn't support)

Substitute your database password into both strings.

### 1.4 Configure auth URLs

Authentication → **URL Configuration**:

- **Site URL**: your production URL once you have it (e.g.
  `https://ryloom.vercel.app`) — use `http://localhost:3000` until then.
- **Redirect URLs** — add all of:
  - `http://localhost:3000/auth/callback`
  - `https://<your-production-domain>/auth/callback`

### 1.5 Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   create a project (or reuse the company one) → *Credentials* → *Create
   credentials* → **OAuth client ID** → type **Web application**.
2. Authorized redirect URI (exactly one, from Supabase):
   `https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback`
3. If prompted to configure the consent screen: **Internal** user type is
   perfect for a Google Workspace org — it limits sign-in to your org at
   Google's level too.
4. Copy the client ID + secret into Supabase → Authentication → **Providers →
   Google** → enable.

> Ryloom additionally enforces the `@lyratechnologies.com.au` restriction
> server-side on every sign-in and every API call, so even a personal Gmail
> that somehow authenticates gets rejected.

---

## Step 2 — Web app on Vercel (10 min)

1. Push this repo to GitHub (see Step 6 if not done yet) and **Import** it at
   [vercel.com/new](https://vercel.com/new).
2. **Root Directory**: click *Edit* and set it to `apps/web`. Vercel detects
   Next.js + the pnpm workspace automatically. Leave build settings default.
3. **Environment Variables** — add these (Production + Preview):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from step 1.3 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 1.3 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1.3 |
   | `DATABASE_URL` | pooled string, port **6543** |
   | `NEXT_PUBLIC_APP_URL` | `https://<your-vercel-domain>` |
   | `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | `lyratechnologies.com.au` |
   | `IP_HASH_SALT` | any long random string (`openssl rand -hex 24`) |
   | `RESEND_API_KEY` | *(optional)* for invite/comment emails |
   | `EMAIL_FROM` | *(optional)* e.g. `Ryloom <ryloom@lyratechnologies.com.au>` |
   | `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL` | *(add later, step 4)* |
   | `WORKER_WAKE_URL` / `WORKER_WAKE_TOKEN` | *(optional, from step 3 if using Modal)* |

4. **Deploy.** When it's live:
   - go back to Supabase → Authentication → URL Configuration and set **Site
     URL** to the production URL (and confirm the redirect URL is listed);
   - update `NEXT_PUBLIC_APP_URL` in Vercel if your domain changed, and redeploy.

**Verify:** open the production URL → you should see the landing page. Sign in
with your `@lyratechnologies.com.au` Google account → onboarding → create a
workspace → you land in the library. Record a short test clip at `/record` —
it will sit on "Processing…" because the worker isn't running yet. That's
expected; continue.

---

## Step 3 — Worker (10 min)

The worker runs FFmpeg + AI jobs from the database queue — no inbound
networking required. It supports two modes:

- **Continuous** (default): runs 24/7 and polls — for Railway/Fly/any Docker box.
- **Drain** (`WORKER_DRAIN=true`): wakes up, processes everything queued, exits —
  built for **Modal's** scale-to-zero free tier.

### Pick an AI key first (either one)

| Key | Where to get it | What you get |
|---|---|---|
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — **free tier** | Transcription + all AI features. Word timing is approximate, so filler-word removal is best-effort. |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) — pay-as-you-go | Whisper transcription with word-level timestamps → precise filler-word removal. |

Set one (or both — OpenAI wins for transcription when both are present).
Without either, videos still process fully; only transcripts/AI features no-op.

Common environment variables:

| Name | Value |
|---|---|
| `WORKER_DATABASE_URL` | direct string, port **5432** |
| `SUPABASE_URL` | same as `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 1.3 |
| `GEMINI_API_KEY` *or* `OPENAI_API_KEY` | see table above |
| `AI_MODEL` | optional (defaults: `gemini-2.5-flash` / `gpt-4o-mini`) |
| `WORKER_CONCURRENCY` | `2` (raise on bigger machines) |

### Option A — Modal (free tier, recommended on no budget)

Modal's Starter plan includes ~$30/month of compute, billed per second with
scale-to-zero — the drain-mode worker typically uses cents per recorded hour.

```bash
pip install modal
modal setup                      # one-time browser auth

# Secrets (one secret bundle named exactly "ryloom-worker"):
modal secret create ryloom-worker \
  WORKER_DATABASE_URL='postgresql://...:5432/postgres' \
  SUPABASE_URL='https://YOUR-PROJECT.supabase.co' \
  SUPABASE_SERVICE_ROLE_KEY='eyJ...' \
  GEMINI_API_KEY='AIza...' \
  WAKE_TOKEN='any-random-string'

# Deploy (from the repo root):
modal deploy apps/worker/modal_app.py
```

The deploy prints a **wake endpoint URL**. Two things happen now:

1. A scheduled function checks the queue **every minute** and drains it —
   recordings process within ~1 minute even with no further setup.
2. For instant pickup, copy the wake URL into Vercel as `WORKER_WAKE_URL`
   (and your `WAKE_TOKEN` value as `WORKER_WAKE_TOKEN`), then redeploy the web
   app — it pings Modal the moment a job is enqueued.

**Verify:** `modal app logs ryloom-worker` while you record a test clip.

### Option B — Railway

1. [railway.app](https://railway.app) → New Project → **Deploy from GitHub repo**.
2. Service settings → *Build* → **Dockerfile Path** = `apps/worker/Dockerfile`.
3. Add the env vars above → Deploy. (~$5/mo with usage-based pricing.)

### Option C — Fly.io

```bash
fly launch --no-deploy --copy-config --config apps/worker/fly.toml
fly secrets set WORKER_DATABASE_URL='...' SUPABASE_URL='...' \
  SUPABASE_SERVICE_ROLE_KEY='...' GEMINI_API_KEY='...'
fly deploy --dockerfile apps/worker/Dockerfile
```

Use a `shared-cpu-2x` / 2GB+ machine for 1080p; bigger for 4K/HLS-heavy loads.

### Option D — any Docker box

```bash
docker build -f apps/worker/Dockerfile -t ryloom-worker .
docker run -d --restart unless-stopped --env-file apps/worker/.env ryloom-worker
```

**Verify:** your stuck test recording from step 2 should flip to ready within
a minute or two (thumbnail appears, video plays, transcript + AI summary
populate shortly after). If not, read the worker logs — almost always a wrong
`WORKER_DATABASE_URL` (must be port 5432) or missing service-role key.

---

## Step 4 — Desktop app (10 min)

Build the dmg once and share it with the team:

```bash
pnpm install
pnpm --filter @ryloom/desktop dist        # builds for your Mac's architecture
# or both architectures:
pnpm --filter @ryloom/desktop run dist:all
open apps/desktop/dist                    # Ryloom-0.1.0-arm64.dmg etc.
```

Because the app is unsigned (no Apple Developer account needed), first launch
requires **right-click → Open → Open**. Each user also grants **Screen
Recording** permission on first record (System Settings → Privacy & Security →
Screen Recording → enable Ryloom, then restart the app).

Point the app at your deployment: gear icon → **App URL** →
`https://<your-production-domain>` (it defaults to localhost). Sign in with
Google → the browser opens → "Open Ryloom" hands the session back to the app.

### Optional: hosted download button

Upload the dmg somewhere your team can reach — easiest is a GitHub release:

```bash
gh release create v0.1.0 apps/desktop/dist/*.dmg --title "Ryloom 0.1.0"
```

Then set `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL` in Vercel to the dmg's release URL
and redeploy — the landing page's **Download for macOS** button now serves it.
(For a private repo, the link requires GitHub login; a public bucket or Drive
link also works.)

## Step 5 — Chrome extension (optional, 2 min per person)

`chrome://extensions` → enable **Developer mode** → **Load unpacked** → select
the `extension/` folder from a checkout. Open the extension's options and set
the app URL to your production domain. `Alt+Shift+R` opens the recorder with
the current tab pre-filled.

## Step 6 — Day-2 operations

- **Invite the team:** they can sign up directly (any `@lyratechnologies.com.au`
  Google account), or you can invite them by email from *Settings → Members*
  (invites outside the domain are blocked).
- **Roles:** owner/admin/member/viewer/guest plus billing/content/compliance
  admin variants — all available, no paywall.
- **Retention/legal hold/audit logs/SCIM:** *Settings → Security & compliance*.
  All features are enabled for every workspace.
- **Migrations later:** edit `packages/db/src/schema.ts` → `pnpm db:generate` →
  `supabase db push`.
- **Logs:** Vercel → Functions tab for API issues; worker host logs for
  processing issues; Supabase → Logs for auth/storage.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Sign-in bounces back with "restricted to @lyratechnologies.com.au" | Working as intended — the account isn't on the company domain. To change the domain (or disable), set `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` (use `*` to disable) and redeploy. |
| Google sign-in error `redirect_uri_mismatch` | The redirect URI in Google Cloud must be exactly `https://<PROJECT_REF>.supabase.co/auth/v1/callback`. |
| After sign-in, redirected to localhost | Supabase → Auth → URL Configuration → Site URL is still localhost. |
| Upload fails immediately | Storage buckets missing → re-run `supabase db push`; or file exceeds the bucket's 10 GB cap. |
| Stuck on "Processing…" forever | Worker not running / can't reach DB. Check worker logs (`modal app logs ryloom-worker` on Modal); `WORKER_DATABASE_URL` must be the **direct** (5432) string. |
| Transcript/AI missing | Neither `GEMINI_API_KEY` nor `OPENAI_API_KEY` set on the worker (videos still work; AI features no-op). |
| Filler-word removal says "unavailable" | Transcription ran via Gemini (no word-level timestamps). Use an OpenAI key for Whisper if you need precise filler edits. |
| Desktop app: black recording | macOS Screen Recording permission not granted — System Settings → Privacy & Security → Screen Recording → enable Ryloom → relaunch. |
| Desktop app won't open ("unidentified developer") | Unsigned build: right-click the app → Open → Open. |
| Emails not sending | `RESEND_API_KEY`/`EMAIL_FROM` unset — invites still work via copyable links. |

## Cost notes

Running on $0 is viable for a trial: **Vercel Hobby** (free) + **Supabase Free**
+ **Modal Starter** (~$30/mo included compute) + **Gemini free tier**.

- **Supabase Free** caps storage at 1 GB (≈15–30 min of HD video) and uploads
  at 50 MB — the first thing you'll outgrow; **Pro ($25/mo)** gives 100 GB.
- **Vercel Hobby** works; Pro if you want team members on the dashboard.
- **Worker**: free on Modal's included credits at small-team volume
  (per-second billing, scale-to-zero); or ~$5–10/mo continuous on Railway/Fly.
- **AI**: Gemini AI Studio free tier covers transcription + summaries for a
  small team (daily request caps apply). OpenAI alternative: Whisper ≈
  $0.006/min of video; `gpt-4o-mini` summaries are fractions of a cent.
