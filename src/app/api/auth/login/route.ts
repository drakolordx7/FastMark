import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  createSession,
  seedUserDefaults,
  sessionCookieOptions,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  kind: z.enum(["web", "extension"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = bodySchema.parse(await req.json());
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, body.username.trim()))
      .limit(1);
    if (!user || user.disabled) {
      return jsonError("Invalid credentials", 401);
    }
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) return jsonError("Invalid credentials", 401);
    await seedUserDefaults(user.id);
    const kind = body.kind ?? "web";
    const { token, expiresAt } = await createSession(user.id, kind);
    if (kind === "web") {
      const jar = await cookies();
      jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
      return jsonOk({
        user: { id: user.id, username: user.username, role: user.role },
      });
    }
    return jsonOk({
      token,
      expiresAt,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
