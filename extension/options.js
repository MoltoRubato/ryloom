"use strict";

const DEFAULT_APP_URL = "http://localhost:3000";

const form = document.getElementById("settings-form");
const input = document.getElementById("app-url");
const status = document.getElementById("status");
const resetButton = document.getElementById("reset");

let statusTimer = null;

function normalizeAppUrl(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return DEFAULT_APP_URL;
  return trimmed.replace(/\/+$/, "");
}

/** Returns an error message, or null when the value is a usable http(s) URL. */
function validateAppUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return "Enter a valid URL, e.g. https://ryloom.example.com";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "The URL must start with http:// or https://";
  }
  if (!parsed.hostname) {
    return "The URL must include a hostname";
  }
  return null;
}

function showStatus(message, kind) {
  status.textContent = message;
  status.className = "status " + kind;
  if (statusTimer !== null) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  if (kind === "success") {
    statusTimer = setTimeout(() => {
      status.textContent = "";
      status.className = "status";
      statusTimer = null;
    }, 3000);
  }
}

function save(value) {
  chrome.storage.sync.set({ appUrl: value }, () => {
    if (chrome.runtime.lastError) {
      showStatus("Could not save: " + chrome.runtime.lastError.message, "error");
      return;
    }
    input.value = value;
    showStatus("Saved. Recordings will open at " + value + "/record.", "success");
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = normalizeAppUrl(input.value);
  const error = validateAppUrl(value);
  if (error) {
    showStatus(error, "error");
    input.focus();
    return;
  }
  save(value);
});

resetButton.addEventListener("click", () => {
  save(DEFAULT_APP_URL);
});

chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL }, (items) => {
  input.value = normalizeAppUrl(items.appUrl);
});
