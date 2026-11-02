/**
 * "What changes if I move to another collector version?"
 *
 * The same block and payload are traced on two engines; this lines the two traces up
 * statement by statement and reports where the outcome differs. Pure — the panel runs
 * the traces and renders the result.
 */

import type { StepResult, TraceResult } from "./trace";

export interface StepOutcome {
  /** Short verdict, e.g. "changed", "wrote an empty value", "no effect", "error". */
  verdict: string;
  /** What it did: the first diff line, or the first sentence of the error/hint. */
  detail: string;
}

export interface VersionDifference {
  index: number;
  statement: string;
  a: StepOutcome;
  b: StepOutcome;
}

export interface Comparison {
  versionA: string;
  versionB: string;
  differences: VersionDifference[];
  /** Both traces ran to completion and produced the same final payload. */
  sameOutput: boolean;
  /** One-line headline for the panel. */
  summary: string;
}

const firstSentence = (s: string) => (/^(.+?[.?!])(\s|$)/.exec(s)?.[1] ?? s);

export function outcomeOf(step: StepResult | undefined): StepOutcome {
  if (!step) return { verdict: "not run", detail: "an earlier statement stopped the block" };
  switch (step.verdict) {
    case "changed": {
      const rows = (step.display ?? []).map((d) => `${d.kind === "added" ? "+" : d.kind === "removed" ? "−" : "~"} ${d.label}${d.kind === "changed" ? ": " : " = "}${d.text}`);
      return { verdict: step.caution ? "wrote an empty value" : "changed", detail: rows.join("; ") };
    }
    case "no-effect":
      return { verdict: "no effect", detail: "ran, changed nothing" };
    case "not-matched":
      return { verdict: "matched nothing", detail: "the where clause excluded every record" };
    case "error":
      return {
        verdict: step.errorClass === "config" ? "config error" : "error",
        detail: firstSentence(step.explanation ?? step.error ?? "error"),
      };
  }
}

function canonical(json: string | undefined): string | undefined {
  if (json === undefined) return undefined;
  try { return JSON.stringify(JSON.parse(json)); } catch { return json; }
}

export function compareTraces(a: TraceResult, b: TraceResult, versionA: string, versionB: string): Comparison {
  const byIndex = (t: TraceResult) => new Map(t.steps.map((s) => [s.index, s]));
  const ma = byIndex(a);
  const mb = byIndex(b);
  const count = Math.max(
    a.steps.length ? Math.max(...a.steps.map((s) => s.index)) + 1 : 0,
    b.steps.length ? Math.max(...b.steps.map((s) => s.index)) + 1 : 0,
  );
  const differences: VersionDifference[] = [];
  for (let i = 0; i < count; i++) {
    const sa = ma.get(i);
    const sb = mb.get(i);
    const oa = outcomeOf(sa);
    const ob = outcomeOf(sb);
    // Errors differ in wording between versions (line:col was added in v0.163); compare the kind.
    const same = oa.verdict === ob.verdict && (oa.verdict.endsWith("error") || oa.detail === ob.detail);
    if (!same) differences.push({ index: i, statement: (sa ?? sb)!.statement, a: oa, b: ob });
  }
  const sameOutput = a.finalOutput !== undefined && canonical(a.finalOutput) === canonical(b.finalOutput);
  const summary = differences.length === 0
    ? `Same result on ${versionA} and ${versionB} for this block and payload.`
    : `${differences.length} statement${differences.length === 1 ? " behaves" : "s behave"} differently on ${versionA} and ${versionB}.`;
  return { versionA, versionB, differences, sameOutput, summary };
}
