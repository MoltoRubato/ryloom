<p align="center">
  <img src="apps/web/public/favicon.svg" width="56" alt="Ryloom" />
</p>

<h1 align="center">Ryloom</h1>

<p align="center">
  Lyra's internal screen recorder — a self-hosted, full-featured Loom alternative.<br/>
  Record · Share · Transcribe · Summarize · Analyze
</p>

---

Ryloom is an internal tool: **every feature is enabled for everyone, with no
limits and no billing.** Access is restricted to `@lyratechnologies.com.au`
accounts (configurable via `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN`).

- 📦 **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — step-by-step deploy guide (Supabase → Vercel → worker → desktop app)
- 👋 **[docs/TEAM-GUIDE.md](docs/TEAM-GUIDE.md)** — features list + setup guide to send to coworkers

## What it does

**Recording**
- **macOS desktop app** (the primary entrypoint): native screen capture, floating
  camera bubble, pause/resume — and the share link is **on your clipboard the
  moment you press stop**, while the upload finishes in the background
- Browser recorder: screen/camera/screen+camera-bubble (canvas composition),
  mic + tab audio mixing, countdown, crash recovery via IndexedDB
- Chrome extension launcher; upload existing files; chunked multipart uploads
  direct to Cloudflare R2 (video bytes never touch the web server)

**Processing (worker)**
- H.264 MP4 up to 4K + HLS adaptive streaming, thumbnails, animated previews, waveforms
- **Automatic silence removal** and **filler-word removal** ("um", "uh"…)
- Trim (including middle cuts) and stitching — originals backed up, revertable
- Whisper transcription → searchable transcripts, VTT/SRT captions
- AI: auto titles + summaries, chapters, action items, and one-click drafts
  (bug report, SOP, email, Slack message, PR description, Jira/Linear issue,
  FAQ, meeting notes, recap email)

**Sharing & playback**
- Share pages + iframe embeds, custom player (chapters, captions, speeds, PiP,
  keyboard shortcuts)
- Privacy per video: private / workspace / specific people / public / password,
  plus expiring links, domain-restricted viewing, viewer identity prompts,
  email watermarking, download control, multiple revocable links

**Teams & insights**
- Workspaces, roles, invites, folders & team spaces
- Full-text search across titles, transcripts, AI summaries, and comments
- Timestamped comments (guests supported) + emoji reactions, notifications
- Viewer analytics: engagement timeline, drop-off, completion, per-viewer
  breakdown, devices/referrers, CSV export; workspace-level admin insights
- Compliance: audit logs, retention policies, legal hold, SCIM 2.0 API, SSO hooks

## Architecture

```
apps/web        Next.js 15 (App Router, tRPC v11, Drizzle, Tailwind v4, shadcn/ui) → Vercel
apps/desktop    Electron macOS recorder (deep-link auth, tray, camera bubble)      → dmg artifact
apps/worker     Node 22 + FFmpeg job worker (Postgres queue, SKIP LOCKED)          → Cloud Run Jobs / any Docker host
packages/db     Shared Drizzle schema (25+ tables)
supabase/       SQL migrations: DDL, RLS, storage buckets, triggers, FTS
extension/      Chrome MV3 extension (recorder launcher)
docs/           Deployment guide + team guide
```

- **Control plane** (Vercel): auth, metadata API, dashboards, share pages.
- **Media plane**: recorder → presigned multipart → Cloudflare R2 → worker
  (FFmpeg) → R2 → presigned playback URLs / token-checked HLS proxy. R2 has
  zero egress fees, so playback bandwidth is free; Supabase keeps auth, the
  database, and small public assets (thumbnails, captions, avatars).
- **Queue**: `processing_jobs` with `FOR UPDATE SKIP LOCKED` + `pg_notify`. No Redis.
- **Access control**: domain allow-list enforced in middleware, auth callbacks,
  and every authenticated API procedure; Postgres RLS as the second layer.

## Development

```bash
pnpm install
cp .env.example apps/web/.env.local    # fill in Supabase + Cloudflare R2 values
pnpm dev                               # web on :3000
pnpm dev:worker                        # worker (needs ffmpeg, or use Docker)
pnpm --filter @ryloom/desktop dev      # desktop app against localhost
pnpm typecheck && pnpm build
pnpm db:generate                       # regen SQL after schema changes
```

## License

MIT — not affiliated with Loom/Atlassian.
