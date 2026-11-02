import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { loadEngine } from "./engineHost";

// Loads the real bundled engine. Two instances in one process is the case the version
// compare relies on; each must keep its own functions after the next one starts.
const media = path.resolve(__dirname, "../../media");
const wasmPath = path.join(media, "ottl.wasm");
const haveEngine = fs.existsSync(wasmPath);
const LOG = JSON.stringify({ resourceLogs: [{ resource: {}, scopeLogs: [{ scope: {}, logRecords: [{ body: { stringValue: "hi" } }] }] }] });

describe.skipIf(!haveEngine)("engineHost (real engine)", () => {
  it("runs two engine instances side by side, with feature gates per instance", async () => {
    const wasm = fs.readFileSync(wasmPath);
    const a = await loadEngine("a", wasm, path.join(media, "wasm_exec.js"));
    const b = await loadEngine("b", wasm, path.join(media, "wasm_exec.js"));
    expect((globalThis as Record<string, unknown>).ottlEval).toBeUndefined();
    const ra = a.eval('set(log.attributes["x"], "1")', "logs", LOG);
    const rb = b.eval('set(log.attributes["y"], "2")', "logs", LOG);
    expect(ra.ok && ra.output).toMatch(/"x"/);
    expect(rb.ok && rb.output).toMatch(/"y"/);
    expect(a.eval("# only a comment", "logs", LOG)).toEqual({ ok: false, error: "No runnable OTTL statements (only comments/blank lines)." });
    expect(a.setFeatureGate("ottl.functions.enableLambda", true)).toBe("");
    expect(a.setFeatureGate("no.such.gate", true)).toMatch(/no such feature gate/);
    const lambda = 'set(log.attributes["f"], Filter(log.attributes, (k, v) => k == "x"))';
    expect(a.eval(lambda, "logs", LOG).ok).toBe(true);
    expect(b.eval(lambda, "logs", LOG).error).toMatch(/requires the `ottl.functions.enableLambda` feature gate/);
  }, 60000);
});
