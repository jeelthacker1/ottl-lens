/**
 * Verdicts shown next to each statement in the editor after a dry-run.
 * Pure: maps trace steps onto document lines and produces short labels; the VS Code
 * decoration code lives in src/verdicts.ts.
 */

import type { StepResult } from "./trace";
import type { StatementLine } from "./yaml";

/** `caution` is a `changed` step that wrote an empty value (set() with a nil value, v0.161+). */
export type InlineKind = "changed" | "caution" | "no-effect" | "not-matched" | "error";

export interface InlineVerdict {
  line: number;
  kind: InlineKind;
  /** Short text shown after the line. */
  label: string;
  /** Full detail for the hover. */
  detail: string;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** First sentence of a message, for a compact inline label. */
const firstSentence = (s: string) => (/^(.+?[.?!])(\s|$)/.exec(s)?.[1] ?? s);

export function inlineLabel(step: StepResult): string {
  switch (step.verdict) {
    case "changed": {
      const rows = step.display ?? [];
      const sigil = (k: string) => (k === "added" ? "+" : k === "removed" ? "−" : "~");
      const first = rows[0] ? `${sigil(rows[0].kind)} ${rows[0].label}${rows[0].kind === "changed" ? ": " : " = "}${rows[0].text}` : "";
      const more = rows.length > 1 ? `  (+${rows.length - 1} more)` : "";
      return clip(`${step.caution ? "⚠ wrote an empty value" : "✓ changed"}  ${first}${more}`, 90);
    }
    case "no-effect":
      return "⚠ no effect";
    case "not-matched":
      return step.note?.startsWith("This where clause can never match") ? "⚠ where clause can never match" : "○ matched nothing";
    case "error":
      return clip(`✗ ${firstSentence(step.explanation ?? step.error ?? "error")}`, 90);
  }
}

export function inlineDetail(step: StepResult): string {
  const parts: string[] = [`**${step.verdict}** — \`${step.statement}\``];
  for (const d of step.display ?? []) {
    const sigil = d.kind === "added" ? "+" : d.kind === "removed" ? "−" : "~";
    parts.push(`${sigil} \`${d.label}\` ${d.kind === "changed" ? ": " : " = "}${d.text}`);
  }
  if (step.note) parts.push(step.note);
  if (step.explanation) parts.push(step.explanation);
  if (step.consequence) parts.push(step.consequence);
  if (step.error && !step.explanation) parts.push("`" + step.error + "`");
  return parts.join("\n\n");
}

/**
 * Pair each step with the document line its statement came from. Matching is by
 * statement text in order, so a step is only decorated when it is unambiguous.
 */
export function mapVerdicts(steps: StepResult[], items: StatementLine[]): InlineVerdict[] {
  const out: InlineVerdict[] = [];
  let cursor = 0;
  for (const step of steps) {
    let found = -1;
    for (let j = cursor; j < items.length; j++) {
      if (items[j].text === step.statement) { found = j; break; }
    }
    if (found === -1) continue;
    const kind: InlineKind = step.verdict === "changed" && step.caution ? "caution" : step.verdict;
    out.push({ line: items[found].line, kind, label: inlineLabel(step), detail: inlineDetail(step) });
    cursor = found + 1;
  }
  return out;
}
