// Package config manages earnd client local state: the on/off toggle, cache
// locations, and the per-install device identity path. State lives under the
// user's config dir so the toggle persists across shells.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// State is the persisted, cross-shell client state.
type State struct {
	// Enabled is the master on/off toggle. When false the banner never draws.
	Enabled bool `json:"enabled"`
}

// Dir returns the earnd config directory ($XDG_CONFIG_HOME/earnd or ~/.config/earnd),
// creating it if needed.
func Dir() (string, error) {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".config")
	}
	dir := filepath.Join(base, "earnd")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

func statePath() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "state.json"), nil
}

// CreativeCachePath is where the most recent fetched creative is cached so the
// prompt hot-path never blocks on the network.
func CreativeCachePath() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "creative.json"), nil
}

// OfflineFlagPath holds the cached online/offline result written by the background probe.
func OfflineFlagPath() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "online.flag"), nil
}

// KeyPath is the per-install Ed25519 private key (mode 0600).
func KeyPath() (string, error) { return inDir("device.key") }

// IdentityPath stores the registered device + publisher ids and public key.
func IdentityPath() (string, error) { return inDir("device.json") }

// SessionPath holds the in-flight impression session (token, dwell clock).
func SessionPath() (string, error) { return inDir("session.json") }

// TickLockPath serializes background ticks so concurrent prompts don't stampede.
func TickLockPath() (string, error) { return inDir("tick.lock") }

func inDir(name string) (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, name), nil
}

// APIBase is the earnd server origin the client talks to. Overridable via
// EARND_API_BASE (set by install.sh); defaults to local dev.
func APIBase() string {
	if v := os.Getenv("EARND_API_BASE"); v != "" {
		return v
	}
	return "http://localhost:3000"
}

// Load reads state, defaulting to enabled when no state file exists yet.
func Load() (State, error) {
	p, err := statePath()
	if err != nil {
		return State{}, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return State{Enabled: true}, nil
		}
		return State{}, err
	}
	var s State
	if err := json.Unmarshal(b, &s); err != nil {
		// Corrupt state should not brick the prompt; default to enabled.
		return State{Enabled: true}, nil
	}
	return s, nil
}

// Save atomically writes state.
func Save(s State) error {
	p, err := statePath()
	if err != nil {
		return err
	}
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// SetEnabled flips the toggle and persists it.
func SetEnabled(enabled bool) error {
	s, err := Load()
	if err != nil {
		s = State{}
	}
	s.Enabled = enabled
	return Save(s)
}
