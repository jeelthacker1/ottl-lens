import { describe, it, expect } from "vitest";
import { piiKinds, luhnValid, scanForPii, describePii } from "./redact";

describe("piiKinds", () => {
  it("detects emails, Luhn-valid cards, JWTs, bearer tokens and SSNs", () => {
    expect(piiKinds("contact jane.doe@example.com")).toEqual(["email address"]);
    expect(piiKinds("card 4111 1111 1111 1111")).toEqual(["card number"]);
    expect(piiKinds("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")).toEqual(["JWT"]);
    expect(piiKinds("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345")).toEqual(["bearer token"]);
    expect(piiKinds("ssn 123-45-6789")).toEqual(["SSN"]);
  });

  it("ignores near-misses: last-4, non-Luhn numbers, IPs, short tokens", () => {
    expect(piiKinds("4242")).toEqual([]);
    expect(piiKinds("order 1234567890123")).toEqual([]);
    expect(piiKinds("10.0.0.1")).toEqual([]);
    expect(piiKinds("Bearer short")).toEqual([]);
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
  });
});

describe("scanForPii", () => {
  const payload = (attrs: unknown[], body: string) => ({
    resourceLogs: [{ scopeLogs: [{ logRecords: [{ body: { stringValue: body }, attributes: attrs }] }] }],
  });

  it("labels findings as OTTL paths and ignores attribute names", () => {
    const p = payload([{ key: "user_email", value: { stringValue: "jane.doe@example.com" } }, { key: "jane.doe@example.com", value: { stringValue: "x" } }], "ok");
    expect(scanForPii(p)).toEqual([{ label: 'log.attributes["user_email"]', kind: "email address" }]);
  });

  it("finds PII inside a JSON-encoded body and inside nested maps", () => {
    const p = payload([{ key: "m", value: { kvlistValue: { values: [{ key: "card", value: { stringValue: "4111-1111-1111-1111" } }] } } }],
      '{"user_email":"jane.doe@example.com"}');
    expect(scanForPii(p)).toEqual([
      { label: "log.body", kind: "email address" },
      { label: 'log.attributes["m"]["card"]', kind: "card number" },
    ]);
  });

  it("reports nothing for a clean payload and dedupes repeats", () => {
    expect(scanForPii(payload([], "hello"))).toEqual([]);
    expect(scanForPii("x")).toEqual([]);
  });
});

describe("describePii", () => {
  it("summarises up to four findings", () => {
    expect(describePii([])).toBeUndefined();
    const many = Array.from({ length: 6 }, (_, i) => ({ label: `log.attributes["a${i}"]`, kind: "email address" as const }));
    expect(describePii(many)).toMatch(/Redaction check: the output still contains .*`log\.attributes\["a3"\]` \(email address\) and 2 more\./);
  });
});
