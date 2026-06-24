// Command earnd is the terminal ad-network banner client.
//
// A thin shell shim (bash/zsh/fish) calls `earnd render` each prompt. That path
// is FAST and side-effect-light: it draws the cached creative on row 1 and spawns
// a detached, silent `earnd tick` that advances the server-authoritative
// impression session (auction → heartbeat → redeem) and refreshes the offline
// probe. The shell layer only prints render's stdout; tick never touches the tty.
//
// Subcommands:
//
//	earnd render --surface=shell --width=N --rows=M   draw (or clear) row 1 (hot path)
//	earnd tick   --surface=shell --width=N            advance the session (background)
//	earnd register                                    register this device with the server
//	earnd open                                         open the current ad's link in a browser
//	earnd on | off                                    toggle the banner (off clears immediately)
//	earnd status                                      print state + identity
//	earnd version                                     print version
//
// SAFETY: every margin set is paired with a guaranteed reset. The shell shim emits
// `earnd off`-equivalent reset on its EXIT trap so a closed terminal is never left
// with a stuck scroll region (the Windows Terminal/ConPTY corruption class).
package main

import (
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"github.com/earnd/client/internal/auth"
	"github.com/earnd/client/internal/config"
	"github.com/earnd/client/internal/core"
	"github.com/earnd/client/internal/render"
)

const version = "0.1.0-dev"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "render":
		cmdRender(os.Args[2:])
	case "tick":
		cmdTick(os.Args[2:])
	case "self-update":
		// Internal: spawned detached by a tick. Fetches origin/main and reinstalls if
		// the binary is behind. Silent no-op when there's nothing to do. Not in usage().
		core.SelfUpdate()
	case "register":
		cmdRegister()
	case "open":
		cmdOpen()
	case "on":
		mustSet(true)
	case "off":
		mustSet(false)
		core.ClearCreative()
		// Clearing must take effect now, not at the next prompt.
		fmt.Print(render.Release())
	case "reset":
		// Release scroll margins + clear row 1 WITHOUT changing the toggle. The
		// shell EXIT trap calls this so a closed terminal is never left corrupted.
		if isTTY(os.Stdout) {
			fmt.Print(render.Release())
		}
	case "clear":
		// Banner-preserving clear: wipe the scrollback + everything below row 1 but
		// keep the banner. The shell binds `clear`/Ctrl-L here (a bare ESC[2J would
		// erase row 1 too, and homing the cursor lets the prompt overwrite it).
		if isTTY(os.Stdout) {
			fmt.Print(render.ClearScreen())
		}
	case "status":
		cmdStatus(os.Args[2:])
	case "version", "--version", "-v":
		fmt.Printf("earnd %s (%s)\n", version, core.BuildCommit)
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: earnd <render|tick|register|open|on|off|reset|clear|status|version>")
}

func mustSet(enabled bool) {
	if err := config.SetEnabled(enabled); err != nil {
		fmt.Fprintln(os.Stderr, "earnd:", err)
		os.Exit(1)
	}
}

func cmdRender(args []string) {
	fs := flag.NewFlagSet("render", flag.ContinueOnError)
	surface := fs.String("surface", "shell", "rendering surface: shell|tmux|vim")
	width := fs.Int("width", envInt("COLUMNS", 80), "terminal width in columns")
	rows := fs.Int("rows", envInt("LINES", 24), "terminal height in rows")
	if err := fs.Parse(args); err != nil {
		return
	}
	_ = surface // only the shell surface emits escapes in v1

	// Never emit escape sequences into a non-TTY (pipes, scripts, captured output).
	if !isTTY(os.Stdout) {
		return
	}

	s, err := config.Load()
	if err != nil || !s.Enabled {
		fmt.Print(render.Release())
		return
	}

	// Advance the session + refresh connectivity in the background, detached and
	// silent. This is what makes the next prompt's cache fresh; it must not block
	// the prompt or print anything.
	spawnTick(*surface, *width)

	// Requirement: no banner when offline. Fail-closed when the probe is stale/unknown.
	if !core.CachedOnline(core.OnlineTTL) {
		fmt.Print(render.Release())
		return
	}

	c, ok := core.LoadCreative()
	if !ok {
		// No inventory cached (yet): give the terminal back rather than show stale.
		fmt.Print(render.Release())
		return
	}
	// Lightly surface that the client auto-updated: show a right-aligned notice for a
	// few prompts, decrementing the countdown each render until it clears itself.
	status := ""
	if us := config.LoadUpdateState(); us.RendersLeft > 0 {
		status = "⟳ updated"
		us.RendersLeft--
		_ = config.SaveUpdateState(us)
	}
	fmt.Print(render.Draw(render.Banner{Line: c.Line, URL: c.ClickURL, Icon: c.Icon, Status: status}, *width, *rows))
}

func cmdTick(args []string) {
	fs := flag.NewFlagSet("tick", flag.ContinueOnError)
	surface := fs.String("surface", "shell", "rendering surface")
	width := fs.Int("width", envInt("COLUMNS", 80), "terminal width in columns")
	if err := fs.Parse(args); err != nil {
		return
	}
	core.Tick(*surface, *width)
}

// spawnTick starts `earnd tick` detached with output discarded, then returns
// immediately so the prompt isn't blocked. If Stdout/Stderr are nil, exec wires
// them to /dev/null — critical, so the background process can never corrupt row 1.
func spawnTick(surface string, width int) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	cmd := exec.Command(exe, "tick", "--surface", surface, "--width", strconv.Itoa(width))
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	_ = cmd.Start() // fire-and-forget; the orphan finishes its network work and exits
}

func cmdRegister() {
	id, err := core.EnsureRegistered()
	if err != nil {
		fmt.Fprintln(os.Stderr, "earnd: registration failed:", err)
		os.Exit(1)
	}
	fmt.Printf("registered device %s (publisher %s)\n", id.DeviceID, id.PublisherID)
}

func cmdOpen() {
	c, ok := core.LoadCreative()
	if !ok || c.ClickURL == "" {
		return
	}
	openURL(c.ClickURL)
}

// safeOpenURL reports whether u is safe to hand to the OS opener. It must parse
// as an http/https URL and must not begin with '-', which the opener (open /
// xdg-open / cmd start) would otherwise treat as an option flag — argument
// injection (CWE-88). No shell is spawned, so this only blocks option smuggling
// and non-web schemes (file:, etc.).
func safeOpenURL(u string) bool {
	if u == "" || strings.HasPrefix(u, "-") {
		return false
	}
	parsed, err := url.Parse(u)
	if err != nil {
		return false
	}
	return parsed.Scheme == "https" || parsed.Scheme == "http"
}

// openURL launches the OS default browser on the signed redirect URL.
func openURL(u string) {
	if !safeOpenURL(u) {
		return
	}
	var name string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		name, args = "open", []string{u}
	case "windows":
		name, args = "cmd", []string{"/c", "start", "", u}
	default:
		name, args = "xdg-open", []string{u} // wslview/gio are install-specific fallbacks
	}
	cmd := exec.Command(name, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	_ = cmd.Start()
}

func cmdStatus(args []string) {
	fs := flag.NewFlagSet("status", flag.ContinueOnError)
	// The dashboard token is a bearer secret. Don't print it by default — `status`
	// output lands in scrollback, screen-shares, and CI logs. Reveal only on request.
	showToken := fs.Bool("show-token", false, "reveal the dashboard bearer token (a secret)")
	if err := fs.Parse(args); err != nil {
		return
	}

	s, _ := config.Load()
	dir, _ := config.Dir()
	state := "off"
	if s.Enabled {
		state = "on"
	}
	fmt.Printf("earnd %s (%s)\nstate: %s\nonline(cached): %v\napi: %s\nconfig: %s\n",
		version, core.BuildCommit, state, core.CachedOnline(core.OnlineTTL), config.APIBase(), dir)
	if id, err := auth.LoadIdentity(); err == nil {
		fmt.Printf("device: %s\npublisher: %s\n", id.DeviceID, id.PublisherID)
		// The dashboard URL routes by publisher id; the token is the bearer secret
		// that actually authorizes reading earnings (paste it into the dashboard).
		fmt.Printf("dashboard: %s/publisher/%s\n", config.APIBase(), id.PublisherID)
		if id.DashboardToken != "" {
			if *showToken {
				fmt.Printf("dashboard token: %s\n", id.DashboardToken)
			} else {
				fmt.Println("dashboard token: (hidden — run `earnd status --show-token` to reveal)")
			}
		}
	} else {
		fmt.Println("device: (unregistered — run `earnd register`)")
	}
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func isTTY(f *os.File) bool {
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}
