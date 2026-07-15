import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export type CrawlErrorKind =
  | "http"
  | "timeout"
  | "blocked"
  | "too_large"
  | "extract"
  | "network"
  | "unsupported";

export type CrawlResult =
  | {
      ok: true;
      title: string;
      text: string;
      htmlLength: number;
    }
  | {
      ok: false;
      reason: string;
      kind: CrawlErrorKind;
    };

const BLOCK_HINTS = [
  "cloudflare",
  "captcha",
  "access denied",
  "bot detection",
  "just a moment",
  "verify you are human",
  "attention required",
];

export async function crawlUrl(
  url: string,
  opts: { timeoutMs: number; maxHtmlBytes: number; maxTextChars: number },
): Promise<CrawlResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; FastMark/0.1; +https://github.com/drakolordx7/FastMark)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (res.status === 429) {
      return {
        ok: false,
        reason: "Rate limited (HTTP 429)",
        kind: "blocked",
      };
    }
    if (res.status === 403 || res.status === 401) {
      return {
        ok: false,
        reason: `Blocked by site (HTTP ${res.status}) — try manual index`,
        kind: "blocked",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: `HTTP ${res.status}`,
        kind: "http",
      };
    }
    const contentType = res.headers.get("content-type") || "";
    if (
      contentType &&
      !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)
    ) {
      return {
        ok: false,
        reason: `Unsupported content type: ${contentType}`,
        kind: "unsupported",
      };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > opts.maxHtmlBytes) {
      return {
        ok: false,
        reason: `HTML too large (${buf.byteLength} bytes)`,
        kind: "too_large",
      };
    }
    const html = buf.toString("utf8");
    const lower = html.slice(0, 8000).toLowerCase();
    if (BLOCK_HINTS.some((h) => lower.includes(h)) && html.length < 20000) {
      return {
        ok: false,
        reason: "Site appears to block automated fetch — use manual index",
        kind: "blocked",
      };
    }
    return extractFromHtml(html, url, opts.maxTextChars);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed";
    if (/abort/i.test(message)) {
      return { ok: false, reason: "Timed out", kind: "timeout" };
    }
    return { ok: false, reason: message, kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

export function extractFromHtml(
  html: string,
  url: string,
  maxTextChars: number,
): CrawlResult {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const title =
      article?.title?.trim() ||
      dom.window.document.title?.trim() ||
      url;
    let text = (article?.textContent || dom.window.document.body?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text.length < 40) {
      return {
        ok: false,
        reason: "Could not extract readable content — paste HTML to index",
        kind: "extract",
      };
    }
    if (text.length > maxTextChars) {
      text = text.slice(0, maxTextChars);
    }
    return { ok: true, title, text, htmlLength: html.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parse failed";
    return { ok: false, reason: message, kind: "extract" };
  }
}
