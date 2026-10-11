/**
 * Redaction check: after a dry-run, list values in the output that still look like
 * personal data or credentials. Redaction is one of the most common reasons people
 * write OTTL, and "did my delete_key / replace_pattern actually remove it?" is exactly
 * what a dry-run can answer.
 *
 * Deliberately high-precision: emails, Luhn-valid card numbers, JWTs, bearer tokens,
 * US SSN format. IP addresses are NOT flagged — server.address holding an IP is normal,
 * and a noisy check teaches people to ignore it.
 */

import { computeOrdinals, ottlLabel } from "./present";

export type PiiKind = "email address" | "card number" | "JWT" | "bearer token" | "SSN";

export interface PiiFinding {
  /** OTTL-style location, e.g. log.attributes["user_email"] or log.body. */
  label: string;
  kind: PiiKind;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/i;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const CARD_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g;

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

export function piiKinds(value: string): PiiKind[] {
  const kinds: PiiKind[] = [];
  if (EMAIL.test(value)) kinds.push("email address");
  for (const m of value.match(CARD_CANDIDATE) ?? []) {
    if (luhnValid(m.replace(/[ -]/g, ""))) { kinds.push("card number"); break; }
  }
  if (JWT.test(value)) kinds.push("JWT");
  if (BEARER.test(value)) kinds.push("bearer token");
  if (SSN.test(value)) kinds.push("SSN");
  return kinds;
}

/** Walk every string in an OTLP JSON payload and report likely PII, labelled as OTTL paths. */
export function scanForPii(payload: unknown): PiiFinding[] {
  const ord = computeOrdinals(payload);
  const out: PiiFinding[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      for (const kind of piiKinds(v)) {
        const { label } = ottlLabel(path, ord);
        const key = `${label}\u0000${kind}`;
        if (!seen.has(key)) { seen.add(key); out.push({ label, kind }); }
      }
      return;
    }
    if (Array.isArray(v)) {
      const keyed = v.every((x) => typeof x === "object" && x !== null && typeof (x as { key?: unknown }).key === "string");
      v.forEach((x, i) => walk(x, keyed && v.length ? `${path}[${JSON.stringify((x as { key: string }).key)}]` : `${path}[${i}]`));
      return;
    }
    if (typeof v === "object" && v !== null) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === "key") continue; // attribute names aren't data
        walk(x, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(payload, "");
  return out;
}

/** One-line note for the panel, or undefined when nothing was found. */
export function describePii(findings: PiiFinding[]): string | undefined {
  if (findings.length === 0) return undefined;
  const shown = findings.slice(0, 4).map((f) => `\`${f.label}\` (${f.kind})`).join(", ");
  const more = findings.length > 4 ? ` and ${findings.length - 4} more` : "";
  return `Redaction check: the output still contains what looks like personal data or credentials — ${shown}${more}.`;
}
