# Ryloom Screen Recorder — Chrome extension

A lightweight Chrome (Manifest V3) launcher for the Ryloom web recorder. It adds
a toolbar popup and a keyboard shortcut that open `/record` in your Ryloom app
with the current tab's URL and title attached as recording context, so finished
videos automatically know which page they were recorded about.

No build step, no dependencies, no binary assets — plain HTML/CSS/JS.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser: Edge, Brave, Arc).
2. Toggle **Developer mode** on (top-right corner).
3. Click **Load unpacked**.
4. Select this `extension/` directory.
5. Pin "Ryloom Screen Recorder" from the puzzle-piece menu so it stays on the toolbar.

> The extension ships without icon assets, so Chrome shows its default
> letter/puzzle icon. That's expected for the 0.1.0 development build.

## Usage

Click the toolbar button to open the popup:

- **Record this tab** — opens the Ryloom recorder in screen mode with the
  current tab's URL and title pre-attached (`sourceUrl` / `title`).
- **Record desktop** — same screen mode; in the recorder's share dialog pick a
  full screen or window instead of a tab.
- **Record camera** — opens the recorder in camera-only mode.
- **Open library** — jumps to your Ryloom library at `/app`.
- **Gear icon** — opens the extension settings.

Tab metadata is only attached for regular web pages. On restricted pages
(`chrome://`, `chrome-extension://`, `file://`, the Chrome Web Store, blank
tabs) the recorder still opens, just without `sourceUrl`/`title`.

### Keyboard shortcut

`Alt+Shift+R` (macOS: `Option+Shift+R`) starts a screen recording for the
current tab from anywhere — no popup needed.

To change or fix the shortcut (Chrome drops suggested keys when they collide
with another extension), open `chrome://extensions/shortcuts` and rebind
**Start a Ryloom screen recording for the current tab**.

## Self-hosted / custom app URL

By default the extension targets a local dev instance at
`http://localhost:3000`. To point it at your deployment:

1. Click the gear icon in the popup (or right-click the toolbar icon →
   **Options**).
2. Enter your Ryloom origin, e.g. `https://ryloom.example.com`.
3. Click **Save**.

The URL is validated (http/https only) and synced via `chrome.storage.sync`,
so it follows your Chrome profile across machines. **Reset to default**
restores `http://localhost:3000`.

## Permissions

- `activeTab` — read the current tab's URL/title at the moment you invoke the
  extension (popup click or shortcut). No persistent tab access, no host
  permissions.
- `storage` — persist the app URL setting.

## Roadmap

In-extension capture via `chrome.desktopCapture` (record without leaving the
current tab, with an injected control bar) is planned for **Phase 2**. The
current version intentionally launches the Ryloom web recorder, which captures
screen/window/tab via `getDisplayMedia` — identical output quality with a much
smaller permission footprint.
