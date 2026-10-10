// ============================================================
// DelayerZ - Release packager
//
// npm run package  ->  dist/DelayerZ-v<version>.zip
//                      (DelayerZ/ + install.bat + operator.ps1)
// npm run clean    ->  removes dist/
//
// End users unzip it and double click install.bat.
// ============================================================

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const EXTENSION = path.join(ROOT, "extension");
const INSTALLER = path.join(ROOT, "installer");
const { version } = require(path.join(ROOT, "package.json"));

function log(msg) {
    console.log("  " + msg);
}

function fail(msg) {
    console.error("\n  [X] " + msg + "\n");
    process.exit(1);
}

function zipFolder(srcPath, zipPath) {
    const ps = "Compress-Archive -Path '" + srcPath.replace(/'/g, "''") +
        "' -DestinationPath '" + zipPath.replace(/'/g, "''") + "' -Force";
    const res = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
    if (res.error || res.status !== 0) fail("Compress-Archive failed for " + srcPath);
}

function checkVersions() {
    const manifest = fs.readFileSync(path.join(EXTENSION, "CSXS", "manifest.xml"), "utf8");
    const m = manifest.match(/ExtensionBundleVersion="([^"]+)"/);
    if (!m || m[1] !== version) {
        fail("Version mismatch: package.json is " + version +
            " but CSXS/manifest.xml is " + (m ? m[1] : "missing") + ". Update both.");
    }
}

// ------------------------------------------------------------

if (process.platform !== "win32") fail("Packaging needs Windows (Compress-Archive).");

if (process.argv.includes("--clean")) {
    fs.rmSync(DIST, { recursive: true, force: true });
    log("dist/ removed.");
    process.exit(0);
}

checkVersions();

console.log("\n  DelayerZ v" + version + " - packaging\n");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "delayerz-pkg-"));

try {
    // 1. Stage release layout
    fs.cpSync(EXTENSION, path.join(work, "DelayerZ"), { recursive: true });
    for (const f of ["install.bat", "operator.ps1"]) {
        fs.copyFileSync(path.join(INSTALLER, f), path.join(work, f));
    }
    log("[OK] Staged release files");

    // 2. Zip into dist/
    fs.rmSync(DIST, { recursive: true, force: true });
    fs.mkdirSync(DIST);
    const zipName = "DelayerZ-v" + version + ".zip";
    zipFolder(path.join(work, "*"), path.join(DIST, zipName));

    const kb = Math.round(fs.statSync(path.join(DIST, zipName)).size / 1024);
    log("[OK] Built dist/" + zipName + "  (" + kb + " KB)\n");
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}
