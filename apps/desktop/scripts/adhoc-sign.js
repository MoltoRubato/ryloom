/**
 * electron-builder afterPack hook: ad-hoc sign the macOS bundle.
 *
 * This machine has no Developer ID certificate, so electron-builder skips
 * signing entirely. The packed app then carries only the linker's signature
 * of the stock Electron binary, which no longer matches the modified bundle
 * ("code has no resources but signature indicates they must be present") —
 * and Gatekeeper reports downloaded copies as damaged, with no "Open Anyway"
 * escape hatch. A forced ad-hoc re-sign of the whole bundle restores a valid
 * (if unidentified) signature, which downgrades the verdict to the normal
 * unverified-developer flow: System Settings → Privacy & Security →
 * "Open Anyway".
 */
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

exports.default = function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
};
