package config

import (
	"encoding/json"
	"os"
)

// SrcDir is the managed shallow clone the auto-updater builds from. It is kept
// separate from whatever directory the user originally cloned to install (which we
// don't control and they may delete), so updates are fully self-contained.
func SrcDir() (string, error) { return inDir("src") }

// InstallMetaPath records the arguments the installer was last run with, so the
// auto-updater can re-invoke install.sh identically (same api-base, shell, prefix).
func InstallMetaPath() (string, error) { return inDir("install.json") }

// UpdateStatePath holds the auto-update throttle clock + post-update render countdown.
func UpdateStatePath() (string, error) { return inDir("updates.json") }

// UpdateLockPath serializes the self-update run across concurrent shells.
func UpdateLockPath() (string, error) { return inDir("update.lock") }

// InstallMeta is written by install.sh and read by the self-updater so it can replay
// the original install (clean reinstall) without guessing the user's chosen options.
type InstallMeta struct {
	RemoteURL     string `json:"remoteURL"`     // git origin to fetch updates from (fixed at install)
	Branch        string `json:"branch"`        // tracked branch (main)
	InstallScript string `json:"installScript"` // install.sh path relative to the repo root
	APIBase       string `json:"apiBase"`       // --api-base passed to install.sh
	Shell         string `json:"shell"`         // --shell
	Prefix        string `json:"prefix"`        // --prefix (binary install dir)
}

// LoadInstallMeta returns the recorded install metadata. A missing or corrupt file
// yields a zero value (RemoteURL == "" disables auto-update), never an error that
// could brick a caller.
func LoadInstallMeta() InstallMeta {
	p, err := InstallMetaPath()
	if err != nil {
		return InstallMeta{}
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return InstallMeta{}
	}
	var m InstallMeta
	if json.Unmarshal(b, &m) != nil {
		return InstallMeta{}
	}
	return m
}

// UpdateState is the auto-update bookkeeping: when we last checked, when we last
// updated, the commit we updated to, and how many more renders should show the
// "updated" notice.
type UpdateState struct {
	LastCheckUnix int64  `json:"lastCheck"`   // throttle: when self-update was last spawned
	UpdatedAtUnix int64  `json:"updatedAt"`   // when the last successful update landed
	Commit        string `json:"commit"`      // commit we last updated to
	RendersLeft   int    `json:"rendersLeft"` // remaining prompts to show the notice
}

// LoadUpdateState returns the bookkeeping, defaulting to zero on any error so the
// prompt path is never blocked by corrupt state.
func LoadUpdateState() UpdateState {
	p, err := UpdateStatePath()
	if err != nil {
		return UpdateState{}
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return UpdateState{}
	}
	var s UpdateState
	if json.Unmarshal(b, &s) != nil {
		return UpdateState{}
	}
	return s
}

// SaveUpdateState atomically persists the bookkeeping (write .tmp, rename).
func SaveUpdateState(s UpdateState) error {
	p, err := UpdateStatePath()
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
