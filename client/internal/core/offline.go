package core

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/earnd/client/internal/config"
)

// Probe does a single TCP-connect check to the API host and writes the cached
// online flag ("1 <unix>" or "0 <unix>"). TCP connect — not ICMP ping — because
// ping is routinely firewalled and would give false offlines. Runs in the
// background tick, never on the prompt hot path.
func Probe() {
	online := dialOK(config.APIBase(), 3*time.Second)
	p, err := config.OfflineFlagPath()
	if err != nil {
		return
	}
	flag := "0"
	if online {
		flag = "1"
	}
	tmp := p + ".tmp"
	if os.WriteFile(tmp, []byte(fmt.Sprintf("%s %d\n", flag, time.Now().Unix())), 0o600) == nil {
		_ = os.Rename(tmp, p)
	}
}

func dialOK(base string, timeout time.Duration) bool {
	u, err := url.Parse(base)
	if err != nil {
		return false
	}
	host := u.Hostname()
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// CachedOnline reports whether the last probe said online AND is within ttl.
// Fail-closed: a missing, stale, or unparseable flag is treated as OFFLINE, so
// the banner hides whenever connectivity is unknown (the brief's requirement).
func CachedOnline(ttl time.Duration) bool {
	p, err := config.OfflineFlagPath()
	if err != nil {
		return false
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return false
	}
	fields := strings.Fields(string(b))
	if len(fields) < 2 || fields[0] != "1" {
		return false
	}
	ts, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil {
		return false
	}
	return time.Since(time.Unix(ts, 0)) <= ttl
}
