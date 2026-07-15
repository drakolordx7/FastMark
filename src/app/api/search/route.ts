import { NextRequest } from "next/server";
import { and, eq, sql, inArray } from "drizzle-orm";
import { requireUser, getUserFromToken, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookmarkTags, bookmarks, tags } from "@/lib/db/schema";
import { embedText } from "@/lib/ai";
import { handleRouteError, jsonOk } from "@/lib/api";

async function authed(req: NextRequest) {
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
    const user = await authed(req);
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (!q) return jsonOk({ results: [] });

    const fts = await db.execute(sql`
      SELECT id, url, title, summary, status, favorite, read_later, favicon_url,
        ts_rank(
          to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content_text,'')),
          plainto_tsquery('english', ${q})
        ) AS rank
      FROM bookmarks
      WHERE user_id = ${user.id}
        AND to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content_text,''))
            @@ plainto_tsquery('english', ${q})
      ORDER BY rank DESC
      LIMIT 40
    `);

    let vectorHits: { id: string; score: number }[] = [];
    try {
      const queryVec = await embedText(user.id, q);
      const vecLiteral = `[${queryVec.join(",")}]`;
      const vrows = await db.execute(sql`
        SELECT b.id,
          1 - (e.embedding <=> ${vecLiteral}::vector) AS score
        FROM embeddings e
        INNER JOIN bookmarks b ON b.id = e.bookmark_id
        WHERE b.user_id = ${user.id}
        ORDER BY e.embedding <=> ${vecLiteral}::vector
        LIMIT 40
      `);
      vectorHits = (vrows as unknown as { id: string; score: number }[]).map(
        (r) => ({ id: r.id, score: Number(r.score) }),
      );
    } catch {
      vectorHits = [];
    }

    const scores = new Map<string, number>();
    for (const row of fts as unknown as { id: string; rank: number }[]) {
      scores.set(row.id, Number(row.rank) * 2);
    }
    for (const hit of vectorHits) {
      scores.set(hit.id, (scores.get(hit.id) ?? 0) + hit.score);
    }

    // Fallback substring if nothing
    if (scores.size === 0) {
      const all = await db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.userId, user.id))
        .limit(500);
      const needle = q.toLowerCase();
      for (const b of all) {
        const hay =
          `${b.title ?? ""} ${b.summary ?? ""} ${b.url} ${b.contentText ?? ""}`.toLowerCase();
        if (hay.includes(needle)) scores.set(b.id, 0.1);
      }
    }

    const ids = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([id]) => id);

    if (ids.length === 0) return jsonOk({ results: [] });

    const rows = await db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, user.id), inArray(bookmarks.id, ids)));

    const tagLinks = await db
      .select({
        bookmarkId: bookmarkTags.bookmarkId,
        tagId: tags.id,
        name: tags.name,
        kind: tags.kind,
      })
      .from(bookmarkTags)
      .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
      .where(inArray(bookmarkTags.bookmarkId, ids));
    const tagsByBookmark = new Map<
      string,
      { id: string; name: string; kind: string }[]
    >();
    for (const t of tagLinks) {
      const list = tagsByBookmark.get(t.bookmarkId) ?? [];
      list.push({ id: t.tagId, name: t.name, kind: t.kind });
      tagsByBookmark.set(t.bookmarkId, list);
    }

    const byId = new Map(rows.map((r) => [r.id, r]));
    const results = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((b) => ({
        ...b,
        tags: tagsByBookmark.get(b!.id) ?? [],
        score: scores.get(b!.id) ?? 0,
      }));

    return jsonOk({ results });
  } catch (err) {
    return handleRouteError(err);
  }
}
