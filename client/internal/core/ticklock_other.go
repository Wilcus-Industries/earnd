//go:build !unix

package core

import (
	"os"
	"time"
)

const tickLockStale = 30 * time.Second // a lock older than this is abandoned

// tryTickLock is the non-unix fallback (no flock available): an exclusive create,
// stealing a lock that looks abandoned by mtime. This keeps a small check-then-act
// window, but a rare double-tick is harmless — the server's single-use impression
// nonce makes a duplicate redeem a no-op, so it can't double-charge or double-pay.
func tryTickLock(path string) (func(), bool) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		if info, statErr := os.Stat(path); statErr == nil && time.Since(info.ModTime()) > tickLockStale {
			_ = os.Remove(path)
			f2, err2 := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
			if err2 != nil {
				return func() {}, false
			}
			f = f2
		} else {
			return func() {}, false
		}
	}
	_ = f.Close()
	return func() { _ = os.Remove(path) }, true
}
