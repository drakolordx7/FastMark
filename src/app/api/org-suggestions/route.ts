import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookmarks, collections, orgSuggestions } from "@/lib/db/schema";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(orgSuggestions)
      .where(
        and(
          eq(orgSuggestions.userId, user.id),
          eq(orgSuggestions.status, "pending"),
        ),
      )
      .orderBy(desc(orgSuggestions.createdAt))
      .limit(100);
    return jsonOk({ suggestions: rows });
  } catch (err) {
    return handleRouteError(err);
  }
}

const schema = z.object({
  id: z.string().uuid(),
  action: z.enum(["accept", "reject"]),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const [suggestion] = await db
      .select()
      .from(orgSuggestions)
      .where(
        and(
          eq(orgSuggestions.id, body.id),
          eq(orgSuggestions.userId, user.id),
        ),
      )
      .limit(1);
    if (!suggestion) return jsonError("Not found", 404);

    if (body.action === "reject") {
      await db
        .update(orgSuggestions)
        .set({ status: "rejected" })
        .where(eq(orgSuggestions.id, suggestion.id));
      return jsonOk({ ok: true });
    }

    if (suggestion.kind === "collection") {
      const name = String(suggestion.payload?.name || "").trim();
      if (!name) return jsonError("Invalid collection suggestion");
      let [col] = await db
        .select()
        .from(collections)
        .where(
          and(eq(collections.userId, user.id), eq(collections.name, name)),
        )
        .limit(1);
      if (!col) {
        [col] = await db
          .insert(collections)
          .values({
            userId: user.id,
            name,
            kind: "dynamic",
          })
          .returning();
      }
      if (col && suggestion.bookmarkId) {
        await db
          .update(bookmarks)
          .set({ collectionId: col.id, updatedAt: new Date() })
          .where(
            and(
              eq(bookmarks.id, suggestion.bookmarkId),
              eq(bookmarks.userId, user.id),
            ),
          );
      }
    }

    await db
      .update(orgSuggestions)
      .set({ status: "accepted" })
      .where(eq(orgSuggestions.id, suggestion.id));
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
