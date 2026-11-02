package internal

import "go.opentelemetry.io/collector/featuregate"

// SetFeatureGate enables or disables a collector feature gate in this engine, as
// `--feature-gates=<id>` / `--feature-gates=-<id>` would on a real collector.
// Unknown gates (for example a gate newer than this engine's version) return an error.
func SetFeatureGate(id string, enabled bool) string {
	if err := featuregate.GlobalRegistry().Set(id, enabled); err != nil {
		return err.Error()
	}
	return ""
}
