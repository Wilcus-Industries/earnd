package core

// Auto-update: keep the installed binary current with origin/main.
//
// No daemon and no new timer. Every prompt spawns a background tick; once a tick
// confirms the client is online it calls maybeSpawnUpdate, which is throttled to once
// per updateInterval via a timestamp in updates.json. When due it spawns a detached
// `earnd self-update` so the (potentially slow) git + rebuild never touches the
// impression cycle. self-update fetches origin/main into a managed shallow clone,
// and if its HEAD differs from the commit this binary was built from, resets to it
// and re-runs install.sh — a clean reinstall that rebuilds the binary embedding the
// new commit, refreshes the shim, and re-registers (all idempotent).
//
// Security: this fetches and executes code unattended. That is inherent to git-based
// auto-update. The remote URL is fixed at install time (from the original clone's
// origin, recorded in install.json) and is never taken from runtime input. If git or
// go is absent, or no remote was recorded, every step no-ops cleanly.

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/earnd/client/internal/config"
)

const (
	// updateInterval throttles how often a tick may spawn self-update.
	updateInterval = 5 * time.Minute
	// gitTimeout bounds each git/network step so a hung remote can't wedge the updater.
	gitTimeout = 60 * time.Second
	// updateNoticeRenders is how many prompts show the "updated" banner notice.
	updateNoticeRenders = 5
)

// maybeSpawnUpdate spawns a detached self-update at most once per updateInterval.
// It records the attempt timestamp BEFORE spawning (and even if the spawn fails) so a
// failing update can't busy-loop git every prompt. Cheap: one file read + one write.
func maybeSpawnUpdate() {
	st := config.LoadUpdateState()
	now := time.Now().Unix()
	if now-st.LastCheckUnix < int64(updateInterval.Seconds()) {
		return // checked recently; nothing to do
	}
	st.LastCheckUnix = now
	_ = config.SaveUpdateState(st)

	exe, err := os.Executable()
	if err != nil {
		return
	}
	cmd := exec.Command(exe, "self-update")
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	_ = cmd.Start() // fire-and-forget; the child does the work and exits
}

// SelfUpdate performs one update attempt. It is safe to call concurrently from
// multiple shells: an exclusive lock ensures only one runs at a time, and every
// failure path is a silent no-op (the prompt must never break from an update).
func SelfUpdate() {
	lockPath, err := config.UpdateLockPath()
	if err != nil {
		return
	}
	release, ok := tryTickLock(lockPath)
	if !ok {
		return // another self-update is already running
	}
	defer release()

	meta := config.LoadInstallMeta()
	if meta.RemoteURL == "" {
		return // no recorded remote → auto-update disabled
	}
	if !haveCmd("git") || !haveCmd("go") {
		return // toolchain absent → can't update; leave the working binary alone
	}
	branch := meta.Branch
	if branch == "" {
		branch = "main"
	}

	src, err := config.SrcDir()
	if err != nil {
		return
	}

	// Ensure the managed clone exists and points at the latest branch tip.
	if _, statErr := os.Stat(src + "/.git"); statErr != nil {
		// Remove any partial leftover, then shallow-clone fresh.
		_ = os.RemoveAll(src)
		if !git(src, false, "clone", "--depth", "1", "--branch", branch, meta.RemoteURL, src) {
			return
		}
	} else if !git(src, true, "fetch", "--depth", "1", "origin", branch) {
		return
	}

	remote, ok := gitOut(src, "rev-parse", "origin/"+branch)
	if !ok || remote == "" {
		return
	}
	if remote == BuildCommit {
		return // already current
	}

	// Move the clone to the new tip, then clean reinstall from it.
	if !git(src, true, "reset", "--hard", "origin/"+branch) {
		return
	}
	if !runInstall(src, meta) {
		return // reinstall failed; keep the old (working) binary, retry next interval
	}

	st := config.LoadUpdateState()
	st.UpdatedAtUnix = time.Now().Unix()
	st.Commit = remote
	st.RendersLeft = updateNoticeRenders
	_ = config.SaveUpdateState(st)
}

// runInstall re-runs the installer from the freshly-updated clone with the original
// install arguments, so the rebuild embeds the new commit and the shim/rc/registration
// are refreshed. Output is discarded; success is the process exit code.
func runInstall(src string, meta config.InstallMeta) bool {
	rel := meta.InstallScript
	if rel == "" {
		rel = "install.sh" // back-compat: assume repo-root install.sh
	}
	script := filepath.Join(src, rel)
	args := []string{script}
	if meta.APIBase != "" {
		args = append(args, "--api-base", meta.APIBase)
	}
	if meta.Shell != "" {
		args = append(args, "--shell", meta.Shell)
	}
	if meta.Prefix != "" {
		args = append(args, "--prefix", meta.Prefix)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "bash", args...)
	cmd.Dir = filepath.Dir(script)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	return cmd.Run() == nil
}

// git runs a git command with a bounded timeout, no shell. When inDir is true the
// command runs against the existing repo via `-C src`; for `clone` (inDir false) the
// destination is an explicit positional arg instead. Returns true on exit code 0.
func git(src string, inDir bool, args ...string) bool {
	full := args
	if inDir {
		full = append([]string{"-C", src}, args...)
	}
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", full...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	return cmd.Run() == nil
}

// gitOut runs `git -C src <args>` and returns trimmed stdout, ok=false on failure.
func gitOut(src string, args ...string) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", src}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(string(out)), true
}

// haveCmd reports whether name resolves on PATH.
func haveCmd(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
