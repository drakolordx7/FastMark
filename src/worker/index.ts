import { Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import {
  bookmarks,
  bookmarkTags,
  collections,
  embeddings,
  orgSuggestions,
  systemSettings,
  tags,
  userSettings,
} from "../lib/db/schema";
import { crawlUrl, extractFromHtml } from "../lib/crawl";
import { summarizeAndTag, embedText, formatAiProviderError } from "../lib/ai";
import { cleanTitle } from "../lib/titles";
import { siteHost } from "../lib/urls";
import {
  INDEX_QUEUE,
  redisConnection,
  type IndexJobData,
} from "../lib/queue";

function normalizeTag(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function ensureTag(
  userId: string,
  name: string,
  kind: "static" | "dynamic" = "dynamic",
) {
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
      kind,
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
    .set({
      status: "indexing",
      error: null,
      errorKind: null,
      siteHost: siteHost(bookmark.canonicalUrl || bookmark.url),
      updatedAt: new Date(),
    })
    .where(eq(bookmarks.id, bookmark.id));

  const [sys] = await db.select().from(systemSettings).limit(1);
  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, job.userId))
    .limit(1);
  const timeoutMs = sys?.crawlTimeoutMs ?? 20_000;
  const maxHtmlBytes = sys?.crawlMaxHtmlBytes ?? 2_000_000;
  const maxTextChars = sys?.crawlMaxTextChars ?? 500_000;
  const maxAiTags = settings?.maxAiTags ?? 5;
  const cleanTitles = settings?.cleanTitles ?? true;
  const allowDynamicCollections = settings?.allowDynamicCollections ?? true;

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
          errorKind: extracted.kind,
          retryCount: bookmark.retryCount + 1,
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
          errorKind: crawled.kind,
          retryCount: bookmark.retryCount + 1,
          updatedAt: new Date(),
        })
        .where(eq(bookmarks.id, bookmark.id));
      return;
    }
    title = bookmark.title || crawled.title;
    text = crawled.text;
  }

  const host = siteHost(bookmark.canonicalUrl || bookmark.url);
  if (cleanTitles) {
    title = cleanTitle(title, host) || title;
  }

  const userCollections = await db
    .select()
    .from(collections)
    .where(eq(collections.userId, job.userId));
  const existingTags = await db
    .select({ name: tags.name })
    .from(tags)
    .where(eq(tags.userId, job.userId));

  let ai;
  try {
    ai = await summarizeAndTag(job.userId, title, text, {
      collectionNames: userCollections.map((c) => c.name),
      existingTags: existingTags.map((t) => t.name),
      maxTags: maxAiTags,
      allowDynamicCollections,
    });
  } catch (err) {
    await db
      .update(bookmarks)
      .set({
        status: "failed",
        error: formatAiProviderError(err),
        errorKind: "ai",
        retryCount: bookmark.retryCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(bookmarks.id, bookmark.id));
    return;
  }

  let collectionId = bookmark.collectionId;
  const workingCollections = userCollections;

  if (!collectionId && ai.collectionHint) {
    const match = workingCollections.find(
      (c) => c.name.toLowerCase() === ai.collectionHint!.toLowerCase(),
    );
    if (match) collectionId = match.id;
  }

  if (
    !collectionId &&
    ai.createCollection &&
    allowDynamicCollections
  ) {
    const name = ai.createCollection.trim().slice(0, 120);
    const existing = workingCollections.find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      collectionId = existing.id;
    } else {
      await db.insert(orgSuggestions).values({
        userId: job.userId,
        bookmarkId: bookmark.id,
        kind: "collection",
        payload: { name, source: "indexer" },
        status: "pending",
      });
    }
  }

  if (!collectionId) {
    const unsorted = workingCollections.find((c) => c.name === "Unsorted");
    collectionId = unsorted?.id ?? null;
  }

  await db
    .update(bookmarks)
    .set({
      title,
      summary: ai.summary,
      contentText: text,
      collectionId,
      siteHost: host,
      suggestedCollection: ai.collectionHint || ai.createCollection || null,
      status: "ready",
      error: null,
      errorKind: null,
      indexedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(bookmarks.id, bookmark.id));

  // Keep manually-added static tags; replace dynamic AI tags from this run
  const existingLinks = await db
    .select({
      tagId: bookmarkTags.tagId,
      kind: tags.kind,
    })
    .from(bookmarkTags)
    .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
    .where(eq(bookmarkTags.bookmarkId, bookmark.id));

  for (const link of existingLinks) {
    if (link.kind !== "static") {
      await db
        .delete(bookmarkTags)
        .where(
          and(
            eq(bookmarkTags.bookmarkId, bookmark.id),
            eq(bookmarkTags.tagId, link.tagId),
          ),
        );
    }
  }

  for (const tagName of ai.tags) {
    const tagId = await ensureTag(job.userId, tagName, "dynamic");
    if (tagId) {
      await db
        .insert(bookmarkTags)
        .values({ bookmarkId: bookmark.id, tagId })
        .onConflictDoNothing();
    }
  }

  try {
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
  } catch (err) {
    // Embeddings are best-effort; bookmark stays ready
    console.error("Embedding failed", err);
  }
}

async function main() {
  const [sys] = await db.select().from(systemSettings).limit(1);
  const concurrency = Math.max(
    1,
    Math.min(16, sys?.indexConcurrency ?? Number(process.env.INDEX_CONCURRENCY || 4)),
  );
  console.log(`FastMark worker starting (concurrency=${concurrency})…`);
  const worker = new Worker<IndexJobData>(
    INDEX_QUEUE,
    async (job) => {
      console.log(`Indexing ${job.data.bookmarkId}`);
      await processIndex(job.data);
    },
    { connection: redisConnection(), concurrency },
  );

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed`, err);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
