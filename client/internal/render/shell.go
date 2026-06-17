// Package render emits the terminal escape sequences for the shell surface.
//
// Mechanism: DECSTBM (Set Top and Bottom Margins). `ESC[2;<LINES>r` confines the
// scroll region to rows 2..LINES, pinning row 1 so program output scrolls beneath
// the banner. The banner is (re)drawn each prompt; margins are re-asserted every
// time because full-screen apps (vim/less/htop/tmux) and SIGWINCH reset them.
//
// SAFETY: every margin set MUST be paired with a guaranteed reset (ESC[r) on shell
// exit / disable, or Windows Terminal/ConPTY leaves the terminal corrupted.
package render

import (
	"fmt"
	"strings"
	"unicode"
)

const (
	esc = "\x1b"

	// Synchronized output (DECSET 2026) brackets a redraw to prevent tearing.
	beginSync = esc + "[?2026h"
	endSync   = esc + "[?2026l"

	saveCursor    = esc + "7"
	restoreCursor = esc + "8"
	clearLine     = esc + "[K"
	gotoHome      = esc + "[1;1H"

	// releaseMargins resets the scroll region to the full screen.
	releaseMargins = esc + "[r"
)

// setMargins reserves row 1 by setting the scroll region to rows 2..lines.
func setMargins(lines int) string {
	if lines < 2 {
		lines = 2
	}
	return fmt.Sprintf("%s[2;%dr", esc, lines)
}

// osc8 wraps text in an OSC 8 hyperlink so supporting terminals make it clickable.
// Degrades to plain text elsewhere. Empty url => plain text.
func osc8(url, text string) string {
	if url == "" {
		return text
	}
	return fmt.Sprintf("%s]8;;%s%s\\%s%s]8;;%s\\", esc, url, esc, text, esc, esc)
}

// displayWidth approximates the rendered column width of s, counting East-Asian
// wide and most emoji as 2 columns and ignoring zero-width marks. This is a
// pragmatic wcwidth; a full table can replace it without changing callers.
func displayWidth(s string) int {
	w := 0
	for _, r := range s {
		switch {
		case r == 0:
			// no width
		case unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Me, r) || unicode.Is(unicode.Cf, r):
			// combining / format: zero width
		case isWide(r):
			w += 2
		default:
			w += 1
		}
	}
	return w
}

func isWide(r rune) bool {
	return (r >= 0x1100 && r <= 0x115F) || // Hangul Jamo
		(r >= 0x2E80 && r <= 0xA4CF) || // CJK .. Yi
		(r >= 0xAC00 && r <= 0xD7A3) || // Hangul Syllables
		(r >= 0xF900 && r <= 0xFAFF) || // CJK Compatibility Ideographs
		(r >= 0xFE30 && r <= 0xFE4F) || // CJK Compatibility Forms
		(r >= 0xFF00 && r <= 0xFF60) || // Fullwidth Forms
		(r >= 0xFFE0 && r <= 0xFFE6) ||
		(r >= 0x1F300 && r <= 0x1FAFF) || // emoji / symbols & pictographs
		(r >= 0x20000 && r <= 0x3FFFD) // CJK Extension B+
}

// truncateToWidth trims s so its display width is at most cols, appending an
// ellipsis when truncated.
func truncateToWidth(s string, cols int) string {
	if cols <= 0 {
		return ""
	}
	if displayWidth(s) <= cols {
		return s
	}
	const ell = "…"
	limit := cols - 1 // room for the ellipsis (width 1)
	if limit < 0 {
		limit = 0
	}
	var b strings.Builder
	w := 0
	for _, r := range s {
		rw := 1
		if isWide(r) {
			rw = 2
		}
		if w+rw > limit {
			break
		}
		b.WriteRune(r)
		w += rw
	}
	b.WriteString(ell)
	return b.String()
}

// Banner is the content to draw on row 1.
type Banner struct {
	Line string // sanitized banner text
	URL  string // OSC 8 click target (the signed redirect URL)
}

// Draw returns the full escape sequence that pins row 1 and writes the banner,
// truncated to cols and re-asserting margins for the given terminal height.
func Draw(b Banner, cols, lines int) string {
	text := truncateToWidth(b.Line, cols)
	linked := osc8(b.URL, text)
	var sb strings.Builder
	sb.WriteString(beginSync)
	sb.WriteString(setMargins(lines)) // (re)assert every redraw
	sb.WriteString(saveCursor)
	sb.WriteString(gotoHome)
	sb.WriteString(clearLine)
	sb.WriteString(linked)
	sb.WriteString(restoreCursor)
	sb.WriteString(endSync)
	return sb.String()
}

// Release returns the sequence that gives the terminal back to the user: reset
// margins and clear row 1. Emit on disable, offline, and the shell EXIT trap.
func Release() string {
	return releaseMargins + saveCursor + gotoHome + clearLine + restoreCursor
}
