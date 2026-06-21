//go:build unix

package core

import (
	"os"
	"syscall"
)

// tryTickLock takes an exclusive, non-blocking flock on the lock file. flock is
// atomic — there is no stat-then-create window for two ticks to both pass — and the
// kernel releases the lock automatically when the holding process exits, so a
// crashed tick can't wedge it and no stale-mtime stealing is needed. The fd is held
// open for the duration; release unlocks and closes it.
func tryTickLock(path string) (func(), bool) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return func() {}, true // best-effort: proceed without a lock
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close() // already held by another tick
		return func() {}, false
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}, true
}
