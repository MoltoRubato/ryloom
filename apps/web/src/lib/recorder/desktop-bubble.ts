/**
 * Desktop-app bubble handoff — the Loom trick.
 *
 * The web platform cannot make a transparent, circle-shaped, always-on-top
 * window: Document PiP is the only always-on-top primitive and it is always
 * an opaque rectangular window with browser chrome. The desktop app CAN
 * (frameless transparent BrowserWindow), so when the presenter records a
 * whole monitor and has the app installed, the recorder fires a
 * `ryloom://bubble` deep link and the app floats the true circle over
 * everything. The OS compositor burns it into the capture — pixel-identical
 * to a native desktop recording.
 *
 * Install detection is necessarily heuristic (browsers don't expose protocol
 * handlers): launching an external protocol steals the page's focus when
 * something picks it up, and silently does nothing when nothing is
 * registered. Two durable signals mark the app as installed: a successful
 * handoff here, and the /desktop/auth token handoff (which the app itself
 * initiates, so reaching that page proves the install). Failed launches only
 * mute retries for the session — installing the app later recovers.
 */

import { type BubbleFrame, type CameraBackgroundId } from "./effects";
import { type BubbleSize } from "./engine";

const DETECTED_KEY = "ryloom:desktop-app";
const SESSION_MISS_KEY = "ryloom:desktop-app-miss";

/** How long the app gets to steal focus before we declare "not installed". */
const LAUNCH_TIMEOUT_MS = 1600;

export function markDesktopAppDetected(): void {
  try {
    localStorage.setItem(DETECTED_KEY, "yes");
    sessionStorage.removeItem(SESSION_MISS_KEY);
  } catch {
    // Storage can be unavailable (private mode) — detection just won't stick.
  }
}

export function isDesktopAppDetected(): boolean {
  try {
    return localStorage.getItem(DETECTED_KEY) === "yes";
  } catch {
    return false;
  }
}

function markLaunchMissed(): void {
  try {
    sessionStorage.setItem(SESSION_MISS_KEY, "1");
  } catch {
    // ignore — worst case we re-attempt and wait out the timeout again
  }
}

function launchMissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_MISS_KEY) === "1";
  } catch {
    return false;
  }
}

export type DesktopBubbleParams = {
  /** OS label of the active camera — deviceIds are origin-scoped and useless across apps. */
  cameraLabel: string | null;
  size: BubbleSize;
  frame: BubbleFrame;
  cameraBackground: CameraBackgroundId;
};

/** External-protocol navigation never unloads the page; with no handler registered the browser ignores it. */
function fireDeepLink(url: string): void {
  window.location.href = url;
}

/**
 * Asks the desktop app to float its always-on-top camera bubble. Resolves
 * true when something picked the deep link up (see caveat on focusLostAfter).
 */
export async function openDesktopBubble(params: DesktopBubbleParams): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!isDesktopAppDetected() && launchMissedThisSession()) return false;

  const query = new URLSearchParams();
  if (params.cameraLabel) query.set("label", params.cameraLabel);
  query.set("size", String(params.size));
  query.set("frame", params.frame);
  query.set("cameraBg", params.cameraBackground);

  const launched = await focusLostAfter(() =>
    fireDeepLink(`ryloom://bubble?${query.toString()}`),
  );
  if (launched) markDesktopAppDetected();
  else markLaunchMissed();
  return launched;
}

/** Best-effort dismissal of the floating bubble when the recording ends. */
export function closeDesktopBubble(): void {
  if (typeof window === "undefined") return;
  fireDeepLink("ryloom://bubble-close");
}

/**
 * Resolves true if the page lost focus shortly after the launch — either the
 * app grabbed focus or the browser showed its "Open Ryloom?" consent prompt.
 * A prompt the user then cancels is a false positive; callers surface an
 * undo action so that costs one click instead of a lost camera.
 */
function focusLostAfter(launch: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const initiallyFocused = document.hasFocus();
    let settled = false;
    let poll: number | undefined;
    let timer: number | undefined;
    const settle = (result: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("blur", onSignal);
      if (poll !== undefined) window.clearInterval(poll);
      if (timer !== undefined) window.clearTimeout(timer);
      resolve(result);
    };
    const onSignal = () => settle(true);
    window.addEventListener("blur", onSignal);
    // blur can be swallowed when focus jumps straight to another app —
    // hasFocus() is the reliable fallback, but only meaningful when the page
    // actually held focus to begin with.
    if (initiallyFocused) {
      poll = window.setInterval(() => {
        if (!document.hasFocus()) settle(true);
      }, 120);
    }
    timer = window.setTimeout(() => settle(false), LAUNCH_TIMEOUT_MS);
    launch();
  });
}
