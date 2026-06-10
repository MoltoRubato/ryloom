# Ryloom Desktop (macOS)

The native recorder: pick a screen or window, hit record, hit stop — the share
link is already on your clipboard while the upload finishes in the background.

Plain Electron, no bundler. Renderer windows load **local files only** with
`nodeIntegration: true` / `contextIsolation: false` (acceptable because no
remote content is ever loaded into a window; all web links open in the
system browser).

```
src/
  main.js                 Electron main process (windows, tray, deep links, IPC)
  renderer/
    index.html / app.js   Main panel — auth → home → record → upload → done
    styles.css            Dark violet design language
    recorder.js           Screen + mic capture → MediaRecorder (WebM)
    superjson-lite.js     CJS fallback for the superjson wire format
    bubble.html           Floating circular camera bubble window
```

## Development

```bash
# from the repo root
pnpm install
pnpm --filter @ryloom/desktop dev
```

The app talks to the web app at the **App URL** (default
`http://localhost:3000`, change it via the gear icon → Settings). On first run
it fetches `GET <appUrl>/api/desktop-config` to learn the Supabase URL + anon
key, so the only thing you ever configure is the App URL — handy for
self-hosted instances.

Make sure `apps/web` is running (`pnpm --filter web dev` or similar) before
signing in.

## How sign-in works (deep link handoff)

1. The app opens `<appUrl>/desktop/auth` in your default browser.
2. That page checks your browser session (redirecting through `/login` if
   needed), then triggers `ryloom://auth#access_token=…&refresh_token=…`.
3. macOS routes the `ryloom://` URL to the app (registered via
   `app.setAsDefaultProtocolClient` + the `protocols` entry in the
   electron-builder config). Tokens travel in the URL *fragment*, so they
   never hit a server or a request log.
4. The renderer calls `supabase.auth.setSession(...)` and persists the session
   in the app's settings store (`~/Library/Application Support/Ryloom/settings.json`),
   with automatic token refresh from then on.

There is also an email + password fallback ("Use email instead") that signs in
against Supabase directly.

> Deep-link registration is most reliable in the **packaged** app. In
> `pnpm dev` the OS may route `ryloom://` links to Electron only after the
> first run; if the browser handoff doesn't come back, use the email sign-in
> or the "Copy link" fallback on the browser page and paste it into Safari's
> address bar.

## Recording pipeline

- `recording.createSession` is called **at recording start**, so the share
  token exists before you stop — stop ⇒ link is on the clipboard instantly.
- Screen/window capture via Chromium desktop capture at up to 30 fps; mic is
  mixed through an `AudioContext`; encoded by `MediaRecorder` as WebM
  (VP9+Opus, VP8 fallback) in 1-second chunks kept in memory.
- The camera bubble is an always-on-top transparent window, so it is
  composited into the capture naturally — the classic Loom effect.
- Upload goes **directly to Supabase Storage** with tus (resumable, 6 MB
  chunks — a Supabase requirement), authorized with your Supabase access
  token. Then `recording.completeSession` flips the video to processing.
- If the upload fails you can retry (tus resumes where it left off) or save
  the recording locally as a `.webm`.

## macOS permissions

| Permission       | When asked | Where to fix it                                              |
| ---------------- | ---------- | ------------------------------------------------------------ |
| Screen Recording | first capture | System Settings → Privacy & Security → **Screen Recording** |
| Microphone       | toggling the mic on | System Settings → Privacy & Security → **Microphone** |
| Camera           | toggling the camera on | System Settings → Privacy & Security → **Camera**  |

Screen Recording has no in-app prompt on macOS — the app shows an
instructions card with an "Open System Settings" button. After enabling it,
**quit and reopen** the app (macOS requirement).

## Packaging

```bash
pnpm --filter @ryloom/desktop dist        # .dmg + .zip for your arch
pnpm --filter @ryloom/desktop dist:all    # x64 + arm64
```

Artifacts land in `apps/desktop/dist/`.

### Unsigned-build note

These builds are **not code-signed or notarized**. On first launch macOS will
warn that the app "can't be checked for malicious software":

- Right-click (Control-click) **Ryloom.app** → **Open** → **Open**, or
- `xattr -dr com.apple.quarantine /Applications/Ryloom.app`

To ship signed builds, set the standard electron-builder signing environment
(`CSC_LINK`, `CSC_KEY_PASSWORD`, plus `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD`
/ `APPLE_TEAM_ID` for notarization) and flip `hardenedRuntime` to `true` in
`package.json` → `build.mac`. <!-- codesign instructions placeholder -->

## Self-hosting

Settings (gear icon) → **App URL** → point it at your instance
(e.g. `https://ryloom.yourcompany.com`) → Save & reconnect. Everything else
(Supabase URL, anon key) is fetched from `/api/desktop-config` on that host
and cached locally for offline starts.
