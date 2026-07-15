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
  });
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
};

export async function summarizeAndTag(
  userId: string,
  title: string,
  text: string,
  collectionNames: string[],
): Promise<IndexAiResult> {
  const creds = await resolveAiCredentials(userId);
  if (!creds?.model) {
    return {
      summary: text.slice(0, 400),
      tags: [],
      collectionHint: null,
    };
  }

  const client = createOpenAI(creds);
  const prompt = `You organize bookmarks. Given a page title and content, return JSON only with keys:
summary (2-4 sentences), tags (3-8 short strings), collectionHint (one of ${JSON.stringify(collectionNames)} or null).

Title: ${title}
Content:
${text.slice(0, 12000)}`;

  const completion = await client.chat.completions.create({
    model: creds.model,
    messages: [
      {
        role: "system",
        content: "Return valid JSON only. No markdown.",
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
    };
    return {
      summary: parsed.summary?.trim() || text.slice(0, 400),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
        : [],
      collectionHint: parsed.collectionHint?.trim() || null,
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
        // Pad/truncate to 384 for storage compatibility
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
