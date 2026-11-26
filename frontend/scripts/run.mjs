import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const { loadEnvConfig } = nextRequire("@next/env");
const [mode, ...args] = process.argv.slice(2);
const frontend = fileURLToPath(new URL("../", import.meta.url));
const backend = fileURLToPath(new URL("../../backend/", import.meta.url));
const healthUrl = "http://127.0.0.1:8000/api/health";
const children = new Set();
const stopping = new AbortController();

loadEnvConfig(frontend, mode === "dev");

function start(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  children.add(child);
  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      children.delete(child);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

async function backendReady() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return false;
    const health = await response.json();
    return health.status === "ok" && typeof health.road_network_loaded === "boolean";
  } catch {
    return false;
  }
}

async function waitForBackend() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await backendReady()) return;
    await delay(250, undefined, { signal: stopping.signal });
  }
  throw new Error("The API did not become ready on port 8000.");
}

function stop() {
  stopping.abort();
  for (const child of children) child.kill("SIGTERM");
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  let backendExit;
  if (!process.env.NEXT_PUBLIC_API_URL && !await backendReady()) {
    const windows = process.platform === "win32";
    const virtualPython = join(backend, ".venv", windows ? "Scripts/python.exe" : "bin/python");
    const python = process.env.PYTHON || (existsSync(virtualPython) ? virtualPython : windows ? "python" : "python3");
    backendExit = start(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], backend)
      .then(() => { throw new Error("The routing API stopped."); });
    await Promise.race([waitForBackend(), backendExit]);
  }
  if (!stopping.signal.aborted) {
    const frontendExit = start(
      process.execPath, [require.resolve("next/dist/bin/next"), mode, "--hostname", "127.0.0.1", ...args], frontend,
    );
    const code = await Promise.race(backendExit ? [frontendExit, backendExit] : [frontendExit]);
    if (!stopping.signal.aborted) process.exitCode = code;
  }
} catch (error) {
  if (!stopping.signal.aborted) {
    console.error(`${error.message} See README.md for backend setup and make sure port 8000 is available.`);
    process.exitCode = 1;
  }
} finally {
  stop();
}
