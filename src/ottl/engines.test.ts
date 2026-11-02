import { describe, it, expect } from "vitest";
import * as zlib from "zlib";
import { ENGINES, BUNDLED_ENGINE, engineVersions, findEngine, engineUrl, engineAssetName, engineLabel } from "./engines";
import { sha256, verifyAndUnpack, download } from "./engineHost";
import { BOUNDARY } from "./versions";

describe("engines", () => {
  it("lists one engine per behaviour boundary, oldest first, with the bundled one last", () => {
    const v = engineVersions();
    expect(v[v.length - 1]).toBe(BUNDLED_ENGINE);
    for (const b of [BOUNDARY.traceIdString, BOUNDARY.defaultErrorModeIgnore, BOUNDARY.setWritesNil, BOUNDARY.dynamicSliceArguments]) expect(v).toContain(b);
    for (const e of ENGINES) {
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.bytes).toBeGreaterThan(1_000_000);
    }
  });

  it("builds release URLs and picker labels", () => {
    expect(engineAssetName("v0.150.0")).toBe("ottl-v0.150.0.wasm.gz");
    expect(engineUrl("v0.150.0")).toBe("https://github.com/srikar-kompella/ottl-lens/releases/download/engines-1/ottl-v0.150.0.wasm.gz");
    expect(engineLabel(findEngine(BUNDLED_ENGINE)!, true)).toBe(`${BUNDLED_ENGINE} — latest (bundled)`);
    expect(engineLabel(findEngine("v0.150.0")!, false)).toMatch(/^v0\.150\.0 — hex strings .* \(download, 4\.9 MB\)$/);
    expect(engineLabel(findEngine("v0.150.0")!, true)).not.toMatch(/download/);
    expect(findEngine("v9.9.9")).toBeUndefined();
  });

  it("only unpacks an engine whose checksum matches the pinned one", () => {
    const gz = zlib.gzipSync(Buffer.from("\0asm fake engine"));
    const info = { version: "v0.0.1", bytes: gz.length, sha256: sha256(gz), why: "test" };
    expect(Buffer.from(verifyAndUnpack(gz, info)).toString()).toBe("\0asm fake engine");
    const tampered = Buffer.from(gz); tampered[tampered.length - 5] ^= 0xff;
    expect(() => verifyAndUnpack(tampered, info)).toThrow(/failed its integrity check .* It was not loaded/);
  });

  it("refuses to download over plain HTTP", async () => {
    await expect(download("http://example.com/x", 10)).rejects.toThrow(/refusing non-HTTPS/);
  });
});
