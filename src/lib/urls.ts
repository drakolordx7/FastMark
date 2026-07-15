const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
]);

export function canonicalizeUrl(raw: string): string {
  let input = raw.trim();
  if (!/^https?:\/\//i.test(input)) {
    input = `https://${input}`;
  }
  const url = new URL(input);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of params) url.searchParams.append(k, v);
  let path = url.pathname.replace(/\/+$/, "");
  if (!path) path = "";
  url.pathname = path || "/";
  return url.toString();
}

export function siteHost(url: string): string {
  try {
    return new URL(canonicalizeUrl(url)).hostname;
  } catch {
    return "";
  }
}

export function pathDepth(url: string): number {
  try {
    const path = new URL(canonicalizeUrl(url)).pathname.replace(/\/+$/, "");
    if (!path || path === "/") return 0;
    return path.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

export function isTopLevelUrl(url: string): boolean {
  return pathDepth(url) === 0;
}

export function faviconForUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
  } catch {
    return "/logo.svg";
  }
}
