import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser, getUserFromToken, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { collections } from "@/lib/db/schema";
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
      .from(collections)
      .where(eq(collections.userId, user.id))
      .orderBy(asc(collections.position), asc(collections.name));
    return jsonOk({ collections: rows });
  } catch (err) {
    return handleRouteError(err);
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().uuid().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await authed(req);
    const body = createSchema.parse(await req.json());
    const [created] = await db
      .insert(collections)
      .values({
        userId: user.id,
        name: body.name.trim(),
        parentId: body.parentId ?? null,
      })
      .returning();
    return jsonOk({ collection: created }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  parentId: z.string().uuid().nullable().optional(),
  position: z.number().int().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await authed(req);
    const body = patchSchema.parse(await req.json());
    const [updated] = await db
      .update(collections)
      .set({
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
      })
      .where(and(eq(collections.id, body.id), eq(collections.userId, user.id)))
      .returning();
    return jsonOk({ collection: updated });
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
      .delete(collections)
      .where(
        and(eq(collections.id, body.id), eq(collections.userId, user.id)),
      );
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
