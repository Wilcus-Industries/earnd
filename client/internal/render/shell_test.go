package render

import (
	"strings"
	"testing"
)

// With an icon and room to spare, the banner is prefixed with a 1-col margin,
// the emoji, and a 1-col gap before the (here unlinked) line.
func TestDrawWithIcon(t *testing.T) {
	out := Draw(Banner{Line: "ship faster", Icon: "🚀"}, 80, 24)
	if !strings.Contains(out, " 🚀 ship faster") {
		t.Fatalf("expected emoji prefix before the line; got:\n%q", out)
	}
}

// No icon keeps the original layout: the line starts immediately, no prefix.
func TestDrawWithoutIcon(t *testing.T) {
	out := Draw(Banner{Line: "ship faster"}, 80, 24)
	if strings.Contains(out, " 🚀 ") {
		t.Fatalf("unexpected emoji prefix; got:\n%q", out)
	}
	// The line follows clearLine directly (no leading space prefix).
	if !strings.Contains(out, clearLine+"ship faster") {
		t.Fatalf("expected line immediately after clearLine; got:\n%q", out)
	}
}

// The icon steals iconCells columns from the line's truncation budget.
func TestDrawIconTruncatesLine(t *testing.T) {
	line := strings.Repeat("a", 100)
	cols := 20
	out := Draw(Banner{Line: line, Icon: "🚀"}, cols, 24)
	if !strings.Contains(out, " 🚀 ") {
		t.Fatalf("expected emoji prefix; got:\n%q", out)
	}
	want := truncateToWidth(line, cols-iconCells)
	if !strings.Contains(out, " 🚀 "+want) {
		t.Fatalf("line not truncated to cols-iconCells (%d); got:\n%q", cols-iconCells, out)
	}
	if displayWidth(want) > cols-iconCells {
		t.Fatalf("truncated line width %d exceeds budget %d", displayWidth(want), cols-iconCells)
	}
}

// A terminal too narrow to fit the icon budget falls back to the plain line.
func TestDrawNarrowDropsIcon(t *testing.T) {
	out := Draw(Banner{Line: "hello", Icon: "🚀"}, 4, 24)
	if strings.Contains(out, "🚀") {
		t.Fatalf("expected icon dropped on a narrow terminal; got:\n%q", out)
	}
}

// A line carrying raw escape/control bytes must not smuggle them into row 1.
// Draw legitimately emits ESC for its own styling/margins, so we assert the
// attacker payload (a CSI clear-screen + an OSC sequence) is gone, not that the
// output is ESC-free.
func TestDrawStripsControlBytesInLine(t *testing.T) {
	out := Draw(Banner{Line: "buy\x1b[2Jnow\x07\x1b]0;pwn\x07"}, 80, 24)
	if strings.Contains(out, "\x1b[2J") {
		t.Fatalf("CSI clear-screen survived sanitization; got:\n%q", out)
	}
	if strings.Contains(out, "\x07") {
		t.Fatalf("BEL byte survived sanitization; got:\n%q", out)
	}
	if strings.Contains(out, "\x1b]0;") {
		t.Fatalf("OSC title-set survived sanitization; got:\n%q", out)
	}
	if !strings.Contains(out, "buy") || !strings.Contains(out, "now") {
		t.Fatalf("visible text was lost; got:\n%q", out)
	}
}

// Bidi overrides / zero-width chars (Trojan-Source class) are stripped.
func TestDrawStripsBidiAndZeroWidth(t *testing.T) {
	out := Draw(Banner{Line: "safe‮text​"}, 80, 24)
	if strings.ContainsRune(out, '‮') || strings.ContainsRune(out, '​') {
		t.Fatalf("bidi/zero-width survived sanitization; got:\n%q", out)
	}
}

// A non-https click target degrades to plain text — no OSC-8 hyperlink emitted.
func TestDrawRejectsNonHTTPSURL(t *testing.T) {
	out := Draw(Banner{Line: "click", URL: "javascript:alert(1)"}, 80, 24)
	if strings.Contains(out, "]8;;") {
		t.Fatalf("OSC-8 link emitted for a non-https URL; got:\n%q", out)
	}
}

// A click target that smuggles an OSC-8 terminator is rejected (no link).
func TestDrawRejectsURLWithControlBytes(t *testing.T) {
	out := Draw(Banner{Line: "click", URL: "https://evil.com\x1b\\\x1b]8;;https://x.com"}, 80, 24)
	if strings.Contains(out, "]8;;") {
		t.Fatalf("OSC-8 link emitted for a control-byte URL; got:\n%q", out)
	}
}

// A valid https click target still produces an OSC-8 hyperlink.
func TestDrawKeepsValidHTTPSURL(t *testing.T) {
	out := Draw(Banner{Line: "click", URL: "https://example.com/x"}, 80, 24)
	if !strings.Contains(out, "]8;;https://example.com/x") {
		t.Fatalf("expected OSC-8 link for a valid https URL; got:\n%q", out)
	}
}

func TestSanitizeLineCollapsesWhitespace(t *testing.T) {
	if got := sanitizeLine("  a\t\tb \n c  "); got != "a b c" {
		t.Fatalf("whitespace not collapsed/trimmed; got %q", got)
	}
}

func TestSafeURL(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"https://example.com", "https://example.com"},
		{"https://example.com/path?q=1", "https://example.com/path?q=1"},
		{"http://example.com", ""},                            // not https
		{"https://localhost", ""},                             // host has no dot
		{"javascript:alert(1)", ""},                           // wrong scheme
		{"https://e.com\x1b\\x", ""},                          // control byte
		{"", ""},                                              // empty
		{"https://" + strings.Repeat("a", 2048) + ".com", ""}, // over length
	}
	for _, c := range cases {
		if got := safeURL(c.in); got != c.want {
			t.Fatalf("safeURL(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// A status notice is drawn right-aligned at the row's edge, after the ad text.
func TestDrawStatusRightAligned(t *testing.T) {
	out := Draw(Banner{Line: "ad", Status: "⟳ updated"}, 40, 24)
	if !strings.Contains(out, "⟳ updated") {
		t.Fatalf("expected status notice in output; got:\n%q", out)
	}
	// The notice must follow the ad text (right side), not precede it.
	if strings.Index(out, "ad") > strings.Index(out, "⟳ updated") {
		t.Fatalf("status should come after the ad text; got:\n%q", out)
	}
}

// When the row is too narrow to fit the ad text and the notice, the notice is
// dropped and the ad still renders.
func TestDrawStatusDroppedWhenNarrow(t *testing.T) {
	out := Draw(Banner{Line: "buy now please", Status: "⟳ updated"}, 12, 24)
	if strings.Contains(out, "⟳ updated") {
		t.Fatalf("status notice should be dropped at narrow width; got:\n%q", out)
	}
	if !strings.Contains(out, "buy") {
		t.Fatalf("ad text should still render; got:\n%q", out)
	}
}

// The status notice steals columns from the ad text's truncation budget so the
// combined content never overflows the row.
func TestDrawStatusShrinksTextBudget(t *testing.T) {
	line := strings.Repeat("a", 100)
	cols := 40
	status := "⟳ updated"
	out := Draw(Banner{Line: line, Status: status}, cols, 24)
	// statusW reserved = displayWidth(status)+1; text truncated to cols-statusW.
	want := truncateToWidth(line, cols-(displayWidth(status)+1))
	if !strings.Contains(out, want) {
		t.Fatalf("ad text not truncated to leave room for the notice; got:\n%q", out)
	}
}
