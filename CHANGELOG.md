# Changelog

## 0.4.0

### True for your collector version
- **Collector version picker.** The dry-run can now run on the OTTL engine of 9 collector versions — v0.140.0, v0.146.0, v0.150.0, v0.153.0, v0.157.0, v0.160.0, v0.161.0, v0.163.0, v0.164.1 — the releases where a documented OTTL behaviour changed. Each is the real transform processor at that release, compiled to WebAssembly.
- **The bundled engine is now v0.164.1** (OTTL 1.x stable). Earlier releases bundled v0.146.0.
- **Found in your workspace.** If a compose file, Helm values, Kubernetes manifest, Dockerfile or `go.mod` pins `opentelemetry-collector-contrib`, the panel preselects the closest engine and says where it found the version. Override it with the `ottl.collectorVersion` setting.
- **Downloads only when you ask.** Non-bundled engines (about 5 MB each) download once from this extension's GitHub release after you agree. Each is checked against a sha256 built into the extension before it runs, and is cached. Nothing else goes over the network.

### Upgrade check
**Compare with** runs the same block and payload on a second version and lists every statement whose result changes between the two.

### Correctness: `set()` with a missing value now overwrites
Since collector v0.161, `set(target, value)` writes `nil` as an **empty value**. So `set(log.attributes["user"], log.attributes["missing"])` no longer does nothing: it **overwrites `user` with an empty value**. 0.3.0 reported this as "no effect". Verified on engines at v0.160 and v0.161.
- On v0.161+ the step is marked **⚠ wrote an empty value** in the panel and in the editor, with a suggested guard: `where log.attributes["missing"] != nil`.
- On older versions, the "no effect" hint now names the v0.161 change.

### More version-accurate hints
- **Failed conversions.** `Int(log.attributes["s"])` with a non-numeric value returns nil up to v0.159 and is a run-time error from v0.160 (#50564).
- **`trace_id` hint.** Shown only where it applies: up to v0.149. From v0.150 the trace shows the real run-time error.
- **Functions newer than an engine.** These are named with the version you need, for example: "`clear` … added after v0.157.0 … pick collector version v0.160.0 or newer".
- **Missing `error_mode`.** When the block doesn't set it, the panel names the picked version's default.

### Experimental lambdas run
Add `ottl.functions.enableLambda` to the new `ottl.dryRun.featureGates` setting, the same way you'd pass `--feature-gates`. `Filter`, `MapEach`, `Reduce` and the other lambda functions then execute on v0.157+ engines. Without the gate, the panel explains how to enable it.

### Lint
- **List arguments.** A plain value where a function takes a list is an error the collector rejects at startup, for example `keep_keys(log.attributes, "http.method")` or `Concat("a", "-")`. The quick fix wraps it: `["http.method"]`. Confirmed on the real engines.
- **Transform and filter processor functions are no longer "unknown".** This was a false positive in 0.3.0 and covers:
  - `convert_gauge_to_sum`, `convert_sum_to_gauge`, `extract_count_metric` and the other metric functions
  - `copy_metric`, `scale_metric`, `aggregate_on_attributes`
  - `ParseCEF`, `ParseCLF`, `ParseELF`, `ParseLEEF`
  - `set_semconv_span_name`
  - `HasAttrOnDatapoint`, `HasAttrKeyOnDatapoint`

  They're documented in hover and autocomplete as processor-only.
- **`flatten_data`.** Deprecated since v0.164.0; the quick fix replaces it with `flatten: { log: true }`. Setting both is flagged as the config error it is.

### Under the hood
- **Engine runner.** It now forces `error_mode: propagate` so that every runtime error reaches the trace. The processor default became `ignore` in v0.153 and would hide them; `ignore` and `silent` are simulated by the trace, as before.
- **New syntax-error format.** Parse errors from v0.163+ (`1:25: … near \`…\``) are explained like the old format.
- **Catalog.** Regenerated from contrib v0.164.1, with per-version function history.

## 0.3.0

### Results where you work
- **▶ Dry-run** buttons above every runnable transform block in Collector YAML, and at the top of `.ottl` files. Clicking one opens the panel and runs that block. Can be turned off with `ottl.codeLens.enabled`.
- After a run, each statement's verdict appears **at the end of its line**. Examples: `✓ changed  + log.attributes["env"] = "production"`, `⚠ no effect`, `○ matched nothing`, `✗ <explanation>`. Hover a verdict for the full detail. Verdicts clear when you edit the file, or with **OTTL: Clear Inline Verdicts**.

### "Can never match" checks
New warnings for OTTL that is valid but can't work, using the field types from the upstream context docs:
- A typed field compared with a string: `metric.type == "Sum"`, `span.trace_id == "0102…"`, `log.severity_number == "9"`. `==` is never true; `!=` is always true.
- A string assigned to a typed field: `set(span.trace_id, "<hex>")` (ignored up to v0.149, a run-time error from v0.150) and `set(log.severity_number, "INFO")` (ignored up to v0.140, an error from v0.141).

The trace uses the same check. A guard like that now gets "This where clause can never match any payload", instead of "matched nothing".

### Quick fixes
One-click fixes for:
- `"Sum"` → `METRIC_DATA_TYPE_SUM` (and the `span.kind`, `span.status.code`, `log.severity_number` and aggregation-temporality enums)
- `span.trace_id` → `span.trace_id.string`
- `"9"` → `9`
- path typos (`log.atributes` → `log.attributes`)
- mis-cased functions (`parsejson` → `ParseJSON`)
- `Base64Decode(x)` → `Decode(x, "base64")`

Every fix was applied and re-run against the bundled engine to confirm the fixed statement works.

### Redaction check
After a run, the panel lists values in the output that still look like personal data or credentials:
- emails
- Luhn-valid card numbers
- JWTs
- bearer tokens
- US SSN format

For example, an email you deleted from the attributes but that is still inside `log.body`. IP addresses are deliberately not flagged.

### Corrected wording
- **`propagate`:** now says the whole **batch** is dropped, not the record.
- **`trace_id` hint:** states the version boundary. It is silent up to v0.149 (including the bundled v0.146.0 engine). From v0.150 it errors: logged under `ignore`, the batch is dropped under `propagate`, and nothing is visible under `silent`.
- **Converter-returned-nil hint:** silent up to v0.157; by v0.161 it is an error.

These were checked against a cross-version harness (v0.140 / v0.150 / v0.157 / v0.161).

### Fixes
- **Squiggles in quoted YAML values** (`- 'set(…)'`) were one character to the left. Positions now point at the OTTL text, not the quote.
- **The catalog now tracks the latest collector release (v0.162.0)** rather than `main`, so hover never shows unreleased changes.

## 0.2.1

Correctness release.

### `error_mode` now follows your config and your collector version
0.2.0 called `propagate` "the default". That was true only for older collectors: the transform processor's default is **`propagate` up to v0.152 and `ignore` from v0.153** (feature gate `processor.transform.defaultErrorModeIgnore`: beta in v0.153, stable in v0.158, removed in v0.162 — checked in the contrib source for each version).

- The dry-run reads `error_mode` from the block under your cursor (a statement group's own setting overrides the processor's), and the panel shows "from your config".
- If the block doesn't set it, the dry-run uses `ignore` and tells you the default depends on your collector version.
- An invalid value (`error_mode: ingore`) is reported: the collector would reject the config.

### Experimental lambda functions
`All`, `Any`, `Filter`, `Find`, `MapEach`, `MapKeys`, `Reduce` and `When` (moved to `pkg/ottl/xottl` upstream on 2026-09-28) are no longer flagged as unknown.
- A note says they need the `ottl.functions.enableLambda` feature gate (alpha since v0.155.0, off by default) — without it the collector rejects the config.
- Hover and autocomplete document them.
- The lambda arrow `=>` is no longer reported as a single `=`.
- The bundled engine (v0.146.0) can't run them; the dry-run now says exactly that instead of a lexer error.

### Clearer syntax errors
Engine syntax errors now point at the column and text that couldn't be read.

### Catalog
Regenerated from contrib `main` (2026-09-29), plus the experimental function reference and the OTTL feature-gate table.

## 0.2.0

### Per-statement trace
The dry-run now runs your statements one at a time and reports what each one did:

- **changed** — with a diff in OTTL terms: `+ log.attributes["env"] = "production"`. Type changes are named: `200 → "200" (int → string)`. With several records, each change says which one (`log #2`).
- **no effect** — ran without error, changed nothing. Known traps get a specific hint; each was reproduced on the bundled engine: `set(metric.type, …)` (use `convert_gauge_to_sum()`), `span.trace_id` without `.string`, and a converter returning nil (`Int("abc")`).
- **matched nothing** — the `where` guard excluded every record (decided by re-running the statement without its guard).
- **error** — explained in plain language, with the right consequence: a config error means the collector won't start; a runtime error depends on `error_mode`.

Diffs are taken against the engine's own normalized form of the input, so no statement is blamed for the engine's normalization (it adds an empty `status` to spans that had none).

### `error_mode` that changes the result
`propagate` (the default) stops the trace at a runtime error — the record would be dropped. `ignore` and `silent` continue past the failed statement, as a collector would.

### Paste what you already have
The payload box accepts OTLP JSON, JSON Lines from the file exporter, or raw `debug` exporter output (`verbosity: detailed`), including zap, docker-compose and JSON-logging wrappers. The signal is detected from the content. **Open file…** loads the same formats from disk.

### Samples
Nine realistic payloads: a k8s log with a JSON body and PII, health-check noise, an errored HTTP span with an exception event, a SQL client span with an email in the query, a gauge, a counter with a high-cardinality attribute, and a latency histogram.

### Hover docs and autocomplete
- Hover functions, paths and enums for signatures, descriptions, examples, types and a link to the upstream reference.
- Autocomplete functions (with argument placeholders; editors only at statement start), context fields after `log.` / `span.` / `metric.` / `datapoint.` / `resource.`, enums and keywords. Works in `.ottl` files and on OTTL lines in Collector YAML, even while the YAML is half-typed.

### Errors you can act on
`log.atributes` → *did you mean `log.attributes`?* · `parsejson` → *did you mean `ParseJSON`?* · `attributes["x"]` → *needs its context prefix* · functions newer than the bundled engine are identified as such instead of surfacing as a context-inference error.

### Version-aware catalog
The catalog is regenerated from upstream `main` and now includes context paths and enums. It is the union of the latest reference and the engine's version (contrib v0.146.0):
- `clear`, `IsEmpty`, `Coalesce`, `stringify_all`, `Base64Encode` are no longer flagged as unknown (false positives in 0.1.1).
- `Base64Decode`, removed upstream, gets an informational hint to use `Decode(value, "base64")`.
- `ProfileID` (profiles) is recognised.

### Fixes
- The panel no longer replaces a pasted payload when you move the cursor in your YAML.
- Layout: in a narrow side panel the payload and results stack instead of squeezing the results off-screen, and the results scroll into view after a run.

## 0.1.1

Collector-YAML-aware linting, offline dry-run with the real upstream OTTL engine (Go → WebAssembly), syntax highlighting, and an auto-generated function catalog with "did you mean" suggestions.
