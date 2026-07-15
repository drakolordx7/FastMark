import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookmarks } from "@/lib/db/schema";
import { canonicalizeUrl, faviconForUrl } from "@/lib/urls";
import { enqueueIndex } from "@/lib/queue";
import { handleRouteError, jsonOk } from "@/lib/api";

function parseNetscapeBookmarks(html: string): { url: string; title: string }[] {
  const results: { url: string; title: string }[] = [];
  const re = /<A\s+[^>]*HREF=["']([^"']+)["'][^>]*>([^<]*)<\/A>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = m[1];
    const title = m[2]?.trim() || url;
    if (url && /^https?:\/\//i.test(url)) {
      results.push({ url, title });
    }
  }
  return results;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const contentType = req.headers.get("content-type") || "";
    let html = "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file && typeof file !== "string") {
        html = await file.text();
      }
    } else {
      const body = (await req.json()) as { html?: string };
      html = body.html ?? "";
    }

    const items = parseNetscapeBookmarks(html);
    let imported = 0;
    let skipped = 0;

    for (const item of items) {
      let canonicalUrl: string;
      try {
        canonicalUrl = canonicalizeUrl(item.url);
      } catch {
        skipped++;
        continue;
      }
      const [existing] = await db
        .select()
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, user.id),
            eq(bookmarks.canonicalUrl, canonicalUrl),
          ),
        )
        .limit(1);
      if (existing) {
        skipped++;
        continue;
      }
      const [created] = await db
        .insert(bookmarks)
        .values({
          userId: user.id,
          url: item.url,
          canonicalUrl,
          title: item.title,
          faviconUrl: faviconForUrl(canonicalUrl),
          status: "queued",
        })
        .returning();
      if (created) {
        imported++;
        await enqueueIndex({ bookmarkId: created.id, userId: user.id });
      }
    }

    return jsonOk({ imported, skipped, total: items.length });
  } catch (err) {
    return handleRouteError(err);
  }
}
