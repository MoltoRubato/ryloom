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

const DEFAULT_APP_URL = "https://ryloom-web.vercel.app";

let mainWindow = null;
let bubbleWindow = null;
let controlsWindow = null;
let countdownWindow = null;
let notesWindow = null;
let tray = null;
let isRecording = false;
/** Deep-link auth tokens that arrived before the renderer was ready. */
let pendingAuthTokens = null;
let rendererReady = false;

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

/** Parses ryloom://auth#access_token=…&refresh_token=… and forwards tokens. */
function handleDeepLink(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.startsWith("ryloom://")) return;
  try {
    const url = new URL(rawUrl);
    const action = url.hostname || url.pathname.replace(/^\/+/, "");
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
    }
  } catch (err) {
    console.error("[ryloom] failed to parse deep link:", err);
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

function openBubble(deviceId, size, frame, cameraBg) {
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
  bubbleWindow.setAlwaysOnTop(true, "floating");
  bubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubbleWindow.loadFile(path.join(__dirname, "renderer", "bubble.html"), {
    query: {
      deviceId: deviceId || "",
      frame: frame || "circle",
      cameraBg: cameraBg || "none",
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
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id || null,
      thumbnailDataUrl:
        source.thumbnail && !source.thumbnail.isEmpty()
          ? source.thumbnail.toDataURL()
          : null,
      appIconDataUrl:
        source.appIcon && !source.appIcon.isEmpty()
          ? source.appIcon.toDataURL()
          : null,
      isScreen: source.id.startsWith("screen"),
    }));
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
    createMainWindow();

    // Cold-start deep link (Windows/Linux).
    const link = extractDeepLinkFromArgv(process.argv);
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
  });
}
