import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions, atLeast, normalizeVersion, closestEngine, detectCollectorVersions, BOUNDARY } from "./versions";

describe("versions", () => {
  it("parses and compares collector versions", () => {
    expect(parseVersion("v0.161.0")).toEqual([0, 161, 0]);
    expect(parseVersion("0.150")).toEqual([0, 150, 0]);
    expect(parseVersion("latest")).toBeUndefined();
    expect(compareVersions("v0.150.0", "v0.153.0")).toBeLessThan(0);
    expect(compareVersions("v0.164.1", "v0.164.0")).toBeGreaterThan(0);
    expect(compareVersions("v0.150.0", "0.150.0")).toBe(0);
    expect(compareVersions("x", "v0.1.0")).toBeLessThan(0);
    expect(compareVersions("v0.1.0", "x")).toBeGreaterThan(0);
    expect(normalizeVersion("0.150")).toBe("v0.150.0");
    expect(normalizeVersion("nope")).toBeUndefined();
  });

  it("atLeast treats unknown versions as latest", () => {
    expect(atLeast("v0.160.0", BOUNDARY.setWritesNil)).toBe(false);
    expect(atLeast("v0.161.0", BOUNDARY.setWritesNil)).toBe(true);
    expect(atLeast(undefined, BOUNDARY.setWritesNil)).toBe(true);
    expect(atLeast("main", BOUNDARY.setWritesNil)).toBe(true);
  });

  it("picks the newest engine at or below a collector version", () => {
    const engines = ["v0.164.1", "v0.140.0", "v0.153.0", "v0.161.0"];
    expect(closestEngine("v0.155.0", engines)).toBe("v0.153.0");
    expect(closestEngine("v0.161.0", engines)).toBe("v0.161.0");
    expect(closestEngine("v0.120.0", engines)).toBe("v0.140.0");
    expect(closestEngine("v0.170.0", engines)).toBe("v0.164.1");
    expect(closestEngine("latest", engines)).toBe("v0.164.1");
    expect(closestEngine("v0.150.0", [])).toBeUndefined();
  });

  it("detects contrib versions in compose files, Kubernetes, Helm, Dockerfiles and go.mod", () => {
    expect(detectCollectorVersions("services:\n  otel:\n    image: otel/opentelemetry-collector-contrib:0.150.0\n")).toEqual(["v0.150.0"]);
    expect(detectCollectorVersions("FROM ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib:0.157.1")).toEqual(["v0.157.1"]);
    expect(detectCollectorVersions("image: docker.io/otel/otelcol-contrib:v0.161.0")).toEqual(["v0.161.0"]);
    expect(detectCollectorVersions("image:\n  repository: otel/opentelemetry-collector-contrib\n  pullPolicy: IfNotPresent\n  tag: \"0.153.0\"\n")).toEqual(["v0.153.0"]);
    expect(detectCollectorVersions("require github.com/open-telemetry/opentelemetry-collector-contrib/processor/transformprocessor v0.146.0")).toEqual(["v0.146.0"]);
    // newest first, de-duplicated
    expect(detectCollectorVersions("a: otel/opentelemetry-collector-contrib:0.150.0\nb: otel/opentelemetry-collector-contrib:0.161.0\nc: otel/opentelemetry-collector-contrib:0.150.0")).toEqual(["v0.161.0", "v0.150.0"]);
    // the core distribution has no transform processor
    expect(detectCollectorVersions("image: otel/opentelemetry-collector:0.150.0")).toEqual([]);
  });
});
