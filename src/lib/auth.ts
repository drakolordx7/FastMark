import { cookies } from "next/headers";
import { eq, and, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { sessions, users, userSettings, collections, type User } from "./db/schema";
import { hashToken, randomToken } from "./crypto";

export const SESSION_COOKIE = "fastmark_session";

const SEED_COLLECTIONS = [
  "Unsorted",
  "Gaming",
  "TV",
  "Browser tools",
  "Code",
];

export function cookieSecure(): boolean {
  const mode = process.env.COOKIE_SECURE ?? "auto";
  if (mode === "true") return true;
  if (mode === "false") return false;
  const appUrl = process.env.APP_URL ?? "";
  return appUrl.startsWith("https://");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(
  userId: string,
  kind: "web" | "extension" = "web",
  days = 30,
) {
  const token = randomToken(32);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({
    userId,
    tokenHash,
    kind,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function destroySession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function getUserFromToken(token: string | undefined | null) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await db
    .select({
      user: users,
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.user.disabled) return null;
  return row.user;
}

export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return getUserFromToken(token);
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Unauthorized");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("Forbidden");
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = message === "Forbidden" ? 403 : status;
  }
}

export async function seedUserDefaults(userId: string) {
  await db
    .insert(userSettings)
    .values({ userId, timezone: "America/Chicago" })
    .onConflictDoNothing();

  const existing = await db
    .select()
    .from(collections)
    .where(eq(collections.userId, userId))
    .limit(1);
  if (existing.length) return;

  await db.insert(collections).values(
    SEED_COLLECTIONS.map((name, position) => ({
      userId,
      name,
      position,
    })),
  );
}

export async function userCount() {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/",
    expires: expiresAt,
  };
}
