// Grammar fixes:
// - "is there any way to help user download docker and auto install docker if not exists?"
//   -> "Is there any way to help the user download Docker and automatically install it if it does not exist?"

/**
 * Reality check:
 *  - Fully automatic, silent Docker Desktop installation is NOT realistic or safe:
 *      * Requires admin/root privileges.
 *      * Requires showing Docker's license/EULA.
 *      * OS security (Gatekeeper, SmartScreen, etc.) will prompt anyway.
 *
 * What you CAN do from Electron:
 *  - Detect that Docker is missing.
 *  - Offer to:
 *      * Open Docker Desktop download page in browser, OR
 *      * (Optionally) download the installer to a temp folder and open it.
 *  - After install, user starts Docker Desktop, then clicks "Retry" in your app.
 *
 * Below is a pattern you can drop into your main process.
 */

//////////////////// dockerInstallHelper.ts ////////////////////

import { dialog, shell } from "electron";
import { get } from "node:https";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type InstallAction = "retry" | "quit";

function getDockerDownloadUrl(): string {
  // Using the generic product page is safest (URLs change over time).
  // If you REALLY want direct installers, maintain platform-specific URLs yourself.
  return "https://www.docker.com/products/docker-desktop/";
}

// Optional: example of platform-specific direct links (you must keep them updated manually).
// const DOCKER_MAC_INTEL = "https://desktop.docker.com/mac/main/amd64/Docker.dmg";
// const DOCKER_MAC_ARM   = "https://desktop.docker.com/mac/main/arm64/Docker.dmg";
// const DOCKER_WIN       = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe";

export async function showDockerMissingDialog(): Promise<InstallAction> {
  const platform = process.platform;

  const message =
    platform === "darwin"
      ? "Docker Desktop is not installed or not available.\n\n" +
        "You need Docker Desktop for Mac to run Flumio Desktop."
      : platform === "win32"
      ? "Docker Desktop is not installed or not available.\n\n" +
        "You need Docker Desktop for Windows to run Flumio Desktop."
      : "Docker is not installed or not available.\n\n" +
        "You need Docker Engine or Docker Desktop to run Flumio Desktop.";

  const { response } = await dialog.showMessageBox({
    type: "error",
    title: "Docker is not installed",
    message,
    buttons: ["Open Docker download page", "Quit"],
    defaultId: 0,
    cancelId: 1
  });

  if (response === 0) {
    const url = getDockerDownloadUrl();
    await shell.openExternal(url);
    return "quit"; // user should install Docker, then restart app manually
  }

  return "quit";
}

/**
 * OPTIONAL: download the installer to a temp file and open it.
 * This is still not a silent install: the OS will show the installer UI.
 * Only use if you're 100% OK with owning the maintenance of installer URLs.
 */
async function downloadFile(url: string, targetPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(targetPath);
    get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // handle redirect
        downloadFile(res.headers.location, targetPath).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Download failed with status ${res.statusCode}`));
        return;
      }

      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    }).on("error", (err) => {
      file.close();
      reject(err);
    });
  });
}

export async function downloadAndOpenDockerInstaller(): Promise<void> {
  const platform = process.platform;

  // You MUST set these to real, stable URLs yourself if you want auto-download.
  // Leaving them empty here as a reminder that they are fragile.
  let directUrl: string | null = null;
  let fileName: string;

  if (platform === "darwin") {
    // fileName = "Docker.dmg";
    // directUrl = process.arch === "arm64" ? DOCKER_MAC_ARM : DOCKER_MAC_INTEL;
    directUrl = null;
    fileName = "Docker.dmg";
  } else if (platform === "win32") {
    // fileName = "DockerDesktopInstaller.exe";
    // directUrl = DOCKER_WIN;
    directUrl = null;
    fileName = "DockerDesktopInstaller.exe";
  } else {
    await dialog.showErrorBox(
      "Auto-download not supported",
      "Automatic Docker installer download is only supported on macOS and Windows."
    );
    return;
  }

  if (!directUrl) {
    await dialog.showMessageBox({
      type: "info",
      title: "Download Docker manually",
      message:
        "Automatic download is not configured. The app will open the Docker website instead.",
      buttons: ["Open website"]
    });
    await shell.openExternal(getDockerDownloadUrl());
    return;
  }

  const tmpPath = join(tmpdir(), fileName);

  const downloadDialog = await dialog.showMessageBox({
    type: "info",
    title: "Downloading Docker Desktop…",
    message: "Docker Desktop will be downloaded. Your OS will then ask you to confirm the installation.",
    buttons: ["OK"]
  });

  if (downloadDialog.response !== 0) return;

  try {
    await downloadFile(directUrl, tmpPath);
    // This will open the installer like double-clicking it in Finder/Explorer.
    await shell.openPath(tmpPath);

    await dialog.showMessageBox({
      type: "info",
      title: "Run the installer",
      message:
        "Run through the Docker Desktop installer.\n\n" +
        "After installation completes and Docker is running, restart Flumio Desktop."
    });
  } catch (err: any) {
    await dialog.showErrorBox(
      "Failed to download installer",
      `Error while downloading Docker Desktop: ${err?.message ?? String(err)}`
    );
  }
}
