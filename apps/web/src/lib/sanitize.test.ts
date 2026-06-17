import { describe, expect, it } from "vitest";
import { validateIcon } from "./sanitize";

describe("validateIcon", () => {
  it("accepts a single emoji and returns it verbatim", () => {
    for (const e of [
      "🚀", // simple pictographic
      "❤️", // pictographic + VS16
      "👍🏽", // skin-tone modifier
      "👨‍💻", // ZWJ sequence
      "🇧🇷", // regional-indicator flag pair
      "👨‍👩‍👧‍👦", // multi-ZWJ family (7 codepoints)
    ]) {
      expect(validateIcon(e), e).toEqual({ ok: true, value: e });
    }
  });

  it("treats empty/blank/missing as a cleared icon", () => {
    expect(validateIcon(null)).toEqual({ ok: true, value: null });
    expect(validateIcon(undefined)).toEqual({ ok: true, value: null });
    expect(validateIcon("")).toEqual({ ok: true, value: null });
    expect(validateIcon("   ")).toEqual({ ok: true, value: null });
  });

  it("trims surrounding whitespace", () => {
    expect(validateIcon("  🚀  ")).toEqual({ ok: true, value: "🚀" });
  });

  it("rejects text, digits, and mixed content", () => {
    for (const bad of ["a", "abc", "1", "🚀x", "x🚀", ":rocket:"]) {
      expect(validateIcon(bad).ok, bad).toBe(false);
    }
  });

  it("rejects more than one emoji", () => {
    expect(validateIcon("🚀🚀").ok).toBe(false);
    expect(validateIcon("🚀🔥").ok).toBe(false);
  });

  it("rejects control/escape bytes and leftover base64 image data", () => {
    expect(validateIcon("\u0001").ok).toBe(false); // raw control byte
    expect(validateIcon("\u001b[31m").ok).toBe(false); // ANSI escape
    expect(validateIcon("iVBORw0KGgoAAAANSUhEUg").ok).toBe(false); // base64 PNG header
  });

  it("rejects sequences past the codepoint cap", () => {
    expect(validateIcon("🚀".repeat(9)).ok).toBe(false);
  });
});
