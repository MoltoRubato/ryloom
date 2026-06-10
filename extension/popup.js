"use strict";

const DEFAULT_APP_URL = "http://localhost:3000";

/** Button id → recorder mode passed to the web app. */
const MODE_BY_BUTTON = {
  "record-tab": "screen",
  "record-desktop": "screen",
  "record-camera": "camera",
};

function normalizeAppUrl(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return DEFAULT_APP_URL;
  return trimmed.replace(/\/+$/, "");
}

function getAppUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL }, (items) => {
      resolve(normalizeAppUrl(items.appUrl));
    });
  });
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs.length > 0 ? tabs[0] : null);
    });
  });
}

/** Only regular web pages get linked — chrome://, file://, the Web Store, etc. are omitted. */
function hasLinkableUrl(tab) {
  return Boolean(tab && typeof tab.url === "string" && /^https?:\/\//i.test(tab.url));
}

function buildRecordUrl(appUrl, mode, tab) {
  const url = new URL(appUrl + "/record");
  url.searchParams.set("mode", mode);
  if (hasLinkableUrl(tab)) {
    url.searchParams.set("sourceUrl", tab.url);
    if (tab.title) {
      url.searchParams.set("title", tab.title);
    }
  }
  return url.toString();
}

async function launchRecorder(mode) {
  const [appUrl, tab] = await Promise.all([getAppUrl(), getActiveTab()]);
  chrome.tabs.create({ url: buildRecordUrl(appUrl, mode, tab) });
  window.close();
}

async function openLibrary() {
  const appUrl = await getAppUrl();
  chrome.tabs.create({ url: appUrl + "/app" });
  window.close();
}

function renderTabTitle() {
  const element = document.getElementById("tab-title");
  if (!element) return;
  getActiveTab().then((tab) => {
    if (hasLinkableUrl(tab)) {
      element.textContent = tab.title || tab.url;
      element.title = tab.url;
    } else {
      element.textContent = "This page won't be linked to the recording";
      element.removeAttribute("title");
    }
  });
}

function renderShortcutHint() {
  const hint = document.getElementById("shortcut-hint");
  const key = document.getElementById("shortcut-key");
  if (!hint || !key) return;
  chrome.commands.getAll((commands) => {
    const command = commands.find((c) => c.name === "start-recording");
    if (command && command.shortcut) {
      key.textContent = command.shortcut;
      hint.hidden = false;
    }
  });
}

function init() {
  for (const [buttonId, mode] of Object.entries(MODE_BY_BUTTON)) {
    const button = document.getElementById(buttonId);
    if (button) {
      button.addEventListener("click", () => {
        void launchRecorder(mode);
      });
    }
  }

  const library = document.getElementById("open-library");
  if (library) {
    library.addEventListener("click", () => {
      void openLibrary();
    });
  }

  const options = document.getElementById("open-options");
  if (options) {
    options.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
  }

  renderTabTitle();
  renderShortcutHint();
}

init();
