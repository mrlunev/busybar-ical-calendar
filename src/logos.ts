/**
 * Pixel marks of the calendar services, 8x8, so a meeting shows where it comes
 * from at a glance. Michael's decision of 20.11.2026: the app draws the services'
 * marks on the bar (the rule against service logos is about the announcement's
 * key visual, not the app).
 *
 * Each mark is a picture in rows of characters with its own palette; a space is
 * transparent. The back screen is grey: the firmware turns the colours to grey
 * there, which keeps the shapes.
 */

import type { Vendor } from "./sources.ts";

interface Mark {
  rows: readonly string[];
  colors: Readonly<Record<string, string>>;
}

const MARKS: Record<Vendor, Mark> = {
  // Outlook: the blue tile with a white "O", the envelope behind it.
  microsoft: {
    rows: [
      "  llllll",
      "ddddddll",
      "ddwwddll",
      "dwddwdll",
      "dwddwdll",
      "ddwwddll",
      "ddddddll",
      "  llllll",
    ],
    colors: { d: "#0A4FA3", w: "#FFFFFF", l: "#28A8EA" },
  },
  // Google Calendar: a white page framed in blue, yellow and green, the folded red corner, the blue date in it.
  google: {
    rows: [
      " bbbbbb ",
      "bwwwwwwy",
      "bwbbbbwy",
      "bwwwbwwy",
      "bwwbwwwy",
      "bwbbbbwy",
      "bwwwwwrr",
      " gggggr ",
    ],
    colors: { b: "#4285F4", w: "#FFFFFF", y: "#FBBC04", g: "#34A853", r: "#EA4335" },
  },
  // iCloud (Apple Calendar): a page with the red band on top and the date in black.
  apple: {
    rows: [
      " rrrrrr ",
      "rrrrrrrr",
      "wwwwwwww",
      "wkwwkkkw",
      "wkwwwwkw",
      "wkwwwkww",
      "wkwwwkww",
      " wwwwww ",
    ],
    colors: { r: "#FF3B30", w: "#FFFFFF", k: "#1C1C1E" },
  },
  // Proton Calendar: the purple tile with a light calendar grid.
  proton: {
    rows: [
      " pppppp ",
      "pPPPPPPp",
      "pPwwwwPp",
      "pPwlwlPp",
      "pPwwwwPp",
      "pPwlwlPp",
      "pPPPPPPp",
      " pppppp ",
    ],
    colors: { p: "#6D4AFF", P: "#8A6CFF", w: "#FFFFFF", l: "#C4B5FF" },
  },
  // Fastmail: the dark blue tile with a white envelope.
  fastmail: {
    rows: [
      " nnnnnn ",
      "nnnnnnnn",
      "nwwwwwwn",
      "nwnwwnwn",
      "nwwnnwwn",
      "nwwwwwwn",
      "nnnnnnnn",
      " nnnnnn ",
    ],
    colors: { n: "#0067B9", w: "#FFFFFF" },
  },
  // Anything else: a plain calendar page.
  other: {
    rows: [
      " g gg g ",
      "gggggggg",
      "wwwwwwww",
      "wkwkwkww",
      "wwwwwwww",
      "wkwkwkww",
      "wwwwwwww",
      " wwwwww ",
    ],
    colors: { g: "#8A8F98", w: "#E8EAED", k: "#5F6368" },
  },
};

/** The mark as XPM2 text for an `xpmbitmap` element. */
export function logoXpm(vendor: Vendor): string {
  const mark = MARKS[vendor];
  const keys = Object.keys(mark.colors);
  const palette = ["  c none"];
  for (let i = 0; i < keys.length; i += 1) palette.push(`${keys[i]} c ${mark.colors[keys[i]]}`);
  return ["! XPM2", `8 8 ${palette.length} 1`, ...palette, ...mark.rows].join("\n");
}

export const LOGO_SIZE = 8;

/** For the tests and the preview: the colour of one pixel, or null where it is transparent. */
export function logoPixel(vendor: Vendor, x: number, y: number): string | null {
  const c = MARKS[vendor].rows[y].charAt(x);
  return c === " " ? null : MARKS[vendor].colors[c];
}
