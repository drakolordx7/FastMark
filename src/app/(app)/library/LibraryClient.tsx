"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Tag = { id: string; name: string; kind?: string };
type Bookmark = {
  id: string;
  url: string;
  title: string | null;
  summary: string | null;
  status: string;
  error: string | null;
  errorKind?: string | null;
  favorite: boolean;
  readLater: boolean;
  faviconUrl: string | null;
  tags: Tag[];
  collectionId: string | null;
  siteHost?: string | null;
};

type Collection = {
  id: string;
  name: string;
  parentId?: string | null;
  kind?: string;
};

export default function LibraryClient() {
  const sp = useSearchParams();
  const view = sp.get("view");
  const collectionId = sp.get("collectionId");
  const initialQ = sp.get("q") || "";
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tagId, setTagId] = useState<string>("");
  const [layout, setLayout] = useState<"dual" | "grid">("dual");
  const [q, setQ] = useState(initialQ);
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Bookmark | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [htmlPaste, setHtmlPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulkTag, setBulkTag] = useState("");
  const [bulkCollection, setBulkCollection] = useState("");
  const filterKey = `${view || ""}|${collectionId || ""}|${tagId}`;
  const [pages, setPages] = useState<Record<string, number>>({});
  const page = pages[filterKey] ?? 1;
  const setPage = (next: number | ((n: number) => number)) => {
    setPages((prev) => {
      const current = prev[filterKey] ?? 1;
      const value = typeof next === "function" ? next(current) : next;
      return { ...prev, [filterKey]: value };
    });
  };
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [msg, setMsg] = useState("");
  const [relatedHost, setRelatedHost] = useState<string | null>(null);
  const [related, setRelated] = useState<
    {
      id: string;
      url: string;
      title: string | null;
      pathDepth: number;
      isTopLevel: boolean;
    }[]
  >([]);

  const listQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (view) p.set("view", view);
    if (collectionId) p.set("collectionId", collectionId);
    if (tagId) p.set("tagId", tagId);
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    return p.toString();
  }, [view, collectionId, tagId, page, pageSize]);

  async function refreshMeta() {
    const [t, c] = await Promise.all([
      fetch("/api/tags").then((r) => r.json()),
      fetch("/api/collections").then((r) => r.json()),
    ]);
    setTags(t.tags || []);
    setCollections(c.collections || []);
  }

  async function load() {
    const [b] = await Promise.all([
      fetch(`/api/bookmarks?${listQuery}`).then((r) => r.json()),
      refreshMeta(),
    ]);
    setBookmarks(b.bookmarks || []);
    setTotal(b.total ?? 0);
    setTotalPages(b.totalPages ?? 1);
    setChecked(new Set());
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery]);

  useEffect(() => {
    if (initialQ) void searchAi(initialQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addBookmark() {
    if (!url.trim()) return;
    setBusy(true);
    const res = await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, collectionId: collectionId || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setUrl("");
    setBusy(false);
    setMsg(data.duplicate ? "Already saved (same link)" : "Queued for indexing");
    await load();
  }

  async function toggleFlag(
    id: string,
    field: "favorite" | "readLater",
    value: boolean,
  ) {
    await fetch(`/api/bookmarks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    await load();
  }

  async function reindexOne(id: string) {
    await fetch("/api/reindex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "one", bookmarkId: id }),
    });
    await load();
  }

  async function reindexScope(scope: "all" | "collection" | "tag") {
    await fetch("/api/reindex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        collectionId: collectionId || undefined,
        tagId: tagId || undefined,
      }),
    });
    await load();
  }

  async function submitHtml() {
    if (!selected || !htmlPaste.trim()) return;
    setBusy(true);
    await fetch(`/api/bookmarks/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: htmlPaste }),
    });
    setHtmlPaste("");
    setBusy(false);
    await load();
  }

  async function searchAi(term = q) {
    if (!term.trim()) {
      await load();
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
    const data = await res.json();
    const results = (data.results || []).map((b: Bookmark) => ({
      ...b,
      tags: b.tags || [],
    }));
    setBookmarks(results);
    setTotal(results.length);
    setTotalPages(1);
    setPage(1);
    await refreshMeta();
  }

  function toggleCheck(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllPage() {
    setChecked(new Set(bookmarks.map((b) => b.id)));
  }

  async function bulk(action: string) {
    if (!checked.size) return;
    setBusy(true);
    await fetch("/api/bookmarks/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: [...checked],
        action,
        collectionId: bulkCollection || null,
        tag: bulkTag || undefined,
      }),
    });
    setBusy(false);
    await load();
  }

  async function openRelated(host: string) {
    setRelatedHost(host);
    const res = await fetch(`/api/duplicates?host=${encodeURIComponent(host)}`);
    const data = await res.json();
    const group = (data.groups || [])[0];
    setRelated(group?.pages || []);
  }

  async function resolveRelated(action: "keep_selected" | "keep_top_level") {
    if (!relatedHost) return;
    setBusy(true);
    await fetch("/api/duplicates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteHost: relatedHost,
        action,
        keepIds: action === "keep_selected" ? [...checked] : undefined,
      }),
    });
    setBusy(false);
    setRelatedHost(null);
    await load();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="fm-input max-w-md fm-input-sm"
          placeholder="Add bookmark URL…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addBookmark()}
        />
        <button className="fm-btn fm-btn-primary" disabled={busy} onClick={addBookmark}>
          Add
        </button>
        <input
          className="fm-input max-w-xs fm-input-sm"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void searchAi()}
        />
        <button className="fm-btn" onClick={() => void searchAi()}>
          Search
        </button>
        <button
          className="fm-btn"
          onClick={() => setLayout((l) => (l === "dual" ? "grid" : "dual"))}
        >
          {layout === "dual" ? "Grid view" : "List view"}
        </button>
        <select
          className="fm-input max-w-[12rem] fm-input-sm"
          value={tagId}
          onChange={(e) => setTagId(e.target.value)}
          onFocus={() => void refreshMeta()}
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="fm-btn" type="button" onClick={() => void load()}>
          Refresh
        </button>
        <button className="fm-btn" onClick={() => void reindexScope("all")}>
          Reindex all
        </button>
        <select
          className="fm-input max-w-[6rem] fm-input-sm"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
        >
          {[25, 50, 75, 100].map((n) => (
            <option key={n} value={n}>
              {n}/page
            </option>
          ))}
        </select>
      </div>

      {msg ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {msg}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 items-center text-sm">
        <button className="fm-btn" type="button" onClick={selectAllPage}>
          Select all (page)
        </button>
        <button
          className="fm-btn"
          type="button"
          onClick={() => setChecked(new Set())}
        >
          Clear selection
        </button>
        <span style={{ color: "var(--muted)" }}>
          {total} bookmarks · page {page}/{totalPages}
        </span>
      </div>

      {checked.size > 0 ? (
        <div className="fm-card p-2 flex flex-wrap gap-2 items-center text-sm">
          <span>{checked.size} selected</span>
          <button className="fm-btn" disabled={busy} onClick={() => void bulk("favorite")}>
            Favorite
          </button>
          <button className="fm-btn" disabled={busy} onClick={() => void bulk("read_later")}>
            Read later
          </button>
          <button className="fm-btn" disabled={busy} onClick={() => void bulk("reindex")}>
            Reindex
          </button>
          <select
            className="fm-input max-w-[10rem] fm-input-sm"
            value={bulkCollection}
            onChange={(e) => setBulkCollection(e.target.value)}
          >
            <option value="">Move to…</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === "dynamic" ? "⚡ " : ""}
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="fm-btn"
            disabled={busy || !bulkCollection}
            onClick={() => void bulk("move_collection")}
          >
            Move
          </button>
          <input
            className="fm-input max-w-[8rem] fm-input-sm"
            placeholder="Tag"
            value={bulkTag}
            onChange={(e) => setBulkTag(e.target.value)}
          />
          <button
            className="fm-btn"
            disabled={busy || !bulkTag.trim()}
            onClick={() => void bulk("add_tag")}
          >
            Add tag
          </button>
          <button className="fm-btn" disabled={busy} onClick={() => void bulk("delete")}>
            Delete
          </button>
        </div>
      ) : null}

      <div
        className={
          layout === "grid"
            ? "grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
            : "space-y-1.5"
        }
      >
        {bookmarks.map((b) => (
          <article
            key={b.id}
            className={`fm-card cursor-pointer ${
              layout === "dual"
                ? "p-2 grid md:grid-cols-[1.2fr_1fr] gap-2 items-stretch"
                : "p-3"
            }`}
            onClick={() => setSelected(b)}
          >
            <div className="flex gap-2 items-start min-w-0">
              <input
                type="checkbox"
                checked={checked.has(b.id)}
                onClick={(e) => toggleCheck(b.id, e)}
                onChange={() => undefined}
                className="mt-1"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={b.faviconUrl || "/logo.svg"}
                alt=""
                width={16}
                height={16}
                className="mt-1 rounded"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate leading-tight">
                  {b.title || b.url}
                </div>
                <div className="text-[11px] truncate" style={{ color: "var(--muted)" }}>
                  {b.url}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {b.status !== "ready" ? (
                    <span className="fm-chip">{b.status}</span>
                  ) : null}
                  {b.favorite ? <span className="fm-chip">★</span> : null}
                  {b.readLater ? <span className="fm-chip">later</span> : null}
                  {b.tags?.map((t) => (
                    <span key={t.id} className="fm-chip">
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {layout === "dual" ? (
              <div
                className="text-xs border-t md:border-t-0 md:border-l pt-2 md:pt-0 md:pl-2 min-w-0"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              >
                <p className="line-clamp-2 leading-snug">
                  {b.summary || "No summary yet"}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {b.siteHost ? (
                    <button
                      className="fm-btn"
                      style={{ padding: "0.15rem 0.45rem", fontSize: "0.7rem" }}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void openRelated(b.siteHost!);
                      }}
                    >
                      Same site
                    </button>
                  ) : null}
                </div>
              </div>
            ) : b.summary ? (
              <p
                className="text-sm mt-2 line-clamp-2"
                style={{ color: "var(--muted)" }}
              >
                {b.summary}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center justify-between pt-1">
        <button
          className="fm-btn"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </button>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          Page {page} of {totalPages}
        </span>
        <button
          className="fm-btn"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          Next
        </button>
      </div>

      {relatedHost ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={() => setRelatedHost(null)}
        >
          <div
            className="fm-card w-full max-w-xl max-h-[85vh] overflow-auto p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold">Related pages · {relatedHost}</h2>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Exact same links are already blocked. These are different pages on
              the same site. Choose how to resolve.
            </p>
            <ul className="space-y-1 text-sm">
              {related.map((r) => (
                <li key={r.id} className="flex gap-2 items-start">
                  <input
                    type="checkbox"
                    checked={checked.has(r.id)}
                    onChange={() => {
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.id)) next.delete(r.id);
                        else next.add(r.id);
                        return next;
                      });
                    }}
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {r.title || r.url}{" "}
                      {r.isTopLevel ? (
                        <span className="fm-chip">top level</span>
                      ) : null}
                    </div>
                    <div className="text-xs truncate" style={{ color: "var(--muted)" }}>
                      {r.url}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button className="fm-btn" onClick={() => setRelatedHost(null)}>
                Keep all
              </button>
              <button
                className="fm-btn"
                disabled={busy || !checked.size}
                onClick={() => void resolveRelated("keep_selected")}
              >
                Keep selected
              </button>
              <button
                className="fm-btn fm-btn-primary"
                disabled={busy}
                onClick={() => void resolveRelated("keep_top_level")}
              >
                Keep top level only
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selected ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={() => setSelected(null)}
        >
          <div
            className="fm-card w-full max-w-2xl max-h-[90vh] overflow-auto p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {selected.title || selected.url}
              </h2>
              <button className="fm-btn" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <a
              href={selected.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm"
              style={{ color: "var(--accent)" }}
            >
              {selected.url}
            </a>
            <p className="text-sm whitespace-pre-wrap">{selected.summary}</p>
            {selected.error ? (
              <p className="text-sm" style={{ color: "var(--warning)" }}>
                {selected.errorKind ? `[${selected.errorKind}] ` : ""}
                {selected.error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                className="fm-btn"
                onClick={() =>
                  void toggleFlag(selected.id, "favorite", !selected.favorite)
                }
              >
                {selected.favorite ? "Unfavorite" : "Favorite"}
              </button>
              <button
                className="fm-btn"
                onClick={() =>
                  void toggleFlag(selected.id, "readLater", !selected.readLater)
                }
              >
                {selected.readLater ? "Unset read later" : "Read later"}
              </button>
              <button
                className="fm-btn"
                onClick={() => void reindexOne(selected.id)}
              >
                Reindex / retry
              </button>
              <a
                className="fm-btn"
                href={selected.url}
                target="_blank"
                rel="noreferrer"
              >
                Open
              </a>
            </div>
            {(selected.status === "needs_manual_index" ||
              selected.status === "failed") && (
              <div className="space-y-2">
                <div className="text-sm font-medium">
                  Manual index — paste page HTML (extension can capture this)
                </div>
                <textarea
                  className="fm-input min-h-40 font-mono text-xs"
                  value={htmlPaste}
                  onChange={(e) => setHtmlPaste(e.target.value)}
                  placeholder="Paste HTML from the page or extension…"
                />
                <button
                  className="fm-btn fm-btn-primary"
                  disabled={busy}
                  onClick={submitHtml}
                >
                  Submit HTML
                </button>
              </div>
            )}
            <label className="block text-sm space-y-1">
              <span>Collection</span>
              <select
                className="fm-input"
                value={selected.collectionId || ""}
                onChange={async (e) => {
                  await fetch(`/api/bookmarks/${selected.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      collectionId: e.target.value || null,
                    }),
                  });
                  await load();
                }}
              >
                <option value="">None</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.kind === "dynamic" ? "⚡ " : ""}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}
