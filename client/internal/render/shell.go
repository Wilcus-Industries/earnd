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

	// Banner row styling: theme-neutral. Background uses the palette's "bright black"
	// (SGR 100) — the terminal renders it per the user's color scheme, a subtle gray on
	// both light and dark themes — and the foreground is the terminal default (SGR 39).
	// No truecolor / brand color, so the bar blends into whatever palette is in use.
	// Set BEFORE clearLine so ESC[K paints the whole row via background-color-erase;
	// resetStyle stops the color bleeding past row 1.
	bannerStyle = esc + "[100;39m"
	resetStyle  = esc + "[0m"

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
	Line   string // sanitized banner text
	URL    string // OSC 8 click target (the signed redirect URL)
	Icon   string // optional emoji glyph drawn left of the line ("" = none)
	Status string // optional right-aligned notice (e.g. "⟳ updated"); "" = none
}

// iconCells is the column budget reserved for the emoji icon plus its margins:
// a 1-column left margin, the emoji, and a 1-column gap before the line. The
// emoji itself is reserved as 2 cells — terminals render an emoji grapheme as a
// double-width cell, and counting runes would mis-measure ZWJ/flag sequences.
const iconCells = 1 + 2 + 1

// minAdCols is the smallest ad-text budget worth keeping alongside the right-aligned
// status notice; below it the notice is dropped so the ad keeps the row.
const minAdCols = 8

// Draw returns the full escape sequence that pins row 1 and writes the banner,
// truncated to cols and re-asserting margins for the given terminal height.
func Draw(b Banner, cols, lines int) string {
	// With an icon and room to spare, prefix " <emoji> " and shrink the text
	// budget accordingly; otherwise the line keeps the full width as before.
	// Last-line-of-defense neutralization: strip any control/escape/bidi bytes
	// from the line and reject a non-https / malformed click target BEFORE
	// truncation or linking, so a poisoned cache or hostile server can't inject
	// raw ESC/CSI/OSC into row 1. Width clamping is applied after.
	text := sanitizeLine(b.Line)
	clickURL := safeURL(b.URL)
	icon := sanitizeLine(b.Icon)

	// Right-aligned status notice (e.g. "⟳ updated"). It is plain (no link) and is
	// only drawn when, after reserving the left content, at least one column of gap
	// remains — at narrow widths it is dropped entirely and the ad keeps the row.
	status := sanitizeLine(b.Status)
	statusW := 0
	if status != "" {
		statusW = displayWidth(status) + 1 // +1 for a minimum gap before the notice
		// Drop the notice when reserving it would leave the ad too little room — at
		// narrow widths the ad text wins the whole row.
		if cols-statusW < minAdCols {
			status, statusW = "", 0
		}
	}

	budget := cols - statusW
	prefix := ""
	if icon != "" && budget > iconCells+1 {
		prefix = " " + icon + " "
		text = truncateToWidth(text, budget-iconCells)
	} else {
		text = truncateToWidth(text, budget)
	}
	linked := osc8(clickURL, text) // icon stays decorative (outside the click target)

	// Pad from the end of the left content to the right edge so the notice sits flush
	// right. The drop check above guarantees at least one column of gap remains here.
	padding := ""
	if status != "" {
		gap := cols - displayWidth(prefix) - displayWidth(text) - displayWidth(status)
		if gap < 1 {
			gap = 1
		}
		padding = strings.Repeat(" ", gap)
	}

	var sb strings.Builder
	sb.WriteString(beginSync)
	sb.WriteString(saveCursor)        // save BEFORE setMargins — DECSTBM homes the cursor
	sb.WriteString(setMargins(lines)) // (re)assert every redraw
	sb.WriteString(gotoHome)
	sb.WriteString(bannerStyle) // theme bg + default fg; clearLine paints the row via BCE
	sb.WriteString(clearLine)
	sb.WriteString(prefix) // left margin + emoji + gap (inherits the banner bg)
	sb.WriteString(linked)
	sb.WriteString(padding)       // fill to the right edge (inherits the banner bg)
	sb.WriteString(status)        // plain right-aligned notice
	sb.WriteString(resetStyle)    // stop the color bleeding past the banner row
	sb.WriteString(restoreCursor) // back to where the shell left it, not row 1
	sb.WriteString(endSync)
	return sb.String()
}

// ClearScreen clears the scrollback and everything below the banner while leaving
// row 1 intact. The shell binds `clear` (and Ctrl-L) to this so a clear no longer
// wipes the banner the way a bare ESC[2J would: jump to row 2, erase from there to
// the end of the screen (row 1 untouched), drop the scrollback, and leave the
// cursor at the top of the scroll region so the next prompt draws below the banner.
func ClearScreen() string {
	return esc + "[2;1H" + esc + "[J" + esc + "[3J"
}

// Release returns the sequence that gives the terminal back to the user: reset
// margins and clear row 1. Emit on disable, offline, and the shell EXIT trap.
// saveCursor MUST come before releaseMargins: DECSTBM reset (ESC[r) homes the
// cursor as a side effect, so saving after it would park the cursor at row 1
// every prompt — the "terminal resets each command" bug.
func Release() string {
	return saveCursor + releaseMargins + gotoHome + clearLine + restoreCursor
}
