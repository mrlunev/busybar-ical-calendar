/**
 * What the bar's fonts can draw (checked on the stock bar on 18.11):
 *
 * - `small`, `normal`, `bold`: ASCII and Cyrillic (with "ё"); typographic dashes and
 *   guillemets come out as their ASCII look-alikes;
 * - `global`: Latin letters with diacritics too (ü, é, ć, ę, ß), at 11 px a line;
 * - `tiny`: ASCII only.
 *
 * Everything is drawn in `small`: `global` is taller than the line and its top gets
 * cut off. Latin letters with diacritics lose them (é to e, ß to ss, ł to l),
 * characters no font draws (emoji, mostly) are left out, the rest becomes "?".
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

// Latin-1 Supplement from U+00C0 and Latin Extended-A from U+0100, each character's base letter;
// "#" marks the ones that become two letters (MULTI).
const LATIN1 = "AAAAAA#CEEEEIIIIDNOOOOOxOUUUUY##aaaaaa#ceeeeiiiidnooooo/ouuuuy#y";
const LATIN_A = "AaAaAaCcCcCcCcDdDdEeEeEeEeEeGgGgGgGgHhHhIiIiIiIiIi##JjKkkLlLlLlLlLlNnNnNnnNnOoOoOo##RrRrRrSsSsSsSsTtTtTtUuUuUuUuUuUuWwYyYZzZzZzs";
const MULTI: Record<string, string> = {
  "\u00c6": "AE", "\u00e6": "ae", "\u00de": "TH", "\u00fe": "th", "\u00df": "ss",
  "\u0132": "IJ", "\u0133": "ij", "\u0152": "OE", "\u0153": "oe",
  "\u0218": "S", "\u0219": "s", "\u021a": "T", "\u021b": "t",
};

/** One character `small` cannot draw, as letters it can: the base letter, or "?". */
function plainChar(c: string): string {
  const multi = MULTI[c];
  if (multi !== undefined) return multi;
  const code = c.charCodeAt(0);
  const base = code >= 0xc0 && code < 0x100 ? LATIN1.charAt(code - 0xc0) : code >= 0x100 && code < 0x180 ? LATIN_A.charAt(code - 0x100) : "";
  if (base !== "" && base !== "#") return base;
  try {
    const d = c.normalize("NFD").charAt(0);
    if (fitsSmall(d)) return d;
  } catch {
    // No normalize on this engine.
  }
  return "?";
}

/** The text as `small` can draw it: diacritics dropped, anything else it lacks as "?". */
export function smallText(text: string): string {
  if (fitsSmall(text)) return text;
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    out += fitsSmall(c) ? c : plainChar(c);
  }
  return out;
}
