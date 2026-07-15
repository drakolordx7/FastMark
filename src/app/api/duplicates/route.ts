import { NextRequest } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookmarks } from "@/lib/db/schema";
import { isTopLevelUrl, pathDepth } from "@/lib/urls";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

/** Related pages: same host, different canonical URLs (not exact dupes). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const host = req.nextUrl.searchParams.get("host")?.trim();
    const rows = await db
      .select({
        id: bookmarks.id,
        url: bookmarks.url,
        canonicalUrl: bookmarks.canonicalUrl,
        title: bookmarks.title,
        siteHost: bookmarks.siteHost,
        status: bookmarks.status,
        createdAt: bookmarks.createdAt,
      })
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.userId, user.id),
          host ? eq(bookmarks.siteHost, host) : sql`true`,
        ),
      );

    const byHost = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.siteHost || "unknown";
      const list = byHost.get(key) ?? [];
      list.push(row);
      byHost.set(key, list);
    }

    const groups = [...byHost.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([siteHost, list]) => ({
        siteHost,
        count: list.length,
        topLevel: list.filter((b) => isTopLevelUrl(b.canonicalUrl)),
        pages: list
          .map((b) => ({
            ...b,
            pathDepth: pathDepth(b.canonicalUrl),
            isTopLevel: isTopLevelUrl(b.canonicalUrl),
          }))
          .sort((a, b) => a.pathDepth - b.pathDepth),
      }))
      .sort((a, b) => b.count - a.count);

    return jsonOk({ groups });
  } catch (err) {
    return handleRouteError(err);
  }
}

const resolveSchema = z.object({
  siteHost: z.string().min(1),
  action: z.enum(["keep_all", "keep_selected", "keep_top_level"]),
  keepIds: z.array(z.string().uuid()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = resolveSchema.parse(await req.json());
    const rows = await db
      .select()
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.userId, user.id),
          eq(bookmarks.siteHost, body.siteHost),
        ),
      );

    if (body.action === "keep_all") {
      return jsonOk({ deleted: 0, kept: rows.length });
    }

    let keep = new Set<string>();
    if (body.action === "keep_selected") {
      keep = new Set(body.keepIds || []);
      if (!keep.size) return jsonError("keepIds required");
    } else if (body.action === "keep_top_level") {
      const tops = rows.filter((r) => isTopLevelUrl(r.canonicalUrl));
      keep = new Set(
        (tops.length ? tops : [rows.sort((a, b) => pathDepth(a.canonicalUrl) - pathDepth(b.canonicalUrl))[0]!]).map(
          (r) => r.id,
        ),
      );
    }

    const deleteIds = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (deleteIds.length) {
      await db
        .delete(bookmarks)
        .where(
          and(eq(bookmarks.userId, user.id), inArray(bookmarks.id, deleteIds)),
        );
    }
    return jsonOk({ deleted: deleteIds.length, kept: keep.size });
  } catch (err) {
    return handleRouteError(err);
  }
}
