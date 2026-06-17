// Package core is the surface-agnostic brain: server session protocol, creative
// cache, offline probe, and the impression state machine. Surfaces (shell today;
// tmux/vim later) only render what core caches and never talk to the network.
package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/earnd/client/internal/config"
)

// Client calls the earnd HTTP API.
type Client struct {
	base string
	http *http.Client
}

// NewClient builds a client against the configured API base.
func NewClient() *Client {
	return &Client{
		base: config.APIBase(),
		http: &http.Client{Timeout: 8 * time.Second},
	}
}

// Creative is the ad content cached for the surface to render.
type Creative struct {
	AdID       string `json:"adId"`
	Line       string `json:"line"`
	DisplayURL string `json:"displayUrl"`
	ClickURL   string `json:"clickUrl"`
	Icon       string `json:"icon,omitempty"`
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
	buf, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return fmt.Errorf("%s: server status %d", path, resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
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
