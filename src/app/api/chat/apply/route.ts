import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  bookmarkTags,
  bookmarks,
  collections,
  tags,
} from "@/lib/db/schema";
import type { Proposal } from "@/lib/proposals";
import { handleRouteError, jsonOk } from "@/lib/api";

const schema = z.object({
  proposals: z.array(z.unknown()),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const proposals = body.proposals as Proposal[];
    let applied = 0;

    for (const p of proposals) {
      if (p.type === "move_to_collection") {
        let [col] = await db
          .select()
          .from(collections)
          .where(
            and(
              eq(collections.userId, user.id),
              eq(collections.name, p.collectionName),
            ),
          )
          .limit(1);
        if (!col && p.createIfMissing) {
          [col] = await db
            .insert(collections)
            .values({ userId: user.id, name: p.collectionName })
            .returning();
        }
        if (!col) continue;
        for (const id of p.bookmarkIds) {
          await db
            .update(bookmarks)
            .set({ collectionId: col.id, updatedAt: new Date() })
            .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id)));
          applied++;
        }
      } else if (p.type === "add_tag") {
        const normalizedName = p.tag.trim().toLowerCase();
        if (!normalizedName) continue;
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
              name: p.tag.trim(),
              normalizedName,
            })
            .returning();
        }
        if (!tag) continue;
        for (const id of p.bookmarkIds) {
          const [b] = await db
            .select()
            .from(bookmarks)
            .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id)))
            .limit(1);
          if (!b) continue;
          await db
            .insert(bookmarkTags)
            .values({ bookmarkId: id, tagId: tag.id })
            .onConflictDoNothing();
          applied++;
        }
      } else if (p.type === "set_favorite") {
        for (const id of p.bookmarkIds) {
          await db
            .update(bookmarks)
            .set({ favorite: p.value, updatedAt: new Date() })
            .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id)));
          applied++;
        }
      } else if (p.type === "set_read_later") {
        for (const id of p.bookmarkIds) {
          await db
            .update(bookmarks)
            .set({ readLater: p.value, updatedAt: new Date() })
            .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id)));
          applied++;
        }
      }
    }

    return jsonOk({ applied });
  } catch (err) {
    return handleRouteError(err);
  }
}
