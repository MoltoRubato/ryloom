"use strict";

const DEFAULT_APP_URL = "http://localhost:3000";

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
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "start-recording") return;
  void launchRecorder("screen");
});
