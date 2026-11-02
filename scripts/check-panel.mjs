/**
 * Headless check of the dry-run panel's webview: version picker, compare view, cautioned
 * steps. Renders buildHtml() in jsdom and drives it with the messages the extension sends.
 *
 * Usage:  npm i --no-save jsdom && node scripts/check-panel.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "ottl-panel-"));
import { build } from "esbuild"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
await build({ stdin:{contents:`export { buildHtml } from "./src/panel/dryRunPanel";`, resolveDir:root, loader:"ts"}, bundle:true, platform:"node", format:"cjs", outfile:join(tmp,"panel.cjs"), external:["vscode"], logLevel:"error"});
const Module = require("module"); const orig = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? {} : orig.call(this, r, ...a); };
const { buildHtml } = require(join(tmp,"panel.cjs"));
const { JSDOM } = require("jsdom");
const posted = [];
const dom = new JSDOM(buildHtml(), { runScripts: "dangerously", beforeParse(w) { w.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m) }); w.matchMedia = () => ({ matches: false }); } });
const w = dom.window, d = w.document;
const send = (m) => w.dispatchEvent(new w.MessageEvent("message", { data: m }));
let failed = 0; const check = (l, ok, got="") => { console.log((ok?"PASS":"FAIL")+"  "+l+(ok?"":"  got: "+got)); if(!ok) failed++; };
await new Promise(r=>setTimeout(r,50));
check("panel says ready", posted[0]?.type === "ready");
send({ type: "statements", text: 'set(log.attributes["user"], log.attributes["missing"])', filename: "collector.yaml", signal: "logs", errorMode: null, fromYaml: true });
send({ type: "engines", options: [{version:"v0.164.1",label:"v0.164.1 — latest (bundled)"},{version:"v0.157.0",label:"v0.157.0 — x (download, 5.1 MB)"}], selected: "v0.157.0", detected: { version: "v0.158.2", file: "deploy/docker-compose.yml", engine: "v0.157.0" }, fromSetting: false });
check("collector picker filled and preselected from the workspace", d.getElementById("version").value === "v0.157.0" && d.getElementById("version").options.length === 2, d.getElementById("version").value);
check("compare picker has — plus both versions", d.getElementById("compare").options.length === 3);
check("source says where the version came from", /found v0\.158\.2 in deploy\/docker-compose\.yml → closest engine v0\.157\.0/.test(d.getElementById("version-source").textContent), d.getElementById("version-source").textContent);
d.getElementById("compare").value = "v0.164.1"; d.getElementById("compare").dispatchEvent(new w.Event("change"));
d.getElementById("run-btn").click();
const run = posted.find((m) => m.type === "run");
check("run carries version and compareWith", run?.version === "v0.157.0" && run?.compareWith === "v0.164.1", JSON.stringify(run));
send({ type: "engines", options: [{version:"v0.164.1",label:"v0.164.1 — latest (bundled)"},{version:"v0.157.0",label:"v0.157.0 — x"}], selected: "v0.164.1", fromSetting: false });
check("a refresh keeps the user's choices", d.getElementById("version").value === "v0.157.0" && d.getElementById("compare").value === "v0.164.1");
send({ type: "result", ok: true, engineVersion: "v0.157.0", summary: "0 changed · 1 had no effect", noEffectCount: 1, notes: [], output: "{}",
  steps: [{ index: 0, statement: 's', verdict: "changed", caution: true, display: [{kind:"changed",label:'log.attributes["user"]',text:'"alice" → (empty)'}], note: "x was nil" }],
  comparison: { versionA: "v0.157.0", versionB: "v0.164.1", summary: "1 statement behaves differently on v0.157.0 and v0.164.1.", differences: [{ index: 0, statement: "s", a: { verdict: "no effect", detail: "ran, changed nothing" }, b: { verdict: "wrote an empty value", detail: '~ log.attributes["user"]: "alice" → (empty)' } }], sameOutput: false } });
const cb = d.getElementById("compare-box");
check("comparison box shows the difference for both versions", cb.style.display === "block" && /behaves differently/.test(cb.textContent) && /v0\.157\.0: no effect/.test(cb.textContent) && /v0\.164\.1: wrote an empty value/.test(cb.textContent), cb.textContent);
const card = d.querySelector(".step");
check("cautioned step gets the warning style and badge", card.classList.contains("caution") && card.querySelector(".badge").textContent === "wrote empty value");
check("summary names the collector version", /· collector v0\.157\.0/.test(d.getElementById("summary").textContent), d.getElementById("summary").textContent);
d.getElementById("version").value = "v0.164.1"; d.getElementById("version").dispatchEvent(new w.Event("change"));
check("changing version clears stale results", cb.style.display === "none" && !d.querySelector(".step"));
console.log(failed ? failed + " FAILED" : "All panel checks passed."); process.exit(failed?1:0);
