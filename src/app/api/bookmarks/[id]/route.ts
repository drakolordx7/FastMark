import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookmarkTags, bookmarks, tags } from "@/lib/db/schema";
import { enqueueIndex } from "@/lib/queue";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const [bookmark] = await db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id)))
      .limit(1);
    if (!bookmark) return jsonError("Not found", 404);
    const tagRows = await db
      .select({ id: tags.id, name: tags.name })
      .from(bookmarkTags)
      .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
      .where(eq(bookmarkTags.bookmarkId, id));
    return jsonOk({ bookmark: { ...bookmark, tags: tagRows } });
  } catch (err) {
    return handleRouteError(err);
  }
}

const patchSchema = z.object({
  title: z.string().optional(),
  collectionId: z.string().uuid().nullable().optional(),
  favorite: z.boolean().optional(),
  readLater: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  html: z.string().optional(),
  summary: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const [bookmark] = await db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id)))
      .limit(1);
    if (!bookmark) return jsonError("Not found", 404);

    const [updated] = await db
      .update(bookmarks)
      .set({
        title: body.title ?? bookmark.title,
        collectionId:
          body.collectionId === undefined
            ? bookmark.collectionId
            : body.collectionId,
        favorite: body.favorite ?? bookmark.favorite,
        readLater: body.readLater ?? bookmark.readLater,
        summary: body.summary ?? bookmark.summary,
        updatedAt: new Date(),
      })
      .where(eq(bookmarks.id, id))
      .returning();

    if (body.tags) {
      await db.delete(bookmarkTags).where(eq(bookmarkTags.bookmarkId, id));
      for (const name of body.tags) {
        const normalizedName = name.trim().toLowerCase();
        if (!normalizedName) continue;
        let [tag] = await db
          .select()
          .from(tags)
          .where(
            and(eq(tags.userId, user.id), eq(tags.normalizedName, normalizedName)),
          )
          .limit(1);
        if (!tag) {
          [tag] = await db
            .insert(tags)
            .values({
              userId: user.id,
              name: name.trim(),
              normalizedName,
            })
            .returning();
        }
        if (tag) {
          await db
            .insert(bookmarkTags)
            .values({ bookmarkId: id, tagId: tag.id })
            .onConflictDoNothing();
        }
      }
    }

    if (body.html) {
      await db
        .update(bookmarks)
        .set({ status: "queued", error: null, updatedAt: new Date() })
        .where(eq(bookmarks.id, id));
      await enqueueIndex({
        bookmarkId: id,
        userId: user.id,
        html: body.html,
      });
    }

    return jsonOk({ bookmark: updated });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await db
      .delete(bookmarks)
      .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id)));
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
