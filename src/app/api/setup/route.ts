import { NextRequest } from "next/server";
import { count } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  createSession,
  hashPassword,
  seedUserDefaults,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { cookies } from "next/headers";

const bodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1),
});

export async function GET() {
  const [row] = await db.select({ n: count() }).from(users);
  return jsonOk({ needsSetup: (row?.n ?? 0) === 0 });
}

export async function POST(req: NextRequest) {
  try {
    const [row] = await db.select({ n: count() }).from(users);
    if ((row?.n ?? 0) > 0) {
      return jsonError("Setup already completed", 400);
    }
    const body = bodySchema.parse(await req.json());
    const passwordHash = await hashPassword(body.password);
    const [user] = await db
      .insert(users)
      .values({
        username: body.username.trim(),
        passwordHash,
        role: "admin",
      })
      .returning();
    if (!user) return jsonError("Failed to create admin", 500);
    await seedUserDefaults(user.id);
    const { token, expiresAt } = await createSession(user.id, "web");
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return jsonOk({
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
