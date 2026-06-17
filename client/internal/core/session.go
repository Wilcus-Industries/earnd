package core

import (
	"context"
	"encoding/json"
	"os"
	"runtime"
	"time"

	"github.com/earnd/client/internal/auth"
	"github.com/earnd/client/internal/config"
)

// OnlineTTL bounds how long a cached probe result is trusted. The render hot path
// and the tick share it so "fresh probe" means the same thing on both sides.
const OnlineTTL = 90 * time.Second

const (
	tokenMaxAgeSeconds = 110              // server token TTL is 120s; rotate before it expires
	tickLockStale      = 30 * time.Second // a lock older than this is abandoned
)

// Session is the in-flight impression: the signed token plus the client-side
// dwell clock (seconds the banner has been shown since the token was issued).
type Session struct {
	Token           string `json:"token"`
	IssuedAtUnix    int64  `json:"issuedAt"`
	MinDwellSeconds int    `json:"minDwell"`
	Redeemed        bool   `json:"redeemed"`
	Surface         string `json:"surface"`
}

// Tick advances the server-authoritative impression session by exactly one step.
// It runs in a detached background process (never the prompt hot path): refresh
// the offline probe, ensure the device is registered, then begin / heartbeat /
// redeem. The shell `render` only ever draws what this leaves in the creative cache.
func Tick(surface string, width int) {
	release, ok := acquireTickLock()
	if !ok {
		return // another tick is already in flight
	}
	defer release()

	ctx := context.Background()

	// Always refresh connectivity first so the hot path's fail-closed gate is current.
	Probe()
	if !CachedOnline(OnlineTTL) {
		return // offline: don't register, don't auction, leave the banner hidden
	}

	id, err := ensureRegistered(ctx)
	if err != nil {
		return
	}

	cl := NewClient()
	sess, _ := LoadSession()
	now := time.Now().Unix()

	// No live token, already redeemed, or close to server expiry → auction a fresh one.
	if sess.Token == "" || sess.Redeemed || now-sess.IssuedAtUnix > tokenMaxAgeSeconds {
		beginFresh(ctx, cl, id.DeviceID, surface, width)
		return
	}

	displayed := float64(now - sess.IssuedAtUnix)
	// Best-effort liveness; the server decides redeemability.
	_, _, _ = cl.Heartbeat(ctx, sess.Token, displayed)

	if displayed >= float64(sess.MinDwellSeconds) {
		// Redeem once; success or terminal failure both rotate to a fresh impression.
		_, _, _ = cl.Redeem(ctx, sess.Token, displayed)
		beginFresh(ctx, cl, id.DeviceID, surface, width)
	}
}

func beginFresh(ctx context.Context, cl *Client, deviceID, surface string, width int) {
	res, err := cl.Begin(ctx, deviceID, surface, width)
	if err != nil {
		return // transient; keep the last creative, retry next tick
	}
	if res.Empty || res.Creative == nil {
		// No inventory: clear so the banner hides rather than showing a stale ad.
		ClearCreative()
		_ = SaveSession(Session{})
		return
	}
	SaveCreative(*res.Creative)
	_ = SaveSession(Session{
		Token:           res.ImpressionToken,
		IssuedAtUnix:    time.Now().Unix(),
		MinDwellSeconds: res.MinDwellSeconds,
		Surface:         surface,
	})
}

// EnsureRegistered exposes registration for the `register` subcommand.
func EnsureRegistered() (auth.Identity, error) {
	return ensureRegistered(context.Background())
}

func ensureRegistered(ctx context.Context) (auth.Identity, error) {
	if id, err := auth.LoadIdentity(); err == nil {
		return id, nil
	}
	priv, err := auth.LoadOrCreateKey()
	if err != nil {
		return auth.Identity{}, err
	}
	pub := auth.PublicKeyB64(priv)
	deviceID, publisherID, dashboardToken, err := NewClient().Register(ctx, pub, runtime.GOOS)
	if err != nil {
		return auth.Identity{}, err
	}
	id := auth.Identity{DeviceID: deviceID, PublisherID: publisherID, PublicKey: pub, DashboardToken: dashboardToken}
	if err := auth.SaveIdentity(id); err != nil {
		return auth.Identity{}, err
	}
	return id, nil
}

// ── creative cache ──────────────────────────────────────────────────

// SaveCreative caches the creative for the surface to draw on the next prompt.
func SaveCreative(c Creative) {
	p, err := config.CreativeCachePath()
	if err != nil {
		return
	}
	b, err := json.Marshal(c)
	if err != nil {
		return
	}
	tmp := p + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, p)
	}
}

// LoadCreative returns the cached creative, ok=false when there is none.
func LoadCreative() (Creative, bool) {
	p, err := config.CreativeCachePath()
	if err != nil {
		return Creative{}, false
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return Creative{}, false
	}
	var c Creative
	if err := json.Unmarshal(b, &c); err != nil || c.Line == "" {
		return Creative{}, false
	}
	return c, true
}

// ClearCreative removes the cached creative (no inventory / disabled).
func ClearCreative() {
	if p, err := config.CreativeCachePath(); err == nil {
		_ = os.Remove(p)
	}
}

// ── session persistence ─────────────────────────────────────────────

func LoadSession() (Session, error) {
	p, err := config.SessionPath()
	if err != nil {
		return Session{}, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return Session{}, err
	}
	var s Session
	if err := json.Unmarshal(b, &s); err != nil {
		return Session{}, err
	}
	return s, nil
}

func SaveSession(s Session) error {
	p, err := config.SessionPath()
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

// ── tick lock ───────────────────────────────────────────────────────

// acquireTickLock serializes background ticks. Returns a release func and ok=true
// when the caller holds the lock; ok=false when a fresh lock is already held.
func acquireTickLock() (func(), bool) {
	p, err := config.TickLockPath()
	if err != nil {
		return func() {}, true // best-effort: proceed without a lock
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		// Held already — steal it only if abandoned (stale mtime).
		if info, statErr := os.Stat(p); statErr == nil && time.Since(info.ModTime()) > tickLockStale {
			_ = os.Remove(p)
			if f2, err2 := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600); err2 == nil {
				f = f2
			} else {
				return func() {}, false
			}
		} else {
			return func() {}, false
		}
	}
	_ = f.Close()
	return func() { _ = os.Remove(p) }, true
}
