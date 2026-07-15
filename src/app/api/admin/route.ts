import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin, hashPassword, seedUserDefaults } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiUsage, systemSettings, users } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    await requireAdmin();
    const userRows = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        disabled: users.disabled,
        aiDailyCap: users.aiDailyCap,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
    const [sys] = await db.select().from(systemSettings).limit(1);
    const usage = await db.select().from(aiUsage).orderBy(desc(aiUsage.day)).limit(100);
    return jsonOk({
      users: userRows,
      system: {
        globalOpenaiBaseUrl: sys?.globalOpenaiBaseUrl ?? "",
        globalOpenaiModel: sys?.globalOpenaiModel ?? "",
        globalEmbeddingModel: sys?.globalEmbeddingModel ?? "",
        hasGlobalApiKey: Boolean(sys?.globalOpenaiApiKeyEncrypted),
        crawlMaxHtmlBytes: sys?.crawlMaxHtmlBytes ?? 2_000_000,
        crawlMaxTextChars: sys?.crawlMaxTextChars ?? 500_000,
        crawlTimeoutMs: sys?.crawlTimeoutMs ?? 20_000,
        logoUrl: sys?.logoUrl ?? "/logo.svg",
      },
      usage,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

const createUserSchema = z.object({
  action: z.literal("create_user"),
  username: z.string().min(1),
  password: z.string().min(1),
  role: z.enum(["admin", "user"]).optional(),
});

const patchUserSchema = z.object({
  action: z.literal("patch_user"),
  userId: z.string().uuid(),
  disabled: z.boolean().optional(),
  aiDailyCap: z.number().int().nullable().optional(),
  password: z.string().min(1).optional(),
});

const systemSchema = z.object({
  action: z.literal("system"),
  globalOpenaiBaseUrl: z.string().optional(),
  globalOpenaiApiKey: z.string().optional(),
  clearGlobalApiKey: z.boolean().optional(),
  globalOpenaiModel: z.string().optional(),
  globalEmbeddingModel: z.string().optional(),
  crawlMaxHtmlBytes: z.coerce.number().int().optional(),
  crawlMaxTextChars: z.coerce.number().int().optional(),
  crawlTimeoutMs: z.coerce.number().int().optional(),
  logoUrl: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const raw = await req.json();
    if (raw.action === "create_user") {
      const body = createUserSchema.parse(raw);
      const passwordHash = await hashPassword(body.password);
      const [created] = await db
        .insert(users)
        .values({
          username: body.username.trim(),
          passwordHash,
          role: body.role ?? "user",
        })
        .returning();
      if (!created) return jsonError("Failed", 500);
      await seedUserDefaults(created.id);
      return jsonOk({ user: { id: created.id, username: created.username } });
    }
    if (raw.action === "patch_user") {
      const body = patchUserSchema.parse(raw);
      const patch: {
        disabled?: boolean;
        aiDailyCap?: number | null;
        passwordHash?: string;
      } = {};
      if (body.disabled !== undefined) patch.disabled = body.disabled;
      if (body.aiDailyCap !== undefined) patch.aiDailyCap = body.aiDailyCap;
      if (body.password) patch.passwordHash = await hashPassword(body.password);
      await db.update(users).set(patch).where(eq(users.id, body.userId));
      return jsonOk({ ok: true });
    }
    if (raw.action === "system") {
      const body = systemSchema.parse({
        action: "system",
        globalOpenaiBaseUrl: raw.globalOpenaiBaseUrl,
        globalOpenaiApiKey: raw.globalOpenaiApiKey,
        clearGlobalApiKey: raw.clearGlobalApiKey,
        globalOpenaiModel: raw.globalOpenaiModel,
        globalEmbeddingModel: raw.globalEmbeddingModel,
        crawlMaxHtmlBytes: raw.crawlMaxHtmlBytes,
        crawlMaxTextChars: raw.crawlMaxTextChars,
        crawlTimeoutMs: raw.crawlTimeoutMs,
        logoUrl: raw.logoUrl,
      });
      const [sys] = await db.select().from(systemSettings).limit(1);
      let keyEnc = sys?.globalOpenaiApiKeyEncrypted ?? null;
      if (body.clearGlobalApiKey) keyEnc = null;
      if (typeof body.globalOpenaiApiKey === "string" && body.globalOpenaiApiKey.trim()) {
        keyEnc = encryptSecret(body.globalOpenaiApiKey.trim());
      }
      const patch = {
        globalOpenaiBaseUrl:
          body.globalOpenaiBaseUrl !== undefined
            ? body.globalOpenaiBaseUrl.trim() || null
            : sys?.globalOpenaiBaseUrl ?? null,
        globalOpenaiApiKeyEncrypted: keyEnc,
        globalOpenaiModel:
          body.globalOpenaiModel !== undefined
            ? body.globalOpenaiModel.trim() || null
            : sys?.globalOpenaiModel ?? null,
        globalEmbeddingModel:
          body.globalEmbeddingModel !== undefined
            ? body.globalEmbeddingModel.trim() || null
            : sys?.globalEmbeddingModel ?? null,
        crawlMaxHtmlBytes:
          body.crawlMaxHtmlBytes ?? sys?.crawlMaxHtmlBytes ?? 2_000_000,
        crawlMaxTextChars:
          body.crawlMaxTextChars ?? sys?.crawlMaxTextChars ?? 500_000,
        crawlTimeoutMs: body.crawlTimeoutMs ?? sys?.crawlTimeoutMs ?? 20_000,
        logoUrl: body.logoUrl ?? sys?.logoUrl ?? "/logo.svg",
        updatedAt: new Date(),
      };
      await db
        .insert(systemSettings)
        .values({ id: 1, ...patch })
        .onConflictDoUpdate({
          target: systemSettings.id,
          set: patch,
        });
      return jsonOk({ ok: true });
    }
    return jsonError("Unknown action");
  } catch (err) {
    return handleRouteError(err);
  }
}
