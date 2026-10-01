/**
 * Coarse, privacy-friendly descriptions of where a session or security event came from.
 * Pure and client-safe. Full user-agent strings and full IP addresses are never shown.
 */

export type DeviceKind = "desktop" | "mobile" | "tablet" | "app" | "unknown";

export interface DeviceDescription {
  /** "Chrome on macOS", "Harbour for Mac", "Safari on iPhone". */
  label: string;
  browser: string | null;
  os: string | null;
  kind: DeviceKind;
}

function detectOs(ua: string): string | null {
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

function detectBrowser(ua: string): string | null {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/CriOS\//.test(ua)) return "Chrome";
  if (/(Headless)?Chrome\/|Chromium\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  if (/AppleWebKit/.test(ua) && /(iPhone|iPad|iPod)/.test(ua)) return "Safari";
  return null;
}

export function describeUserAgent(ua: string | null | undefined): DeviceDescription {
  if (!ua || !ua.trim()) return { label: "Unknown device", browser: null, os: null, kind: "unknown" };
  const os = detectOs(ua);
  // The Mac desktop app is an Electron shell around this web app.
  if (/Electron\/|Harbour\//.test(ua)) {
    return { label: os === "macOS" ? "Harbour for Mac" : "Harbour desktop app", browser: null, os, kind: "app" };
  }
  const browser = detectBrowser(ua);
  const kind: DeviceKind = os === "iPad" || (/Android/.test(ua) && !/Mobile/.test(ua)) ? "tablet" : os === "iPhone" || /Mobile|Android/.test(ua) ? "mobile" : os ? "desktop" : "unknown";
  const label = browser && os ? `${browser} on ${os}` : browser ?? (os ? `Browser on ${os}` : "Unknown browser");
  return { label, browser, os, kind };
}

/**
 * Coarse network location: the last IPv4 octet or everything after the /48 of an
 * IPv6 address is hidden ("203.0.113.x", "2001:db8:85a3::/48").
 */
export function coarseIp(ip: string | null | undefined): string {
  if (!ip) return "Unknown network";
  const v = ip.trim().replace(/^::ffff:/i, "");
  if (v === "127.0.0.1" || v === "::1" || v === "localhost") return "This computer";
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
  if (v.includes(":")) {
    const head = v.split("::")[0].split(":").filter(Boolean).slice(0, 3);
    while (head.length < 3) head.push("0");
    return `${head.join(":")}::/48`;
  }
  return "Unknown network";
}
