"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Tag = { id: string; name: string };
type Bookmark = {
  id: string;
  url: string;
  title: string | null;
  summary: string | null;
  status: string;
  error: string | null;
  favorite: boolean;
  readLater: boolean;
  faviconUrl: string | null;
  tags: Tag[];
  collectionId: string | null;
};

type Collection = { id: string; name: string };

export default function LibraryClient() {
  const sp = useSearchParams();
  const view = sp.get("view");
  const collectionId = sp.get("collectionId");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tagId, setTagId] = useState<string>("");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Bookmark | null>(null);
  const [htmlPaste, setHtmlPaste] = useState("");
  const [busy, setBusy] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (view) p.set("view", view);
    if (collectionId) p.set("collectionId", collectionId);
    if (tagId) p.set("tagId", tagId);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [view, collectionId, tagId, q]);

  async function load() {
    const [b, t, c] = await Promise.all([
      fetch(`/api/bookmarks?${query}`).then((r) => r.json()),
      fetch("/api/tags").then((r) => r.json()),
      fetch("/api/collections").then((r) => r.json()),
    ]);
    setBookmarks(b.bookmarks || []);
    setTags(t.tags || []);
    setCollections(c.collections || []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function addBookmark() {
    if (!url.trim()) return;
    setBusy(true);
    await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, collectionId: collectionId || undefined }),
    });
    setUrl("");
    setBusy(false);
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

  async function searchAi() {
    if (!q.trim()) {
      await load();
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setBookmarks(
      (data.results || []).map((b: Bookmark) => ({
        ...b,
        tags: b.tags || [],
      })),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="fm-input max-w-xl"
          placeholder="Add bookmark URL…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addBookmark()}
        />
        <button className="fm-btn fm-btn-primary" disabled={busy} onClick={addBookmark}>
          Add
        </button>
        <input
          className="fm-input max-w-sm"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void searchAi()}
        />
        <button className="fm-btn" onClick={searchAi}>
          Search
        </button>
        <button
          className="fm-btn"
          onClick={() => setLayout((l) => (l === "grid" ? "list" : "grid"))}
        >
          {layout === "grid" ? "List view" : "Grid view"}
        </button>
        <select
          className="fm-input max-w-[12rem]"
          value={tagId}
          onChange={(e) => setTagId(e.target.value)}
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div
        className={
          layout === "grid"
            ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            : "space-y-2"
        }
      >
        {bookmarks.map((b) => (
          <article
            key={b.id}
            className={`fm-card p-4 cursor-pointer ${layout === "list" ? "flex gap-3 items-start" : ""}`}
            onClick={() => setSelected(b)}
          >
            <div className="flex gap-3 items-start w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={b.faviconUrl || "/logo.svg"}
                alt=""
                width={20}
                height={20}
                className="mt-1 rounded"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{b.title || b.url}</div>
                <div className="text-xs truncate" style={{ color: "var(--muted)" }}>
                  {b.url}
                </div>
                {layout === "grid" && b.summary ? (
                  <p
                    className="text-sm mt-2 line-clamp-3"
                    style={{ color: "var(--muted)" }}
                  >
                    {b.summary}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="fm-chip">{b.status}</span>
                  {b.favorite ? <span className="fm-chip">favorite</span> : null}
                  {b.readLater ? <span className="fm-chip">read later</span> : null}
                  {b.tags?.map((t) => (
                    <span key={t.id} className="fm-chip">
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

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
                Reindex
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
                  Manual index — paste page HTML
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
