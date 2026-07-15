import { NextRequest } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireUser, getUserFromToken, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  bookmarkTags,
  bookmarks,
  tags,
} from "@/lib/db/schema";
import { canonicalizeUrl, faviconForUrl } from "@/lib/urls";
import { enqueueIndex } from "@/lib/queue";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

async function authedUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const user = await getUserFromToken(auth.slice(7));
    if (!user) throw new AuthError("Unauthorized");
    return user;
  }
  return requireUser();
}

export async function GET(req: NextRequest) {
  try {
    const user = await authedUser(req);
    const sp = req.nextUrl.searchParams;
    const view = sp.get("view");
    const collectionId = sp.get("collectionId");
    const tagId = sp.get("tagId");
    const q = sp.get("q")?.trim();

    const conditions = [eq(bookmarks.userId, user.id)];
    if (view === "favorites") conditions.push(eq(bookmarks.favorite, true));
    if (view === "read_later") conditions.push(eq(bookmarks.readLater, true));
    if (view === "manual")
      conditions.push(eq(bookmarks.status, "needs_manual_index"));
    if (collectionId)
      conditions.push(eq(bookmarks.collectionId, collectionId));

    let rows = await db
      .select()
      .from(bookmarks)
      .where(and(...conditions))
      .orderBy(desc(bookmarks.createdAt))
      .limit(500);

    if (tagId) {
      const links = await db
        .select()
        .from(bookmarkTags)
        .where(eq(bookmarkTags.tagId, tagId));
      const ids = new Set(links.map((l) => l.bookmarkId));
      rows = rows.filter((b) => ids.has(b.id));
    }

    if (q) {
      const pattern = `%${q.toLowerCase()}%`;
      rows = rows.filter((b) => {
        const hay = `${b.title ?? ""} ${b.summary ?? ""} ${b.url} ${b.contentText ?? ""}`.toLowerCase();
        return hay.includes(q.toLowerCase()) || b.url.toLowerCase().includes(q.toLowerCase());
      });
      void pattern;
    }

    const ids = rows.map((r) => r.id);
    const tagLinks =
      ids.length === 0
        ? []
        : await db
            .select({
              bookmarkId: bookmarkTags.bookmarkId,
              tagId: tags.id,
              name: tags.name,
            })
            .from(bookmarkTags)
            .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
            .where(inArray(bookmarkTags.bookmarkId, ids));

    const byBookmark = new Map<string, { id: string; name: string }[]>();
    for (const t of tagLinks) {
      const list = byBookmark.get(t.bookmarkId) ?? [];
      list.push({ id: t.tagId, name: t.name });
      byBookmark.set(t.bookmarkId, list);
    }

    return jsonOk({
      bookmarks: rows.map((b) => ({
        ...b,
        tags: byBookmark.get(b.id) ?? [],
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

const createSchema = z.object({
  url: z.string().min(1),
  title: z.string().optional(),
  collectionId: z.string().uuid().nullable().optional(),
  favorite: z.boolean().optional(),
  readLater: z.boolean().optional(),
  html: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await authedUser(req);
    const body = createSchema.parse(await req.json());
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeUrl(body.url);
    } catch {
      return jsonError("Invalid URL");
    }

    const [existing] = await db
      .select()
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.userId, user.id),
          eq(bookmarks.canonicalUrl, canonicalUrl),
        ),
      )
      .limit(1);
    if (existing) {
      return jsonOk({ bookmark: existing, duplicate: true });
    }

    const [created] = await db
      .insert(bookmarks)
      .values({
        userId: user.id,
        url: body.url.trim(),
        canonicalUrl,
        title: body.title?.trim() || null,
        collectionId: body.collectionId ?? null,
        favorite: body.favorite ?? false,
        readLater: body.readLater ?? false,
        faviconUrl: faviconForUrl(canonicalUrl),
        status: "queued",
      })
      .returning();

    if (!created) return jsonError("Failed to create bookmark", 500);
    await enqueueIndex({
      bookmarkId: created.id,
      userId: user.id,
      html: body.html,
    });
    return jsonOk({ bookmark: created, duplicate: false }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
