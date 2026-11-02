/**
 * Collector versions and the OTTL behaviour changes between them.
 *
 * Every boundary below was checked twice: in contrib source/CHANGELOG at the tag, and by
 * running the same statement on engines built from the release before and the release
 * at the boundary (scripts/build-engines.sh; probes in scripts/verify-engine.mjs).
 */

/** "v0.161.0" | "0.161.0" | "0.161" → [0, 161, 0]; undefined when not a version. */
export function parseVersion(v: string): [number, number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(v.trim());
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

/** Negative when a < b, 0 when equal, positive when a > b. Unparsable sorts first. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** True when `version` is `boundary` or later. Unknown versions are treated as latest. */
export function atLeast(version: string | undefined, boundary: string): boolean {
  if (!version || !parseVersion(version)) return true;
  return compareVersions(version, boundary) >= 0;
}

/** Canonical "vX.Y.Z" form. */
export function normalizeVersion(v: string): string | undefined {
  const p = parseVersion(v);
  return p ? `v${p[0]}.${p[1]}.${p[2]}` : undefined;
}

export const BOUNDARY = {
  /** set(log.severity_number, "INFO") becomes an error. */
  severityNumberString: "v0.141.0",
  /** Assigning a hex string to trace_id/span_id becomes a run-time error. */
  traceIdString: "v0.150.0",
  /** Transform processor default error_mode becomes ignore. */
  defaultErrorModeIgnore: "v0.153.0",
  /** Int()/Double()/Bool() on an unparsable string return an error instead of nil (#50564). */
  failedConversionError: "v0.160.0",
  /** set() writes nil as an empty value (ottl.set.allowNil beta, on by default). */
  setWritesNil: "v0.161.0",
  /** Slice arguments (keep_keys keys, Concat values) accept paths and converters. */
  dynamicSliceArguments: "v0.163.0",
  /** OTTL traces/metrics/logs are stable (1.x); the standard function set is frozen. */
  ottlStable: "v0.164.0",
} as const;

/**
 * The closest available engine for a collector version: the newest engine at or below
 * it. Between boundaries every behaviour we check is the same, so this engine behaves
 * like that collector for the cases OTTL Lens reports on. Versions older than every
 * engine get the oldest one; versions newer than every engine get the newest.
 */
export function closestEngine(version: string, engines: readonly string[]): string | undefined {
  if (engines.length === 0) return undefined;
  const sorted = [...engines].sort(compareVersions);
  if (!parseVersion(version)) return sorted[sorted.length - 1];
  let pick = sorted[0];
  for (const e of sorted) if (compareVersions(e, version) <= 0) pick = e;
  return pick;
}

/**
 * Find collector-contrib versions pinned in workspace files: container image tags
 * (`otel/opentelemetry-collector-contrib:0.150.0`, `…/otelcol-contrib:v0.150.0`),
 * Helm `image.tag` under a contrib repository, and a Go module require on the transform
 * processor. Returns distinct versions, newest first. Only contrib counts: the core
 * distribution has no transform processor.
 */
export function detectCollectorVersions(text: string): string[] {
  const found = new Set<string>();
  const add = (v: string) => {
    const n = normalizeVersion(v);
    if (n) found.add(n);
  };
  const patterns = [
    /opentelemetry-collector-contrib(?:\/[\w.-]+)?:v?(\d+\.\d+(?:\.\d+)?)\b/g,
    /\botelcol-contrib:v?(\d+\.\d+(?:\.\d+)?)\b/g,
    /opentelemetry-collector-contrib\/processor\/transformprocessor\s+v(\d+\.\d+\.\d+)/g,
    // Helm values: a contrib repository followed within a few lines by its tag.
    /repository:\s*["']?[\w./-]*opentelemetry-collector-contrib["']?[ \t]*\r?\n(?:[ \t]*[\w-]+:.*\r?\n){0,3}?[ \t]*tag:\s*["']?v?(\d+\.\d+(?:\.\d+)?)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) add(m[1]);
  }
  return [...found].sort((a, b) => compareVersions(b, a));
}
