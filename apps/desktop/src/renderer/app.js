/**
 * Ryloom desktop — main window renderer.
 *
 * A small state machine:
 *   loading → auth → home → (countdown) → recording → uploading → done
 *                                  ↘ permission (macOS privacy instructions)
 *
 * Talks to the web app over tRPC (Authorization: Bearer <supabase access
 * token>) and uploads recordings straight to Cloudflare R2 via presigned
 * multipart URLs from recording.startUpload.
 */
"use strict";

const { ipcRenderer } = require("electron");
const { createClient } = require("@supabase/supabase-js");
const { createTRPCClient, httpBatchLink } = require("@trpc/client");
const { Recorder } = require("./recorder.js");

// superjson 2.x is ESM-only; fall back to a wire-compatible CJS shim.
let transformer;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  transformer = require("superjson");
  if (typeof transformer.serialize !== "function" && transformer.default) {
    transformer = transformer.default;
  }
  if (typeof transformer.serialize !== "function") throw new Error("no serialize");
} catch {
  transformer = require("./superjson-lite.js");
}

// ---------------------------------------------------------------------------
// IPC + store helpers
// ---------------------------------------------------------------------------

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const storeGet = (key) => invoke("store-get", key);
const storeSet = (key, value) => invoke("store-set", key, value);
const openExternal = (url) => invoke("open-external", url);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Production by default so a fresh install connects out of the box;
// self-hosters/devs point elsewhere via Settings (gear icon).
const DEFAULT_APP_URL = "https://ryloom-web.vercel.app";
const UPLOAD_CONCURRENCY = 3; // R2 multipart parts uploaded in parallel
const UPLOAD_RETRY_DELAYS_MS = [1000, 3000, 5000, 10000];

const state = {
  view: "loading",
  appUrl: DEFAULT_APP_URL,
  config: null, // { supabaseUrl, supabaseAnonKey, appUrl }
  supabase: null,
  session: null,
  workspaces: [], // [{ workspace, role }]
  workspaceId: null,
  sources: [],
  source: null, // selected capture source
  prefs: {
    micOn: true,
    camOn: false,
    countdownOn: true,
    micDeviceId: null,
    camDeviceId: null,
    bubbleSize: 220,
    effects: {
      background: "none", // wallpaper behind the recording (composited)
      cameraBackground: "none", // what's behind YOU on camera (segmentation)
      padding: "md", // canvas inset, used when a background is active
      corners: "rounded",
      frame: "circle", // camera bubble frame
    },
  },
  recorder: null,
  active: null, // createSession result + mimeType for the in-flight recording
  blob: null,
  durationMs: 0,
  dims: null,
  upload: null, // in-flight multipart upload handle { aborted, xhrs }
  uploadDone: false,
  completePending: false,
  recTimer: null,
  permissionKind: "screen",
  starting: false,
  stopping: false,
  restarting: false,
};

// Effects presets. Background ids must match recorder.js BACKGROUND_PAINTERS;
// the CSS here only drives the swatch previews.
const BG_PRESETS = [
  { id: "none", label: "None", css: null },
  { id: "aurora", label: "Aurora", css: "linear-gradient(135deg,#16102e,#4636b3 60%,#2c8f6e)" },
  { id: "sunset", label: "Sunset", css: "linear-gradient(135deg,#ff7e5f,#feb47b)" },
  { id: "ocean", label: "Ocean", css: "linear-gradient(180deg,#0f2027,#203a43,#2c5364)" },
  { id: "candy", label: "Candy", css: "linear-gradient(135deg,#fc5c7d,#6a82fb)" },
  { id: "forest", label: "Forest", css: "linear-gradient(135deg,#0b3d2e,#1d976c)" },
  { id: "slate", label: "Slate", css: "linear-gradient(135deg,#1f1c2c,#4e54c8)" },
  { id: "graphite", label: "Graphite", css: "linear-gradient(180deg,#1b1924,#2e2b3a)" },
  { id: "lavender", label: "Lavender", css: "linear-gradient(135deg,#b993d6,#8ca6db)" },
];

const FRAME_PRESETS = [
  { id: "circle", label: "Classic" },
  { id: "gradient", label: "Gradient" },
  { id: "square", label: "Square" },
  { id: "none", label: "Borderless" },
];

// Camera backgrounds (Effects → Backgrounds) — applied to the bubble via
// person segmentation in bubble.html; ids must match its BG_PAINTERS.
const CAMERA_BG_PRESETS = [
  { id: "none", label: "Clear", css: null },
  { id: "blur", label: "Blur", css: "linear-gradient(135deg,#3a4051,#191d27)" },
  ...BG_PRESETS.filter((preset) => preset.id !== "none"),
];

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const VIEWS = [
  "loading",
  "auth",
  "home",
  "permission",
  "recording",
  "uploading",
  "done",
];

function setView(name) {
  state.view = name;
  for (const view of VIEWS) {
    $(`view-${view}`).hidden = view !== name;
  }
}

function toast(message, kind = "info") {
  const el = document.createElement("div");
  el.className = `toast${kind === "error" ? " error" : ""}`;
  el.textContent = message;
  $("toast-root").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.25s ease";
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

function setBanner(id, message) {
  const el = $(id);
  if (!message) {
    el.hidden = true;
    el.textContent = "";
  } else {
    el.hidden = false;
    el.textContent = message;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTimer(ms) {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function errorMessage(err, fallback) {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  return err.message || fallback;
}

// ---------------------------------------------------------------------------
// Config + Supabase bootstrap
// ---------------------------------------------------------------------------

async function fetchDesktopConfig(appUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${appUrl}/api/desktop-config`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.supabaseUrl || !json.supabaseAnonKey) {
      throw new Error("Config response missing Supabase credentials");
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

/** Supabase auth storage adapter persisted via the main-process JSON store. */
const supabaseStorage = {
  async getItem(key) {
    const all = (await storeGet("supabaseSession")) || {};
    return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null;
  },
  async setItem(key, value) {
    const all = (await storeGet("supabaseSession")) || {};
    all[key] = value;
    await storeSet("supabaseSession", all);
  },
  async removeItem(key) {
    const all = (await storeGet("supabaseSession")) || {};
    delete all[key];
    await storeSet("supabaseSession", all);
  },
};

function buildSupabase() {
  if (state.supabase) {
    // Re-connecting (e.g. App URL changed) — silence the old client.
    try {
      state.supabase.auth.stopAutoRefresh();
    } catch {
      /* ignore */
    }
  }
  state.supabase = createClient(state.config.supabaseUrl, state.config.supabaseAnonKey, {
    auth: {
      storage: supabaseStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  state.supabase.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === "SIGNED_OUT" && state.view !== "loading") {
      setView("auth");
      showAuthSection("main");
    }
  });
}

function getTrpc() {
  return createTRPCClient({
    links: [
      httpBatchLink({
        url: `${state.appUrl}/api/trpc`,
        transformer,
        headers: () => {
          const token = state.session && state.session.access_token;
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  setView("loading");
  $("loading-label").textContent = "Connecting to Ryloom…";

  const storedUrl = await storeGet("appUrl");
  state.appUrl =
    typeof storedUrl === "string" && /^https?:\/\//.test(storedUrl)
      ? storedUrl.replace(/\/+$/, "")
      : DEFAULT_APP_URL;
  if (!storedUrl) await storeSet("appUrl", state.appUrl);

  const prefs = await storeGet("preferences");
  if (prefs && typeof prefs === "object") {
    const defaults = state.prefs;
    state.prefs = {
      ...defaults,
      ...prefs,
      effects: { ...defaults.effects, ...(prefs.effects || {}) },
    };
  }
  $("auth-app-url").textContent = state.appUrl;
  $("setting-app-url").value = state.appUrl;

  // 1. Bootstrap Supabase credentials from the web app (cache for offline).
  try {
    state.config = await fetchDesktopConfig(state.appUrl);
    await storeSet("desktopConfig", state.config);
    setConfigStatus(`Connected — Supabase: ${hostOf(state.config.supabaseUrl)}`, "ok");
  } catch (err) {
    const cached = await storeGet("desktopConfig");
    if (cached && cached.supabaseUrl && cached.supabaseAnonKey) {
      state.config = cached;
      setConfigStatus("Using cached connection (couldn't reach the app)", "ok");
    } else {
      setView("auth");
      showAuthSection("main");
      setBanner(
        "auth-error",
        `Can't reach Ryloom at ${state.appUrl}. Check the App URL below.`,
      );
      setConfigStatus(`Failed: ${errorMessage(err, "network error")}`, "bad");
      openSettings(); // surface the Advanced panel only when it's needed
      return;
    }
  }

  buildSupabase();

  // 2. Restore session.
  const {
    data: { session },
  } = await state.supabase.auth.getSession();
  state.session = session;

  if (session) {
    await enterHome();
  } else {
    setView("auth");
    showAuthSection("main");
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function setConfigStatus(text, kind) {
  const el = $("config-status");
  el.textContent = text;
  el.className = `config-status${kind ? ` ${kind}` : ""}`;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function showAuthSection(section) {
  $("auth-main").hidden = section !== "main";
  $("auth-waiting").hidden = section !== "waiting";
  $("auth-email-form").hidden = section !== "email";
}

function openBrowserSignIn() {
  setBanner("auth-error", null);
  openExternal(`${state.appUrl}/desktop/auth`);
  showAuthSection("waiting");
}

async function handleAuthTokens({ accessToken, refreshToken }) {
  if (!state.supabase) {
    toast("Still connecting — try again in a second", "error");
    return;
  }
  setBanner("auth-error", null);
  const { data, error } = await state.supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error || !data.session) {
    showAuthSection("main");
    setBanner("auth-error", `Sign-in failed: ${errorMessage(error, "invalid tokens")}`);
    setView("auth");
    return;
  }
  state.session = data.session;
  toast("Signed in");
  await enterHome();
}

async function handleEmailSignIn(event) {
  event.preventDefault();
  if (!state.supabase) {
    setBanner("auth-error", "Not connected to the app yet — check Settings.");
    return;
  }
  const email = $("email-input").value.trim();
  const password = $("password-input").value;
  if (!email || !password) return;

  const button = $("btn-email-submit");
  button.disabled = true;
  button.textContent = "Signing in…";
  setBanner("auth-error", null);
  try {
    const { data, error } = await state.supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.session) {
      setBanner("auth-error", errorMessage(error, "Sign-in failed"));
      return;
    }
    state.session = data.session;
    $("password-input").value = "";
    await enterHome();
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
}

async function signOut() {
  try {
    if (state.supabase) await state.supabase.auth.signOut();
  } catch {
    /* local sign-out regardless */
  }
  await storeSet("supabaseSession", null);
  state.session = null;
  await invoke("bubble-close");
  setView("auth");
  showAuthSection("main");
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

async function enterHome() {
  setView("loading");
  $("loading-label").textContent = "Loading your workspaces…";

  const email = (state.session && state.session.user && state.session.user.email) || "";
  const avatar = $("avatar");
  avatar.textContent = (email[0] || "?").toUpperCase();
  avatar.title = email;

  // Workspaces
  try {
    const rows = await getTrpc().workspace.list.query();
    state.workspaces = Array.isArray(rows) ? rows : [];
  } catch (err) {
    setView("home");
    setBanner(
      "home-error",
      `Couldn't load workspaces: ${errorMessage(err, "network error")}. Check your connection or App URL.`,
    );
    state.workspaces = [];
    populateWorkspaces();
    return;
  }

  if (state.workspaces.length === 0) {
    setView("home");
    setBanner(
      "home-error",
      "You don't have a workspace yet — open Ryloom in your browser to finish onboarding, then come back.",
    );
    populateWorkspaces();
    return;
  }

  setBanner("home-error", null);
  const last = await storeGet("lastWorkspaceId");
  const ids = state.workspaces.map((row) => row.workspace.id);
  state.workspaceId = ids.includes(last) ? last : ids[0];
  populateWorkspaces();

  await refreshSources();
  await refreshDevices();
  applyPrefsToUi();
  setView("home");
  syncBubble();
}

function populateWorkspaces() {
  const select = $("workspace-select");
  select.innerHTML = "";
  for (const row of state.workspaces) {
    const option = document.createElement("option");
    option.value = row.workspace.id;
    option.textContent = row.workspace.name || "Workspace";
    select.appendChild(option);
  }
  if (state.workspaceId) select.value = state.workspaceId;
  select.disabled = state.workspaces.length === 0;
}

function applyPrefsToUi() {
  $("mic-toggle").checked = Boolean(state.prefs.micOn);
  $("cam-toggle").checked = Boolean(state.prefs.camOn);
  $("countdown-toggle").checked = Boolean(state.prefs.countdownOn);
  $("mic-select").disabled = !state.prefs.micOn;
  $("cam-select").disabled = !state.prefs.camOn;
  updateEffectsDot();
}

async function savePrefs() {
  await storeSet("preferences", state.prefs);
}

// --- capture sources -------------------------------------------------------

async function refreshSources() {
  try {
    state.sources = await invoke("get-sources");
  } catch {
    state.sources = [];
  }
  // Screens first.
  state.sources.sort((a, b) => Number(b.isScreen) - Number(a.isScreen));
  const selectedStillExists =
    state.source && state.sources.some((s) => s.id === state.source.id);
  if (!selectedStillExists) {
    state.source = state.sources.find((s) => s.isScreen) || state.sources[0] || null;
  } else {
    state.source = state.sources.find((s) => s.id === state.source.id);
  }
  renderSelectedSource();
}

function renderSelectedSource() {
  const thumb = $("source-thumb");
  if (state.source) {
    $("source-name").textContent = state.source.isScreen
      ? screenLabel(state.source)
      : state.source.name;
    $("source-kind").textContent = state.source.isScreen ? "Screen" : "Window";
    if (state.source.thumbnailDataUrl) {
      thumb.src = state.source.thumbnailDataUrl;
      thumb.style.display = "";
    } else {
      thumb.removeAttribute("src");
      thumb.style.display = "none";
    }
  } else {
    $("source-name").textContent = "No source available";
    $("source-kind").textContent = "Check Screen Recording permission";
    thumb.removeAttribute("src");
    thumb.style.display = "none";
  }
}

function screenLabel(source) {
  const screens = state.sources.filter((s) => s.isScreen);
  if (screens.length <= 1) return "Entire screen";
  return source.name || "Screen";
}

async function openSourcePicker() {
  await refreshSources();
  renderSourceGrids();
  $("sources-overlay").hidden = false;

  if (state.sources.length === 0) {
    const status = await invoke("media-status");
    if (status.screen !== "granted") {
      $("sources-overlay").hidden = true;
      showPermissionCard("screen");
    }
  }
}

function renderSourceGrids() {
  const screensGrid = $("sources-grid-screens");
  const windowsGrid = $("sources-grid-windows");
  screensGrid.innerHTML = "";
  windowsGrid.innerHTML = "";

  const screens = state.sources.filter((s) => s.isScreen);
  const windows = state.sources.filter((s) => !s.isScreen);
  $("sources-empty").hidden = windows.length > 0;

  const makeTile = (source) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `source-tile${state.source && state.source.id === source.id ? " selected" : ""}`;

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = "";
    if (source.thumbnailDataUrl) img.src = source.thumbnailDataUrl;
    tile.appendChild(img);

    const label = document.createElement("div");
    label.className = "tile-label";
    if (source.appIconDataUrl) {
      const icon = document.createElement("img");
      icon.className = "app-icon";
      icon.alt = "";
      icon.src = source.appIconDataUrl;
      label.appendChild(icon);
    }
    const text = document.createElement("span");
    text.textContent = source.isScreen ? screenLabel(source) : source.name;
    label.appendChild(text);
    tile.appendChild(label);

    tile.addEventListener("click", () => {
      state.source = source;
      renderSelectedSource();
      $("sources-overlay").hidden = true;
    });
    return tile;
  };

  for (const source of screens) screensGrid.appendChild(makeTile(source));
  for (const source of windows) windowsGrid.appendChild(makeTile(source));
}

// --- devices ----------------------------------------------------------------

async function refreshDevices() {
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    devices = [];
  }
  const mics = devices.filter((d) => d.kind === "audioinput");
  const cams = devices.filter((d) => d.kind === "videoinput");

  fillDeviceSelect($("mic-select"), mics, state.prefs.micDeviceId, "Microphone");
  fillDeviceSelect($("cam-select"), cams, state.prefs.camDeviceId, "Camera");
}

function fillDeviceSelect(select, devices, preferredId, fallbackLabel) {
  select.innerHTML = "";
  if (devices.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = `Default ${fallbackLabel.toLowerCase()}`;
    select.appendChild(option);
    return;
  }
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
    select.appendChild(option);
  });
  if (preferredId && devices.some((d) => d.deviceId === preferredId)) {
    select.value = preferredId;
  }
}

function syncBubble() {
  if (state.view !== "home" && state.view !== "recording") {
    return;
  }
  if (state.prefs.camOn) {
    invoke("bubble-open", {
      deviceId: state.prefs.camDeviceId || $("cam-select").value || "",
      size: state.prefs.bubbleSize,
      frame: state.prefs.effects.frame || "circle",
      cameraBg: state.prefs.effects.cameraBackground || "none",
    });
  } else {
    invoke("bubble-close");
  }
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

const PRIVACY_PANES = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  camera: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
};

const PERMISSION_COPY = {
  screen: {
    title: "Screen Recording permission needed",
    body: "macOS blocks screen capture until you allow it. Open System Settings → Privacy & Security → Screen Recording, enable Ryloom, then quit and reopen the app.",
  },
  microphone: {
    title: "Microphone permission needed",
    body: "Ryloom can't hear you yet. Open System Settings → Privacy & Security → Microphone and enable Ryloom, or turn the mic off to record silently.",
  },
  camera: {
    title: "Camera permission needed",
    body: "Ryloom can't show your camera bubble yet. Open System Settings → Privacy & Security → Camera and enable Ryloom, or record without the camera.",
  },
};

function showPermissionCard(kind) {
  state.permissionKind = kind;
  $("permission-title").textContent = PERMISSION_COPY[kind].title;
  $("permission-body").textContent = PERMISSION_COPY[kind].body;
  setView("permission");
}

// ---------------------------------------------------------------------------
// Recording flow
// ---------------------------------------------------------------------------

async function startRecordingFlow() {
  if (state.starting || state.view === "recording" || state.view === "countdown") return;
  if (!state.session) {
    toast("Sign in first", "error");
    return;
  }
  if (!state.workspaceId) {
    // Workspace list failed (or none yet) — re-attempt the home load.
    await enterHome();
    if (!state.workspaceId) return;
  }
  if (!state.source) {
    await refreshSources();
    if (!state.source) {
      showPermissionCard("screen");
      return;
    }
  }

  state.starting = true;
  const recordBtn = $("btn-record");
  recordBtn.disabled = true;
  setBanner("home-error", null);

  try {
    // Permission preflight (macOS).
    const status = await invoke("media-status");
    if (status.screen === "denied" || status.screen === "restricted") {
      showPermissionCard("screen");
      return;
    }
    if (state.prefs.micOn) {
      const granted = await invoke("media-request", "microphone");
      if (!granted) {
        showPermissionCard("microphone");
        return;
      }
    }

    const mimeType = Recorder.pickMimeType();

    // Create the session NOW so the share token exists before we even start —
    // the link can be on the clipboard the instant the user hits stop.
    let created;
    try {
      created = await getTrpc().recording.createSession.mutate({
        workspaceId: state.workspaceId,
        mode: state.prefs.camOn ? "screen_camera" : "screen",
        mimeType,
      });
    } catch (err) {
      setBanner("home-error", errorMessage(err, "Couldn't start a recording session."));
      return;
    }
    state.active = { ...created, mimeType };
    state.blob = null;
    state.uploadDone = false;

    // Hide the hub BEFORE the countdown/capture starts so the panel never
    // appears in the recording — the floating control bar (content-protected,
    // never captured) takes over from here.
    await invoke("main-hide");

    // Countdown — a content-protected overlay across the whole recording
    // display, like Loom's. Never appears in the captured video.
    if (state.prefs.countdownOn) {
      const completed = await invoke("countdown-run", {
        displayId: state.source.displayId || null,
      });
      if (!completed) {
        await safeCancelSession();
        setView("home");
        await invoke("main-show");
        return;
      }
    }

    const started = await beginCapture();
    if (!started) return;
  } finally {
    state.starting = false;
    recordBtn.disabled = false;
  }
}

/** Starts the Recorder + control bar. Assumes state.active is set. */
async function beginCapture() {
  state.recorder = new Recorder();
  try {
    await state.recorder.start({
      sourceId: state.source.id,
      micEnabled: Boolean(state.prefs.micOn),
      micDeviceId: state.prefs.micDeviceId || $("mic-select").value || null,
      effects: {
        background: state.prefs.effects.background,
        padding: state.prefs.effects.padding,
        corners: state.prefs.effects.corners,
      },
      onScreenEnded: () => stopRecordingFlow(),
      onError: (err) => {
        toast(`Recording error: ${errorMessage(err, "unknown")}`, "error");
      },
    });
  } catch (err) {
    state.recorder = null;
    await safeCancelSession();
    await invoke("main-show");
    const name = err && err.name;
    if (name === "NotAllowedError" || name === "NotReadableError") {
      showPermissionCard("screen");
    } else {
      setView("home");
      setBanner("home-error", `Couldn't start capture: ${errorMessage(err, "unknown error")}`);
    }
    return false;
  }

  await invoke("set-recording", true);
  $("rec-source-label").textContent = state.source.isScreen
    ? `Recording ${screenLabel(state.source).toLowerCase()}`
    : `Recording “${state.source.name}”`;
  $("btn-pause").textContent = "Pause";
  $("rec-dot").classList.remove("paused");
  $("rec-state-label").textContent = "Recording";
  $("rec-timer").textContent = "00:00";
  setView("recording"); // shown only if the user re-opens the hidden hub

  await invoke("controls-open", { displayId: state.source.displayId || null });
  startStatusTimer();
  return true;
}

/** Drives both the (hidden) hub's recording view and the floating bar. */
function startStatusTimer() {
  clearInterval(state.recTimer);
  state.recTimer = setInterval(() => {
    if (!state.recorder) return;
    $("rec-timer").textContent = formatTimer(state.recorder.elapsedMs);
    pushRecordingStatus();
  }, 200);
}

function pushRecordingStatus() {
  if (!state.recorder) return;
  invoke("recording-status", {
    elapsedMs: state.recorder.elapsedMs,
    state: state.recorder.state,
  });
}

function togglePause() {
  if (!state.recorder) return;
  if (state.recorder.state === "recording") {
    state.recorder.pause();
    $("btn-pause").textContent = "Resume";
    $("rec-dot").classList.add("paused");
    $("rec-state-label").textContent = "Paused";
  } else if (state.recorder.state === "paused") {
    state.recorder.resume();
    $("btn-pause").textContent = "Pause";
    $("rec-dot").classList.remove("paused");
    $("rec-state-label").textContent = "Recording";
  }
  pushRecordingStatus();
}

async function stopRecordingFlow() {
  if (!state.recorder || state.stopping) return;
  state.stopping = true;
  clearInterval(state.recTimer);
  state.recTimer = null;

  try {
    state.durationMs = Math.max(1, Math.round(state.recorder.elapsedMs));
    state.dims = state.recorder.dimensions;
    const blob = await state.recorder.stop();
    state.recorder = null;
    state.blob = blob;

    await invoke("set-recording", false);
    await invoke("controls-close");
    await invoke("bubble-close");

    const shareUrl = `${state.appUrl}/share/${state.active.shareToken}`;

    // Link on the clipboard IMMEDIATELY — before the upload even starts.
    await invoke("clipboard-write", shareUrl);
    invoke("notify", {
      title: "Link copied",
      body: "Your Ryloom link is on the clipboard — upload in progress.",
    });

    $("upload-link").textContent = shareUrl;
    $("done-link").textContent = shareUrl;
    $("progress-fill").style.width = "0%";
    $("progress-pct").textContent = "0%";
    $("progress-bytes").textContent = `0 B / ${formatBytes(blob.size)}`;
    setBanner("upload-error", null);
    $("upload-error-actions").hidden = true;
    $("upload-title").textContent = "Uploading…";
    setView("uploading");
    await invoke("main-show");

    startUpload();
  } finally {
    state.stopping = false;
  }
}

/**
 * Discards the current recording. From the floating bar (`fromControls`) the
 * bar itself already arm-confirmed the trash button, so no extra dialog.
 */
async function cancelRecordingFlow(fromControls = false) {
  if (!state.recorder) return;
  if (!fromControls) {
    const sure = window.confirm("Discard this recording? Nothing will be uploaded.");
    if (!sure) return;
  }

  clearInterval(state.recTimer);
  state.recTimer = null;
  state.recorder.cancel();
  state.recorder = null;
  await invoke("set-recording", false);
  await invoke("controls-close");
  await safeCancelSession();
  setView("home");
  await invoke("main-show");
  syncBubble();
  toast("Recording discarded");
}

/**
 * Restart from the floating bar: throw away what's recorded so far, run the
 * countdown again and record into the same session/share link.
 */
async function restartRecordingFlow() {
  if (!state.recorder || state.restarting || state.stopping) return;
  state.restarting = true;
  try {
    clearInterval(state.recTimer);
    state.recTimer = null;
    state.recorder.cancel();
    state.recorder = null;
    await invoke("controls-close");

    if (state.prefs.countdownOn) {
      const completed = await invoke("countdown-run", {
        displayId: state.source.displayId || null,
      });
      if (!completed) {
        // Canceling the restart countdown discards the take entirely.
        await invoke("set-recording", false);
        await safeCancelSession();
        setView("home");
        await invoke("main-show");
        syncBubble();
        toast("Recording discarded");
        return;
      }
    }

    await beginCapture();
  } finally {
    state.restarting = false;
  }
}

async function safeCancelSession() {
  const active = state.active;
  if (!active) return;
  try {
    await getTrpc().recording.cancelSession.mutate({ sessionId: active.sessionId });
  } catch {
    /* best effort */
  }
  state.active = null;
}

// ---------------------------------------------------------------------------
// Upload (direct-to-R2 multipart via presigned URLs from recording.startUpload)
// ---------------------------------------------------------------------------

function putPartXhr(handle, url, body, onPartProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    handle.xhrs.add(xhr);
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onPartProgress(event.loaded);
    };
    xhr.onload = () => {
      handle.xhrs.delete(xhr);
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");
        if (!etag) {
          reject(new Error("R2 did not expose the ETag header — check the bucket's CORS ExposeHeaders"));
          return;
        }
        onPartProgress(body.size);
        resolve(etag);
      } else {
        reject(new Error(`part upload failed with HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      handle.xhrs.delete(xhr);
      reject(new Error("network error"));
    };
    xhr.onabort = () => {
      handle.xhrs.delete(xhr);
      reject(new Error("upload aborted"));
    };
    xhr.send(body);
  });
}

async function runMultipartUpload(handle, blob, active) {
  // Fresh presigned URLs on every attempt — retry never reuses stale ones.
  const target = await getTrpc().recording.startUpload.mutate({
    sessionId: active.sessionId,
    sizeBytes: blob.size,
  });
  const partCount = target.urls.length;
  const progress = new Array(partCount).fill(0);

  const report = () => {
    const sent = progress.reduce((a, b) => a + b, 0);
    const pct = blob.size > 0 ? Math.min(100, Math.round((sent / blob.size) * 100)) : 0;
    $("progress-fill").style.width = `${pct}%`;
    $("progress-pct").textContent = `${pct}%`;
    $("progress-bytes").textContent = `${formatBytes(sent)} / ${formatBytes(blob.size)}`;
  };

  const uploadPart = async (index) => {
    const start = index * target.partSize;
    const body = blob.slice(start, Math.min(start + target.partSize, blob.size));
    let lastError = new Error("upload failed");
    for (let attempt = 0; attempt <= UPLOAD_RETRY_DELAYS_MS.length; attempt++) {
      if (handle.aborted || handle.failed) throw new Error("upload aborted");
      try {
        const etag = await putPartXhr(handle, target.urls[index], body, (loaded) => {
          progress[index] = Math.min(loaded, body.size);
          report();
        });
        return { partNumber: index + 1, etag };
      } catch (err) {
        lastError = err;
        // No point retrying a deterministic CORS misconfiguration.
        if (handle.aborted || handle.failed || String(err && err.message).includes("ETag header")) {
          throw err;
        }
        progress[index] = 0;
        report();
        const delay = UPLOAD_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  };

  const parts = new Array(partCount);
  let nextIndex = 0;
  const workers = [];
  for (let w = 0; w < Math.min(UPLOAD_CONCURRENCY, partCount); w++) {
    workers.push(
      (async () => {
        for (;;) {
          const index = nextIndex++;
          if (index >= partCount) return;
          parts[index] = await uploadPart(index);
        }
      })(),
    );
  }
  try {
    await Promise.all(workers);
  } catch (err) {
    // Stop the sibling workers' in-flight PUTs, then abort server-side so
    // incomplete parts don't linger (retry starts fresh). `failed`, not
    // `aborted` — the caller's catch must still show the error banner.
    handle.failed = true;
    for (const xhr of handle.xhrs) xhr.abort();
    handle.xhrs.clear();
    getTrpc()
      .recording.abortUpload.mutate({ sessionId: active.sessionId, uploadId: target.uploadId })
      .catch(() => undefined);
    throw err;
  }

  try {
    await getTrpc().recording.completeUpload.mutate({
      sessionId: active.sessionId,
      uploadId: target.uploadId,
      parts,
    });
  } catch (err) {
    // Retry re-uploads from scratch — abort this fully-uploaded MPU so its
    // parts don't sit in R2 until lifecycle cleanup.
    getTrpc()
      .recording.abortUpload.mutate({ sessionId: active.sessionId, uploadId: target.uploadId })
      .catch(() => undefined);
    throw err;
  }
}

function startUpload() {
  const { blob, active } = state;
  if (!blob || !active) return;

  setBanner("upload-error", null);
  $("upload-error-actions").hidden = true;
  $("upload-title").textContent = "Uploading…";

  const handle = { aborted: false, failed: false, xhrs: new Set() };
  state.upload = handle;

  runMultipartUpload(handle, blob, active)
    .then(() => {
      state.upload = null;
      finalizeUpload();
    })
    .catch((err) => {
      state.upload = null;
      if (handle.aborted) return;
      setBanner(
        "upload-error",
        `Upload failed: ${errorMessage(err, "network error")}. Your recording is safe in memory — retry, or save it locally.`,
      );
      $("upload-error-actions").hidden = false;
      $("upload-title").textContent = "Upload interrupted";
    });
}

async function finalizeUpload() {
  const active = state.active;
  if (!active) return;
  $("upload-title").textContent = "Finishing up…";
  $("progress-fill").style.width = "100%";
  $("progress-pct").textContent = "100%";

  try {
    await getTrpc().recording.completeSession.mutate({
      sessionId: active.sessionId,
      durationMs: state.durationMs,
      sizeBytes: state.blob ? state.blob.size : undefined,
      width: state.dims ? state.dims.width : undefined,
      height: state.dims ? state.dims.height : undefined,
    });
  } catch (err) {
    state.uploadDone = true; // bytes are up; only the finalize call failed
    setBanner(
      "upload-error",
      `The video uploaded but couldn't be finalized: ${errorMessage(err, "network error")}. Retry to finish.`,
    );
    $("upload-error-actions").hidden = false;
    $("upload-title").textContent = "Almost there";
    return;
  }

  state.uploadDone = true;
  invoke("notify", {
    title: "Upload complete",
    body: "Your video is processing — the share link already works.",
  });
  setView("done");
}

function retryUpload() {
  if (!state.active || !state.blob) return;
  if (state.uploadDone) {
    // Bytes already uploaded — just retry the finalize call.
    finalizeUpload();
    return;
  }
  // Fresh multipart attempt with newly signed URLs (handles expiry too).
  startUpload();
}

function saveLocalCopy() {
  if (!state.blob) {
    toast("No recording in memory", "error");
    return;
  }
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(state.blob);
  a.download = `ryloom-recording-${stamp}.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

function resetForNewRecording() {
  state.blob = null;
  state.active = null;
  state.upload = null;
  state.uploadDone = false;
  state.durationMs = 0;
  state.dims = null;
  setView("home");
  refreshSources();
  syncBubble();
}

// ---------------------------------------------------------------------------
// Effects panel (Backgrounds / Frames / Canvas)
// ---------------------------------------------------------------------------

function openEffects() {
  renderCameraBgGrid();
  renderBgGrid();
  renderFrameGrid();
  renderSegRow("padding-row", "padding");
  renderSegRow("corners-row", "corners");
  $("effects-overlay").hidden = false;
}

function updateEffectsDot() {
  $("effects-dot").hidden =
    state.prefs.effects.background === "none" &&
    (state.prefs.effects.cameraBackground || "none") === "none";
}

/** Effects → Backgrounds: your camera's background (Clear/Blur/replace). */
function renderCameraBgGrid() {
  const grid = $("cam-bg-grid");
  grid.innerHTML = "";
  for (const preset of CAMERA_BG_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `swatch${preset.id === "none" ? " swatch-none" : ""}${
      (state.prefs.effects.cameraBackground || "none") === preset.id ? " selected" : ""
    }`;
    if (preset.css) btn.style.background = preset.css;
    const label = document.createElement("span");
    label.className = "swatch-label";
    label.textContent = preset.label;
    btn.appendChild(label);
    btn.addEventListener("click", () => {
      state.prefs.effects.cameraBackground = preset.id;
      savePrefs();
      renderCameraBgGrid();
      updateEffectsDot();
      syncBubble(); // live-apply to the open camera bubble
    });
    grid.appendChild(btn);
  }
}

function renderBgGrid() {
  const grid = $("bg-grid");
  grid.innerHTML = "";
  for (const preset of BG_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `swatch${preset.id === "none" ? " swatch-none" : ""}${
      state.prefs.effects.background === preset.id ? " selected" : ""
    }`;
    if (preset.css) btn.style.background = preset.css;
    const label = document.createElement("span");
    label.className = "swatch-label";
    label.textContent = preset.label;
    btn.appendChild(label);
    btn.addEventListener("click", () => {
      state.prefs.effects.background = preset.id;
      savePrefs();
      renderBgGrid();
      updateEffectsDot();
    });
    grid.appendChild(btn);
  }
}

function renderFrameGrid() {
  const grid = $("frame-grid");
  grid.innerHTML = "";
  for (const preset of FRAME_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `opt-btn${state.prefs.effects.frame === preset.id ? " selected" : ""}`;
    const preview = document.createElement("span");
    preview.className = `opt-preview${preset.id !== "circle" ? ` frame-${preset.id}` : ""}`;
    btn.appendChild(preview);
    const label = document.createElement("span");
    label.textContent = preset.label;
    btn.appendChild(label);
    btn.addEventListener("click", () => {
      state.prefs.effects.frame = preset.id;
      savePrefs();
      renderFrameGrid();
      syncBubble(); // live-apply to the open camera bubble
    });
    grid.appendChild(btn);
  }
}

function renderSegRow(rowId, key) {
  const row = $(rowId);
  for (const btn of row.querySelectorAll(".seg-btn")) {
    btn.classList.toggle("selected", btn.dataset.value === state.prefs.effects[key]);
    btn.onclick = () => {
      state.prefs.effects[key] = btn.dataset.value;
      savePrefs();
      renderSegRow(rowId, key);
    };
  }
}

// ---------------------------------------------------------------------------
// Settings (Advanced — self-host/dev only)
// ---------------------------------------------------------------------------

function openSettings() {
  $("setting-app-url").value = state.appUrl;
  $("settings-overlay").hidden = false;
  $("setting-app-url").focus();
}

async function saveSettings() {
  let url = $("setting-app-url").value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) {
    setConfigStatus("Enter a valid http(s) URL", "bad");
    return;
  }
  const button = $("btn-save-settings");
  button.disabled = true;
  button.textContent = "Connecting…";
  try {
    const config = await fetchDesktopConfig(url);
    await storeSet("appUrl", url);
    await storeSet("desktopConfig", config);
    setConfigStatus(`Connected — Supabase: ${hostOf(config.supabaseUrl)}`, "ok");
    $("settings-overlay").hidden = true;
    toast("Reconnecting…");
    // Full re-init: new Supabase client, fresh session check.
    state.session = null;
    await init();
  } catch (err) {
    setConfigStatus(
      `Couldn't reach ${url}/api/desktop-config — ${errorMessage(err, "network error")}`,
      "bad",
    );
  } finally {
    button.disabled = false;
    button.textContent = "Save & reconnect";
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function wireEvents() {
  // Auth
  $("btn-browser-signin").addEventListener("click", openBrowserSignIn);
  $("btn-waiting-retry").addEventListener("click", openBrowserSignIn);
  $("btn-waiting-cancel").addEventListener("click", () => showAuthSection("main"));
  $("btn-email-mode").addEventListener("click", () => {
    setBanner("auth-error", null);
    showAuthSection("email");
    $("email-input").focus();
  });
  $("btn-email-back").addEventListener("click", () => showAuthSection("main"));
  $("auth-email-form").addEventListener("submit", handleEmailSignIn);
  // Advanced (App URL) settings are tucked away: this link, ⌘, , or the tray.
  $("auth-advanced-link").addEventListener("click", openSettings);

  // Home
  $("btn-signout").addEventListener("click", signOut);
  $("btn-open-library").addEventListener("click", () =>
    openExternal(`${state.appUrl}/app`),
  );
  $("workspace-select").addEventListener("change", async (event) => {
    state.workspaceId = event.target.value;
    await storeSet("lastWorkspaceId", state.workspaceId);
  });
  $("source-btn").addEventListener("click", openSourcePicker);
  $("btn-record").addEventListener("click", startRecordingFlow);
  $("btn-effects").addEventListener("click", openEffects);
  $("btn-notes").addEventListener("click", () => invoke("notes-toggle"));

  $("mic-toggle").addEventListener("change", async (event) => {
    state.prefs.micOn = event.target.checked;
    $("mic-select").disabled = !state.prefs.micOn;
    if (state.prefs.micOn) {
      const granted = await invoke("media-request", "microphone");
      if (!granted) {
        state.prefs.micOn = false;
        applyPrefsToUi();
        showPermissionCard("microphone");
      } else {
        await refreshDevices(); // labels appear once permission is granted
      }
    }
    savePrefs();
  });
  $("mic-select").addEventListener("change", (event) => {
    state.prefs.micDeviceId = event.target.value || null;
    savePrefs();
  });

  $("cam-toggle").addEventListener("change", async (event) => {
    state.prefs.camOn = event.target.checked;
    $("cam-select").disabled = !state.prefs.camOn;
    if (state.prefs.camOn) {
      const granted = await invoke("media-request", "camera");
      if (!granted) {
        state.prefs.camOn = false;
        applyPrefsToUi();
        await savePrefs();
        showPermissionCard("camera");
        return;
      }
      await refreshDevices();
      if (!state.prefs.camDeviceId) {
        state.prefs.camDeviceId = $("cam-select").value || null;
      }
    }
    savePrefs();
    syncBubble();
  });
  $("cam-select").addEventListener("change", (event) => {
    state.prefs.camDeviceId = event.target.value || null;
    savePrefs();
    if (state.prefs.camOn) syncBubble(); // reopen bubble with the new camera
  });

  $("countdown-toggle").addEventListener("change", (event) => {
    state.prefs.countdownOn = event.target.checked;
    savePrefs();
  });

  // Permission card
  $("btn-open-privacy").addEventListener("click", () => {
    openExternal(PRIVACY_PANES[state.permissionKind] || PRIVACY_PANES.screen);
  });
  $("btn-permission-retry").addEventListener("click", async () => {
    setView("home");
    await refreshSources();
    await refreshDevices();
    syncBubble();
  });
  $("btn-permission-back").addEventListener("click", () => {
    setView(state.session ? "home" : "auth");
    if (state.session) syncBubble();
  });

  // Recording (the hidden hub's fallback view — primary controls live on the
  // floating bar)
  $("btn-pause").addEventListener("click", togglePause);
  $("btn-stop").addEventListener("click", stopRecordingFlow);
  $("btn-cancel-rec").addEventListener("click", () => cancelRecordingFlow(false));

  // Uploading
  $("btn-upload-retry").addEventListener("click", retryUpload);
  $("btn-upload-save").addEventListener("click", saveLocalCopy);
  $("btn-upload-copy").addEventListener("click", async () => {
    await invoke("clipboard-write", $("upload-link").textContent);
    toast("Link copied");
  });

  // Done
  $("btn-open-video").addEventListener("click", () => {
    if (state.active) openExternal(`${state.appUrl}/share/${state.active.shareToken}`);
  });
  $("btn-copy-again").addEventListener("click", async () => {
    await invoke("clipboard-write", $("done-link").textContent);
    toast("Link copied");
  });
  $("btn-new-recording").addEventListener("click", resetForNewRecording);
  $("btn-done-save").addEventListener("click", saveLocalCopy);

  // Settings overlay
  $("btn-settings-close").addEventListener("click", () => {
    $("settings-overlay").hidden = true;
  });
  $("btn-save-settings").addEventListener("click", saveSettings);
  $("settings-overlay").addEventListener("click", (event) => {
    if (event.target === $("settings-overlay")) $("settings-overlay").hidden = true;
  });

  // Source picker overlay
  $("btn-sources-close").addEventListener("click", () => {
    $("sources-overlay").hidden = true;
  });
  $("btn-sources-refresh").addEventListener("click", async () => {
    await refreshSources();
    renderSourceGrids();
  });
  $("sources-overlay").addEventListener("click", (event) => {
    if (event.target === $("sources-overlay")) $("sources-overlay").hidden = true;
  });

  // Effects overlay
  $("btn-effects-close").addEventListener("click", () => {
    $("effects-overlay").hidden = true;
  });
  $("effects-overlay").addEventListener("click", (event) => {
    if (event.target === $("effects-overlay")) $("effects-overlay").hidden = true;
  });
  const effectsTabs = $("effects-tabs").querySelectorAll(".effects-tab");
  for (const tab of effectsTabs) {
    tab.addEventListener("click", () => {
      for (const t of effectsTabs) t.classList.toggle("active", t === tab);
      for (const pane of ["backgrounds", "frames", "canvas"]) {
        $(`effects-pane-${pane}`).hidden = pane !== tab.dataset.tab;
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      $("settings-overlay").hidden = true;
      $("sources-overlay").hidden = true;
      $("effects-overlay").hidden = true;
    }
    // ⌘, — the standard macOS shortcut — opens the Advanced settings.
    if (event.key === "," && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      openSettings();
    }
  });

  // IPC from main
  ipcRenderer.on("auth-tokens", (_event, tokens) => {
    handleAuthTokens(tokens).catch((err) => {
      toast(`Sign-in failed: ${errorMessage(err, "unknown error")}`, "error");
    });
  });

  // The user closed the bubble with its ✕ — keep the camera toggle in sync.
  ipcRenderer.on("bubble-closed", () => {
    if (state.prefs.camOn) {
      state.prefs.camOn = false;
      applyPrefsToUi();
      savePrefs();
    }
  });

  ipcRenderer.on("tray-record", () => {
    if (state.view === "home") {
      startRecordingFlow();
    } else if (state.view === "recording") {
      toast("Already recording");
    }
  });

  // Floating control bar buttons (forwarded by the main process).
  ipcRenderer.on("controls-action", (_event, action) => {
    switch (action) {
      case "stop":
        stopRecordingFlow();
        break;
      case "pause":
      case "resume":
        togglePause();
        break;
      case "restart":
        restartRecordingFlow();
        break;
      case "cancel":
        cancelRecordingFlow(true);
        break;
      case "notes":
        invoke("notes-toggle");
        break;
      default:
        break;
    }
  });

  // Tray → "Connection settings…"
  ipcRenderer.on("open-settings", () => openSettings());

  // Refresh device lists when hardware changes.
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      if (state.view === "home") refreshDevices();
    });
  }
}

// ---------------------------------------------------------------------------

wireEvents();
init().catch((err) => {
  setView("auth");
  showAuthSection("main");
  setBanner("auth-error", `Something went wrong on startup: ${errorMessage(err, "unknown")}`);
});
