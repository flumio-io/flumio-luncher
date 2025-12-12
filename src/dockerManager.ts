// src/dockerManager.ts
// Better status handling: Docker not installed vs daemon not running vs compose error.

import {exec} from "node:child_process";
import {promisify} from "node:util";
import {join} from "node:path";
import {app} from "electron";

const asyncExec = promisify(exec);

export type DockerBootstrapStatus =
    | "docker_missing"
    | "docker_daemon_off"
    | "compose_started"
    | "compose_error";

type RawDockerStatus = "ok" | "missing" | "daemon_off";

async function getRawDockerStatus(): Promise<RawDockerStatus> {
    try {
        // 1. Is docker CLI on PATH?
        await asyncExec("docker --version");
    } catch (err) {
        console.error("[dockerManager] docker --version failed:", err);
        return "missing";
    }

    try {
        // 2. Is the daemon actually running?
        // If Docker Desktop is closed, this typically fails with
        // "Cannot connect to the Docker daemon…" error.
        await asyncExec("docker info");
        return "ok";
    } catch (err) {
        console.error("[dockerManager] docker info failed:", err);
        return "daemon_off";
    }
}

export function getComposeFilePath(): string {
    const basePath =
        process.env.NODE_ENV === "development"
            ? process.cwd()
            : app.isPackaged
                ? app.getAppPath().replace(/app\.asar$/, "")
                : process.cwd();

    return join(basePath, "docker", "docker-compose.yml");
}

export async function startStack(): Promise<DockerBootstrapStatus> {
    const dockerStatus = await getRawDockerStatus();

    if (dockerStatus === "missing") return "docker_missing";
    if (dockerStatus === "daemon_off") return "docker_daemon_off";

    const composeFile = getComposeFilePath();

    console.log('composing file from path', composeFile)
    try {
        console.log("[dockerManager] running docker compose pull...");
        await asyncExec(`docker compose -f "${composeFile}" pull`, {
            cwd: process.cwd()
        });

        console.log("[dockerManager] running docker compose up -d...");
        await asyncExec(`docker compose -f "${composeFile}" up -d`, {
            cwd: process.cwd()
        });

        console.log("[dockerManager] stack started.");
        return "compose_started";
    } catch (err: any) {
        console.error("[dockerManager] docker compose failed:", {
            message: err?.message,
            stdout: err?.stdout,
            stderr: err?.stderr
        });
        return "compose_error";
    }
}

export async function waitForHttpReady(
    url: string,
    timeoutMs = 60_000
): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) return true;
        } catch {
            // ignore and retry
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    return false;
}
