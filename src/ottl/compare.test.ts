import { describe, it, expect } from "vitest";
import { compareTraces, outcomeOf } from "./compare";
import type { StepResult, TraceResult } from "./trace";

const step = (index: number, s: Partial<StepResult>): StepResult => ({ index, statement: `s${index}`, verdict: "changed", ...s } as StepResult);
const trace = (steps: StepResult[], finalOutput?: string): TraceResult => ({ ok: true, steps, noEffectCount: 0, finalOutput });

describe("compareTraces", () => {
  it("reports statements whose outcome differs between versions", () => {
    // The set-writes-nil case, as traced on v0.157.0 and v0.164.1.
    const old = trace([step(0, { verdict: "no-effect" })], "{}");
    const cur = trace([step(0, { caution: true, display: [{ kind: "changed", label: 'log.attributes["user"]', text: '"alice" → (empty)' }] })], '{"x":1}');
    const c = compareTraces(old, cur, "v0.157.0", "v0.164.1");
    expect(c.summary).toBe("1 statement behaves differently on v0.157.0 and v0.164.1.");
    expect(c.differences[0].a).toEqual({ verdict: "no effect", detail: "ran, changed nothing" });
    expect(c.differences[0].b).toEqual({ verdict: "wrote an empty value", detail: '~ log.attributes["user"]: "alice" → (empty)' });
    expect(c.sameOutput).toBe(false);
  });

  it("treats differently worded errors of the same kind as the same", () => {
    const a = trace([step(0, { verdict: "error", errorClass: "config", explanation: "Syntax error at column 5." })]);
    const b = trace([step(0, { verdict: "error", errorClass: "config", explanation: "Syntax error at column 5: the engine couldn't read x." })]);
    expect(compareTraces(a, b, "v1", "v2").differences).toEqual([]);
  });

  it("notices a statement that only one version got to run", () => {
    const a = trace([step(0, { verdict: "error", errorClass: "runtime", error: "boom" })]);
    const b = trace([step(0, { verdict: "changed", display: [] }), step(1, { verdict: "no-effect" })], "{}");
    const c = compareTraces(a, b, "v0.150.0", "v0.146.0");
    expect(c.differences.map((d) => d.index)).toEqual([0, 1]);
    expect(c.differences[1].a).toEqual({ verdict: "not run", detail: "an earlier statement stopped the block" });
  });

  it("says when nothing changes", () => {
    const t = trace([step(0, { verdict: "not-matched" })], '{"a":1}');
    const c = compareTraces(t, trace([step(0, { verdict: "not-matched" })], '{ "a": 1 }'), "v1", "v2");
    expect(c.summary).toBe("Same result on v1 and v2 for this block and payload.");
    expect(c.sameOutput).toBe(true);
    expect(compareTraces(trace([]), trace([]), "v1", "v2").differences).toEqual([]);
  });

  it("describes each kind of outcome", () => {
    expect(outcomeOf(step(0, { verdict: "error", error: "x. y" })).verdict).toBe("error");
    expect(outcomeOf(step(0, { verdict: "error", errorClass: "config", explanation: "Bad. More." })).detail).toBe("Bad.");
    expect(outcomeOf(step(0, { verdict: "not-matched" })).verdict).toBe("matched nothing");
    expect(outcomeOf(step(0, { verdict: "changed", display: [{ kind: "added", label: "a", text: "1" }, { kind: "removed", label: "b", text: "2" }] })).detail).toBe("+ a = 1; − b = 2");
  });
});
