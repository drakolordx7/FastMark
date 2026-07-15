import { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookmarkTags, bookmarks, tags } from "@/lib/db/schema";
import { enqueueIndex } from "@/lib/queue";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  action: z.enum([
    "favorite",
    "unfavorite",
    "read_later",
    "unread_later",
    "move_collection",
    "add_tag",
    "reindex",
    "delete",
  ]),
  collectionId: z.string().uuid().nullable().optional(),
  tag: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());

    const owned = await db
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(
        and(eq(bookmarks.userId, user.id), inArray(bookmarks.id, body.ids)),
      );
    const ids = owned.map((o) => o.id);
    if (!ids.length) return jsonError("No matching bookmarks");

    switch (body.action) {
      case "favorite":
      case "unfavorite":
        await db
          .update(bookmarks)
          .set({
            favorite: body.action === "favorite",
            updatedAt: new Date(),
          })
          .where(inArray(bookmarks.id, ids));
        break;
      case "read_later":
      case "unread_later":
        await db
          .update(bookmarks)
          .set({
            readLater: body.action === "read_later",
            updatedAt: new Date(),
          })
          .where(inArray(bookmarks.id, ids));
        break;
      case "move_collection":
        await db
          .update(bookmarks)
          .set({
            collectionId: body.collectionId ?? null,
            updatedAt: new Date(),
          })
          .where(inArray(bookmarks.id, ids));
        break;
      case "add_tag": {
        const name = body.tag?.trim();
        if (!name) return jsonError("tag required");
        const normalizedName = name.toLowerCase();
        let [tag] = await db
          .select()
          .from(tags)
          .where(
            and(
              eq(tags.userId, user.id),
              eq(tags.normalizedName, normalizedName),
            ),
          )
          .limit(1);
        if (!tag) {
          [tag] = await db
            .insert(tags)
            .values({
              userId: user.id,
              name,
              normalizedName,
              kind: "static",
            })
            .returning();
        }
        if (tag) {
          for (const id of ids) {
            await db
              .insert(bookmarkTags)
              .values({ bookmarkId: id, tagId: tag.id })
              .onConflictDoNothing();
          }
        }
        break;
      }
      case "reindex":
        await db
          .update(bookmarks)
          .set({ status: "queued", error: null, updatedAt: new Date() })
          .where(inArray(bookmarks.id, ids));
        for (const id of ids) {
          await enqueueIndex({ bookmarkId: id, userId: user.id });
        }
        break;
      case "delete":
        await db.delete(bookmarks).where(inArray(bookmarks.id, ids));
        break;
    }

    return jsonOk({ affected: ids.length });
  } catch (err) {
    return handleRouteError(err);
  }
}
