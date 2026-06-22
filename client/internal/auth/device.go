// Package auth manages the per-install device identity.
//
// On first use the client generates an Ed25519 keypair stored 0600 under the
// config dir. The public key is registered with the server and bound to a
// publisher; the private key signs every money-moving request (begin/heartbeat/
// redeem), which the server verifies against the registered public key before
// issuing or redeeming a billing token.
package auth

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"runtime"

	"github.com/earnd/client/internal/config"
)

// ensurePrivatePerms re-verifies that a secret-bearing file (the device key, the
// identity holding the dashboard token) is not group/other readable before we trust
// it — permissions can drift after creation (a careless chmod, a bad umask on a
// restore). On unix it tightens an over-permissive file back to 0600 and fails if it
// cannot. No-op on Windows, where unix permission bits aren't meaningful.
func ensurePrivatePerms(path string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.Mode().Perm()&0o077 != 0 {
		if err := os.Chmod(path, 0o600); err != nil {
			return fmt.Errorf("insecure permissions on %s and chmod failed: %w", path, err)
		}
	}
	return nil
}

// Identity is the registered device, persisted after a successful register call.
type Identity struct {
	DeviceID    string `json:"deviceId"`
	PublisherID string `json:"publisherId"`
	PublicKey   string `json:"publicKey"` // base64 std
	// Bearer secret for the publisher's earnings dashboard. Stored 0600 with the
	// identity; printed by `earnd status` so the developer can open their dashboard.
	DashboardToken string `json:"dashboardToken,omitempty"`
}

// LoadOrCreateKey returns the install's Ed25519 private key, generating and
// persisting one (mode 0600) the first time.
func LoadOrCreateKey() (ed25519.PrivateKey, error) {
	p, err := config.KeyPath()
	if err != nil {
		return nil, err
	}
	if raw, err := os.ReadFile(p); err == nil {
		if permErr := ensurePrivatePerms(p); permErr != nil {
			return nil, permErr
		}
		dec, err := base64.StdEncoding.DecodeString(string(raw))
		if err == nil && len(dec) == ed25519.PrivateKeySize {
			return ed25519.PrivateKey(dec), nil
		}
		// fall through and regenerate on a corrupt key
	}
	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		return nil, err
	}
	enc := base64.StdEncoding.EncodeToString(priv)
	if err := os.WriteFile(p, []byte(enc), 0o600); err != nil {
		return nil, err
	}
	return priv, nil
}

// PublicKeyB64 returns the base64 public key for the given private key.
func PublicKeyB64(priv ed25519.PrivateKey) string {
	pub := priv.Public().(ed25519.PublicKey)
	return base64.StdEncoding.EncodeToString(pub)
}

// Sign returns a base64 (std) Ed25519 signature over msg. Used to authenticate
// each impression-lifecycle request against the device's registered public key.
func Sign(priv ed25519.PrivateKey, msg []byte) string {
	return base64.StdEncoding.EncodeToString(ed25519.Sign(priv, msg))
}

// LoadIdentity reads the persisted device identity, or returns an error if the
// install has not registered yet.
func LoadIdentity() (Identity, error) {
	p, err := config.IdentityPath()
	if err != nil {
		return Identity{}, err
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return Identity{}, err
	}
	if permErr := ensurePrivatePerms(p); permErr != nil {
		return Identity{}, permErr
	}
	var id Identity
	if err := json.Unmarshal(raw, &id); err != nil {
		return Identity{}, err
	}
	if id.DeviceID == "" {
		return Identity{}, errors.New("device not registered")
	}
	return id, nil
}

// SaveIdentity persists the registered device identity.
func SaveIdentity(id Identity) error {
	p, err := config.IdentityPath()
	if err != nil {
		return err
	}
	b, err := json.Marshal(id)
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}
