<p align="center">
  <img src="apps/web/public/favicon.svg" width="56" alt="Ryloom" />
</p>

<h1 align="center">Ryloom</h1>

<p align="center">
  Self-hosted async video messaging — a full-featured Loom alternative.<br/>
  Record · Share · Transcribe · Summarize · Analyze
</p>

---

Ryloom is a production-grade Loom clone you deploy yourself on **Vercel + Supabase**,
with a Docker **FFmpeg worker** for media processing.

## Features

**Recording & upload**
- Browser recorder: screen, camera, or screen + circular camera bubble (canvas composition)
- Mic + system/tab audio mixing, pause/resume, 3-2-1 countdown, mic level meter
- Crash recovery (chunks persisted to IndexedDB while recording)
- Resumable direct-to-storage uploads (TUS) — video bytes never touch the web server
- Upload existing video files; Chrome extension launcher with tab metadata

**Processing (worker)**
- H.264 MP4 transcode (per-plan resolution caps up to 4K), HLS adaptive ladder
- Thumbnails, animated GIF hover-previews, audio waveforms
- **Automatic silence removal** (FFmpeg `silencedetect` → re-render)
- **Filler-word removal** ("um", "uh"… via word-level transcript timestamps)
- Trim (including middle cuts) and multi-video stitching — original always backed up, revertable
- Whisper transcription → searchable transcript, VTT/SRT captions
- AI outputs: auto title, summary, chapters, action items, bug report, SOP,
  email/Slack drafts, PR description, Jira/Linear issue drafts, FAQ, meeting notes, recap email

**Sharing & playback**
- Public share pages + iframe embeds, custom player (speed, captions, chapters, PiP, keyboard shortcuts)
- Privacy modes: private / workspace / specific people / public / **password protected**
- Expiring links, domain-restricted viewing, viewer identity prompts, disabled downloads,
  viewer-email watermarking, multiple revocable share links per video
- Comments (threaded, timestamped, guests supported), emoji reactions, watch-later

**Teams & analytics**
- Workspaces with roles (owner/admin/member/viewer/guest + enterprise admin roles)
- Folders & team spaces, invites by email/link, full-text search (title/transcript/AI/comments)
- Viewer insights: who watched, watch %, completion, engagement timeline, drop-off,
  CTA clicks, devices, referrers, CSV export; workspace-level admin insights

**Billing & enterprise**
- Stripe subscriptions (Free / Pro / Business / Business + AI / Enterprise) with plan gating
- SAML SSO (via Supabase Auth), **SCIM 2.0 provisioning API**, audit logs with CSV export,
  retention policies + legal hold, content ownership transfer, custom branding

## Architecture

```
apps/web        Next.js 15 (App Router, tRPC v11, Drizzle, Tailwind v4, shadcn/ui) → Vercel
apps/worker     Node 22 + FFmpeg job worker (Postgres queue, SKIP LOCKED)          → Fly/Railway/any Docker host
packages/db     Shared Drizzle schema (25+ tables)
supabase/       SQL migrations: DDL, RLS, storage buckets, triggers, FTS
extension/      Chrome MV3 extension (recorder launcher)
```

- **Control plane** (Vercel): auth, metadata API, dashboards, share pages.
- **Media plane**: browser → TUS → Supabase Storage → worker (FFmpeg) → processed buckets → signed playback URLs / HLS token proxy.
- **Queue**: `processing_jobs` table with `FOR UPDATE SKIP LOCKED` + `pg_notify` wake-ups. No Redis required.

## Quick start

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full step-by-step guide
(Supabase project → migrations → Google OAuth → Vercel → worker → Stripe).

The short version:

```bash
# 1. Supabase: create a project, then apply migrations
supabase init && supabase link --project-ref <ref>
supabase db push

# 2. Configure env
cp .env.example apps/web/.env.local   # fill in Supabase keys + DB URL
cp .env.example apps/worker/.env      # same + OPENAI_API_KEY

# 3. Run
pnpm install
pnpm dev          # web on :3000
pnpm dev:worker   # worker (needs ffmpeg locally, or use Docker)
```

## Development

```bash
pnpm dev             # next dev (turbopack)
pnpm dev:worker      # tsx watch worker
pnpm typecheck       # all packages
pnpm build           # production build of web
pnpm db:generate     # regenerate SQL after editing packages/db/src/schema.ts
```

## License

MIT — built as an open self-hosted alternative; not affiliated with Loom/Atlassian.
