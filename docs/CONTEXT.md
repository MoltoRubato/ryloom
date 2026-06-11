# Ryloom — Build Context (read this fully before writing code)

> **Status update (2026-06):** Ryloom now runs as an internal tool. The billing
> router, Stripe webhook, and pricing/enterprise marketing pages were removed;
> `getPlan()` returns a single full-access plan for every workspace, and access
> is restricted to the email domain in `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN`
> (enforced in middleware, auth callbacks, and `protectedProcedure`). Plan-gate
> helpers (`requirePlanFeature` etc.) still exist but never block.

Ryloom is a full Loom clone: record screen/camera in the browser or desktop
app, presigned-multipart-upload direct to Cloudflare R2, process with an
FFmpeg worker, share with rich privacy controls, watch with analytics,
transcripts, comments, and AI features.

## Monorepo layout

```
apps/web        Next.js 15 App Router (T3-style) — deployed on Vercel
apps/worker     Node + FFmpeg processing worker — Docker, deployed on Cloud Run Jobs
packages/db     Shared Drizzle schema  (@ryloom/db)
supabase/       SQL migrations (DDL + RLS + storage buckets)
extension/      Chrome MV3 extension
docs/           This file + deployment docs
```

## Conventions (web app)

- **Imports**: `@/*` maps to `apps/web/src/*`. DB schema: `import { videos, ... } from "@ryloom/db"`.
- **tRPC v11** with superjson. Client hooks: `import { api } from "@/trpc/react"` →
  `api.video.list.useQuery(...)`, `api.video.update.useMutation(...)`.
  Server (RSC): `import { api, HydrateClient } from "@/trpc/server"` → `await api.video.get(...)`.
- **Routers** live in `apps/web/src/server/api/routers/*.ts`, use helpers from
  `@/server/api/trpc`: `createTRPCRouter`, `publicProcedure`, `protectedProcedure`,
  `requireMembership(ctx, workspaceId, roles?)`, `requirePlanFeature(membership, feature, label)`,
  `writeAuditLog(ctx.db, {...})`, `getOrCreateProfile(ctx)`, `hashIp`, `getClientIp`,
  `ADMIN_ROLES`, `CREATOR_ROLES`. Study `routers/video.ts`, `routers/workspace.ts`,
  `routers/recording.ts` — match their style exactly.
- **Plan gating**: `@/lib/plans` exports `PLANS`, `getPlan`, `planAtLeast`, `minimumPlanFor`.
- **Storage**: `@/lib/storage` exports `BUCKETS`, `storagePaths`, `createSignedUrl`,
  `publicUrl`, `deletePrefix`. Server-only.
- **Supabase**: browser `@/lib/supabase/client` (`createClient()`), server
  `@/lib/supabase/server`, service-role `@/lib/supabase/admin`.
- **Env**: `import { env } from "@/env"` — never `process.env` directly in app code.
  Do NOT add new env vars without also adding them to `src/env.js`.
- **Do NOT edit** `package.json` — every dependency you need is already installed
  (radix-ui set, lucide-react, sonner, hls.js, aws4fetch, recharts, date-fns,
  motion, next-themes, bcryptjs, nanoid, stripe, resend, ua-parser-js, cva, clsx,
  tailwind-merge, zod, superjson).
- **UI primitives**: standard shadcn/ui components live in `@/components/ui/*`
  (button, card, input, label, textarea, dialog, alert-dialog, dropdown-menu,
  select, switch, checkbox, tabs, tooltip, popover, avatar, badge, separator,
  skeleton, progress, slider, scroll-area, sheet, table, toggle, toggle-group,
  hover-card, collapsible, kbd). They use the canonical shadcn API (cva variants,
  `asChild`, etc.). `cn()` from `@/lib/utils`; also `formatDuration(ms)`,
  `formatBytes`, `formatCount`, `getInitials`, `slugify`.
- Toasts: `import { toast } from "sonner"`.
- Icons: `lucide-react`.
- Dates: `date-fns` (`formatDistanceToNow` etc.).
- Client components get `"use client"`; pages default to RSC where possible.
- TypeScript strict + `noUncheckedIndexedAccess` — index access returns `T | undefined`.

## Design system

- Brand: **Ryloom**, violet primary `--color-primary` (#625DF5-ish, oklch-defined
  in `src/styles/globals.css`), Tailwind v4 (`@theme` tokens, class-based dark mode).
- Tailwind classes use semantic tokens: `bg-background text-foreground`,
  `bg-card`, `border-border`, `text-muted-foreground`, `bg-primary text-primary-foreground`,
  `bg-accent`, `ring-ring`. Radius via `rounded-lg`/`rounded-xl` (var-driven).
- Aesthetic: clean SaaS, generous whitespace, rounded-xl cards, soft shadows
  (`shadow-sm`), subtle borders. Marketing pages may use violet gradients
  (`from-primary/10`), large display type, `motion` for scroll animations.
- App shell: left sidebar (workspace switcher, nav, folders/spaces) + top bar
  (search, record button, notifications, avatar menu) + content area.

## Route map

Marketing (public, in `src/app/(marketing)/`): `/`, `/pricing`, `/security`,
`/enterprise`, `/download-extension`. Shared marketing nav + footer.

Auth (in `src/app/(auth)/`): `/login`, `/signup`, `/forgot-password`,
`/reset-password`, `/auth/callback` (route handler), `/auth/confirm`,
`/onboarding`, `/invite/[token]`.

App (protected, in `src/app/app/` — middleware already guards `/app`, `/record`, `/onboarding`):
`/app` (redirect to default workspace library), `/app/w/[workspaceId]` (library home),
`/app/w/[workspaceId]/library` (alias of home views via tabs: My videos / Team /
Shared with me / Drafts / Archived / Trash / Watch later),
`/app/w/[workspaceId]/folder/[folderId]`, `/app/w/[workspaceId]/search?q=`,
`/app/video/[videoId]` (owner view incl. comments/transcript/AI tabs),
`/app/video/[videoId]/edit` (trim/silence/filler/thumbnail/CTA),
`/app/video/[videoId]/analytics`,
`/app/w/[workspaceId]/settings` (+ `/members`, `/billing`, `/branding`,
`/security`, `/audit-log`, `/integrations`, `/usage`), `/app/settings` (profile).

Recorder: `/record` (mode picker + device pickers + countdown + recording UI +
preview + upload). Standalone full-screen page.

Public: `/share/[token]` (share page), `/embed/[token]` (bare player, iframe-safe,
no cookies needed — middleware already excludes `/embed`).

API route handlers: `/api/trpc/[trpc]` (exists), `/api/hls/[videoId]/[...path]`
(HLS proxy: verifies `?t=` token via `verifyPlaybackToken` from `@/lib/playback-token`,
serves .m3u8 by fetching from private bucket and rewriting segment URIs to keep
the token, 302-redirects segments to signed URLs), `/api/webhooks/stripe`,
`/api/scim/v2/[...scim]` (SCIM Users subset, bearer-token auth against
`api_tokens` table), `/api/captions/[videoId]` (serves VTT from captions bucket).

## tRPC API contract

Existing (already implemented — do not rewrite): `video.*` (list, get,
getByShareToken, update, updatePrivacy, moveToFolder, archive, unarchive, delete,
restore, deleteForever, createShareLink, listShareLinks, revokeShareLink,
addPermission, listPermissions, removePermission, toggleWatchLater, requestTrim,
requestSilenceRemoval, requestFillerRemoval, requestStitch, revertToOriginal,
setCustomThumbnail, requestDownloadUrl, getProcessingStatus, purgeOldTrash, counts),
`workspace.*` (create, list, get, update, listMembers, inviteMember, listInvites,
revokeInvite, getInvite, acceptInvite, updateMemberRole, removeMember, leave),
`recording.*` (createSession, completeSession, cancelSession, getSession).

To implement (signatures are the contract; implementers may add procedures but not
change these):

- `user.me()` → profile row (use getOrCreateProfile). `user.update({ name?, avatarUrl?, timezone?, defaultWorkspaceId?, onboardingCompleted? })`.
  `user.deleteAccount()` (deletes auth user via admin client + cascades).
  `user.exportData()` → JSON blob of the user's profile/videos/comments metadata.
- `folder.list({ workspaceId })` → folders+spaces with video counts.
  `folder.create({ workspaceId, name, parentId?, isSpace?, emoji?, color? })` (plan-gate: folders / teamSpaces).
  `folder.update({ folderId, name?, emoji?, color?, isPinned? })`, `folder.delete({ folderId })` (videos move to root).
- `comment.list({ videoId, shareToken? })` public — validates access like video.getByShareToken (lighter: just resolve token → video and check allowComments; auth users on private videos use membership).
  `comment.create({ videoId, shareToken?, body, timestampMs?, parentCommentId?, guestName?, guestEmail? })` public (guests allowed when share permits comments; logged-in users use their identity; notify video owner via notifications insert + email).
  `comment.update({ commentId, body })`, `comment.delete({ commentId })`, `comment.resolve({ commentId, resolved })` — author or video owner.
- `reaction.list({ videoId, shareToken? })`, `reaction.add({ videoId, shareToken?, emoji, timestampMs?, anonymousId? })` public, `reaction.remove({ reactionId, anonymousId? })`.
- `analytics.startSession({ videoId, shareToken?, anonymousViewerId, identityEmail?, referrer? })` public → { sessionId } (parses UA via ua-parser-js, hashIp(getClientIp(ctx.headers)), increments videos.viewCount once per session).
  `analytics.trackEvent({ sessionId, eventType, playheadMs?, watchDeltaMs? })` public (updates view_sessions.watchMs/maxPlayheadMs/completed + inserts view_events; heartbeat updates lastHeartbeatAt).
  `analytics.getVideoInsights({ videoId })` owner/admin → { totalViews, uniqueViewers, avgWatchPct, completionRate, viewers: [{ name/email/anonymous, watchPct, lastViewedAt, completed }], engagementTimeline: 100 buckets of % viewers watching, eventCounts (ctaClicks, downloads, comments, reactions), viewsByDay (30d), topReferrers, devices }.
  `analytics.getWorkspaceInsights({ workspaceId })` admin → { mostViewedVideos, mostActiveCreators, totalWatchMs, storageBytes, videoCounts byPrivacy, inactiveMembers, aiUsage }. (plan-gate viewerInsights / engagementGraph / exportAnalyticsCsv where it applies)
  `analytics.exportCsv({ workspaceId | videoId })` → string (CSV) — plan-gated.
- `transcript.get({ videoId, shareToken? })` public-capable → transcript + segments (respect allowTranscript).
  `transcript.updateSegment({ segmentId, text })` owner → marks editedByUser, regenerates fullText.
  `transcript.export({ videoId, format: "vtt"|"srt"|"txt" })` owner → string.
- `ai.generate({ videoId, type })` owner; type ∈ ai_output_type enum. Plan-gates: aiWorkflows for doc-types (bug_report, sop, email_draft, slack_message, pr_description, jira_issue, linear_issue, faq, meeting_notes, recap_email, doc); monthly cap via workspace_usage.aiGenerations vs plan.aiGenerationsPerMonth. Inserts ai_outputs row (status pending) + processing_jobs (type ai_generate, inputJson { aiOutputId, outputType }). Returns the row.
  `ai.list({ videoId })` owner → ai_outputs rows. `ai.get({ videoId, type })`.
  `ai.updateContent({ aiOutputId, contentText?, contentJson? })` owner — marks editedByUser.
  `ai.applyChaptersToVideo({ aiOutputId })` — copies chapters JSON into videos.chapters.
- `billing.getSubscription({ workspaceId })` → { plan, subscription?, prices configured? }.
  `billing.createCheckoutSession({ workspaceId, plan: "pro"|"business"|"business_ai", interval: "monthly"|"yearly" })` owner/billing_admin → { url } (Stripe checkout; metadata.workspaceId; graceful error if Stripe env missing).
  `billing.createPortalSession({ workspaceId })` → { url }.
  `billing.setPlanManually({ workspaceId, plan })` — owner only, intended for self-hosters without Stripe; writes audit log. Enterprise plan can only be set this way.
- `admin.getAuditLogs({ workspaceId, cursor?, limit?, action?, actorId? })` — plan-gate auditLogs; roles owner/admin/compliance_admin.
  `admin.exportAuditLogsCsv({ workspaceId })`.
  `admin.transferVideoOwnership({ videoId, newOwnerId })` admin.
  `admin.transferAllContent({ workspaceId, fromUserId, toUserId })` admin.
  `admin.listAllVideos({ workspaceId, cursor? })` admin (includes private).
  `admin.createScimToken({ workspaceId, name })` → { token } shown once (store sha256 hash in api_tokens; plan-gate scim). `admin.revokeScimToken({ tokenId })`, `admin.listApiTokens({ workspaceId })`.
  `admin.getUsage({ workspaceId })` → workspace_usage rows + storage totals.
- `notification.list({ cursor? })`, `notification.markRead({ id? })` (id absent = all), `notification.unreadCount()`.
- `search.videos({ workspaceId, query, limit? })` → Postgres FTS over title/description/tags + transcript fullText + ai summary; return videos with `matchedIn: "title"|"transcript"|"summary"|...` and a snippet. Use `sql` template with `websearch_to_tsquery('english', ...)` against the `fts` generated columns (see migrations).

## Upload contract (recorder → storage)

Video bytes live in Cloudflare R2 (single private bucket, S3 API); they never
touch a Next.js route. Authorization is session ownership in tRPC, not
storage RLS.

1. `recording.createSession` → `{ sessionId, videoId, bucket, uploadPath, limits }`.
2. `recording.startUpload({ sessionId, sizeBytes })` → `{ uploadId, partSize, urls }`
   — opens an R2 multipart upload and presigns one PUT URL per 32MB part
   (6h TTL). Called fresh on every attempt, so retries never reuse stale URLs.
3. Client PUTs each `blob.slice(...)` part to its URL (3 in parallel, per-part
   retry with backoff) and collects the `ETag` response headers — the R2
   bucket's CORS policy must list `ETag` in `ExposeHeaders`.
4. `recording.completeUpload({ sessionId, uploadId, parts })` — server completes
   the multipart upload (`abortUpload` on cancel).
5. `recording.completeSession({ sessionId, durationMs, sizeBytes, width, height })`
   → flips video to `processing`, enqueues worker pipeline.
6. Redirect to `/app/video/[videoId]` which polls `video.getProcessingStatus`.

## Playback contract

`video.get` / `video.getByShareToken` return `playback: { mp4Url (signed),
hlsUrl ("/api/hls/{videoId}/master.m3u8?t=..." or null), captionsUrl, thumbnailUrl,
downloadUrl? }`. Player: hls.js when hlsUrl present and `Hls.isSupported()`,
fallback `<video src={mp4Url}>` (Safari uses native HLS via the same URL).
`getByShareToken` returns a discriminated union on `state`:
`"ok" | "auth_required" | "password_required" | "identity_required" | "processing"`.

## Worker contract (apps/worker)

Polls `processing_jobs` (status queued, scheduled_at <= now, order by priority desc,
created_at) with `FOR UPDATE SKIP LOCKED`. Job types and `input_json` payloads are
defined in `routers/video.ts` + `routers/recording.ts` enqueue sites. The worker
owns: download raw → probe → transcode MP4 H.264/AAC capped at plan maxHeight →
thumbnails (default.jpg + animated preview.gif + waveform.json) → optional HLS
ladder (360/720/1080[/2160]) → upload to `processed-videos` → update videos row
(status ready, playbackUrl, hlsUrl, durationMs, width/height, thumbnailUrl…) +
video_assets rows → chain `transcribe` job → Whisper → transcripts +
transcript_segments (+ VTT/SRT to captions bucket, captionsUrl) → chain
`ai_generate` (title, summary, chapters, action_items) when autoAi.
Edit jobs (trim/silence_removal/filler_removal/stitch) re-render from the current
playback MP4, back up the previous MP4 as `original_backup` asset, and re-run
thumbnails/captions as needed.

## Hard rules

- Never upload video bytes through Next.js API routes (Vercel 4.5MB limit).
- Raw IPs are never stored — only `hashIp()` results.
- Plan gates are enforced server-side (routers/worker), UI shows upgrade prompts.
- Audit log writes for: user.invited/removed, role.changed, video.deleted,
  video.privacy_changed, video.downloaded, share_link.created/revoked,
  workspace.setting_changed, retention_policy.changed, sso.enabled, scim token ops.
