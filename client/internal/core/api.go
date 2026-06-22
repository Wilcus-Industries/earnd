// Package core is the surface-agnostic brain: server session protocol, creative
// cache, offline probe, and the impression state machine. Surfaces (shell today;
// tmux/vim later) only render what core caches and never talk to the network.
package core

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/earnd/client/internal/auth"
	"github.com/earnd/client/internal/config"
)

// maxResponseBytes caps how much of a response we read, so a malicious or wedged
// server can't make the client buffer an unbounded body into memory.
const maxResponseBytes = 1 << 20 // 1 MiB

// Client calls the earnd HTTP API.
type Client struct {
	base string
	http *http.Client

	// Device identity used to sign money-moving requests (begin/heartbeat/redeem).
	// Unset for the unauthenticated register call, which has no device yet.
	priv     ed25519.PrivateKey
	deviceID string
}

// NewClient builds a client against the configured API base. The transport
// floors TLS at 1.2 so a downgrade can't push the connection onto weak crypto.
func NewClient() *Client {
	return &Client{
		base: config.APIBase(),
		http: &http.Client{
			Timeout: 8 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
			},
		},
	}
}

// SetIdentity attaches the device key so subsequent requests are Ed25519-signed.
// Call after the device is registered; register itself stays unsigned.
func (c *Client) SetIdentity(priv ed25519.PrivateKey, deviceID string) {
	c.priv = priv
	c.deviceID = deviceID
}

// signRequest builds the canonical request string and signs it with the device
// key. MUST stay byte-for-byte identical to the server's canonicalRequest (see
// apps/web/src/lib/deviceAuth.ts): deviceId, method, path, timestamp, and the hex
// SHA-256 of the raw body, newline-separated.
func (c *Client) signRequest(req *http.Request, path string, body []byte) {
	if c.priv == nil || c.deviceID == "" {
		return // unauthenticated (register) — server permits it for that route only
	}
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	sum := sha256.Sum256(body)
	msg := c.deviceID + "\n" + http.MethodPost + "\n" + path + "\n" + ts + "\n" + hex.EncodeToString(sum[:])
	sig := auth.Sign(c.priv, []byte(msg))
	req.Header.Set("x-earnd-device", c.deviceID)
	req.Header.Set("x-earnd-timestamp", ts)
	req.Header.Set("x-earnd-signature", sig)
}

// Creative is the ad content cached for the surface to render.
type Creative struct {
	AdID       string `json:"adId"`
	Line       string `json:"line"`
	DisplayURL string `json:"displayUrl"`
	ClickURL   string `json:"clickUrl"`
	// Icon is an optional emoji glyph drawn left of the line.
	Icon string `json:"icon,omitempty"`
}

// BeginResult is the auction outcome for one impression.
type BeginResult struct {
	Empty           bool      `json:"empty"`
	Creative        *Creative `json:"creative"`
	ImpressionToken string    `json:"impressionToken"`
	MinDwellSeconds int       `json:"minDwellSeconds"`
	ServerTime      int64     `json:"serverTime"`
}

func (c *Client) postJSON(ctx context.Context, path string, body, out any) error {
	// Fail closed on an insecure transport before any secret leaves the process.
	if err := config.SecureBase(c.base); err != nil {
		return err
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	c.signRequest(req, path, buf)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody := io.LimitReader(resp.Body, maxResponseBytes)
	// Any non-2xx is an error. Previously only 5xx was caught, so a 4xx (bad request,
	// 404 unknown device, 429 rate-limited) decoded into a zero-value struct and read
	// as a silent success — the caller couldn't tell a real result from a failure.
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(respBody)
		return fmt.Errorf("%s: status %d: %s", path, resp.StatusCode, strings.TrimSpace(string(snippet)))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(respBody).Decode(out)
}

// Register binds this install's public key to a publisher; idempotent server-side.
func (c *Client) Register(ctx context.Context, publicKey, osName string) (deviceID, publisherID, dashboardToken string, err error) {
	var out struct {
		DeviceID       string `json:"deviceId"`
		PublisherID    string `json:"publisherId"`
		DashboardToken string `json:"dashboardToken"`
	}
	err = c.postJSON(ctx, "/api/devices/register", map[string]any{
		"publicKey": publicKey,
		"os":        osName,
	}, &out)
	return out.DeviceID, out.PublisherID, out.DashboardToken, err
}

// Begin runs the auction and issues a single-use impression token.
func (c *Client) Begin(ctx context.Context, deviceID, surface string, width int) (BeginResult, error) {
	var out BeginResult
	err := c.postJSON(ctx, "/api/impression/begin", map[string]any{
		"deviceId":   deviceID,
		"surface":    surface,
		"width":      width,
		"clientTime": time.Now().UnixMilli(),
	}, &out)
	return out, err
}

// Heartbeat reports continuous display time; the server says when it's redeemable.
func (c *Client) Heartbeat(ctx context.Context, token string, displayedSeconds float64) (ok, redeemable bool, err error) {
	var out struct {
		OK         bool `json:"ok"`
		Redeemable bool `json:"redeemable"`
	}
	err = c.postJSON(ctx, "/api/impression/heartbeat", map[string]any{
		"impressionToken":  token,
		"displayedSeconds": displayedSeconds,
	}, &out)
	return out.OK, out.Redeemable, err
}

// Redeem records + bills exactly one impression (server-authoritative).
func (c *Client) Redeem(ctx context.Context, token string, displayedSeconds float64) (recorded bool, reason string, err error) {
	var out struct {
		Recorded bool   `json:"recorded"`
		Reason   string `json:"reason"`
	}
	err = c.postJSON(ctx, "/api/impression/redeem", map[string]any{
		"impressionToken":  token,
		"displayedSeconds": displayedSeconds,
	}, &out)
	return out.Recorded, out.Reason, err
}
