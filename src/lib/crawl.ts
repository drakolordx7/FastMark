import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

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
    };

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
          "FastMark/0.1 (+https://github.com/drakolordx7/FastMark; bookmark-indexer)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > opts.maxHtmlBytes) {
      return {
        ok: false,
        reason: `HTML too large (${buf.byteLength} bytes)`,
      };
    }
    const html = buf.toString("utf8");
    return extractFromHtml(html, url, opts.maxTextChars);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed";
    return { ok: false, reason: message };
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
      return { ok: false, reason: "Could not extract readable content" };
    }
    if (text.length > maxTextChars) {
      text = text.slice(0, maxTextChars);
    }
    return { ok: true, title, text, htmlLength: html.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parse failed";
    return { ok: false, reason: message };
  }
}
