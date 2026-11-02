import { describe, it, expect } from "vitest";
import { classifyError, explainEngineError, editDistance, segmentsAfter, suggestSegment, unqualifiedPath, functionsIn, unavailableReason } from "./explain";

// Messages below are verbatim from the real engine (contrib v0.146.0).
const UNKNOWN_NEWER =
  'OTTL parse error: unable to infer a valid context (["resource" "scope" "log"]) from statements ["clear(log.attributes)"] and conditions []: inferred context "log" does not support the function "clear"';
const BAD_PATH =
  'OTTL parse error: unable to parse OTTL statement "set(log.atributes[\\"a\\"], \\"1\\")": error while parsing arguments for call to "set": invalid argument at position 0: segment "atributes" from path "log.atributes[a]" is not a valid path nor a valid OTTL keyword for the Log context';
const NO_PATH =
  'OTTL parse error: unable to infer context from statements ["resource" "scope" "metric" "datapoint"] and conditions ["convert_gauge_to_sum(\\"cumulative\\", true)"], path\'s first segment must be a valid context name [], and at least one context must be capable of parsing all statements';

describe("classifyError", () => {
  it("separates config, payload and runtime errors", () => {
    expect(classifyError(UNKNOWN_NEWER)).toBe("config");
    expect(classifyError("invalid OTLP logs JSON: unexpected EOF")).toBe("payload");
    expect(classifyError("payload is empty")).toBe("payload");
    expect(classifyError("failed to execute statement: something at runtime")).toBe("runtime");
  });
});

describe("explainEngineError", () => {
  it("explains a function that is newer than the bundled engine", () => {
    // clear first appears in the v0.160.0 engine; the one before it in the history is v0.157.0.
    expect(explainEngineError(UNKNOWN_NEWER, "", "v0.146.0")).toBe(
      "`clear` is a real OTTL function, but it was added after v0.157.0, so the v0.146.0 engine doesn't have it. Pick collector version v0.160.0 or newer to run it.");
    // The same message on an engine that has clear is a context problem, not an age problem.
    expect(explainEngineError(UNKNOWN_NEWER, "", "v0.164.1")).toMatch(/can't be used in this context/);
  });

  it("suggests the right casing for a mis-cased function", () => {
    const msg = UNKNOWN_NEWER.replace(/"clear"$/, '"parsejson"');
    expect(explainEngineError(msg)).toMatch(/Did you mean `ParseJSON`\?/);
  });

  it("says plainly when a function doesn't exist", () => {
    expect(explainEngineError(UNKNOWN_NEWER.replace(/"clear"$/, '"frobnicate"'))).toBe("There is no OTTL function `frobnicate`.");
  });

  it("handles a known function that is not allowed in this context", () => {
    expect(explainEngineError(UNKNOWN_NEWER.replace(/"clear"$/, '"set"'))).toMatch(/can't be used in this context/);
  });

  it("mentions the feature gate for an experimental function the engine lacks", () => {
    expect(explainEngineError(UNKNOWN_NEWER.replace(/"clear"$/, '"Filter"'), "", "v0.146.0")).toMatch(/Pick collector version v0\.157\.0 or newer.*experimental: Collectors need `--feature-gates=ottl\.functions\.enableLambda`/);
  });

  it("explains the v0.155+ feature-gate rejection and how to enable it in the dry-run", () => {
    const msg = 'OTTL parse error: unable to parse OTTL statement "x": error while parsing arguments for call to "set": invalid argument at position 1: function "Filter" is experimental and requires the `ottl.functions.enableLambda` feature gate to be enabled';
    expect(explainEngineError(msg)).toBe("`Filter` is experimental. Collectors need `--feature-gates=ottl.functions.enableLambda` to run it. To run it in the dry-run too, add `ottl.functions.enableLambda` to the `ottl.dryRun.featureGates` setting.");
  });

  it("explains a plain value where a list is required (verbatim v0.164.1 message)", () => {
    const msg = 'OTTL parse error: unable to parse OTTL statement "keep_keys(log.attributes, \\"http.method\\")": 1:27: statement failed to parse near `"http.meth`: error while parsing arguments for call to "keep_keys": invalid argument at position 1: must be a list of type StringGetter[*ottllog.TransformContext]';
    expect(explainEngineError(msg)).toMatch(/^`keep_keys` expects a list here — wrap the value in brackets/);
  });

  it("reads the v0.163+ syntax-error format", () => {
    const msg = 'OTTL parse error: unable to infer a valid context (["resource" "scope" "log"]) from statements ["set(log.attributes[\\"x\\"] \\"y\\")"] and conditions []: 1:25: statement has invalid syntax near `"y")`: (expected ")" Key*)';
    expect(explainEngineError(msg, 'set(log.attributes["x"] "y")')).toBe("Syntax error at column 25: the engine couldn't read `\"y\")`.");
  });

  it("unavailableReason knows additions and removals per engine", () => {
    expect(unavailableReason("IsEmpty", "v0.153.0")).toMatch(/Pick collector version v0\.157\.0 or newer/);
    expect(unavailableReason("IsEmpty", "v0.157.0")).toBeUndefined();
    expect(unavailableReason("Base64Decode", "v0.161.0")).toMatch(/removed in v0\.161\.0; use `Decode\(value, "base64"\)` instead/);
    expect(unavailableReason("Base64Decode", "v0.157.0")).toBeUndefined();
    expect(unavailableReason("set", "v0.140.0")).toBeUndefined();
  });

  it("explains a lambda the bundled engine can't lex (verbatim engine message)", () => {
    const stmt = 'set(log.attributes["t"], Filter(log.attributes, (k, _) => k == "environment"))';
    const msg = 'OTTL parse error: unable to infer a valid context (["resource" "scope" "log"]) from statements ["set(log.attributes[\\"t\\"], Filter(log.attributes, (k, _) => k == \\"environment\\"))"] and conditions []: statement has invalid syntax: 1:53: lexer: invalid input text "_) => k == \\"envi..."';
    expect(explainEngineError(msg, stmt, "v0.146.0")).toMatch(/^`Filter` is a real OTTL function, but it was added after v0\.153\.0, so the v0\.146\.0 engine doesn't have it/);
    expect(explainEngineError(msg, stmt, "v0.146.0")).toMatch(/ottl\.functions\.enableLambda/);
  });

  it("explains lambda syntax without a known newer function", () => {
    const msg = "OTTL parse error: x: statement has invalid syntax: 1:30: lexer: invalid input text \"_) => v\"";
    expect(explainEngineError(msg, "set(log.body, Mystery(x, (_, v) => v))", "v0.146.0")).toBe("The v0.146.0 engine can't parse lambda syntax (`=>`) here.");
    expect(explainEngineError(msg, "set(log.body, Filter(x, v => v))")).toMatch(/lambdas take exactly two parameters/);
  });

  it("points at the column and text for an ordinary syntax error", () => {
    const msg = 'OTTL parse error: x: statement has invalid syntax: 1:15: lexer: invalid input text "@@ oops"';
    expect(explainEngineError(msg, "set(log.body, @@ oops)")).toBe("Syntax error at column 15: the engine couldn't read `@@ oops`.");
    expect(explainEngineError("OTTL parse error: statement has invalid syntax: 1:5: unexpected token", "set((log.body")).toMatch(/Syntax error at column 5/);
  });

  it("lists the functions a statement calls, ignoring strings", () => {
    expect(functionsIn('set(log.body, Concat(["Filter(", x], ""))')).toEqual(["set", "Concat"]);
  });

  it("recognises the undefined-function wording too", () => {
    expect(explainEngineError('undefined function "IsEmpty"', "", "v0.150.0")).toMatch(/added after v0\.153\.0/);
  });

  it("suggests the closest valid path for a typo", () => {
    expect(explainEngineError(BAD_PATH)).toBe("`log.atributes` isn't a valid path. Did you mean `log.attributes`?");
  });

  it("lists valid fields when no suggestion is close enough", () => {
    const msg = BAD_PATH.replace(/atributes/g, "zzzzzzzzzz");
    expect(explainEngineError(msg)).toMatch(/valid fields after `log\.` include/);
  });

  it("explains a statement with no path (context can't be inferred)", () => {
    expect(explainEngineError(NO_PATH, 'convert_gauge_to_sum("cumulative", true)')).toMatch(/doesn't reference any path/);
  });

  it("tells an unprefixed path apart from no path, though the engine message is identical", () => {
    // Verbatim: the engine emits this exact message for `set(attributes["a"], "1")`.
    const same = 'OTTL parse error: unable to infer context from statements ["scope" "log" "resource"] and conditions ["set(attributes[\\"a\\"], \\"1\\")"], path\'s first segment must be a valid context name [], and at least one context must be capable of parsing all statements';
    expect(explainEngineError(same, 'set(attributes["a"], "1")')).toMatch(/`attributes` needs its context prefix — write `log\.attributes`/);
  });

  it("explains a mis-cased converter from its dedicated message", () => {
    const msg = "OTTL parse error: unable to infer a valid context (…) and conditions []: converter names must start with an uppercase letter but got 'parsejson'";
    expect(explainEngineError(msg)).toBe("Converter names start with an uppercase letter. Did you mean `ParseJSON`?");
    expect(explainEngineError(msg.replace("parsejson", "frob"))).toMatch(/no converter called `frob`/);
  });

  it("falls back to general context advice for other inference failures", () => {
    expect(explainEngineError("OTTL parse error: unable to infer a valid context (x)", "set(log.body, 1)")).toMatch(/couldn't infer which context/);
  });

  it("finds unqualified paths but ignores strings, calls and qualified paths", () => {
    expect(unqualifiedPath('set(attributes["a"], "1")')).toBe("attributes");
    expect(unqualifiedPath('set(log.attributes["a"], "x.y[1]")')).toBeUndefined();
    expect(unqualifiedPath("set(log.body, body.string)")).toBe("body");
    expect(unqualifiedPath('convert_gauge_to_sum("cumulative", true)')).toBeUndefined();
  });

  it("explains an invalid payload and returns undefined for anything else", () => {
    expect(explainEngineError("invalid OTLP traces JSON: bad")).toMatch(/Fix the payload/);
    expect(explainEngineError("something unexpected")).toBeUndefined();
  });
});

describe("path helpers", () => {
  it("lists the segments after a context", () => {
    const segs = segmentsAfter("log");
    for (const s of ["attributes", "body", "severity_number", "trace_id"]) expect(segs).toContain(s);
    expect(segmentsAfter("log.trace_id")).toEqual(["string"]);
  });

  it("suggests only plausible typo fixes", () => {
    expect(suggestSegment("span", "nmae")).toBe("name");
    expect(suggestSegment("log", "severity_numbr")).toBe("severity_number");
    expect(suggestSegment("log", "xyz")).toBeUndefined();
  });

  it("computes edit distance with an early exit", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("nmae", "name")).toBe(1); // adjacent swap counts once
    expect(editDistance("a", "abcdefgh", 3)).toBe(4);
    expect(editDistance("abc", "xyzabc", 2)).toBe(3);
  });
});
