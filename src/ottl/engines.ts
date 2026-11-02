/**
 * The OTTL engines OTTL Lens can run.
 *
 * One engine is bundled (media/ottl.wasm). The others are downloaded on demand from a
 * GitHub release of this repository and checked against the sha256 pinned here before
 * they are ever loaded, so a tampered or truncated download is rejected.
 *
 * Built by scripts/build-engines.sh: each is the contrib transform processor at that
 * release compiled to WebAssembly, gzipped. Versions are the releases where a
 * documented OTTL behaviour changed (src/ottl/versions.ts).
 */

import { compareVersions } from "./versions";

export interface EngineInfo {
  version: string;
  /** sha256 of the .wasm.gz asset. */
  sha256: string;
  /** Size of the .wasm.gz asset in bytes. */
  bytes: number;
  /** What changed in this release that the engine exists to show. */
  why: string;
}

export const BUNDLED_ENGINE = "v0.164.1";
export const ENGINE_RELEASE_TAG = "engines-1";
export const ENGINE_REPO = "srikar-kompella/ottl-lens";

export const ENGINES: readonly EngineInfo[] = [
  { version: "v0.140.0", bytes: 6025321, sha256: "01928a330e8acef17249b3c825f8e40ac3d736edf932f2d8c3e758911e1bd93a", why: "before severity_number string assignments became errors (v0.141)" },
  { version: "v0.146.0", bytes: 5075186, sha256: "a174422a49ce23d09d2367361c84565d8bf0c7dda21bd9c3099a3e1de1a31b51", why: "the engine OTTL Lens 0.1–0.3 bundled" },
  { version: "v0.150.0", bytes: 5126846, sha256: "2ad8395452e039f1111210ae36602a7ba36c8c611612c52e49c9d1d2996ed2ce", why: "hex strings assigned to trace_id/span_id became errors" },
  { version: "v0.153.0", bytes: 5145225, sha256: "ccfcea48b1e1776ca09f861ae9d34bcddbf4a2e96ebd49f33ab2c1df025e1c66", why: "transform default error_mode became ignore" },
  { version: "v0.157.0", bytes: 5325524, sha256: "efb262d537fa719d062d08e981e4bf30f1da8abc305085e03015af1ff1078235", why: "failed conversions still return nil" },
  { version: "v0.160.0", bytes: 5377926, sha256: "0cce067ad0149b7c13c25917fb3b9fc052775f61dbe410b37a8c35cb11e2c760", why: "failed conversions (Int(\"abc\")) became errors; clear() added" },
  { version: "v0.161.0", bytes: 5392781, sha256: "3aa99b40661bc187efee81f5c07a4cc49f2fd354dedf7f6b7ad7b1c3b1270e63", why: "set() writes nil as an empty value; failed conversions are errors" },
  { version: "v0.163.0", bytes: 5457216, sha256: "ff37b75e29295c5fb9bbf3be42878715dac8c061ba1430d16cf2242120a6c087", why: "slice arguments accept paths and converters" },
  { version: "v0.164.1", bytes: 5456527, sha256: "42c84d277ae0ae3ff50e6f11be4b044baa35ed989437fb72b9ffb5e530fbaccd", why: "OTTL 1.x stable (bundled)" },
];

export function engineVersions(): string[] {
  return ENGINES.map((e) => e.version).sort(compareVersions);
}

export function findEngine(version: string): EngineInfo | undefined {
  return ENGINES.find((e) => e.version === version);
}

export function engineAssetName(version: string): string {
  return `ottl-${version}.wasm.gz`;
}

export function engineUrl(version: string): string {
  return `https://github.com/${ENGINE_REPO}/releases/download/${ENGINE_RELEASE_TAG}/${engineAssetName(version)}`;
}

/** Label for a picker entry, e.g. "v0.150.0 — hex strings … (download, 4.9 MB)". */
export function engineLabel(e: EngineInfo, cached: boolean): string {
  if (e.version === BUNDLED_ENGINE) return `${e.version} — latest (bundled)`;
  const size = `${(e.bytes / 1048576).toFixed(1)} MB`;
  return `${e.version} — ${e.why}${cached ? "" : ` (download, ${size})`}`;
}
