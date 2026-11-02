/**
 * Loading OTTL engines (Go → WebAssembly) and fetching the non-bundled ones.
 * Node-only, no VS Code dependency: src/engineManager.ts adds caching, consent and progress.
 *
 * Several engines can be loaded in one extension host. Each Go program registers its
 * functions on globalThis (`ottlEval`, `ottlSetFeatureGate`); we capture them right after
 * the program starts and remove the globals, so the next engine can register its own.
 * Loads are serialized for the same reason.
 */

import * as crypto from "crypto";
import * as https from "https";
import * as zlib from "zlib";
import { stripOttlComments } from "./yaml";
import type { EngineInfo } from "./engines";

export interface DryRunResult {
  ok: boolean;
  output?: string; // transformed OTLP JSON
  error?: string;
  executionMs?: number;
}

export interface Engine {
  version: string;
  eval(statements: string, signal: string, payloadJSON: string): DryRunResult;
  /** "" on success; otherwise the engine's error (e.g. the gate doesn't exist in this version). */
  setFeatureGate(id: string, enabled: boolean): string;
}

type EvalNative = (s: string, sig: string, p: string) => string;
type GateNative = (id: string, on: boolean) => string;

interface GoInstance {
  importObject: Record<string, Record<string, unknown>>;
  run(instance: unknown): Promise<void>;
}

let chain: Promise<unknown> = Promise.resolve();

/** Instantiate one engine from its .wasm bytes. `wasmExecPath` is Go's JS shim (media/wasm_exec.js). */
export function loadEngine(version: string, wasm: Uint8Array, wasmExecPath: string): Promise<Engine> {
  const run = chain.then(() => instantiate(version, wasm, wasmExecPath));
  chain = run.catch(() => undefined);
  return run;
}

async function instantiate(version: string, wasm: Uint8Array, wasmExecPath: string): Promise<Engine> {
  // wasm_exec.js is not a module — require() runs it for its side effect of defining globalThis.Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  require(wasmExecPath);
  const g = globalThis as Record<string, unknown>;
  delete g.ottlEval;
  delete g.ottlSetFeatureGate;
  const go = new (g.Go as new () => GoInstance)();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wa = (globalThis as any).WebAssembly as { instantiate(b: Uint8Array, i: unknown): Promise<{ instance: unknown }> };
  const { instance } = await wa.instantiate(wasm, go.importObject);
  // go.run() resolves only when Go's main() exits; ours blocks forever, so fire-and-forget.
  void go.run(instance);
  await waitFor(() => typeof g.ottlEval === "function", 10000);
  const evalNative = g.ottlEval as EvalNative;
  // Engines built before 0.4 have no feature-gate hook.
  const gateNative = typeof g.ottlSetFeatureGate === "function" ? (g.ottlSetFeatureGate as GateNative) : undefined;
  delete g.ottlEval;
  delete g.ottlSetFeatureGate;

  return {
    version,
    eval(statements, signal, payloadJSON) {
      const clean = stripOttlComments(statements);
      if (!clean.trim()) return { ok: false, error: "No runnable OTTL statements (only comments/blank lines)." };
      try {
        return JSON.parse(evalNative(clean, signal, payloadJSON)) as DryRunResult;
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    setFeatureGate(id, enabled) {
      if (!gateNative) return `the ${version} engine can't set feature gates`;
      return gateNative(id, enabled);
    },
  };
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (predicate()) resolve();
      else if (Date.now() > deadline) reject(new Error("Timed out waiting for the OTTL engine to start"));
      else setTimeout(check, 20);
    };
    check();
  });
}

/* ------------------------------------------------------------------ *
 * Integrity and download
 * ------------------------------------------------------------------ */

export function sha256(buf: Uint8Array): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Check a downloaded/cached .wasm.gz against the checksum pinned in the extension and
 * unpack it. Throws when it doesn't match: the file is never loaded in that case.
 */
export function verifyAndUnpack(gz: Uint8Array, info: EngineInfo): Uint8Array {
  const got = sha256(gz);
  if (got !== info.sha256) {
    throw new Error(`The ${info.version} engine failed its integrity check (sha256 ${got.slice(0, 12)}…, expected ${info.sha256.slice(0, 12)}…). It was not loaded.`);
  }
  return zlib.gunzipSync(gz);
}

/* v8 ignore start -- network I/O; exercised against GitHub by scripts/verify-engine.mjs */
/** HTTPS GET with redirects (GitHub release assets redirect to a CDN), capped at maxBytes. */
export function download(url: string, maxBytes: number, onProgress?: (received: number) => void, redirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!url.startsWith("https://")) { reject(new Error(`refusing non-HTTPS URL: ${url}`)); return; }
    const req = https.get(url, { headers: { "User-Agent": "ottl-lens" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) { reject(new Error("too many redirects")); return; }
        resolve(download(new URL(res.headers.location, url).toString(), maxBytes, onProgress, redirects - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`download failed: HTTP ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      res.on("data", (c: Buffer) => {
        received += c.length;
        if (received > maxBytes) { req.destroy(new Error("download larger than expected — aborted")); return; }
        chunks.push(c);
        onProgress?.(received);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("download timed out")));
  });
}
/* v8 ignore stop */
