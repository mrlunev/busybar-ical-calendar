/**
 * What the bar's fonts can draw (checked on the stock bar on 18.11):
 *
 * - `small`, `normal`, `bold`: ASCII and Cyrillic (with "ё"); typographic dashes and
 *   guillemets come out as their ASCII look-alikes;
 * - `global`: Latin letters with diacritics too (ü, é, ć, ę, ß), at 11 px a line;
 * - `tiny`: ASCII only.
 *
 * So titles are kept as written. Characters no font draws (emoji, mostly) are
 * left out, and a title that needs Latin diacritics is drawn in `global`.
 */

/** Drops control characters and characters outside the Basic Multilingual Plane (emoji). */
export function cleanText(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      i += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    // Variation selectors and joiners come with emoji.
    if (code === 0xfe0f || code === 0x200d) continue;
    out += code < 32 ? " " : input.charAt(i);
  }
  const clean = out.replace(/\s+/g, " ").trim();
  return clean === "" && input.trim() !== "" ? "?" : clean;
}

/** Whether `small` can draw every character: ASCII, Cyrillic and the punctuation the firmware maps. */
export function fitsSmall(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 128) continue;
    if (code >= 0x400 && code <= 0x4ff) continue;
    if (code === 0xab || code === 0xbb || code === 0xa0 || (code >= 0x2010 && code <= 0x2026)) continue;
    return false;
  }
  return true;
}

/** The font for a line of text: `preferred` when it can draw it, `global` otherwise. */
export function fontFor(text: string, preferred: "small" | "normal" | "bold"): "small" | "normal" | "bold" | "global" {
  return fitsSmall(text) ? preferred : "global";
}
