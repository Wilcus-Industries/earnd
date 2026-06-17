/**
 * Creative sanitization. Attacker-controlled bytes (`line`, URLs, `icon`) get
 * rendered into a victim developer's terminal row 1 — a real injection surface.
 * Everything here is defense at the trust boundary (the bid API); the Go client
 * re-clamps width as defense in depth.
 *
 * Hard rules:
 *  - strip ALL control/escape bytes (C0, C1, DEL) so no raw ESC/CSI/OSC survives
 *  - strip bidi overrides + zero-width chars (Trojan-Source class attacks)
 *  - collapse whitespace, bound length
 *  - URLs: https only, parseable, length-bounded; served only via the signed redirect
 *  - icon: small, well-formed image magic bytes, or rejected
 */

export interface CleanCreative {
  line: string;
  displayUrl: string;
  targetUrl: string;
  icon: string | null;
}

export type SanitizeResult =
  | { ok: true; value: CleanCreative }
  | { ok: false; error: string };

const MAX_LINE_CODEPOINTS = 140;
const MAX_URL_LEN = 2048;
const MAX_DISPLAY_LEN = 64;
const MAX_ICON_BYTES = 16 * 1024;

// Build a character-class regex from numeric code-point ranges, so the source
// stays pure ASCII (no literal control/invisible bytes to get mangled).
function charClass(ranges: Array<[number, number]>): RegExp {
  const hex = (n: number) => "\\u" + n.toString(16).padStart(4, "0");
  const body = ranges.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join("");
  return new RegExp(`[${body}]`, "g");
}

// C0 (0x00-0x1F) + DEL (0x7F) + C1 (0x80-0x9F): all control/escape bytes.
const CONTROL = charClass([
  [0x00, 0x1f],
  [0x7f, 0x9f],
]);
// Zero-width, bidi embeddings/overrides/isolates, word-joiner & invisibles,
// line/para separators, BOM — the invisible-character / Trojan-Source attack class.
const DANGEROUS_FORMAT = charClass([
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0x2028, 0x2029],
  [0xfeff, 0xfeff],
]);

/** Strip control + dangerous-format chars, collapse whitespace, trim. */
export function sanitizeText(input: string): string {
  return input
    .replace(CONTROL, "")
    .replace(DANGEROUS_FORMAT, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampCodepoints(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length <= max ? s : cps.slice(0, max).join("").trimEnd();
}

/** Validate an https URL; returns the normalized URL or null. */
export function validateHttpsUrl(raw: string): URL | null {
  if (raw.length > MAX_URL_LEN) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (!u.hostname || !u.hostname.includes(".")) return null;
  return u;
}

const IMAGE_MAGIC: Array<{ name: string; bytes: number[] }> = [
  { name: "png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { name: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
];

/** Validate an optional base64 icon: small + recognizable image bytes. */
export function validateIcon(raw: string | null | undefined): { ok: boolean; value: string | null } {
  if (!raw) return { ok: true, value: null };
  const b64 = raw.replace(/^data:image\/[a-z+]+;base64,/, "");
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return { ok: false, value: null };
  }
  if (buf.length === 0 || buf.length > MAX_ICON_BYTES) return { ok: false, value: null };
  const isRiffWebp =
    buf.length > 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP";
  const magicOk =
    isRiffWebp || IMAGE_MAGIC.some((m) => m.bytes.every((b, i) => buf[i] === b));
  if (!magicOk) return { ok: false, value: null };
  return { ok: true, value: b64 };
}

export function sanitizeCreative(input: {
  line: string;
  displayUrl?: string | null;
  targetUrl: string;
  icon?: string | null;
}): SanitizeResult {
  const line = clampCodepoints(sanitizeText(input.line), MAX_LINE_CODEPOINTS);
  if (line.length < 3) return { ok: false, error: "Banner line is empty after sanitizing." };

  const target = validateHttpsUrl(input.targetUrl.trim());
  if (!target) return { ok: false, error: "Target URL must be a valid https:// link." };

  // Prefer a sanitized display URL, else derive a clean host from the target.
  let displayUrl = sanitizeText(input.displayUrl ?? "");
  if (!displayUrl) displayUrl = target.hostname.replace(/^www\./, "");
  displayUrl = clampCodepoints(displayUrl, MAX_DISPLAY_LEN);

  const icon = validateIcon(input.icon);
  if (!icon.ok) return { ok: false, error: "Icon must be a small PNG/JPG/GIF/WebP image." };

  return { ok: true, value: { line, displayUrl, targetUrl: target.toString(), icon: icon.value } };
}
