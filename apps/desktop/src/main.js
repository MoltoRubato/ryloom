/**
 * Ryloom desktop — Electron main process.
 *
 * Responsibilities:
 *  - main control window (record panel)
 *  - floating circular camera bubble window
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
let tray = null;
let isRecording = false;
/** Deep-link auth tokens that arrived before the renderer was ready. */
let pendingAuthTokens = null;
let rendererReady = false;

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
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererReady = false;
  });

  return mainWindow;
}

function showMainWindow() {
  const win = createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openBubble(deviceId, size) {
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
    query: { deviceId: deviceId || "" },
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
// Tray
// ---------------------------------------------------------------------------

// 16×16 violet rounded square with a white record dot (generated PNG).
const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAeUlEQVR42mNIiv3KQAlG5mgA8WYg/g7E/3Hg71A1GugGgAQ+49GIjj/DDIEZsJkEzTC8GdkArM7OSf8Gxni8AzcARbIw59v/06f+/IcBEBskhsUQ7AYga0Y2hCgDQE7GBbB4hwYGUOwFcgOR4mikOCFRnJQpzkxkYwBqQZC7REJYtwAAAABJRU5ErkJggg==";

function createTray() {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  tray = new Tray(icon);
  tray.setToolTip("Ryloom");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Start recording",
        click: () => {
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
    const { deviceId, size } = payload || {};
    openBubble(typeof deviceId === "string" ? deviceId : "", size);
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
    showMainWindow();
  });

  app.on("window-all-closed", () => {
    // Keep running in the tray on macOS; quit elsewhere.
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    closeBubble();
  });
}
