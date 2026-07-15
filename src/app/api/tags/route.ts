import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser, getUserFromToken, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { tags } from "@/lib/db/schema";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

async function authed(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const user = await getUserFromToken(auth.slice(7));
    if (!user) throw new AuthError("Unauthorized");
    return user;
  }
  return requireUser();
}

export async function GET(req: NextRequest) {
  try {
    const user = await authed(req);
    const rows = await db
      .select()
      .from(tags)
      .where(eq(tags.userId, user.id))
      .orderBy(asc(tags.name));
    return jsonOk({ tags: rows });
  } catch (err) {
    return handleRouteError(err);
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["static", "dynamic"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await authed(req);
    const body = createSchema.parse(await req.json());
    const name = body.name.trim();
    const normalizedName = name.toLowerCase().replace(/\s+/g, " ");
    const [existing] = await db
      .select()
      .from(tags)
      .where(
        and(eq(tags.userId, user.id), eq(tags.normalizedName, normalizedName)),
      )
      .limit(1);
    if (existing) return jsonOk({ tag: existing });
    const [created] = await db
      .insert(tags)
      .values({
        userId: user.id,
        name,
        normalizedName,
        kind: body.kind ?? "static",
      })
      .returning();
    return jsonOk({ tag: created }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  kind: z.enum(["static", "dynamic"]).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await authed(req);
    const body = patchSchema.parse(await req.json());
    const patch: { name?: string; normalizedName?: string; kind?: "static" | "dynamic" } =
      {};
    if (body.name) {
      patch.name = body.name.trim();
      patch.normalizedName = body.name.trim().toLowerCase().replace(/\s+/g, " ");
    }
    if (body.kind) patch.kind = body.kind;

    // Rename keeps the same tag id, so all bookmark_tags links stay valid
    const [updated] = await db
      .update(tags)
      .set(patch)
      .where(and(eq(tags.id, body.id), eq(tags.userId, user.id)))
      .returning();
    if (!updated) return jsonError("Tag not found", 404);
    return jsonOk({ tag: updated });
  } catch (err) {
    return handleRouteError(err);
  }
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  try {
    const user = await authed(req);
    const body = deleteSchema.parse(await req.json());
    await db
      .delete(tags)
      .where(and(eq(tags.id, body.id), eq(tags.userId, user.id)));
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
