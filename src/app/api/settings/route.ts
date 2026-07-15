import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { systemSettings, userSettings } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";
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
});

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);

    let keyEnc = existing?.openaiApiKeyEncrypted ?? null;
    if (body.clearApiKey) keyEnc = null;
    if (body.openaiApiKey !== undefined && body.openaiApiKey !== "") {
      keyEnc = encryptSecret(body.openaiApiKey);
    }

    const values = {
      userId: user.id,
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
      timezone: body.timezone ?? existing?.timezone ?? "America/Chicago",
      theme: body.theme ?? existing?.theme ?? "system",
      logoUrl:
        body.logoUrl !== undefined ? body.logoUrl : existing?.logoUrl ?? null,
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(userSettings)
        .set(values)
        .where(eq(userSettings.userId, user.id));
    } else {
      await db.insert(userSettings).values(values);
    }

    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
