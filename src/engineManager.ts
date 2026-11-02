/**
 * Which OTTL engine runs the dry-run, and getting it onto disk.
 *
 * The bundled engine (media/ottl.wasm) needs nothing. Any other version is downloaded
 * once — only after the user agrees — from this extension's GitHub release, checked
 * against the sha256 pinned in src/ottl/engines.ts, cached in global storage, and
 * re-checked every time it is loaded.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BUNDLED_ENGINE, ENGINE_REPO, engineAssetName, engineUrl, findEngine } from "./ottl/engines";
import { download, loadEngine, verifyAndUnpack, type Engine } from "./ottl/engineHost";

const CONSENT_KEY = "ottl.engines.downloadConsent";

export class EngineManager {
  private readonly loaded = new Map<string, Promise<Engine>>();
  /** Feature gates currently switched on, per engine version. */
  private readonly gatesOn = new Map<string, Set<string>>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get cacheDir(): string {
    return path.join(this.context.globalStorageUri.fsPath, "engines");
  }

  private cachePath(version: string): string {
    return path.join(this.cacheDir, engineAssetName(version));
  }

  /** Can this version run without a download? */
  isLocal(version: string): boolean {
    return version === BUNDLED_ENGINE || fs.existsSync(this.cachePath(version));
  }

  /**
   * The engine for a collector version, downloading it first if needed (asks the user).
   * Resolves to undefined when the user declines.
   */
  async get(version: string): Promise<Engine | undefined> {
    const existing = this.loaded.get(version);
    if (existing) return existing;
    if (!this.isLocal(version) && !(await this.fetch(version))) return undefined;
    const p = Promise.resolve(vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Loading OTTL engine ${version}…` },
      () => this.load(version)
    ));
    this.loaded.set(version, p);
    p.catch(() => this.loaded.delete(version));
    return p;
  }

  private async load(version: string): Promise<Engine> {
    const media = this.context.asAbsolutePath("media");
    const shim = path.join(media, "wasm_exec.js");
    if (version === BUNDLED_ENGINE) {
      const wasm = path.join(media, "ottl.wasm");
      if (!fs.existsSync(wasm) || !fs.existsSync(shim)) {
        throw new Error("The bundled OTTL engine is missing. Reinstall the extension, or run `npm run build:wasm` in a development checkout.");
      }
      return loadEngine(version, fs.readFileSync(wasm), shim);
    }
    const info = findEngine(version);
    if (!info) throw new Error(`OTTL Lens has no engine for ${version}.`);
    let bytes: Uint8Array;
    try {
      bytes = verifyAndUnpack(fs.readFileSync(this.cachePath(version)), info);
    } catch (e) {
      fs.rmSync(this.cachePath(version), { force: true }); // corrupt or tampered: fetch again next time
      throw e;
    }
    return loadEngine(version, bytes, shim);
  }

  /** Download a version after asking. Returns false if the user declined or it failed. */
  private async fetch(version: string): Promise<boolean> {
    const info = findEngine(version);
    if (!info) {
      void vscode.window.showErrorMessage(`OTTL Lens has no engine for ${version}.`);
      return false;
    }
    const size = `${(info.bytes / 1048576).toFixed(1)} MB`;
    if (!this.context.globalState.get<boolean>(CONSENT_KEY)) {
      const choice = await vscode.window.showInformationMessage(
        `Download the OTTL engine for collector ${version} (${size})? It comes from the github.com/${ENGINE_REPO} releases ` +
        "and is checked against a checksum built into OTTL Lens before it runs. This is the only network request OTTL Lens makes.",
        { modal: false },
        "Download",
        "Always allow",
      );
      if (!choice) return false;
      if (choice === "Always allow") await this.context.globalState.update(CONSENT_KEY, true);
    }
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Downloading OTTL engine ${version}`, cancellable: false },
        async (progress) => {
          let last = 0;
          const gz = await download(engineUrl(version), info.bytes + 1024, (received) => {
            const pct = Math.floor((received / info.bytes) * 100);
            if (pct > last) { progress.report({ increment: pct - last, message: `${pct}%` }); last = pct; }
          });
          verifyAndUnpack(gz, info); // throws on a checksum mismatch; nothing is written
          fs.mkdirSync(this.cacheDir, { recursive: true });
          fs.writeFileSync(this.cachePath(version), gz);
        }
      );
      return true;
    } catch (e) {
      void vscode.window.showErrorMessage(`Couldn't get the OTTL engine for ${version}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /**
   * Switch feature gates on an engine to exactly `wanted` (as `--feature-gates` would on a
   * collector). Returns notes for gates the engine doesn't know.
   */
  applyFeatureGates(engine: Engine, wanted: readonly string[]): string[] {
    const on = this.gatesOn.get(engine.version) ?? new Set<string>();
    const notes: string[] = [];
    for (const id of [...on]) {
      if (!wanted.includes(id)) { engine.setFeatureGate(id, false); on.delete(id); }
    }
    for (const id of wanted) {
      if (on.has(id)) continue;
      const err = engine.setFeatureGate(id, true);
      if (err) {
        notes.push(/no such feature gate/.test(err)
          ? `Feature gate \`${id}\` doesn't exist in collector ${engine.version}, so it wasn't applied.`
          : `Feature gate \`${id}\` couldn't be set on collector ${engine.version}: ${err}`);
      }
      else on.add(id);
    }
    this.gatesOn.set(engine.version, on);
    return notes;
  }
}
