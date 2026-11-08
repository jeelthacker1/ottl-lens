# Contributing to OTTL Lens

Thanks for taking a look. Bug reports, ideas and pull requests are all welcome.

Maintainer: Srikar Kompella ([@srikar-kompella](https://github.com/srikar-kompella))

## Before you start

- For a bug, open an issue with the statement, a payload and your collector version. A wrong verdict is the most useful bug you can report.
- For anything bigger than a small fix, comment on the issue first so we agree on the approach before you write code.
- Issues labelled `good first issue` are small and self-contained.

## Setup

You need Node.js 20+ and VS Code.

```bash
git clone https://github.com/srikar-kompella/ottl-lens.git
cd ottl-lens
npm install
npm run fetch:engines
npm test
```

`fetch:engines` downloads the OTTL engines from the GitHub release and checks each one against its sha256.

Press F5 in VS Code to start an Extension Development Host, then open `examples/collector.yaml`.

Go 1.26+ is only needed if you change `wasm/` or add a collector version.

## Checks to run before a pull request

```bash
npm test                  # unit tests, with a 90% coverage gate on src/ottl/
npx tsc --noEmit -p ./    # type check
npm run verify:engine     # runs the real OTTL engines
```

`verify:engine` checks the extension against the real transform processor of every supported collector version. If your change affects what the dry-run reports, add a check there.

## Where things live

| Path | What it does |
|---|---|
| `src/ottl/linter.ts`, `typecheck.ts` | Lint rules and quick fixes |
| `src/ottl/trace.ts` | Per-statement dry-run and verdicts |
| `src/ottl/explain.ts` | Turns engine errors into readable explanations |
| `src/ottl/yaml.ts` | Finds OTTL inside Collector YAML |
| `src/ottl/catalog.ts` | Generated from upstream docs by `scripts/gen-catalog.mjs`. Don't edit by hand |
| `src/ottl/engines.ts`, `versions.ts` | Supported collector versions and engine checksums |
| `src/panel/dryRunPanel.ts` | The dry-run panel |
| `wasm/` | The Go program compiled to WebAssembly |

Logic goes in `src/ottl/` as plain functions with tests. Code that talks to VS Code stays thin.

## Adding a collector version

1. Add the version to `VERSIONS` in `scripts/build-engines.sh` and run it.
2. Add the version, size and sha256 it prints to `src/ottl/engines.ts`, and to the `ottl.collectorVersion` list in `package.json`.
3. Run `npm run verify:engine`.

The engine files are published by the maintainer as a GitHub release.

## Lint rules

A noisy linter gets turned off, so new rules must not fire on valid OTTL. Test a new rule against the upstream examples in `opentelemetry-collector-contrib/processor/transformprocessor/testdata` and `filterprocessor/testdata`. Any claim about collector behaviour needs a source: a contrib file at a release tag, or a check in `verify:engine`.

## Pull requests

- One change per pull request, with tests.
- Link the issue it fixes.
- Sign off your commits (`git commit -s`). This certifies the [Developer Certificate of Origin](https://developercertificate.org/).
- By contributing, you agree your work is licensed under [Apache-2.0](LICENSE).

Merged contributions are credited in the release notes.
