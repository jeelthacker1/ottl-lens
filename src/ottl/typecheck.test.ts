import { describe, it, expect } from "vitest";
import { checkTypes, neverMatchReason, enumFor, pathType } from "./typecheck";

// Probe statements are verbatim from the trade-publications harness (ottl-silence-matrix).
describe("checkTypes — comparisons that can never match (harness A2/A4/A6)", () => {
  it("A2: metric.type (int64 enum) vs a string, with the enum as the fix", () => {
    const s = 'set(metric.description, "x") where metric.type == "Sum"';
    const [i] = checkTypes(s);
    expect(i.code).toBe("ottl.neverMatches");
    expect(i.message).toBe('metric.type is an int64, not a string, so == "Sum" can never match. Use METRIC_DATA_TYPE_SUM.');
    expect(s.slice(0, i.fix!.start) + i.fix!.replacement + s.slice(i.fix!.end)).toBe(
      'set(metric.description, "x") where metric.type == METRIC_DATA_TYPE_SUM'
    );
  });

  it("A4: span.trace_id (TraceID) vs a string, with .string as the fix", () => {
    const s = 'set(span.name, "x") where span.trace_id == "0102030405060708090a0b0c0d0e0f10"';
    const [i] = checkTypes(s);
    expect(i.message).toMatch(/span\.trace_id is a pcommon\.TraceID \(bytes\), not a string, so == .* can never match\. Use span\.trace_id\.string\./);
    expect(s.slice(0, i.fix!.start) + i.fix!.replacement + s.slice(i.fix!.end)).toBe(
      'set(span.name, "x") where span.trace_id.string == "0102030405060708090a0b0c0d0e0f10"'
    );
  });

  it("A6: log.severity_number vs a numeric string, with the number as the fix", () => {
    const s = 'set(log.body, "x") where log.severity_number == "9"';
    const [i] = checkTypes(s);
    expect(i.fix).toMatchObject({ title: "Use the number 9", replacement: "9" });
  });

  it("controls A3/A5/A7 are clean", () => {
    expect(checkTypes('set(metric.description, "x") where metric.type == METRIC_DATA_TYPE_SUM')).toEqual([]);
    expect(checkTypes('set(span.name, "x") where span.trace_id.string == "0102030405060708090a0b0c0d0e0f10"')).toEqual([]);
    expect(checkTypes('set(log.body, "x") where log.severity_number == 9')).toEqual([]);
  });

  it("handles the literal on the left and != (always true)", () => {
    const [i] = checkTypes('set(log.body, "x") where "INFO" != log.severity_number');
    expect(i.message).toMatch(/!= "INFO" is always true\. Use SEVERITY_NUMBER_INFO\./);
  });

  it("maps enum names for span.kind, status code and a literal enum name", () => {
    expect(enumFor("span.kind", "Server")).toBe("SPAN_KIND_SERVER");
    expect(enumFor("span.status.code", "Error")).toBe("STATUS_CODE_ERROR");
    expect(enumFor("metric.type", "ExponentialHistogram")).toBe("METRIC_DATA_TYPE_EXPONENTIAL_HISTOGRAM");
    expect(enumFor("metric.type", "Empty")).toBe("METRIC_DATA_TYPE_NONE");
    expect(enumFor("log.severity_number", "warning")).toBe("SEVERITY_NUMBER_WARN");
    expect(enumFor("metric.type", "METRIC_DATA_TYPE_SUM")).toBe("METRIC_DATA_TYPE_SUM");
    expect(enumFor("metric.type", "Banana")).toBeUndefined();
    expect(enumFor("span.name", "x")).toBeUndefined();
  });

  it("offers no fix when nothing obvious applies, and handles bools and times", () => {
    expect(checkTypes('set(log.body, "x") where log.severity_number == "loud"')[0].fix).toBeUndefined();
    expect(checkTypes('set(log.body, "x") where metric.is_monotonic == "true"')[0].fix).toMatchObject({ replacement: "true" });
    expect(checkTypes('set(log.body, "x") where log.time == "2026-01-01"')[0].message).toMatch(/log\.time is a time\.Time/);
  });

  it("ignores string-typed fields, attributes, and paths inside string literals", () => {
    expect(checkTypes('set(log.body, "x") where log.severity_text == "INFO"')).toEqual([]);
    expect(checkTypes('set(log.body, "x") where log.attributes["code"] == "500"')).toEqual([]);
    expect(checkTypes('set(log.body, "log.severity_number == \\"9\\"")')).toEqual([]);
  });
});

describe("checkTypes — string assignments to typed fields (harness C1/C2)", () => {
  it("C1: set(span.trace_id, hex) with version facts and a .string fix", () => {
    const s = 'set(span.trace_id, "0102030405060708090a0b0c0d0e0f10")';
    const [i] = checkTypes(s);
    expect(i.code).toBe("ottl.typeMismatchSet");
    expect(i.message).toMatch(/up to v0\.149 silently ignore the assignment; from v0\.150 it fails at run time/);
    expect(s.slice(0, i.fix!.start) + i.fix!.replacement + s.slice(i.fix!.end)).toBe(
      'set(span.trace_id.string, "0102030405060708090a0b0c0d0e0f10")'
    );
  });

  it("C2: set(log.severity_number, \"INFO\") with version facts and the enum fix", () => {
    const [i] = checkTypes('set(log.severity_number, "INFO")');
    expect(i.message).toMatch(/up to v0\.140 silently ignore the assignment; from v0\.141 it fails at run time/);
    expect(i.fix).toMatchObject({ replacement: "SEVERITY_NUMBER_INFO" });
  });

  it("uses a generic version note for other typed fields", () => {
    expect(checkTypes('set(span.kind, "Server")')[0].message).toMatch(/silently ignored or fails at run time\. Use SPAN_KIND_SERVER\./);
  });

  it("accepts correct assignments", () => {
    expect(checkTypes('set(span.trace_id.string, "0102030405060708090a0b0c0d0e0f10")')).toEqual([]);
    expect(checkTypes("set(log.severity_number, SEVERITY_NUMBER_INFO)")).toEqual([]);
    expect(checkTypes('set(log.severity_text, "INFO")')).toEqual([]);
  });
});

describe("neverMatchReason / pathType", () => {
  it("explains a never-matching guard and ignores the statement body", () => {
    expect(neverMatchReason('set(log.body, "x") where log.severity_number == "9"')).toMatch(/can never match/);
    expect(neverMatchReason('set(log.severity_number, "INFO")')).toBeUndefined();
    expect(neverMatchReason('set(log.body, "x") where log.severity_number == 9')).toBeUndefined();
  });
  it("reads types from the catalog", () => {
    expect(pathType("span.trace_id")).toBe("pcommon.TraceID");
    expect(pathType("nope")).toBeUndefined();
  });
});
