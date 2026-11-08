/**
 * Download the OTTL engines from the GitHub release instead of building them with Go.
 * Every file is checked against the sha256 in src/ottl/engines.ts before it is kept.
 *
 *   npm run fetch:engines
 *
 * Writes the engines to .engines/ (or OTTL_ENGINES_DIR) and, if media/ottl.wasm is
 * missing, unpacks the bundled version there so the extension and tests can run.
 */

import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const out = join(mkdtempSync(join(tmpdir(), "ottl-fetch-")), "lib.cjs");
await build({
  stdin: {
    contents: `export { download, verifyAndUnpack } from "./src/ottl/engineHost";
               export { ENGINES, BUNDLED_ENGINE, engineUrl } from "./src/ottl/engines";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", outfile: out, logLevel: "error",
});
const L = require(out);

const dir = resolve(process.env.OTTL_ENGINES_DIR ?? join(root, ".engines"));
mkdirSync(dir, { recursive: true });
for (const info of L.ENGINES) {
  const file = join(dir, `ottl-${info.version}.wasm.gz`);
  let gz = existsSync(file) ? readFileSync(file) : await L.download(L.engineUrl(info.version), info.bytes + 1024);
  const wasm = L.verifyAndUnpack(gz, info);
  writeFileSync(file, gz);
  if (info.version === L.BUNDLED_ENGINE && !existsSync(join(root, "media", "ottl.wasm"))) {
    writeFileSync(join(root, "media", "ottl.wasm"), wasm);
    console.log(`media/ottl.wasm ← ${info.version}`);
  }
  console.log(`ok  ${info.version}`);
}
console.log(`engines in ${dir}`);
