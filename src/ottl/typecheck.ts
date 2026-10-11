/**
 * Static type checks that catch OTTL that is valid but can never work.
 *
 * 1. Comparing a typed field with a string literal never matches:
 *      where metric.type == "Sum"          (int64 enum)
 *      where span.trace_id == "0102…"      (pcommon.TraceID — bytes)
 *      where log.severity_number == "9"    (int64)
 *    `==` is always false; `!=` is always true.
 * 2. Assigning a string literal to a typed field doesn't set it:
 *      set(span.trace_id, "0102…")         silently ignored ≤ v0.149, run-time error from v0.150
 *      set(log.severity_number, "INFO")    silently ignored ≤ v0.140, run-time error from v0.141
 *
 * Behaviour verified across contrib v0.140.0 / v0.150.0 / v0.157.0 / v0.161.0 by the
 * trade-publications harness (ottl-silence-matrix, probes A2/A4/A6, C1/C2) and on the
 * bundled v0.146.0 engine. Field types come from the generated catalog (upstream
 * context READMEs), so nothing here is hand-typed except the enum prefixes below.
 */

import { CONTEXT_PATHS, ENUMS } from "./catalog";

export interface Fix {
  title: string;
  /** Column range (within the checked text) to replace. */
  start: number;
  end: number;
  replacement: string;
}

export interface TypeIssue {
  start: number;
  end: number;
  message: string;
  code: "ottl.neverMatches" | "ottl.typeMismatchSet";
  fix?: Fix;
}

const PATH_TYPES = new Map(CONTEXT_PATHS.map((p) => [p.path, p.type]));
const ENUM_NAMES = new Set(ENUMS.map((e) => e.name));

/** Field types that a string literal can never equal. */
const NON_STRING_TYPES = new Set(["int64", "uint64", "float64", "bool", "pcommon.TraceID", "pcommon.SpanID", "time.Time"]);

/** Which enum family a numeric field uses (OTTL enum symbols are int64 constants). */
const ENUM_PREFIX: Record<string, string> = {
  "metric.type": "METRIC_DATA_TYPE",
  "metric.aggregation_temporality": "AGGREGATION_TEMPORALITY",
  "span.kind": "SPAN_KIND",
  "span.status.code": "STATUS_CODE",
  "log.severity_number": "SEVERITY_NUMBER",
};

/** Version facts for string assignments (measured; see header). */
const SET_VERSION_NOTE: Record<string, string> = {
  "pcommon.TraceID": "Collectors up to v0.149 silently ignore the assignment; from v0.150 it fails at run time (\"expects pcommon.TraceID but got string\").",
  "pcommon.SpanID": "Collectors up to v0.149 silently ignore the assignment; from v0.150 it fails at run time.",
  "log.severity_number": "Collectors up to v0.140 silently ignore the assignment; from v0.141 it fails at run time (\"expects int64 but got string\").",
};

const CONTEXTS = "log|span|spanevent|metric|datapoint|resource|instrumentation_scope";
const PATH = `\\b(?:${CONTEXTS})(?:\\.[a-z_]+)+(?![\\w.\\[(])`;
const STR = `"(?:[^"\\\\]|\\\\.)*"`;

export function pathType(path: string): string | undefined {
  return PATH_TYPES.get(path);
}

function stringRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = new RegExp(STR, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push([m.index, m.index + m[0].length]);
  return out;
}

const inside = (ranges: Array<[number, number]>, i: number) => ranges.some(([a, b]) => i > a && i < b);

const upperSnake = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toUpperCase();

/** The enum symbol a string literal probably meant, e.g. "Sum" → METRIC_DATA_TYPE_SUM. */
export function enumFor(path: string, literal: string): string | undefined {
  const prefix = ENUM_PREFIX[path];
  if (!prefix) return undefined;
  if (literal.startsWith(prefix + "_") && ENUM_NAMES.has(literal)) return literal;
  const aliases: Record<string, string> = { EMPTY: "NONE", WARNING: "WARN" };
  const key = upperSnake(literal);
  const candidate = `${prefix}_${aliases[key] ?? key}`;
  return ENUM_NAMES.has(candidate) ? candidate : undefined;
}

function describeType(type: string): string {
  if (type === "pcommon.TraceID" || type === "pcommon.SpanID") return `a ${type} (bytes), not a string`;
  return `${/^[aeiou]/i.test(type) ? "an" : "a"} ${type}, not a string`;
}

/** Fix for a string literal used against a typed field, if there is an obvious one. */
function literalFix(path: string, type: string, literal: string, litStart: number, litEnd: number, pathEnd: number): Fix | undefined {
  if (type === "pcommon.TraceID" || type === "pcommon.SpanID") {
    return PATH_TYPES.has(`${path}.string`)
      ? { title: `Use ${path}.string`, start: pathEnd, end: pathEnd, replacement: ".string" }
      : undefined;
  }
  if (type === "bool" && (literal === "true" || literal === "false")) {
    return { title: `Use the boolean ${literal}`, start: litStart, end: litEnd, replacement: literal };
  }
  if (type === "int64" || type === "uint64" || type === "float64") {
    const e = enumFor(path, literal);
    if (e) return { title: `Use ${e}`, start: litStart, end: litEnd, replacement: e };
    if (/^-?\d+(\.\d+)?$/.test(literal)) return { title: `Use the number ${literal}`, start: litStart, end: litEnd, replacement: literal };
  }
  return undefined;
}

const short = (s: string) => (s.length > 24 ? JSON.stringify(s.slice(0, 21) + "…") : JSON.stringify(s));

/** Check one line (or one statement) of OTTL. Columns refer to `text`. */
export function checkTypes(text: string): TypeIssue[] {
  const issues: TypeIssue[] = [];
  const strings = stringRanges(text);

  // 1. Comparisons: <path> ==|!= "<lit>"   and   "<lit>" ==|!= <path>
  const cmp = new RegExp(`(${PATH})\\s*(==|!=)\\s*(${STR})|(${STR})\\s*(==|!=)\\s*(${PATH})`, "g");
  let m: RegExpExecArray | null;
  while ((m = cmp.exec(text)) !== null) {
    const pathFirst = m[1] !== undefined;
    const path = pathFirst ? m[1] : m[6];
    const op = pathFirst ? m[2] : m[5];
    const litRaw = pathFirst ? m[3] : m[4];
    const pathStart = pathFirst ? m.index : m.index + m[0].lastIndexOf(path);
    if (inside(strings, pathStart)) continue; // the "path" is text inside some other string
    const type = PATH_TYPES.get(path);
    if (!type || !NON_STRING_TYPES.has(type)) continue;
    const literal = JSON.parse(litRaw) as string;
    const litStart = pathFirst ? m.index + m[0].lastIndexOf(litRaw) : m.index;
    const fix = literalFix(path, type, literal, litStart, litStart + litRaw.length, pathStart + path.length);
    const outcome = op === "==" ? "can never match" : "is always true";
    issues.push({
      start: m.index,
      end: m.index + m[0].length,
      code: "ottl.neverMatches",
      message:
        `${path} is ${describeType(type)}, so ${op} ${short(literal)} ${outcome}.` +
        (fix ? ` ${fix.title}.` : ""),
      fix,
    });
  }

  // 2. Assignments: set(<path>, "<lit>")
  const set = new RegExp(`\\bset\\s*\\(\\s*(${PATH})\\s*,\\s*(${STR})\\s*\\)`, "g");
  while ((m = set.exec(text)) !== null) {
    if (inside(strings, m.index)) continue;
    const path = m[1];
    const type = PATH_TYPES.get(path);
    if (!type || !NON_STRING_TYPES.has(type)) continue;
    const litRaw = m[2];
    const literal = JSON.parse(litRaw) as string;
    const pathStart = m.index + m[0].indexOf(path);
    const litStart = m.index + m[0].lastIndexOf(litRaw);
    const fix = literalFix(path, type, literal, litStart, litStart + litRaw.length, pathStart + path.length);
    const versionNote = SET_VERSION_NOTE[path] ?? SET_VERSION_NOTE[type] ??
      "Depending on the collector version it is silently ignored or fails at run time.";
    issues.push({
      start: m.index,
      end: m.index + m[0].length,
      code: "ottl.typeMismatchSet",
      message: `${path} is ${describeType(type)}; assigning ${short(literal)} doesn't set it. ${versionNote}` + (fix ? ` ${fix.title}.` : ""),
      fix,
    });
  }
  return issues;
}

/** For the trace: why a guard can never match, if it's a type mismatch. */
export function neverMatchReason(statement: string): string | undefined {
  const where = /\bwhere\b/.exec(statement);
  if (!where) return undefined;
  const issue = checkTypes(statement).find((i) => i.code === "ottl.neverMatches" && i.start >= where.index);
  return issue?.message;
}
