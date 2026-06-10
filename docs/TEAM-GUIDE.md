# Ryloom — Team Guide

*Lyra's internal screen recorder. Record your screen, share a link, let the AI
write the summary. This doc is everything you need to get set up and what the
tool can do.*

---

## Get set up (5 minutes)

### 1. Sign in

Go to **[the Ryloom web app](#)** *(your deployment URL)* and click **Sign in
with Google** using your `@lyratechnologies.com.au` account. That's it — no
invite needed, accounts on the company domain just work. (Personal accounts
are blocked.)

First sign-in walks you through naming yourself and creating/joining a
workspace.

### 2. Install the desktop app (recommended)

The macOS app is the fastest way to record:

1. Download the dmg from the **Download** link on the landing page (or ask
   whoever deployed for the file). Drag **Ryloom** to Applications.
2. First launch: **right-click → Open → Open** (the build is unsigned).
3. Sign in with Google — your browser opens, click **Open Ryloom**, and you're
   back in the app, signed in.
4. First recording: macOS will ask for **Screen Recording** permission
   (System Settings → Privacy & Security → Screen Recording → enable Ryloom,
   then relaunch the app). Mic and camera prompts appear as needed.

### 3. (Optional) Chrome extension

Load `extension/` from the repo via `chrome://extensions` → Developer mode →
Load unpacked, then set the app URL in its options. `Alt+Shift+R` starts a
recording of the current tab.

> No desktop app handy? **The browser recorder does everything too** — hit
> *New video* in the web app or go to `/record`.

---

## The core loop

1. **Record** — pick a screen/window, optionally turn on your camera (it
   floats as a movable circle over the recording) and mic. Pause/resume
   whenever. Optional 3-2-1 countdown.
2. **Stop** — the share link is **already on your clipboard** the moment you
   press stop. Paste it in Slack immediately; the upload finishes in the
   background and the page comes alive when processing completes (usually
   under a minute).
3. **Track** — open your video → **Insights** to see who watched, how far they
   got, and where they dropped off.

---

## Everything Ryloom can do

### Recording
- Screen, window, or tab capture · camera-only mode · mic + system/tab audio
- Floating circular **camera bubble** (drag it anywhere, 3 sizes)
- Pause/resume, restart, countdown, recording timer
- **Crash recovery** — browser recordings are saved as you go; if the tab dies,
  Ryloom offers to recover the recording on your next visit
- Upload any existing video file (drag & drop on `/record`)
- **Resumable uploads** — connection drops just pause the upload; it picks up
  where it left off

### Automatic processing (no clicks required)
- HD transcode with instant-start streaming (adaptive quality up to 4K)
- Thumbnail + animated hover-preview
- **Transcription** of every recording — read, search, and click any line to
  jump the video there
- Captions (CC button on the player, VTT/SRT export)
- **AI title and summary** are generated for every video — plus chapters and
  action items on demand

### AI tools (on every video's AI tab)
- Summary, long summary, chapters (apply to the player), action items
- One-click drafts generated **from the video content**: bug report, SOP /
  how-to doc, email, Slack message, PR description, Jira issue, Linear issue,
  FAQ, meeting notes, recap email — all editable and copyable

### Editing (Edit button on your video)
- **Trim** — cut the start, end, or any middle sections, with waveform timeline
- **Silence auto-edit** — detects and removes dead air (tunable threshold)
- **Filler-word auto-edit** — trims "um", "uh", etc. using the word-level transcript
- Every edit backs up the original — **revert anytime**
- Custom thumbnail (capture a frame or upload), CTA button on the share page,
  chapter editor, stitch multiple videos into one

### Sharing & privacy
- Every video has a share link; privacy per video:
  **Private** (only you) · **Workspace** (any teammate) · **Specific people**
  (by email) · **Public link** · **Password protected**
- Extras: expiring links, multiple named links (revoke any individually),
  domain-restricted viewing, require viewer email, watermark the viewer's
  email over the video, disable downloads, disable comments/reactions
- **Embed** any video via iframe (works in Notion, internal docs, etc.)
- Public viewers don't need an account — external clients can watch shared
  links and even comment as guests (when you allow it)

### Library & organization
- My videos / Team library / Shared with me / Watch later / Drafts / Archive / Trash
- **Folders and team Spaces**, pinning, drag-free move-to-folder
- **Full-text search** across titles, descriptions, *transcripts*, AI
  summaries, and comments — find that video where someone said "staging
  database" three weeks ago
- Inline rename, copy-link, download, archive from any video card

### Collaboration
- **Comments** — threaded, optionally pinned to a timestamp (click to jump),
  resolvable; guests can comment on shared links
- **Emoji reactions**, also timestamped
- In-app + email notifications for comments, replies, and when your video
  finishes processing

### Insights & analytics
- Per video: views, unique viewers, average % watched, completion rate,
  **engagement timeline** (where people drop off), viewer-by-viewer breakdown,
  CTA clicks, downloads, devices and referrers, CSV export
- Per workspace (admins): top videos, most active creators, total watch time,
  storage use, AI usage

### Admin & compliance (Settings → your workspace)
- Roles: owner, admin, member, viewer, guest (+ billing/content/compliance
  admin variants)
- Custom branding on share pages (logo, color, hide "Powered by Ryloom")
- Default privacy for new recordings, allowed invite domains, viewer-identity
  requirements
- **Audit log** of sensitive actions with CSV export
- **Retention policies** (auto-archive old videos) and **legal hold**
- SSO and SCIM provisioning hooks for the future
- Personal: export all your data as JSON; delete your account

### No limits
This is our internal deployment: **no video caps, no recording length limits,
no locked features, no plans or billing.** Everything above is available to
everyone.

---

## Tips

- `Space`/`K` play-pause, `J`/`L` ±10s, `F` fullscreen, `C` captions, `0–9`
  jump to 0–90% — the player has full keyboard shortcuts.
- Paste the share link the second you stop recording — processing finishes
  while your teammate is clicking it.
- Use **silence + filler auto-edit** before sharing anything longer than a few
  minutes; it routinely cuts 20–30% of runtime.
- Search the transcript instead of scrubbing — click the line, you're there.
- Recording something sensitive? Set privacy to **Specific people** or add a
  password + expiry in the Share dialog.
