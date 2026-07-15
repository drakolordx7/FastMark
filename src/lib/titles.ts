/** Clean noisy site titles like "Foo | Site Name" or HTML entities. */
export function cleanTitle(raw: string | null | undefined, host?: string | null): string {
  if (!raw) return "";
  let title = raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();

  const separators = [" | ", " - ", " — ", " – ", " · ", " :: "];
  for (const sep of separators) {
    if (!title.includes(sep)) continue;
    const parts = title.split(sep).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const last = parts[parts.length - 1]!.toLowerCase();
    const hostHint = (host || "").replace(/^www\./, "").split(".")[0] || "";
    if (
      last.length <= 28 ||
      (hostHint && last.includes(hostHint.toLowerCase())) ||
      /^(home|official|website|site)$/i.test(last)
    ) {
      title = parts.slice(0, -1).join(sep).trim() || title;
      break;
    }
  }
  return title.slice(0, 300);
}
