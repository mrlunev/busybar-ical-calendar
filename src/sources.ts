/**
 * The calendars set up in the bar's web page, and what kind of service each is.
 * The service only switches on known quirks (Microsoft's cut-off bodies); the
 * parsing is the same for all.
 */

export type Vendor = "microsoft" | "google" | "apple" | "proton" | "fastmail" | "other";

export interface Source {
  /** 0..2, the place in the settings. */
  index: number;
  url: string;
  name: string;
  alerts: boolean;
  vendor: Vendor;
}

/** webcal:// is https:// for anything that is not a calendar app; spaces around a pasted link go. */
export function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (/^webcals?:\/\//i.test(url)) return "https://" + url.replace(/^webcals?:\/\//i, "");
  if (!/^https?:\/\//i.test(url) && url !== "") return "https://" + url;
  return url;
}

export function vendorOf(url: string): Vendor {
  const host = (/^https?:\/\/([^/?#]+)/i.exec(url) || ["", ""])[1].toLowerCase();
  // The demo calendar (src/demo.ts): "demo/<service>" takes that service's look.
  if (host === "demo") {
    const v = (/^https?:\/\/demo\/([a-z]+)/i.exec(url) || ["", ""])[1].toLowerCase();
    return v === "microsoft" || v === "google" || v === "apple" || v === "proton" || v === "fastmail" ? v : "other";
  }
  if (host.endsWith("outlook.office365.com") || host.endsWith("outlook.live.com") || host.endsWith("outlook.office.com")) return "microsoft";
  if (host === "calendar.google.com" || host.endsWith(".google.com")) return "google";
  if (host.endsWith("icloud.com")) return "apple";
  if (host.endsWith("proton.me")) return "proton";
  if (host === "user.fm" || host.endsWith("fastmail.com")) return "fastmail";
  return "other";
}

const NAMES: Record<Vendor, string> = {
  microsoft: "Outlook",
  google: "Google",
  apple: "iCloud",
  proton: "Proton",
  fastmail: "Fastmail",
  other: "Calendar",
};

export function defaultName(vendor: Vendor): string {
  return NAMES[vendor];
}
