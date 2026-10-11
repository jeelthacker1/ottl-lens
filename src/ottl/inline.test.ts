import { describe, it, expect } from "vitest";
import { mapVerdicts, inlineLabel, inlineDetail } from "./inline";
import type { StepResult } from "./trace";

const step = (o: Partial<StepResult>): StepResult => ({ index: 0, statement: "s", verdict: "changed", ...o } as StepResult);

describe("inlineLabel", () => {
  it("summarises a change with its first diff line and a count", () => {
    expect(inlineLabel(step({
      display: [
        { kind: "added", label: 'log.attributes["env"]', text: '"production"' },
        { kind: "removed", label: 'log.attributes["x"]', text: '"y"' },
      ],
    }))).toBe('✓ changed  + log.attributes["env"] = "production"  (+1 more)');
    expect(inlineLabel(step({ display: [{ kind: "changed", label: "log.body", text: '"a" → "b"' }] }))).toBe('✓ changed  ~ log.body: "a" → "b"');
  });

  it("labels no effect, matched nothing and never-matches", () => {
    expect(inlineLabel(step({ verdict: "no-effect" }))).toBe("⚠ no effect");
    expect(inlineLabel(step({ verdict: "not-matched", note: "No record in this payload matched the where clause; …" }))).toBe("○ matched nothing");
    expect(inlineLabel(step({ verdict: "not-matched", note: "This where clause can never match any payload: …" }))).toBe("⚠ where clause can never match");
  });

  it("uses the first sentence of the explanation for errors, and clips long text", () => {
    expect(inlineLabel(step({ verdict: "error", explanation: "Converter names start with an uppercase letter. Did you mean `ParseJSON`?" })))
      .toBe("✗ Converter names start with an uppercase letter.");
    expect(inlineLabel(step({ verdict: "error", error: "x".repeat(200) })).length).toBe(90);
  });
});

describe("inlineDetail", () => {
  it("includes the statement, diff, note, explanation and consequence", () => {
    const d = inlineDetail(step({
      verdict: "error", statement: "boom()", explanation: "Why.", consequence: "What happens.",
    }));
    expect(d).toContain("**error** — `boom()`");
    expect(d).toContain("Why.");
    expect(d).toContain("What happens.");
    expect(inlineDetail(step({ verdict: "error", error: "raw" }))).toContain("`raw`");
  });
});

describe("mapVerdicts", () => {
  it("pairs steps with document lines by statement text, in order", () => {
    const items = [{ line: 5, text: "a" }, { line: 6, text: "b" }, { line: 9, text: "a" }];
    const steps = [step({ statement: "a", verdict: "changed" }), step({ statement: "b", verdict: "no-effect" }), step({ statement: "a", verdict: "error" })];
    expect(mapVerdicts(steps, items).map((v) => [v.line, v.kind])).toEqual([[5, "changed"], [6, "no-effect"], [9, "error"]]);
  });

  it("skips steps it can't place unambiguously", () => {
    expect(mapVerdicts([step({ statement: "zzz" })], [{ line: 1, text: "a" }])).toEqual([]);
  });
});
