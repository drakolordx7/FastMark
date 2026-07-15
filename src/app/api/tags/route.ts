import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser, getUserFromToken, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { tags } from "@/lib/db/schema";
import { handleRouteError, jsonOk } from "@/lib/api";

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

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await authed(req);
    const body = patchSchema.parse(await req.json());
    const [updated] = await db
      .update(tags)
      .set({
        name: body.name.trim(),
        normalizedName: body.name.trim().toLowerCase(),
      })
      .where(and(eq(tags.id, body.id), eq(tags.userId, user.id)))
      .returning();
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
