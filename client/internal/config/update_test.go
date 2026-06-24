package config

import (
	"os"
	"testing"
)

// LoadUpdateState/SaveUpdateState round-trips through the atomic writer, and a
// missing file degrades to the zero value rather than erroring.
func TestUpdateStateRoundTrip(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	if got := LoadUpdateState(); got != (UpdateState{}) {
		t.Fatalf("missing file = %+v, want zero value", got)
	}

	want := UpdateState{LastCheckUnix: 1700, UpdatedAtUnix: 1800, Commit: "abc123", RendersLeft: 5}
	if err := SaveUpdateState(want); err != nil {
		t.Fatalf("SaveUpdateState: %v", err)
	}
	if got := LoadUpdateState(); got != want {
		t.Fatalf("round-trip = %+v, want %+v", got, want)
	}
}

// LoadInstallMeta reads what install.sh writes; a missing file yields a zero value
// (RemoteURL == "" disables auto-update).
func TestInstallMetaMissing(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	if got := LoadInstallMeta(); got != (InstallMeta{}) {
		t.Fatalf("missing file = %+v, want zero value", got)
	}
}

// Corrupt JSON must not error out — the prompt path can't be bricked by bad state.
func TestUpdateStateCorrupt(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	p, err := UpdateStatePath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := LoadUpdateState(); got != (UpdateState{}) {
		t.Fatalf("corrupt file = %+v, want zero value", got)
	}
}
