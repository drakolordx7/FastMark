import { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookmarkTags, bookmarks } from "@/lib/db/schema";
import { enqueueIndex } from "@/lib/queue";
import { handleRouteError, jsonOk } from "@/lib/api";

const schema = z.object({
  scope: z.enum(["one", "all", "collection", "tag"]),
  bookmarkId: z.string().uuid().optional(),
  collectionId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());
    let ids: string[] = [];

    if (body.scope === "one" && body.bookmarkId) {
      const [b] = await db
        .select()
        .from(bookmarks)
        .where(
          and(eq(bookmarks.id, body.bookmarkId), eq(bookmarks.userId, user.id)),
        )
        .limit(1);
      if (b) ids = [b.id];
    } else if (body.scope === "all") {
      const rows = await db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(eq(bookmarks.userId, user.id));
      ids = rows.map((r) => r.id);
    } else if (body.scope === "collection" && body.collectionId) {
      const rows = await db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, user.id),
            eq(bookmarks.collectionId, body.collectionId),
          ),
        );
      ids = rows.map((r) => r.id);
    } else if (body.scope === "tag" && body.tagId) {
      const links = await db
        .select({ bookmarkId: bookmarkTags.bookmarkId })
        .from(bookmarkTags)
        .innerJoin(bookmarks, eq(bookmarkTags.bookmarkId, bookmarks.id))
        .where(
          and(eq(bookmarkTags.tagId, body.tagId), eq(bookmarks.userId, user.id)),
        );
      ids = links.map((l) => l.bookmarkId);
    }

    if (ids.length) {
      await db
        .update(bookmarks)
        .set({ status: "queued", error: null, updatedAt: new Date() })
        .where(and(eq(bookmarks.userId, user.id), inArray(bookmarks.id, ids)));
      for (const id of ids) {
        await enqueueIndex({ bookmarkId: id, userId: user.id });
      }
    }

    return jsonOk({ queued: ids.length });
  } catch (err) {
    return handleRouteError(err);
  }
}
