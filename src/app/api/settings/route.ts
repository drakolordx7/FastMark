import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { systemSettings, userSettings } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { testAiConnection } from "@/lib/ai";
import { handleRouteError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireUser();
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);
    const [sys] = await db.select().from(systemSettings).limit(1);
    return jsonOk({
      settings: {
        openaiBaseUrl: settings?.openaiBaseUrl ?? "",
        openaiModel: settings?.openaiModel ?? "",
        embeddingModel: settings?.embeddingModel ?? "",
        hasApiKey: Boolean(settings?.openaiApiKeyEncrypted),
        timezone: settings?.timezone ?? "America/Chicago",
        theme: settings?.theme ?? "system",
        logoUrl: settings?.logoUrl || sys?.logoUrl || "/logo.svg",
        maxAiTags: settings?.maxAiTags ?? 5,
        cleanTitles: settings?.cleanTitles ?? true,
        allowDynamicCollections: settings?.allowDynamicCollections ?? true,
        pageSize: settings?.pageSize ?? 50,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

const schema = z.object({
  openaiBaseUrl: z.string().optional(),
  openaiApiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  openaiModel: z.string().optional(),
  embeddingModel: z.string().optional(),
  timezone: z.string().optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  logoUrl: z.string().nullable().optional(),
  maxAiTags: z.number().int().min(0).max(5).optional(),
  cleanTitles: z.boolean().optional(),
  allowDynamicCollections: z.boolean().optional(),
  pageSize: z.number().int().min(10).max(100).optional(),
  testAi: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const raw = await req.json();
    const body = schema.parse({
      openaiBaseUrl: raw.openaiBaseUrl,
      openaiApiKey: raw.openaiApiKey,
      clearApiKey: raw.clearApiKey,
      openaiModel: raw.openaiModel,
      embeddingModel: raw.embeddingModel,
      timezone: raw.timezone,
      theme: raw.theme,
      logoUrl: raw.logoUrl,
      maxAiTags: raw.maxAiTags,
      cleanTitles: raw.cleanTitles,
      allowDynamicCollections: raw.allowDynamicCollections,
      pageSize: raw.pageSize,
      testAi: raw.testAi,
    });

    if (body.testAi) {
      const result = await testAiConnection(user.id);
      return jsonOk({ test: result });
    }

    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);

    let keyEnc = existing?.openaiApiKeyEncrypted ?? null;
    if (body.clearApiKey) keyEnc = null;
    if (typeof body.openaiApiKey === "string" && body.openaiApiKey.trim()) {
      keyEnc = encryptSecret(body.openaiApiKey.trim());
    }

    const patch = {
      openaiBaseUrl:
        body.openaiBaseUrl !== undefined
          ? body.openaiBaseUrl.trim() || null
          : existing?.openaiBaseUrl ?? null,
      openaiApiKeyEncrypted: keyEnc,
      openaiModel:
        body.openaiModel !== undefined
          ? body.openaiModel.trim() || null
          : existing?.openaiModel ?? null,
      embeddingModel:
        body.embeddingModel !== undefined
          ? body.embeddingModel.trim() || null
          : existing?.embeddingModel ?? null,
      timezone: body.timezone?.trim() || existing?.timezone || "America/Chicago",
      theme: body.theme ?? existing?.theme ?? "system",
      logoUrl:
        body.logoUrl !== undefined ? body.logoUrl : existing?.logoUrl ?? null,
      maxAiTags: body.maxAiTags ?? existing?.maxAiTags ?? 5,
      cleanTitles: body.cleanTitles ?? existing?.cleanTitles ?? true,
      allowDynamicCollections:
        body.allowDynamicCollections ??
        existing?.allowDynamicCollections ??
        true,
      pageSize: body.pageSize ?? existing?.pageSize ?? 50,
      updatedAt: new Date(),
    };

    await db
      .insert(userSettings)
      .values({ userId: user.id, ...patch })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: patch,
      });

    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
