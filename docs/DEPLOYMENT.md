# Deploying Ryloom (step by step)

Ryloom has four deployable pieces and one buildable artifact:

| Piece | What it is | Where it runs |
|---|---|---|
| **Supabase project** | Auth, Postgres, small public assets (thumbnails, captions, avatars) | supabase.com (managed, free tier OK) |
| **Cloudflare R2 bucket** | All video bytes — raw recordings + processed MP4/HLS | cloudflare.com (free tier: 10 GB, zero egress fees) |
| **Web app** (`apps/web`) | Dashboard, share pages, API | Vercel |
| **Worker** (`apps/worker`) | FFmpeg + AI processing | Google Cloud Run Jobs (recommended, free tier) — or Modal / any Docker host |
| **Desktop app** (`apps/desktop`) | The macOS recorder | Built once, shared with the team |

Total time: roughly 40–60 minutes. Do the steps in order — each one verifies
before the next begins.

> **Why R2 for video?** Supabase Storage's free tier caps uploads at 50 MB
> (≈50 seconds of recording) and egress at 5 GB/month (≈50 video views). R2
> has no practical file-size limit and **zero egress fees** — playback
> bandwidth is free forever. Supabase stays for what it's great at: auth,
> Postgres, and small public files.

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

Accounts you'll need: [supabase.com](https://supabase.com) (free tier works),
[dash.cloudflare.com](https://dash.cloudflare.com) (free — for R2),
[vercel.com](https://vercel.com), and a
[Google Cloud](https://console.cloud.google.com) account for the worker
(Cloud Run's always-free tier; also install the
[gcloud CLI](https://cloud.google.com/sdk/docs/install) —
`brew install google-cloud-sdk`). An AI key powers transcription + summaries:
[Gemini](https://aistudio.google.com/apikey) (free tier) or an
[OpenAI API key](https://platform.openai.com/api-keys) (pay-as-you-go, better
word-level timestamps).

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

This creates the 25+ tables, row-level-security policies, 5 storage buckets
(small assets only — video lives in R2), the `auth.users → profiles` trigger,
job-queue notifications, and full-text search. **Verify:** in the dashboard,
*Table Editor* should show `videos`, `workspaces`, `processing_jobs`, etc.,
and *Storage* should show `thumbnails`, `captions`, `avatars`,
`workspace-assets`, and `exports`.

### 1.3 Collect your keys

Project Settings → **API**:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` *(server-side secret — never expose)*

Project Settings → **Database** → *Connection string*:

- **Transaction pooler** (port `6543`) → `DATABASE_URL` (used by the web app)
- **Session pooler** (port `5432`, host `*.pooler.supabase.com`) →
  `WORKER_DATABASE_URL` (used by the worker)

> ⚠️ For the worker, use the **session pooler** string — *not* the "direct
> connection" `db.<ref>.supabase.co` host. The direct host is IPv6-only on
> the free tier and unreachable from Modal and most container hosts. The
> session pooler is IPv4 everywhere and supports LISTEN/NOTIFY.

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

## Step 2 — Cloudflare R2 (10 min)

All video bytes — raw recordings and processed MP4/HLS — live in one private
R2 bucket. Uploads go straight from the browser/desktop app to R2 via
presigned URLs; playback streams from R2 via presigned URLs. Nothing heavy
ever transits Vercel.

### 2.1 Create the bucket

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage**
   → *Create bucket*. (First time: R2 asks you to add a payment method, but
   the free tier — 10 GB storage, zero egress — applies automatically and
   there is no charge until you exceed it.)
2. Name: `ryloom-media` (or anything — it becomes `R2_BUCKET`). Location:
   *Automatic* is fine; pick the hint closest to your team.

### 2.2 Create an API token

1. R2 → **Manage API tokens** (under "Account details" on the right) →
   *Create API token*.
2. Permissions: **Object Read & Write**, scoped to *Apply to specific buckets
   only* → `ryloom-media`.
3. Copy the three values shown once:
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
   - Your **Account ID** (shown on the R2 overview page, also in the endpoint
     URL) → `R2_ACCOUNT_ID`

### 2.3 Configure CORS (required — uploads fail without it)

Bucket → **Settings** → **CORS policy** → *Add CORS policy*, paste:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

- `ExposeHeaders: ["ETag"]` is **mandatory** — the uploader reads each part's
  ETag to complete the multipart upload; without it every upload fails with
  a CORS error.
- `AllowedOrigins: ["*"]` is needed because the desktop app runs from a
  `file://` origin. This is safe: every URL is presigned and expires — the
  signature, not CORS, is the security boundary. (You can tighten it to your
  web domain if you only use the browser recorder.)

**Verify:** nothing to run yet — the first recording in Step 3's verify
exercises the whole path.

---

## Step 3 — Web app on Vercel (10 min)

1. Push this repo to GitHub and **Import** it at
   [vercel.com/new](https://vercel.com/new).
2. **Root Directory**: click *Edit* and set it to `apps/web`. Vercel detects
   Next.js + the pnpm workspace automatically. Leave build settings default.
3. **Environment Variables** — add these (Production + Preview):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from step 1.3 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 1.3 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1.3 |
   | `DATABASE_URL` | transaction pooler string, port **6543** |
   | `R2_ACCOUNT_ID` | from step 2.2 |
   | `R2_ACCESS_KEY_ID` | from step 2.2 |
   | `R2_SECRET_ACCESS_KEY` | from step 2.2 |
   | `R2_BUCKET` | `ryloom-media` |
   | `NEXT_PUBLIC_APP_URL` | `https://<your-vercel-domain>` |
   | `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | `lyratechnologies.com.au` |
   | `IP_HASH_SALT` | any long random string (`openssl rand -hex 24`) |
   | `RESEND_API_KEY` | *(optional)* for invite/comment emails |
   | `EMAIL_FROM` | *(optional)* e.g. `Ryloom <ryloom@lyratechnologies.com.au>` |
   | `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL` | *(add later, step 5)* |
   | `GCP_SA_KEY`, `CLOUD_RUN_PROJECT`, `CLOUD_RUN_REGION`, `CLOUD_RUN_JOB`, `WORKER_BACKSTOP_TOKEN` | *(from step 4 — add then redeploy)* |

4. **Deploy.** When it's live:
   - go back to Supabase → Authentication → URL Configuration and set **Site
     URL** to the production URL (and confirm the redirect URL is listed);
   - update `NEXT_PUBLIC_APP_URL` in Vercel if your domain changed, and redeploy.

**Verify:** open the production URL → you should see the landing page. Sign in
with your `@lyratechnologies.com.au` Google account → onboarding → create a
workspace → you land in the library. Record a short test clip at `/record` —
the upload should complete (that's R2 + CORS working), then it will sit on
"Processing…" because the worker isn't running yet. That's expected; continue.

---

## Step 4 — Worker on Google Cloud Run Jobs (15 min)

The worker runs FFmpeg + AI jobs from the database queue — no inbound
networking required. On Cloud Run Jobs it's fully serverless: a container
boots, drains the queue, and exits. Two things start it:

- **Instant wake**: the web app starts a job execution (`jobs.run`) the
  moment an upload finishes — recordings begin processing within seconds.
- **Backstop**: Cloud Scheduler pings `/api/worker-backstop` on the web app
  every 3 minutes; the app checks the queue with one SQL query and only
  starts the job when there's actually work.

> Why the indirection? Cloud Run Jobs bill a **1-minute minimum per
> execution** — pointing a blind cron at the job itself would boot a billed
> container ~480 times a day just to find an empty queue, burning the whole
> free tier. The web app's SQL check costs nothing, so idle cost stays $0.
> (Concurrent executions are harmless — the queue uses `FOR UPDATE SKIP
> LOCKED` — and the app debounces bursts.)

### Pick an AI key first (either one)

| Key | Where to get it | What you get |
|---|---|---|
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — **free tier** | Transcription + all AI features. Word timing is approximate, so filler-word removal is best-effort. |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) — pay-as-you-go | Whisper transcription with word-level timestamps → precise filler-word removal. ≈$0.36/hour of video. |

Set one (or both — OpenAI wins for transcription when both are present).
Without either, videos still process fully; only transcripts/AI features no-op.

### 4.1 Google Cloud project (3 min)

```bash
gcloud auth login
gcloud projects create ryloom-prod-$RANDOM   # or reuse an existing project
gcloud config set project <THE_PROJECT_ID>
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com cloudscheduler.googleapis.com
```

Link a billing account in the console (Billing → Link) — required to run
anything, but the Cloud Run always-free tier applies automatically and a
small team stays inside it (see Cost notes).

Pick a region near your Supabase project and set shell vars for the
commands below:

```bash
REGION=australia-southeast1            # e.g. Sydney
PROJECT=$(gcloud config get-value project)
```

### 4.2 Build and push the image (from the repo root)

```bash
gcloud artifacts repositories create ryloom --repository-format=docker --location=$REGION
IMAGE="$REGION-docker.pkg.dev/$PROJECT/ryloom/worker:latest"
gcloud builds submit --config cloudbuild.yaml --substitutions _IMAGE="$IMAGE"
```

(Alternative without Cloud Build — e.g. on Apple Silicon, note the platform
flag: `gcloud auth configure-docker $REGION-docker.pkg.dev` then
`docker buildx build --platform linux/amd64 -f apps/worker/Dockerfile -t "$IMAGE" --push .`)

### 4.3 Create the job

```bash
cat > /tmp/worker-env.yaml <<'EOF'
WORKER_DRAIN: "true"
# Stay warm for 60s after the queue empties — chained jobs (transcribe → AI)
# land seconds later and reuse the running container instead of a cold boot.
DRAIN_IDLE_EXIT_SECONDS: "60"
# Stop claiming new jobs 20 min before --task-timeout so in-flight encodes
# finish cleanly instead of being killed mid-job.
DRAIN_MAX_RUNTIME_SECONDS: "6000"
# Keep at 1 — two concurrent x264 encodes on one box just split the cores.
WORKER_CONCURRENCY: "1"
WORKER_DATABASE_URL: "postgresql://postgres.YOUR-PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
SUPABASE_URL: "https://YOUR-PROJECT.supabase.co"
SUPABASE_SERVICE_ROLE_KEY: "eyJ..."
R2_ACCOUNT_ID: "..."
R2_ACCESS_KEY_ID: "..."
R2_SECRET_ACCESS_KEY: "..."
R2_BUCKET: "ryloom-media"
GEMINI_API_KEY: "AIza..."
EOF

gcloud run jobs create ryloom-worker \
  --image "$IMAGE" --region "$REGION" \
  --cpu 8 --memory 8Gi --task-timeout 7200 --max-retries 1 \
  --env-vars-file /tmp/worker-env.yaml

rm /tmp/worker-env.yaml
```

> **Why 8 vCPU?** x264 encode wall-time scales roughly linearly with cores,
> and Cloud Run Jobs only bill while an execution runs — 8 cores for a
> quarter of the time costs the same as 2 cores, but a recording is ready
> in a quarter of the wall time.

> `WORKER_DATABASE_URL` must be the **session pooler** string from step 1.3
> (`*.pooler.supabase.com:5432`) — the direct `db.*.supabase.co` host is
> IPv6-only on the free tier and unreachable from Cloud Run.

Test it end-to-end now:

```bash
gcloud run jobs execute ryloom-worker --region "$REGION" --wait
```

Your stuck recording from step 3 should flip to ready (thumbnail appears,
video plays, transcript + AI summary populate shortly after).

Ship a new worker version later with:
`gcloud builds submit --config cloudbuild.yaml --substitutions _IMAGE="$IMAGE" && gcloud run jobs update ryloom-worker --image "$IMAGE" --region "$REGION"`.

### 4.4 Instant wake from the web app

Create a service account that can do exactly one thing — start this job:

```bash
gcloud iam service-accounts create ryloom-invoker
gcloud run jobs add-iam-policy-binding ryloom-worker --region "$REGION" \
  --member "serviceAccount:ryloom-invoker@$PROJECT.iam.gserviceaccount.com" \
  --role roles/run.invoker
gcloud iam service-accounts keys create ryloom-invoker.json \
  --iam-account "ryloom-invoker@$PROJECT.iam.gserviceaccount.com"
base64 -i ryloom-invoker.json    # copy the output
```

Add to Vercel (then redeploy the web app):

| Name | Value |
|---|---|
| `GCP_SA_KEY` | the base64 output above |
| `CLOUD_RUN_PROJECT` | `$PROJECT` |
| `CLOUD_RUN_REGION` | `$REGION` |
| `CLOUD_RUN_JOB` | `ryloom-worker` |
| `WORKER_BACKSTOP_TOKEN` | `openssl rand -hex 24` |

Then delete the local key file: `rm ryloom-invoker.json`.

### 4.5 Backstop schedule

```bash
gcloud scheduler jobs create http ryloom-backstop --location "$REGION" \
  --schedule "*/3 * * * *" \
  --uri "https://<your-production-domain>/api/worker-backstop" \
  --http-method POST \
  --headers "x-backstop-token=<your WORKER_BACKSTOP_TOKEN value>"
```

This covers missed wakes and restarts work owned by a dead container
(stale-lock reclaim) within ~3 minutes — without ever booting the billed
worker on an empty queue. Test it: `gcloud scheduler jobs run ryloom-backstop
--location "$REGION"` → the endpoint returns `{"hasWork":false}` when idle.

**Verify the full loop:** record a clip → the share page should be playing
within a minute or two. Executions:
`gcloud run jobs executions list --job ryloom-worker --region "$REGION"`;
logs are in Cloud Console → Cloud Run → Jobs → ryloom-worker → Logs.

### Alternatives to Cloud Run

| Option | Free? | Notes |
|---|---|---|
| **Modal** | $30/month credit | Still fully supported: `modal deploy apps/worker/modal_app.py` (see that file's docstring for the secret setup). It has its own built-in scout + wake endpoint — set `WORKER_WAKE_URL`/`WORKER_WAKE_TOKEN` in Vercel instead of the `GCP_*`/`CLOUD_RUN_*` vars. |
| **Oracle Cloud Always Free VM** | 4 ARM cores / 24 GB, 24/7 | The most raw free compute; run the worker in continuous mode (`docker run`, no drain). Needs an arm64 image build, VM upkeep, and signup-capacity patience. |
| **Any Docker box** | — | `docker build -f apps/worker/Dockerfile -t ryloom-worker . && docker run -d --restart unless-stopped --env-file apps/worker/.env ryloom-worker` |
| Railway / Fly.io / Render | No | No meaningful free tier for background workers anymore (≈$5–7/mo). The repo keeps `fly.toml` / `railway.json` if you prefer paying for an always-on worker. |

---

## Step 5 — Desktop app (10 min)

Build the dmg once and share it with the team:

```bash
pnpm install
pnpm --filter @ryloom/desktop dist        # builds for your Mac's architecture
# or both architectures:
pnpm --filter @ryloom/desktop run dist:all
open apps/desktop/dist                    # Ryloom-0.1.0-arm64.dmg etc.
```

Because the app is unsigned (no Apple Developer account needed), first launch
requires **System Settings → Privacy & Security → "Open Anyway"** on macOS 15+
(older macOS: right-click → Open → Open). Each user also grants **Screen
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

## Step 6 — Chrome extension (optional, 2 min per person)

`chrome://extensions` → enable **Developer mode** → **Load unpacked** → select
the `extension/` folder from a checkout. Open the extension's options and set
the app URL to your production domain. `Alt+Shift+R` opens the recorder with
the current tab pre-filled.

## Step 7 — Day-2 operations

- **Invite the team:** they can sign up directly (any `@lyratechnologies.com.au`
  Google account), or you can invite them by email from *Settings → Members*
  (invites outside the domain are blocked).
- **Roles:** owner/admin/member/viewer/guest plus billing/content/compliance
  admin variants — all available, no paywall.
- **Retention/legal hold/audit logs/SCIM:** *Settings → Security & compliance*.
  All features are enabled for every workspace.
- **Migrations later:** edit `packages/db/src/schema.ts` → `pnpm db:generate` →
  `supabase db push`.
- **Logs:** Vercel → Functions tab for API issues; Cloud Console → Cloud Run
  → Jobs → ryloom-worker → Logs for processing; Supabase → Logs for auth
  issues; Cloudflare R2 → Metrics for storage/egress.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Sign-in bounces back with "restricted to @lyratechnologies.com.au" | Working as intended — the account isn't on the company domain. To change the domain (or disable), set `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` (use `*` to disable) and redeploy. |
| Google sign-in error `redirect_uri_mismatch` | The redirect URI in Google Cloud must be exactly `https://<PROJECT_REF>.supabase.co/auth/v1/callback`. |
| After sign-in, redirected to localhost | Supabase → Auth → URL Configuration → Site URL is still localhost. |
| Upload fails immediately with a CORS/network error | The R2 bucket has no CORS policy, or `ExposeHeaders` is missing `ETag` — re-do step 2.3 exactly. |
| Upload fails with "Could not prepare the upload" | Wrong `R2_*` env values on Vercel (account id, key pair, or bucket name). |
| Stuck on "Processing…" for more than ~3 minutes | Worker can't run or can't connect. Check `gcloud run jobs executions list --job ryloom-worker --region <region>` + the job's logs in Cloud Console. `WORKER_DATABASE_URL` must be the **session pooler** (`*.pooler.supabase.com:5432`) string — the direct host doesn't resolve from Cloud Run. Also confirm the job's env has all the `R2_*` values, the `GCP_*`/`CLOUD_RUN_*` vars are set on Vercel, and the backstop scheduler exists (`gcloud scheduler jobs run ryloom-backstop --location <region>` to test). |
| Video plays but transcript/AI never appears | Neither `GEMINI_API_KEY` nor `OPENAI_API_KEY` set on the worker (videos still work; AI features no-op) — or the AI provider is rate-limiting; the video stays watchable and the job retries. |
| Filler-word removal says "unavailable" | Transcription ran via Gemini (no word-level timestamps). Use an OpenAI key for Whisper if you need precise filler edits. |
| Desktop app: black recording | macOS Screen Recording permission not granted — System Settings → Privacy & Security → Screen Recording → enable Ryloom → relaunch. |
| Desktop app won't open ("unidentified developer") | Unsigned build: System Settings → Privacy & Security → "Open Anyway" (macOS 15+), or right-click → Open on older macOS. |
| Emails not sending | `RESEND_API_KEY`/`EMAIL_FROM` unset — invites still work via copyable links. |

## Cost notes

The whole stack runs on **$0/month** for an internal team:

- **Cloudflare R2**: 10 GB-month storage free, then $0.015/GB-month. **Egress
  is always free** — video playback bandwidth costs nothing at any scale.
  10 GB ≈ 1.5–3 hours of stored recordings (raw + processed + HLS); a busy
  team might spend $1–3/month.
- **Supabase Free**: plenty for auth + database + thumbnails/captions. The
  5 GB/month egress only carries small assets now. Upgrade triggers: 500 MB
  database (heavy analytics/comments volume) → Pro $25/mo.
- **Cloud Run Jobs**: the always-free instance-based tier (240,000 vCPU-s +
  450,000 GiB-s/month) buys ~8 hours of 8-vCPU/8-GiB transcode time per
  month (the same vCPU-seconds as 30+ hours at 2 vCPU — encodes just finish
  ~4× sooner), and idle cost is **$0** — executions only start when the
  queue has work. Overage is ≈$0.20–0.30 per transcode-hour of compute, so
  even a heavy month is a few dollars. Cloud Scheduler's first 3 jobs are
  free (we use 1, and it pings Vercel, not the billed container).
- **Vercel Hobby**: fine for an internal tool dashboard. Pro if you want team
  members in the Vercel dashboard itself.
- **AI**: Gemini AI Studio free tier covers transcription + summaries for a
  small team (daily request caps apply). OpenAI alternative: Whisper ≈
  $0.006/min of video; `gpt-4o-mini` summaries are fractions of a cent.
