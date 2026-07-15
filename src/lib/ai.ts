import OpenAI from "openai";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  aiUsage,
  systemSettings,
  userSettings,
  users,
} from "./db/schema";
import { decryptSecret, localEmbedding } from "./crypto";
import { formatAiProviderError } from "./ai-errors";

export { formatAiProviderError };

export type AiCredentials = {
  baseUrl: string;
  apiKey: string;
  model: string | null;
  embeddingModel: string | null;
};

export async function resolveAiCredentials(
  userId: string,
): Promise<AiCredentials | null> {
  const [userRow] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const [sys] = await db.select().from(systemSettings).limit(1);

  const baseUrl =
    userRow?.openaiBaseUrl?.trim() ||
    sys?.globalOpenaiBaseUrl?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "";
  const keyEnc =
    userRow?.openaiApiKeyEncrypted || sys?.globalOpenaiApiKeyEncrypted;
  const apiKey =
    decryptSecret(keyEnc) || process.env.OPENAI_API_KEY?.trim() || "";
  const model =
    userRow?.openaiModel?.trim() ||
    sys?.globalOpenaiModel?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    null;
  const embeddingModel =
    userRow?.embeddingModel?.trim() ||
    sys?.globalEmbeddingModel?.trim() ||
    null;

  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, model, embeddingModel };
}

export function createOpenAI(creds: AiCredentials) {
  return new OpenAI({
    apiKey: creds.apiKey,
    baseURL: creds.baseUrl.replace(/\/$/, ""),
    timeout: 60_000,
    maxRetries: 1,
  });
}

export async function testAiConnection(userId: string) {
  const creds = await resolveAiCredentials(userId);
  if (!creds) {
    return { ok: false as const, error: "Missing base URL or API key" };
  }
  if (!creds.model) {
    return { ok: false as const, error: "No chat model configured" };
  }
  try {
    const client = createOpenAI(creds);
    const completion = await client.chat.completions.create({
      model: creds.model,
      temperature: 0,
      max_tokens: 16,
      messages: [
        { role: "system", content: "Reply with OK only." },
        { role: "user", content: "ping" },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() || "";
    return { ok: true as const, reply: text || "OK", model: creds.model };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AI provider request failed";
    return { ok: false as const, error: message };
  }
}

function dayKey(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}

export async function checkAndRecordUsage(
  userId: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number },
) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const tz = settings?.timezone || "America/Chicago";
  const day = dayKey(tz);

  const [existing] = await db
    .select()
    .from(aiUsage)
    .where(sql`${aiUsage.userId} = ${userId} AND ${aiUsage.day} = ${day}`)
    .limit(1);

  if (user?.aiDailyCap != null && (existing?.requests ?? 0) >= user.aiDailyCap) {
    throw new Error("Daily AI request cap reached");
  }

  if (existing) {
    await db
      .update(aiUsage)
      .set({
        requests: existing.requests + 1,
        promptTokens: existing.promptTokens + (usage?.prompt_tokens ?? 0),
        completionTokens:
          existing.completionTokens + (usage?.completion_tokens ?? 0),
      })
      .where(eq(aiUsage.id, existing.id));
  } else {
    await db.insert(aiUsage).values({
      userId,
      day,
      requests: 1,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
    });
  }
}

export type IndexAiResult = {
  summary: string;
  tags: string[];
  collectionHint: string | null;
  createCollection?: string | null;
};

export async function summarizeAndTag(
  userId: string,
  title: string,
  text: string,
  opts: {
    collectionNames: string[];
    existingTags: string[];
    maxTags: number;
    allowDynamicCollections: boolean;
  },
): Promise<IndexAiResult> {
  const creds = await resolveAiCredentials(userId);
  if (!creds?.model) {
    return {
      summary: text.slice(0, 400),
      tags: [],
      collectionHint: null,
    };
  }

  const maxTags = Math.max(0, Math.min(5, opts.maxTags));
  const client = createOpenAI(creds);
  const prompt = `You organize bookmarks. Prefer EXISTING tags and collections for consistency.
Return JSON only with keys:
summary (2-4 sentences),
tags (0-${maxTags} short strings; reuse existing tags when possible),
collectionHint (one of ${JSON.stringify(opts.collectionNames)} or null),
createCollection (only if allowDynamicCollections and no good match: short new name or null).

Existing tags: ${JSON.stringify(opts.existingTags.slice(0, 200))}
Allow new collections: ${opts.allowDynamicCollections}

Title: ${title}
Content:
${text.slice(0, 12000)}`;

  const completion = await client.chat.completions.create({
    model: creds.model,
    messages: [
      {
        role: "system",
        content: "Return valid JSON only. No markdown. Reuse existing tags whenever reasonable.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  });

  await checkAndRecordUsage(userId, completion.usage);

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as {
      summary?: string;
      tags?: string[];
      collectionHint?: string | null;
      createCollection?: string | null;
    };
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, maxTags)
      : [];
    return {
      summary: parsed.summary?.trim() || text.slice(0, 400),
      tags,
      collectionHint: parsed.collectionHint?.trim() || null,
      createCollection: opts.allowDynamicCollections
        ? parsed.createCollection?.trim() || null
        : null,
    };
  } catch {
    return {
      summary: text.slice(0, 400),
      tags: [],
      collectionHint: null,
    };
  }
}

export async function embedText(userId: string, text: string): Promise<number[]> {
  const creds = await resolveAiCredentials(userId);
  if (creds?.embeddingModel) {
    try {
      const client = createOpenAI(creds);
      const res = await client.embeddings.create({
        model: creds.embeddingModel,
        input: text.slice(0, 8000),
      });
      await checkAndRecordUsage(userId, res.usage);
      const vec = res.data[0]?.embedding;
      if (vec?.length) {
        if (vec.length === 384) return vec;
        if (vec.length > 384) return vec.slice(0, 384);
        return [...vec, ...new Array(384 - vec.length).fill(0)];
      }
    } catch {
      // fall through to local
    }
  }
  return localEmbedding(`${text}`);
}
