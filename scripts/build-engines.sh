#!/usr/bin/env bash
# Build the OTTL engine for several collector-contrib versions.
#   - the newest version is copied to media/ottl.wasm (bundled in the extension);
#   - every version is gzipped into $OUT for the "engines" GitHub release that the
#     extension downloads from on demand; src/ottl/engines.ts pins each file's sha256.
# Requires Go (go1.26+ tested). Usage: bash scripts/build-engines.sh [OUT_DIR]
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$REPO_ROOT/../ottl-engines}"
# Boundary versions: each is the first release where a documented OTTL behaviour
# changed (see CHANGELOG / docs). The last entry is the bundled engine.
VERSIONS=(v0.140.0 v0.146.0 v0.150.0 v0.153.0 v0.157.0 v0.160.0 v0.161.0 v0.163.0 v0.164.1)
# Override for a partial rebuild: ENGINE_VERSIONS="v0.163.0 v0.164.1" bash scripts/build-engines.sh
if [ -n "${ENGINE_VERSIONS:-}" ]; then read -r -a VERSIONS <<< "$ENGINE_VERSIONS"; fi
mkdir -p "$OUT"
for V in "${VERSIONS[@]}"; do
  W="$(mktemp -d)"
  cp -R "$REPO_ROOT/wasm/." "$W/"
  ( cd "$W"
    # Fresh go.mod per version, so every dependency (pkg/ottl, collector core) resolves to
    # what that transformprocessor release itself requires. Upgrading/downgrading the
    # checked-in go.mod with `go get` keeps newer pkg/ottl and fails to compile.
    rm -f go.mod go.sum
    go mod init ottl-vscode/wasm >/dev/null 2>&1
    go get "github.com/open-telemetry/opentelemetry-collector-contrib/processor/transformprocessor@$V" >/dev/null 2>&1
    go mod tidy >/dev/null 2>&1
    GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$OUT/ottl-$V.wasm" . )
  gzip -9 -n -c "$OUT/ottl-$V.wasm" > "$OUT/ottl-$V.wasm.gz"
  echo "$V  $(wc -c < "$OUT/ottl-$V.wasm") bytes  gz $(wc -c < "$OUT/ottl-$V.wasm.gz")  sha256(gz) $(sha256sum "$OUT/ottl-$V.wasm.gz" | cut -d' ' -f1)"
  rm -rf "$W"
  [ -n "${LOW_DISK:-}" ] && go clean -cache
done
LATEST="${VERSIONS[${#VERSIONS[@]}-1]}"
cp "$OUT/ottl-$LATEST.wasm" "$REPO_ROOT/media/ottl.wasm"
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$REPO_ROOT/media/wasm_exec.js"
echo "bundled: $LATEST → media/ottl.wasm"
