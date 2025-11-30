// src/main.ts
// Updated to distinguish:
//  - Docker not installed
//  - Docker installed but daemon not running
//  - Compose failure

import {app, BrowserWindow, dialog} from "electron";
import {startStack, waitForHttpReady} from "./dockerManager";
import {showDockerMissingDialog} from "./dockerInstallHelper";
import {join} from "node:path";

const APP_URL = "http://localhost:8080"; // nginx test, or your Flumio URL

let mainWindow: BrowserWindow | null = null;
app.setName("Flumio");

async function bootstrapApp(): Promise<void> {
    const iconPath = join(__dirname, "../assets/logo.png"); // 256x256 PNG

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: "Flumio",
        backgroundColor: "#020617",
        icon: iconPath,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    await mainWindow.loadURL(
        "data:text/html;charset=utf-8," +
        encodeURIComponent(`
        <!doctype html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>Starting backend…</title>
            <style>
              body {
                margin: 0;
                height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #020617;
                color: #e5e7eb;
                font-family: system-ui, sans-serif;
              }
              .box { text-align: center; }
              h1 { margin-bottom: 0.5rem; font-size: 1.6rem; }
              p  { margin: 0.2rem 0; opacity: 0.8; }
              code {
                padding: 0.1rem 0.3rem;
                border-radius: 4px;
                background: #ffffff;
              }
            </style>
          </head>
          <body>
            <div class="box">
              <h1>Starting Docker stack…</h1>
              <p>Running <code>docker compose up -d</code> for a test web container.</p>
            </div>
          </body>
        </html>
      `)
    );

    const status = await startStack();

    if (status === "docker_missing") {
        // Open Docker download page and quit.
        await showDockerMissingDialog();
        app.quit();
        return;
    }
    //
    // if (status === "docker_missing") {
    //     await dialog.showMessageBox({
    //         type: "error",
    //         title: "Docker is not installed",
    //         message: "Docker (Docker Desktop) is not installed or not on PATH.",
    //         detail:
    //             "Install Docker Desktop first, then start Flumio Desktop again.\n\n" +
    //             "On macOS: install Docker Desktop for Mac.\n" +
    //             "On Windows: install Docker Desktop for Windows.",
    //         buttons: ["Open Docker website", "Close"]
    //     }).then((res) => {
    //         if (res.response === 0) {
    //             const url = "https://www.docker.com/products/docker-desktop/";
    //             const {exec} =
    //                 require("node:child_process") as typeof import("node:child_process");
    //             const cmd =
    //                 process.platform === "win32"
    //                     ? `start "" "${url}"`
    //                     : process.platform === "darwin"
    //                         ? `open "${url}"`
    //                         : `xdg-open "${url}"`;
    //             exec(cmd);
    //         }
    //     });
    //
    //     app.quit();
    //     return;
    // }

    if (status === "docker_daemon_off") {
        const res = await dialog.showMessageBox({
            type: "warning",
            title: "Docker is not running",
            message: "Docker Desktop is installed but not running.",
            detail:
                "Start Docker Desktop, wait until it finishes starting, then click “Retry”.",
            buttons: ["Retry", "Quit"],
            defaultId: 0,
            cancelId: 1
        });

        if (res.response === 0) {
            // Retry once – if it still fails, you'll get the error dialogs again.
            await bootstrapApp();
        } else {
            app.quit();
        }
        return;
    }

    if (status === "compose_error") {
        await dialog.showErrorBox(
            "Failed to start Docker stack",
            "Docker Compose returned an error. Open the app from the terminal to see logs, or check Docker Desktop."
        );
        app.quit();
        return;
    }

    const ready = await waitForHttpReady(APP_URL);

    if (!ready) {
        await dialog.showErrorBox(
            "Backend not responding",
            "The containers started, but the web server did not respond in time."
        );
        app.quit();
        return;
    }

    await mainWindow.loadURL(APP_URL);

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

app.on("ready", () => {
    bootstrapApp().catch((err) => {
        console.error("Bootstrap error:", err);
        dialog.showErrorBox(
            "Unexpected error",
            "Something went wrong while starting the Docker stack."
        );
        app.quit();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        bootstrapApp().catch((err) => {
            console.error("Bootstrap error:", err);
            dialog.showErrorBox(
                "Unexpected error",
                "Something went wrong while starting the Docker stack."
            );
            app.quit();
        });
    }
});
