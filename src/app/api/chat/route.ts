import { NextRequest } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  bookmarkTags,
  bookmarks,
  chatMessages,
  chatSessions,
  collections,
  tags,
} from "@/lib/db/schema";
import type { Proposal } from "@/lib/proposals";
import {
  createOpenAI,
  resolveAiCredentials,
  checkAndRecordUsage,
} from "@/lib/ai";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const messageSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const sessionId = req.nextUrl.searchParams.get("sessionId");
    if (!sessionId) {
      const sessions = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.userId, user.id))
        .orderBy(desc(chatSessions.updatedAt))
        .limit(20);
      return jsonOk({ sessions });
    }
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(
        and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, user.id)),
      )
      .limit(1);
    if (!session) return jsonError("Not found", 404);
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt);
    return jsonOk({ session, messages });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = messageSchema.parse(await req.json());
    let sessionId = body.sessionId;
    if (!sessionId) {
      const [session] = await db
        .insert(chatSessions)
        .values({ userId: user.id })
        .returning();
      sessionId = session!.id;
    } else {
      const [session] = await db
        .select()
        .from(chatSessions)
        .where(
          and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, user.id)),
        )
        .limit(1);
      if (!session) return jsonError("Session not found", 404);
    }

    await db.insert(chatMessages).values({
      sessionId,
      role: "user",
      content: body.message,
    });

    const creds = await resolveAiCredentials(user.id);
    if (!creds?.model) {
      const content =
        "Configure an AI base URL, API key, and model in Settings (or ask an admin to set a global default) before using chat.";
      await db.insert(chatMessages).values({
        sessionId,
        role: "assistant",
        content,
      });
      return jsonOk({ sessionId, reply: content, proposals: [] });
    }

    const recent = await db
      .select({
        id: bookmarks.id,
        title: bookmarks.title,
        url: bookmarks.url,
        summary: bookmarks.summary,
        collectionId: bookmarks.collectionId,
      })
      .from(bookmarks)
      .where(eq(bookmarks.userId, user.id))
      .orderBy(desc(bookmarks.updatedAt))
      .limit(80);

    const cols = await db
      .select()
      .from(collections)
      .where(eq(collections.userId, user.id));

    const client = createOpenAI(creds);
    const system = `You are FastMark organization assistant. User bookmarks are private to them.
Return JSON only: { "reply": string, "proposals": Proposal[] }
Proposal types:
- {"type":"move_to_collection","collectionName":string,"bookmarkIds":string[],"createIfMissing"?:boolean}
- {"type":"add_tag","tag":string,"bookmarkIds":string[]}
- {"type":"set_favorite","bookmarkIds":string[],"value":boolean}
- {"type":"set_read_later","bookmarkIds":string[],"value":boolean}
Only include proposals the user can confirm. Prefer existing bookmark IDs from context.
Collections: ${JSON.stringify(cols.map((c) => c.name))}
Bookmarks sample: ${JSON.stringify(
      recent.map((b) => ({
        id: b.id,
        title: b.title,
        url: b.url,
        summary: b.summary?.slice(0, 160),
      })),
    )}`;

    const completion = await client.chat.completions.create({
      model: creds.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: body.message },
      ],
    });
    await checkAndRecordUsage(user.id, completion.usage);

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    let reply = cleaned;
    let proposals: Proposal[] = [];
    try {
      const parsed = JSON.parse(cleaned) as {
        reply?: string;
        proposals?: Proposal[];
      };
      reply = parsed.reply || "Here are suggested changes.";
      proposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];
    } catch {
      reply = raw;
      proposals = [];
    }

    await db.insert(chatMessages).values({
      sessionId,
      role: "assistant",
      content: reply,
      proposals,
    });
    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

    return jsonOk({ sessionId, reply, proposals });
  } catch (err) {
    return handleRouteError(err);
  }
}
