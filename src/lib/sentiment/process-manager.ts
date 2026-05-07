import { spawn, type ChildProcess } from "child_process";
import * as path from "path";

/** Vercel/serverless: set to the public URL of your Python sentiment service (no trailing slash). */
const remoteBase =
  process.env.SENTIMENT_SERVICE_URL?.replace(/\/$/, "") || "";

let pythonProcess: ChildProcess | null = null;
const port = Number(process.env.PYTHON_SERVICE_PORT) || 8100;
const localUrl = `http://127.0.0.1:${port}`;
const PYTHON_URL = remoteBase || localUrl;

function pythonCommand(): string {
  return process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(
  healthUrl: string,
  maxMs: number
): Promise<void> {
  const start = Date.now();
  let lastError: string | null = null;
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const j = (await r.json()) as { model_loaded?: boolean };
        if (j.model_loaded) return;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await sleep(200);
  }
  throw new Error(
    `Python service did not become healthy in ${maxMs}ms${lastError ? `: ${lastError}` : ""}`
  );
}

export async function ensurePythonProcess(): Promise<void> {
  if (remoteBase) {
    return;
  }
  if (pythonProcess && !pythonProcess.killed) {
    return;
  }

  const cwd = path.join(process.cwd(), "python-service");
  const cmd = pythonCommand();
  pythonProcess = spawn(
    cmd,
    ["-m", "uvicorn", "model:app", "--host", "127.0.0.1", "--port", String(port)],
    { cwd, stdio: process.env.NODE_ENV === "development" ? "inherit" : "pipe" }
  );
  pythonProcess.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("python sentiment process error:", err);
  });
  pythonProcess.on("exit", (code) => {
    pythonProcess = null;
    if (code !== 0 && code !== null) {
      // eslint-disable-next-line no-console
      console.warn("python sentiment process exited with code", code);
    }
  });

  await waitForHealth(`${PYTHON_URL}/health`, 30_000);
}

export const sentimentServiceUrl = PYTHON_URL;
