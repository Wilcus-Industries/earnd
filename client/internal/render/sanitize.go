package render

// Trust-boundary hardening for the terminal surface. The banner content
// (`line`, the OSC-8 click target) is attacker-controlled: it originates from
// the bid API and is rendered into a victim developer's terminal row 1. The web
// tier sanitizes at ingest (apps/web/src/lib/sanitize.ts), but the client is the
// last line of defense — a poisoned creative cache, a compromised server, or a
// MITM must never get a raw ESC/CSI/OSC byte onto the terminal. So we re-strip
// here, mirroring the web ranges, before anything reaches Draw/osc8.

import (
	"net/url"
	"strings"
)

const maxURLLen = 2048

// dangerousFormat reports runes in the bidi-override / zero-width / invisible
// class (the Trojan-Source attack family). Mirrors DANGEROUS_FORMAT in
// apps/web/src/lib/sanitize.ts.
func dangerousFormat(r rune) bool {
	switch {
	case r >= 0x200b && r <= 0x200f, // zero-width + bidi marks
		r >= 0x202a && r <= 0x202e, // bidi embeddings/overrides
		r >= 0x2060 && r <= 0x2064, // word-joiner & invisibles
		r >= 0x2066 && r <= 0x2069, // bidi isolates
		r >= 0x2028 && r <= 0x2029, // line/para separators
		r == 0xfeff:                // BOM / zero-width no-break space
		return true
	}
	return false
}

// controlByte reports runes in the C0 (0x00-0x1F), DEL/C1 (0x7F-0x9F) control
// ranges — every raw ESC/CSI/OSC byte lives here. Mirrors CONTROL in the web tier.
func controlByte(r rune) bool {
	return (r >= 0x00 && r <= 0x1f) || (r >= 0x7f && r <= 0x9f)
}

// sanitizeLine strips control/escape bytes and dangerous-format runes, collapses
// runs of whitespace to a single space, and trims. No raw ESC/CSI/OSC can survive
// so the line cannot break out of row 1 or smuggle a hyperlink/cursor move.
func sanitizeLine(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := false
	for _, r := range s {
		if controlByte(r) || dangerousFormat(r) {
			// Treat a stripped control byte that was whitespace-like (TAB/NL/CR)
			// as a space so words don't fuse; other controls just vanish.
			if r == '\t' || r == '\n' || r == '\r' {
				if !prevSpace {
					b.WriteByte(' ')
					prevSpace = true
				}
			}
			continue
		}
		if r == ' ' {
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
			continue
		}
		b.WriteRune(r)
		prevSpace = false
	}
	return strings.TrimSpace(b.String())
}

// safeURL returns u only if it is a syntactically valid, length-bounded https
// URL whose host contains a dot and which carries no control/escape bytes;
// otherwise "". An empty return makes osc8 degrade to plain (unlinked) text, so
// a hostile click target can never inject an OSC-8 terminator or a non-https
// (file:, javascript:, data:) scheme. Mirrors validateHttpsUrl in the web tier.
func safeURL(u string) string {
	if u == "" || len(u) > maxURLLen {
		return ""
	}
	for _, r := range u {
		if controlByte(r) || dangerousFormat(r) {
			return ""
		}
	}
	parsed, err := url.Parse(u)
	if err != nil {
		return ""
	}
	if parsed.Scheme != "https" {
		return ""
	}
	if !strings.Contains(parsed.Hostname(), ".") {
		return ""
	}
	return u
}
