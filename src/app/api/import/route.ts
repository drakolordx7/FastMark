import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookmarks, users } from "@/lib/db/schema";
import { canonicalizeUrl, faviconForUrl, siteHost } from "@/lib/urls";
import { enqueueIndex } from "@/lib/queue";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

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
    const sessionUser = await requireUser();
    const contentType = req.headers.get("content-type") || "";
    let html = "";
    let targetUserId = sessionUser.id;
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file && typeof file !== "string") {
        html = await file.text();
      }
      const forUser = form.get("forUserId");
      if (typeof forUser === "string" && forUser.trim()) {
        await requireAdmin();
        targetUserId = forUser.trim();
        const [target] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, targetUserId))
          .limit(1);
        if (!target) return jsonError("Target user not found", 404);
      }
    } else {
      const body = (await req.json()) as {
        html?: string;
        forUserId?: string;
      };
      html = body.html ?? "";
      if (body.forUserId) {
        await requireAdmin();
        targetUserId = body.forUserId;
      }
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
            eq(bookmarks.userId, targetUserId),
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
          userId: targetUserId,
          url: item.url,
          canonicalUrl,
          siteHost: siteHost(canonicalUrl),
          title: item.title,
          faviconUrl: faviconForUrl(canonicalUrl),
          status: "queued",
        })
        .returning();
      if (created) {
        imported++;
        await enqueueIndex({ bookmarkId: created.id, userId: targetUserId });
      }
    }

    return jsonOk({
      imported,
      skipped,
      total: items.length,
      targetUserId,
      scope:
        targetUserId === sessionUser.id
          ? "your account only"
          : "selected user (admin import)",
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
