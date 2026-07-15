import { eq } from "drizzle-orm";
import { getSessionUser, getUserFromToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { systemSettings, userSettings } from "@/lib/db/schema";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization");
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const user = bearer
      ? await getUserFromToken(bearer)
      : await getSessionUser();
    if (!user) return jsonError("Unauthorized", 401);
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);
    const [sys] = await db.select().from(systemSettings).limit(1);
    return jsonOk({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      settings: {
        timezone: settings?.timezone ?? "America/Chicago",
        theme: settings?.theme ?? "system",
        logoUrl: settings?.logoUrl || sys?.logoUrl || "/logo.svg",
        hasUserAiKey: Boolean(settings?.openaiApiKeyEncrypted),
        hasUserAiUrl: Boolean(settings?.openaiBaseUrl),
        openaiBaseUrl: settings?.openaiBaseUrl ?? "",
        openaiModel: settings?.openaiModel ?? "",
        embeddingModel: settings?.embeddingModel ?? "",
      },
      system: {
        logoUrl: sys?.logoUrl || "/logo.svg",
        hasGlobalAi: Boolean(
          sys?.globalOpenaiApiKeyEncrypted || sys?.globalOpenaiBaseUrl,
        ),
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
