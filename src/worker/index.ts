import { Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import {
  bookmarks,
  bookmarkTags,
  collections,
  embeddings,
  tags,
  systemSettings,
} from "../lib/db/schema";
import { crawlUrl, extractFromHtml } from "../lib/crawl";
import { summarizeAndTag, embedText } from "../lib/ai";
import {
  INDEX_QUEUE,
  redisConnection,
  type IndexJobData,
} from "../lib/queue";

function normalizeTag(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function ensureTag(userId: string, name: string) {
  const normalizedName = normalizeTag(name);
  if (!normalizedName) return null;
  const [found] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.normalizedName, normalizedName)))
    .limit(1);
  if (found) return found.id;
  const [created] = await db
    .insert(tags)
    .values({
      userId,
      name: name.trim(),
      normalizedName,
    })
    .returning();
  return created?.id ?? null;
}

async function processIndex(job: IndexJobData) {
  const [bookmark] = await db
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.id, job.bookmarkId))
    .limit(1);
  if (!bookmark || bookmark.userId !== job.userId) return;

  await db
    .update(bookmarks)
    .set({ status: "indexing", error: null, updatedAt: new Date() })
    .where(eq(bookmarks.id, bookmark.id));

  const [sys] = await db.select().from(systemSettings).limit(1);
  const timeoutMs = sys?.crawlTimeoutMs ?? 20_000;
  const maxHtmlBytes = sys?.crawlMaxHtmlBytes ?? 2_000_000;
  const maxTextChars = sys?.crawlMaxTextChars ?? 500_000;

  let title = bookmark.title || bookmark.url;
  let text = "";

  if (job.html) {
    const extracted = extractFromHtml(job.html, bookmark.url, maxTextChars);
    if (!extracted.ok) {
      await db
        .update(bookmarks)
        .set({
          status: "needs_manual_index",
          error: extracted.reason,
          updatedAt: new Date(),
        })
        .where(eq(bookmarks.id, bookmark.id));
      return;
    }
    title = extracted.title || title;
    text = extracted.text;
  } else {
    const crawled = await crawlUrl(bookmark.url, {
      timeoutMs,
      maxHtmlBytes,
      maxTextChars,
    });
    if (!crawled.ok) {
      await db
        .update(bookmarks)
        .set({
          status: "needs_manual_index",
          error: crawled.reason,
          updatedAt: new Date(),
        })
        .where(eq(bookmarks.id, bookmark.id));
      return;
    }
    title = bookmark.title || crawled.title;
    text = crawled.text;
  }

  const userCollections = await db
    .select()
    .from(collections)
    .where(eq(collections.userId, job.userId));
  const collectionNames = userCollections.map((c) => c.name);

  let ai;
  try {
    ai = await summarizeAndTag(job.userId, title, text, collectionNames);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI failed";
    await db
      .update(bookmarks)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(bookmarks.id, bookmark.id));
    return;
  }

  let collectionId = bookmark.collectionId;
  if (!collectionId && ai.collectionHint) {
    const match = userCollections.find(
      (c) => c.name.toLowerCase() === ai.collectionHint!.toLowerCase(),
    );
    if (match) collectionId = match.id;
    else {
      const unsorted = userCollections.find((c) => c.name === "Unsorted");
      collectionId = unsorted?.id ?? collectionId;
    }
  } else if (!collectionId) {
    const unsorted = userCollections.find((c) => c.name === "Unsorted");
    collectionId = unsorted?.id ?? null;
  }

  await db
    .update(bookmarks)
    .set({
      title,
      summary: ai.summary,
      contentText: text,
      collectionId,
      suggestedCollection: ai.collectionHint,
      status: "ready",
      error: null,
      indexedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(bookmarks.id, bookmark.id));

  await db.delete(bookmarkTags).where(eq(bookmarkTags.bookmarkId, bookmark.id));
  for (const tagName of ai.tags) {
    const tagId = await ensureTag(job.userId, tagName);
    if (tagId) {
      await db
        .insert(bookmarkTags)
        .values({ bookmarkId: bookmark.id, tagId })
        .onConflictDoNothing();
    }
  }

  const vector = await embedText(
    job.userId,
    `${title}\n${ai.summary}\n${text.slice(0, 4000)}`,
  );
  await db
    .insert(embeddings)
    .values({ bookmarkId: bookmark.id, embedding: vector })
    .onConflictDoUpdate({
      target: embeddings.bookmarkId,
      set: { embedding: vector, updatedAt: new Date() },
    });
}

async function main() {
  console.log("FastMark worker starting…");
  const worker = new Worker<IndexJobData>(
    INDEX_QUEUE,
    async (job) => {
      console.log(`Indexing ${job.data.bookmarkId}`);
      await processIndex(job.data);
    },
    { connection: redisConnection(), concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed`, err);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
