/**
 * Ryloom desktop — Electron main process.
 *
 * Responsibilities:
 *  - main control window (record panel)
 *  - floating circular camera bubble window (captured into the recording)
 *  - floating recording control bar, countdown overlay and speaker notes —
 *    all content-protected so they NEVER appear in the captured video
 *  - tray icon + menu
 *  - ryloom:// deep-link handling (browser → app auth token handoff)
 *  - privileged IPC: desktop capture sources, media permissions, clipboard,
 *    notifications, external links, persisted settings store
 */
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  desktopCapturer,
  systemPreferences,
  clipboard,
  Notification,
  shell,
  nativeImage,
  screen,
  dialog,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const DEFAULT_APP_URL = "https://ryloom-web.vercel.app";

let mainWindow = null;
let bubbleWindow = null;
let controlsWindow = null;
let countdownWindow = null;
let notesWindow = null;
/** Full-screen Loom-style canvas stage (a real backdrop window we record). */
let canvasWindow = null;
let canvasDisplayId = null;
/** Full-display "drag a rectangle" overlays (custom-size capture). */
let regionWindows = [];
let regionResolve = null;
let tray = null;
let isRecording = false;
/** Deep-link auth tokens that arrived before the renderer was ready. */
let pendingAuthTokens = null;
/** A ryloom://record deep link arrived before the renderer was ready. */
let pendingTrayRecord = false;
let rendererReady = false;
/**
 * The app was launched solely to host the floating camera bubble (the web
 * recorder fired ryloom://bubble while capturing a monitor). The hub window
 * must stay closed — it would appear in the user's recording.
 */
let bubbleOnlyLaunch = false;

// Dev/QA escape hatch: content-protected windows are invisible to screenshots
// too, which makes UI work on them impossible. Setting this env var keeps
// them capturable.
const CONTENT_PROTECTION_DISABLED =
  process.env.RYLOOM_NO_CONTENT_PROTECTION === "1";

/** Excludes a window from screen capture (and screenshots) where supported. */
function protectFromCapture(win) {
  if (!CONTENT_PROTECTION_DISABLED) win.setContentProtection(true);
}

// ---------------------------------------------------------------------------
// Settings store — plain JSON file in userData, atomic writes.
// Keys: appUrl, desktopConfig, supabaseSession, lastWorkspaceId, preferences.
// ---------------------------------------------------------------------------

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  const file = settingsPath();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    console.error("[ryloom] failed to persist settings:", err);
  }
}

function getSetting(key, fallback = null) {
  const settings = readSettings();
  return settings[key] === undefined ? fallback : settings[key];
}

function getAppUrl() {
  const url = getSetting("appUrl", DEFAULT_APP_URL);
  return typeof url === "string" && /^https?:\/\//.test(url)
    ? url.replace(/\/+$/, "")
    : DEFAULT_APP_URL;
}

// ---------------------------------------------------------------------------
// Single instance + deep links
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

function registerProtocol() {
  // In dev (`electron .`) the executable is Electron itself, so the protocol
  // must be registered with the app path as an argument (Windows/Linux dev).
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("ryloom", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient("ryloom");
  }
}

/**
 * ryloom:// deep links — the browser → app bridge.
 *
 *   ryloom://auth#access_token=…&refresh_token=…  sign the app in
 *   ryloom://record                               open the hub, start recording
 *   ryloom://bubble?label=…&size=…&frame=…&cameraBg=…
 *     Float ONLY the always-on-top camera bubble — no hub window. The web
 *     recorder hands its self-view here while capturing a monitor, so the
 *     true transparent circle (impossible in a browser, where Document PiP
 *     is always a rectangular window) gets composited into the capture by
 *     the OS, exactly like a native desktop recording.
 *   ryloom://bubble-close                         dismiss that bubble again
 */
function handleDeepLink(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.startsWith("ryloom://")) return;
  let url;
  let action;
  try {
    url = new URL(rawUrl);
    action = (url.hostname || url.pathname.replace(/^\/+/, "")).toLowerCase();
  } catch (err) {
    console.error("[ryloom] failed to parse deep link:", err);
    return;
  }

  if (action === "bubble" || action === "bubble-close") {
    // While a NATIVE recording runs, the bubble belongs to it — a stray web
    // deep link must not replace or kill it.
    if (isRecording) return;
    if (action === "bubble-close") {
      closeBubble();
      return;
    }
    // Bubble-only companion mode: never raise the hub — the presenter is
    // mid-recording in the browser and the hub would be captured. The
    // browser's external-protocol consent prompt gates who can trigger this;
    // the bubble itself only shows the camera locally (nothing is
    // transmitted).
    const q = url.searchParams;
    openBubble(
      q.get("deviceId") || "",
      q.get("size") || 220,
      q.get("frame") || "circle",
      q.get("cameraBg") || "none",
      q.get("label") || "",
    );
    return;
  }

  if (action === "auth") {
    // Tokens travel in the fragment so they never hit any server logs.
    const fragment = (url.hash || "").replace(/^#/, "");
    const params = new URLSearchParams(
      fragment.length > 0 ? fragment : url.search.replace(/^\?/, ""),
    );
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) {
      deliverAuthTokens({ accessToken, refreshToken });
    }
  } else if (action === "record") {
    deliverTrayRecord();
  }

  showMainWindow();
}

function deliverAuthTokens(tokens) {
  if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
    mainWindow.webContents.send("auth-tokens", tokens);
  } else {
    pendingAuthTokens = tokens;
  }
}

/** ryloom://record → same flow as the tray's "Start recording". */
function deliverTrayRecord() {
  if (isRecording) return;
  // A pending custom-area pick would leave capturable overlays on screen.
  settleRegionSelect(null);
  if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
    mainWindow.webContents.send("tray-record");
  } else {
    pendingTrayRecord = true;
  }
}

function extractDeepLinkFromArgv(argv) {
  return argv.find((arg) => typeof arg === "string" && arg.startsWith("ryloom://"));
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 460,
    height: 680,
    minWidth: 460,
    minHeight: 600,
    maxWidth: 560,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#17151f",
    show: false,
    webPreferences: {
      // Only local files are ever loaded into this window (no remote URLs),
      // so node integration without context isolation is acceptable here.
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Never render remote content inside the app — open links in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    rendererReady = true;
    if (pendingAuthTokens) {
      mainWindow.webContents.send("auth-tokens", pendingAuthTokens);
      pendingAuthTokens = null;
    }
    if (pendingTrayRecord) {
      pendingTrayRecord = false;
      mainWindow.webContents.send("tray-record");
    }
  });

  mainWindow.on("close", (event) => {
    if (!isRecording) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["Keep recording", "Discard recording & close"],
      defaultId: 0,
      cancelId: 0,
      message: "A recording is in progress",
      detail:
        "Closing this window will stop and discard the current recording. The video will not be uploaded.",
    });
    if (choice === 0) {
      event.preventDefault();
      return;
    }
    isRecording = false;
    closeBubble();
    closeControls();
    closeCountdown();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererReady = false;
  });

  return mainWindow;
}

function showMainWindow() {
  // The hub must never be on screen while recording — it would be captured.
  // Every path that re-shows it (Dock activate, tray, deep links) funnels
  // through here; stop flows clear isRecording before calling main-show.
  if (isRecording) return;
  const win = createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openBubble(deviceId, size, frame, cameraBg, label) {
  closeBubble();
  const bubbleSize = clampBubbleSize(size);
  const { workArea } = screen.getPrimaryDisplay();

  bubbleWindow = new BrowserWindow({
    width: bubbleSize,
    height: bubbleSize,
    x: workArea.x + 24,
    y: workArea.y + workArea.height - bubbleSize - 24,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  // "floating" keeps the bubble above normal windows so it is naturally
  // composited into the screen capture — the classic Loom camera effect.
  // When a canvas backdrop window is up it is ALSO "floating", so a click on
  // the canvas could raise it over the bubble and hide the camera. Float the
  // bubble strictly above the canvas ("pop-up-menu" 101 > "floating" 3) so it
  // stays on top no matter what — yet still below the control bar/countdown
  // ("screen-saver" 1000), so Stop stays clickable. macOS enforces this level
  // order regardless of clicks.
  const bubbleLevel =
    canvasWindow && !canvasWindow.isDestroyed() ? "pop-up-menu" : "floating";
  bubbleWindow.setAlwaysOnTop(true, bubbleLevel);
  bubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubbleWindow.loadFile(path.join(__dirname, "renderer", "bubble.html"), {
    query: {
      deviceId: deviceId || "",
      frame: frame || "circle",
      cameraBg: cameraBg || "none",
      // Browser deviceIds are origin-scoped and useless here — web handoffs
      // send the OS device label instead, matched in bubble.html.
      label: label || "",
    },
  });
  bubbleWindow.on("closed", () => {
    bubbleWindow = null;
  });
}

function closeBubble() {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.destroy();
  }
  bubbleWindow = null;
}

function clampBubbleSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) return 220;
  return Math.max(120, Math.min(480, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Recording control bar / countdown overlay / speaker notes
// (all content-protected — they float on screen but never get recorded)
// ---------------------------------------------------------------------------

/** desktopCapturer screen sources carry display_id — map it to a Display. */
function displayForId(displayId) {
  const displays = screen.getAllDisplays();
  if (displayId) {
    const match = displays.find((d) => String(d.id) === String(displayId));
    if (match) return match;
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/** Clips `rect` to `bounds`; returns null when they don't overlap. */
function intersectRects(rect, bounds) {
  const x1 = Math.max(rect.x, bounds.x);
  const y1 = Math.max(rect.y, bounds.y);
  const x2 = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const y2 = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Resolves a desktopCapturer WINDOW source's on-screen rect, in the same
 * coordinate space as Electron's screen API (DIPs, global top-left origin).
 *
 * This powers Loom-style window recording: instead of capturing the window's
 * own pixel buffer (which can never contain the floating camera bubble — a
 * separate always-on-top window), the renderer captures the ENTIRE screen and
 * crops to this rect, so the bubble stays in the video.
 *
 * macOS-only: the source id ("window:1234:0") carries the CGWindowID and a
 * JXA one-liner reads its bounds via CGWindowListCopyWindowInfo — no native
 * module needed. CGWindow bounds are top-left-origin global points, which is
 * exactly Electron's DIP space. Resolves null when the window is gone or on
 * other platforms; callers fall back to direct window capture.
 */
function getWindowBounds(sourceId) {
  if (process.platform !== "darwin") return Promise.resolve(null);
  const match = /^window:(\d+)/.exec(String(sourceId || ""));
  if (!match) return Promise.resolve(null);
  // 8 = kCGWindowListOptionIncludingWindow (the JXA bridge exports no consts).
  // castRefToObject, not CFBridgingRelease — the latter segfaults osascript.
  const script = [
    'ObjC.import("CoreGraphics");',
    `var ref = $.CGWindowListCopyWindowInfo(8, ${Number(match[1])});`,
    "var arr = ObjC.deepUnwrap(ObjC.castRefToObject(ref));",
    "JSON.stringify(arr && arr[0] ? arr[0].kCGWindowBounds : null);",
  ].join("\n");
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", script],
      { timeout: 3000 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        try {
          const bounds = JSON.parse(String(stdout).trim());
          const width = Math.round(Number(bounds && bounds.Width));
          const height = Math.round(Number(bounds && bounds.Height));
          if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            resolve(null);
            return;
          }
          resolve({
            x: Math.round(Number(bounds.X) || 0),
            y: Math.round(Number(bounds.Y) || 0),
            width,
            height,
          });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Custom-size region selector — one full-display overlay per screen where the
// user drags out the rectangle to record. Recording then captures that whole
// screen and crops to the rect (same trick as window recording), so the
// camera bubble lands in the video.
// ---------------------------------------------------------------------------

function settleRegionSelect(result) {
  const resolve = regionResolve;
  regionResolve = null;
  const windows = regionWindows;
  regionWindows = [];
  for (const win of windows) {
    if (!win.isDestroyed()) win.destroy();
  }
  if (resolve) resolve(result);
}

/** Resolves { displayId, rect } (global DIPs) or null when canceled. */
function openRegionSelector() {
  if (regionResolve) return Promise.resolve(null); // a pick is already running
  return new Promise((resolve) => {
    regionResolve = resolve;
    const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    for (const display of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        ...display.bounds,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        enableLargerThanScreen: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          backgroundThrottling: false,
        },
      });
      win.setAlwaysOnTop(true, "screen-saver");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setBounds(display.bounds); // transparent windows can shrink on create
      win.loadFile(path.join(__dirname, "renderer", "region.html"), {
        query: { displayId: String(display.id) },
      });
      win.on("closed", () => {
        regionWindows = regionWindows.filter((w) => w !== win);
        // Last overlay externally closed mid-pick → treat as cancel.
        if (regionResolve && regionWindows.length === 0) settleRegionSelect(null);
      });
      if (display.id === cursorDisplay.id) {
        win.once("ready-to-show", () => {
          if (!win.isDestroyed()) win.focus(); // Esc-to-cancel works immediately
        });
      }
      regionWindows.push(win);
    }
  });
}

function openControls(displayId) {
  closeControls();
  const { workArea } = displayForId(displayId);
  const width = 88;
  const height = 360;

  controlsWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + 14,
    y: Math.round(workArea.y + workArea.height / 2 - height / 2),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  protectFromCapture(controlsWindow);
  // "screen-saver" floats above full-screen apps too.
  controlsWindow.setAlwaysOnTop(true, "screen-saver");
  controlsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  controlsWindow.loadFile(path.join(__dirname, "renderer", "controls.html"));
  controlsWindow.on("closed", () => {
    controlsWindow = null;
  });
}

function closeControls() {
  if (controlsWindow && !controlsWindow.isDestroyed()) {
    controlsWindow.destroy();
  }
  controlsWindow = null;
}

/**
 * Shows the 3-2-1 countdown as a full-display overlay and resolves with
 * `true` (countdown finished / skipped) or `false` (canceled).
 */
function runCountdownOverlay(displayId) {
  return new Promise((resolve) => {
    closeCountdown();
    const display = displayForId(displayId);

    let settled = false;
    const settle = (completed) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("countdown-done", onDone);
      closeCountdown();
      resolve(completed);
    };
    const onDone = (event, completed) => {
      if (
        countdownWindow &&
        !countdownWindow.isDestroyed() &&
        event.sender === countdownWindow.webContents
      ) {
        settle(Boolean(completed));
      }
    };

    countdownWindow = new BrowserWindow({
      ...display.bounds,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
      },
    });
    protectFromCapture(countdownWindow);
    countdownWindow.setAlwaysOnTop(true, "screen-saver");
    countdownWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    countdownWindow.setBounds(display.bounds); // transparent windows can shrink on create
    countdownWindow.loadFile(path.join(__dirname, "renderer", "countdown.html"));
    countdownWindow.once("ready-to-show", () => {
      if (countdownWindow && !countdownWindow.isDestroyed()) countdownWindow.focus();
    });
    ipcMain.on("countdown-done", onDone);
    countdownWindow.on("closed", () => {
      countdownWindow = null;
      settle(false);
    });
  });
}

function closeCountdown() {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    countdownWindow.destroy();
  }
  countdownWindow = null;
}

function toggleNotes() {
  if (notesWindow && !notesWindow.isDestroyed()) {
    notesWindow.destroy();
    notesWindow = null;
    return false;
  }
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 380;
  const height = 440;
  notesWindow = new BrowserWindow({
    width,
    height,
    minWidth: 280,
    minHeight: 260,
    x: workArea.x + workArea.width - width - 24,
    y: Math.round(workArea.y + workArea.height / 2 - height / 2),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  protectFromCapture(notesWindow);
  notesWindow.setAlwaysOnTop(true, "screen-saver");
  notesWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notesWindow.loadFile(path.join(__dirname, "renderer", "notes.html"));
  notesWindow.on("closed", () => {
    notesWindow = null;
  });
  return true;
}

function closeNotes() {
  if (notesWindow && !notesWindow.isDestroyed()) {
    notesWindow.destroy();
  }
  notesWindow = null;
}

// ---------------------------------------------------------------------------
// Canvas stage — a real full-display backdrop window (Loom-style). Unlike the
// control bar / countdown it is deliberately NOT content-protected: it IS the
// designed backdrop we want in the recording, captured live like any on-screen
// window, with the camera bubble floating on top. The compose toolbar inside it
// hides itself before the take so it's never recorded.
// ---------------------------------------------------------------------------

function openCanvasWindow(displayId, camOn, countdownOn, camDeviceId) {
  closeCanvasWindow();
  const display = displayForId(displayId);
  canvasDisplayId = String(display.id);

  canvasWindow = new BrowserWindow({
    ...display.bounds,
    frame: false,
    transparent: false,
    backgroundColor: "#17151f",
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  // "floating" sits above normal windows so the screen capture includes it; the
  // camera bubble (also "floating", opened at record time) lands on top of it.
  canvasWindow.setAlwaysOnTop(true, "floating");
  canvasWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  canvasWindow.setBounds(display.bounds); // transparent/opaque windows can shrink on create
  canvasWindow.loadFile(path.join(__dirname, "renderer", "canvas.html"), {
    query: {
      camOn: camOn ? "1" : "0",
      countdownOn: countdownOn === false ? "0" : "1",
      camDeviceId: typeof camDeviceId === "string" ? camDeviceId : "",
    },
  });
  canvasWindow.once("ready-to-show", () => {
    if (canvasWindow && !canvasWindow.isDestroyed()) canvasWindow.focus();
  });
  canvasWindow.on("closed", () => {
    canvasWindow = null;
  });
}

function closeCanvasWindow() {
  if (canvasWindow && !canvasWindow.isDestroyed()) {
    canvasWindow.destroy();
  }
  canvasWindow = null;
}

function canvasStageSend(channel, ...args) {
  if (canvasWindow && !canvasWindow.isDestroyed()) {
    canvasWindow.webContents.send(channel, ...args);
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

// Canonical Ryloom mark (violet rounded square + play circle) rasterized at
// 16px/32px — keep in sync with apps/web/public/favicon.svg and build/icon.icns.
const TRAY_ICON_16 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAA0VXHyAAACPklEQVQ4EZ1TS2tTURD+5tyTe2NLk7axLsUHJrqsIoL4GwQpboQUSbQQcWlxISgKLhSXYkCpCAE3LgR/g7izXdpUfODSNm1NJI+be89x5tzcKCIuOnAfzHwzc8433xBGVrm0e0R5kxcMottEyFlr0pD7EilYi7YC3TNx//Xzl9OfJUDyqpY7F0ll60rpQhT12GPF/Q8jaL0PxkQta/q1lcbUK7pS3j1sKVgj0nljQpfEnRANATOqo7iNznA31w5QyufTRD/IDua1tf6Cp7P5KOq65DgGfB84fcZDqeQ5X7MZY+19jJDre+ySRlpP5OOhXaBKudvmwlOWjy3JcwcItesBCvsJnz4mPBw9ptDasqg/HmDzu3VFiI/DPHWoutizQpgcW2vg1p0s2m2Lp09CBhv2EWYKhKWaj1yOcP9uH1GUXEeIVSnbcueTpzzXWZIHA4uz5zSCLLDTsnhWD11MMIIVk1yV/CaElU542Fg32N62jofLVR83bgY4eEhha9O4mGBSciV3XCAt9N/vaAp/YsYFZETNDzGKxxVmZ8kx/mIlxKMHA3z7alCYUyiWlMPIWFNTQoRYhue8yqMStpeu+QgCwru3EQZ9jEmUmGBEE2KSu/cxsoh5cB2qLP5c1t7kw7+FNM9sF0dC2lhnIa3+FpJ0ZyEhHvaWqcxS9vco5ZClrBqN6S880KtctCVV3b2YpAzLOQiSR/6FZIkJRrCSI7ljPpN1njhveZ0ZOZMKTNBijmxrd3gfeZ27b9J1/gVe+xUqkyGoggAAAABJRU5ErkJggg==";
const TRAY_ICON_32 =
  "data:image/png;base64,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";

function createTray() {
  const icon = nativeImage.createEmpty();
  icon.addRepresentation({ scaleFactor: 1, dataURL: TRAY_ICON_16 });
  icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_32 });
  tray = new Tray(icon);
  tray.setToolTip("Ryloom");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Start recording",
        click: () => {
          if (isRecording) return; // control bar already on screen
          showMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("tray-record");
          }
        },
      },
      {
        label: "Open library",
        click: () => {
          shell.openExternal(`${getAppUrl()}/app`);
        },
      },
      {
        label: "Speaker notes",
        click: () => toggleNotes(),
      },
      { type: "separator" },
      {
        // Self-host/dev affordance — the App URL panel lives out of the main
        // UI; reachable here and via ⌘, in the app.
        label: "Connection settings…",
        click: () => {
          showMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("open-settings");
          }
        },
      },
      { type: "separator" },
      {
        label: "Quit Ryloom",
        click: () => {
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => showMainWindow());
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle("get-sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    const displays = screen.getAllDisplays();
    return sources.map((source) => {
      const isScreen = source.id.startsWith("screen");
      // Physical pixel size of the display — the renderer pins its capture
      // constraints to this so Chromium doesn't apply its 2880x1800 default
      // cap and downscale Retina/4K/5K captures (blurry text). displayBounds
      // (DIPs, global) lets the renderer map window/region crop rects onto
      // the captured frame.
      let captureSize = null;
      let displayBounds = null;
      if (isScreen) {
        const display = displays.find(
          (d) => String(d.id) === String(source.display_id),
        );
        if (display) {
          captureSize = {
            width: Math.round(display.bounds.width * display.scaleFactor),
            height: Math.round(display.bounds.height * display.scaleFactor),
          };
          displayBounds = { ...display.bounds };
        }
      }
      return {
        id: source.id,
        name: source.name,
        displayId: source.display_id || null,
        captureSize,
        displayBounds,
        thumbnailDataUrl:
          source.thumbnail && !source.thumbnail.isEmpty()
            ? source.thumbnail.toDataURL()
            : null,
        appIconDataUrl:
          source.appIcon && !source.appIcon.isEmpty()
            ? source.appIcon.toDataURL()
            : null,
        isScreen,
      };
    });
  });

  // Window rect for Loom-style "specific window" capture (screen + crop).
  ipcMain.handle("get-window-bounds", (_event, sourceId) =>
    getWindowBounds(sourceId),
  );

  // --- Custom-size region selection ----------------------------------------

  ipcMain.handle("region-select", () => openRegionSelector());

  ipcMain.on("region-done", (event, payload) => {
    if (!regionResolve) return;
    const fromOverlay = regionWindows.some(
      (win) => !win.isDestroyed() && event.sender === win.webContents,
    );
    if (!fromOverlay) return;
    if (!payload || !payload.rect) {
      settleRegionSelect(null);
      return;
    }
    const rx = Number(payload.rect.x);
    const ry = Number(payload.rect.y);
    const rw = Number(payload.rect.width);
    const rh = Number(payload.rect.height);
    if (![rx, ry, rw, rh].every(Number.isFinite)) {
      settleRegionSelect(null);
      return;
    }
    // Overlay coords are display-relative DIPs — translate to global and
    // clip to the display so the rect is always croppable from its capture.
    const display = displayForId(payload.displayId);
    const rect = intersectRects(
      {
        x: display.bounds.x + Math.round(rx),
        y: display.bounds.y + Math.round(ry),
        width: Math.round(rw),
        height: Math.round(rh),
      },
      display.bounds,
    );
    settleRegionSelect(
      rect && rect.width >= 16 && rect.height >= 16
        ? { displayId: display.id, rect }
        : null,
    );
  });

  ipcMain.handle("media-status", () => {
    if (process.platform !== "darwin") {
      return { microphone: "granted", camera: "granted", screen: "granted" };
    }
    return {
      microphone: systemPreferences.getMediaAccessStatus("microphone"),
      camera: systemPreferences.getMediaAccessStatus("camera"),
      screen: systemPreferences.getMediaAccessStatus("screen"),
    };
  });

  // Triggers the macOS permission prompt for "microphone" / "camera".
  // (Screen Recording has no programmatic prompt — users must enable it in
  // System Settings; the renderer deep-links there instead.)
  ipcMain.handle("media-request", async (_event, mediaType) => {
    if (process.platform !== "darwin") return true;
    if (mediaType !== "microphone" && mediaType !== "camera") return false;
    try {
      return await systemPreferences.askForMediaAccess(mediaType);
    } catch {
      return false;
    }
  });

  ipcMain.handle("clipboard-write", (_event, text) => {
    if (typeof text === "string") clipboard.writeText(text);
    return true;
  });

  ipcMain.handle("notify", (_event, payload) => {
    const { title, body } = payload || {};
    if (!Notification.isSupported()) return false;
    new Notification({
      title: String(title || "Ryloom"),
      body: String(body || ""),
      silent: false,
    }).show();
    return true;
  });

  ipcMain.handle("open-external", (_event, url) => {
    if (typeof url !== "string") return false;
    // http/https for web links + the System Settings privacy panes.
    const allowed =
      /^https?:\/\//i.test(url) || url.startsWith("x-apple.systempreferences:");
    if (!allowed) return false;
    shell.openExternal(url);
    return true;
  });

  ipcMain.handle("store-get", (_event, key) => {
    if (typeof key !== "string") return null;
    const value = getSetting(key, null);
    return value === undefined ? null : value;
  });

  ipcMain.handle("store-set", (_event, key, value) => {
    if (typeof key !== "string") return false;
    const settings = readSettings();
    if (value === null || value === undefined) {
      delete settings[key];
    } else {
      settings[key] = value;
    }
    writeSettings(settings);
    return true;
  });

  ipcMain.handle("set-recording", (_event, recording) => {
    isRecording = Boolean(recording);
    if (tray) {
      tray.setToolTip(isRecording ? "Ryloom — recording…" : "Ryloom");
    }
    return true;
  });

  ipcMain.handle("bubble-open", (_event, payload) => {
    const { deviceId, size, frame, cameraBg } = payload || {};
    openBubble(
      typeof deviceId === "string" ? deviceId : "",
      size,
      typeof frame === "string" ? frame : "circle",
      typeof cameraBg === "string" ? cameraBg : "none",
    );
    return true;
  });

  ipcMain.handle("bubble-close", (event) => {
    // The ✕ inside the bubble itself — tell the main window so its camera
    // toggle stays in sync.
    const fromBubble =
      bubbleWindow &&
      !bubbleWindow.isDestroyed() &&
      event.sender === bubbleWindow.webContents;
    closeBubble();
    if (fromBubble && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("bubble-closed");
    }
    return true;
  });

  ipcMain.handle("bubble-set-size", (_event, size) => {
    if (!bubbleWindow || bubbleWindow.isDestroyed()) return false;
    const next = clampBubbleSize(size);
    const bounds = bubbleWindow.getBounds();
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    bubbleWindow.setBounds({
      x: Math.round(centerX - next / 2),
      y: Math.round(centerY - next / 2),
      width: next,
      height: next,
    });
    return true;
  });

  // Cropped recordings (specific window / custom area) only contain what's
  // inside the crop rect — nudge the bubble into it, or the camera would
  // silently vanish from the video. No-op when it already fits.
  ipcMain.handle("bubble-move-into", (_event, rect) => {
    if (!bubbleWindow || bubbleWindow.isDestroyed() || !rect) return false;
    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      return false;
    }
    const bounds = bubbleWindow.getBounds();
    const inside =
      bounds.x >= x &&
      bounds.y >= y &&
      bounds.x + bounds.width <= x + width &&
      bounds.y + bounds.height <= y + height;
    if (inside) return true;
    // Bottom-left corner of the crop, the classic bubble spot. If the rect is
    // smaller than the bubble it pins to the rect's origin and overflows.
    const margin = 20;
    const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), Math.max(lo, hi));
    bubbleWindow.setBounds({
      x: Math.round(clamp(x + margin, x, x + width - bounds.width - margin)),
      y: Math.round(clamp(y + height - bounds.height - margin, y, y + height - bounds.height)),
      width: bounds.width,
      height: bounds.height,
    });
    return true;
  });

  // --- Recording control bar -------------------------------------------------

  ipcMain.handle("controls-open", (_event, payload) => {
    openControls(payload && payload.displayId);
    return true;
  });

  ipcMain.handle("controls-close", () => {
    closeControls();
    return true;
  });

  // Timer/state pushes from the (hidden) main window → control bar.
  ipcMain.handle("recording-status", (_event, status) => {
    if (controlsWindow && !controlsWindow.isDestroyed()) {
      controlsWindow.webContents.send("status", status || {});
    }
    return true;
  });

  // Button presses on the control bar → main window's recording state machine.
  ipcMain.on("controls-action", (event, action) => {
    const fromControls =
      controlsWindow &&
      !controlsWindow.isDestroyed() &&
      event.sender === controlsWindow.webContents;
    if (!fromControls) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("controls-action", String(action || ""));
    }
  });

  // --- Countdown overlay -------------------------------------------------------

  ipcMain.handle("countdown-run", (_event, payload) =>
    runCountdownOverlay(payload && payload.displayId),
  );

  // --- Speaker notes -------------------------------------------------------------

  ipcMain.handle("notes-toggle", () => toggleNotes());

  ipcMain.handle("notes-close", () => {
    closeNotes();
    return true;
  });

  // --- Main window visibility (hidden while recording so it's never captured) ---

  ipcMain.handle("main-hide", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    return true;
  });

  ipcMain.handle("main-show", () => {
    showMainWindow();
    return true;
  });

  // --- Canvas stage ----------------------------------------------------------

  ipcMain.handle("canvas-open", (_event, payload) => {
    openCanvasWindow(
      payload && payload.displayId,
      Boolean(payload && payload.camOn),
      !(payload && payload.countdownOn === false),
      (payload && payload.camDeviceId) || "",
    );
    return canvasDisplayId;
  });

  // "Start recording" from inside the canvas stage → hand off to the hub's
  // capture pipeline, recording the very display the stage covers.
  ipcMain.handle("canvas-request-record", (event, payload) => {
    const fromCanvas =
      canvasWindow &&
      !canvasWindow.isDestroyed() &&
      event.sender === canvasWindow.webContents;
    if (!fromCanvas) return false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("start-canvas-recording", {
        displayId: canvasDisplayId,
        camOn: Boolean(payload && payload.camOn),
        countdownOn: !(payload && payload.countdownOn === false),
      });
    }
    return true;
  });

  // Hub → canvas stage: hide the compose toolbar right before capture, or bring
  // it back when a take is aborted.
  ipcMain.handle("canvas-set-recording", () => {
    canvasStageSend("canvas-set-recording", true);
    return true;
  });
  ipcMain.handle("canvas-restore-compose", () => {
    canvasStageSend("canvas-restore-compose");
    return true;
  });

  ipcMain.handle("canvas-close", () => {
    closeCanvasWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("canvas-closed");
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

function bootstrap() {
  registerProtocol();

  // macOS: deep links arrive via open-url (possibly before ready).
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) {
      handleDeepLink(url);
    } else {
      // Cold-started just to float the bubble (covers bubble-close too) —
      // flag it before whenReady so the hub window is never created.
      if (typeof url === "string" && url.startsWith("ryloom://bubble")) {
        bubbleOnlyLaunch = true;
      }
      app.whenReady().then(() => handleDeepLink(url));
    }
  });

  // Windows/Linux: deep links arrive as argv on the second instance.
  app.on("second-instance", (_event, argv) => {
    const link = extractDeepLinkFromArgv(argv);
    if (link) handleDeepLink(link);
    else showMainWindow();
  });

  app.whenReady().then(() => {
    registerIpc();
    createTray();

    // Cold-start deep link (Windows/Linux; macOS flags bubbleOnlyLaunch in
    // open-url before ready). Bubble launches skip the hub window — it would
    // show up in the recording the web app is already capturing.
    const link = extractDeepLinkFromArgv(process.argv);
    if (link && link.startsWith("ryloom://bubble")) bubbleOnlyLaunch = true;
    if (!bubbleOnlyLaunch) createMainWindow();
    if (link) handleDeepLink(link);
  });

  app.on("activate", () => {
    // While recording, the floating control bar is the only UI — summoning
    // the hub (e.g. via the Dock) would put a second, capturable "recording
    // info" window on screen. It reappears on its own when the recording
    // stops.
    if (isRecording) return;
    showMainWindow();
  });

  app.on("window-all-closed", () => {
    // Keep running in the tray on macOS; quit elsewhere.
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    closeBubble();
    closeControls();
    closeCountdown();
    closeNotes();
    settleRegionSelect(null);
  });
}
