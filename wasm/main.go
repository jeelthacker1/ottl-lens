//go:build js && wasm

// Build one engine:   npm run build:wasm
// Build all engines:  bash scripts/build-engines.sh   (one per supported collector version)

package main

import (
	"syscall/js"

	"ottl-vscode/wasm/internal"
)

func main() {
	js.Global().Set("ottlEval", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 3 {
			return `{"ok":false,"error":"ottlEval expects (statements, signal, payloadJSON)"}`
		}
		return internal.Eval(args[0].String(), args[1].String(), args[2].String())
	}))
	// Feature gates are collector CLI flags (--feature-gates); this lets the dry-run match
	// a collector started with them. Returns "" on success, or the registry's error.
	js.Global().Set("ottlSetFeatureGate", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 2 {
			return "ottlSetFeatureGate expects (id, enabled)"
		}
		return internal.SetFeatureGate(args[0].String(), args[1].Bool())
	}))
	// Block forever — the Go scheduler must stay alive for JS to call into it.
	<-make(chan struct{})
}
