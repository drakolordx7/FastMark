"use client";

import { FormEvent, useEffect, useState } from "react";

type Settings = {
  openaiBaseUrl: string;
  openaiModel: string;
  embeddingModel: string;
  hasApiKey: boolean;
  timezone: string;
  theme: "system" | "light" | "dark";
  logoUrl: string;
  maxAiTags: number;
  cleanTitles: boolean;
  allowDynamicCollections: boolean;
  pageSize: number;
};

type Collection = {
  id: string;
  name: string;
  parentId: string | null;
  kind?: string;
};

type Tag = { id: string; name: string; kind?: string };

type Suggestion = {
  id: string;
  kind: string;
  payload: { name?: string };
  bookmarkId: string | null;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [collectionKind, setCollectionKind] = useState<"static" | "dynamic">(
    "static",
  );
  const [parentId, setParentId] = useState("");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [importResult, setImportResult] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [newTag, setNewTag] = useState("");

  async function load() {
    const [s, c, t, o] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/collections").then((r) => r.json()),
      fetch("/api/tags").then((r) => r.json()),
      fetch("/api/org-suggestions").then((r) => r.json()),
    ]);
    setSettings(s.settings);
    setCollections(c.collections || []);
    setTags(t.tags || []);
    setSuggestions(o.suggestions || []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        openaiBaseUrl: settings.openaiBaseUrl,
        openaiModel: settings.openaiModel,
        embeddingModel: settings.embeddingModel,
        timezone: settings.timezone,
        theme: settings.theme,
        logoUrl: settings.logoUrl,
        maxAiTags: settings.maxAiTags,
        cleanTitles: settings.cleanTitles,
        allowDynamicCollections: settings.allowDynamicCollections,
        pageSize: settings.pageSize,
        openaiApiKey: apiKey.trim() || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? "Saved" : data.error || "Failed to save");
    if (res.ok) setApiKey("");
    await load();
    const theme = settings.theme;
    const dark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }

  async function testAi() {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testAi: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.test?.ok) {
      setMessage(`AI OK (${data.test.model}): ${data.test.reply}`);
    } else {
      setMessage(data.test?.error || data.error || "AI test failed");
    }
  }

  async function uploadLogo(file: File | null) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("scope", "user");
    const res = await fetch("/api/logo", { method: "POST", body: form });
    const data = await res.json();
    if (res.ok && settings) {
      setSettings({ ...settings, logoUrl: data.logoUrl });
      setMessage("Logo uploaded");
    } else {
      setMessage(data.error || "Upload failed");
    }
  }

  async function addCollection() {
    if (!collectionName.trim()) return;
    await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: collectionName,
        parentId: parentId || null,
        kind: collectionKind,
      }),
    });
    setCollectionName("");
    setParentId("");
    setMessage("Collection created");
    await load();
  }

  async function renameCollection(id: string, name: string) {
    const next = prompt("Rename collection", name);
    if (!next?.trim()) return;
    await fetch("/api/collections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: next.trim() }),
    });
    await load();
  }

  async function updateCollectionKind(id: string, kind: "static" | "dynamic") {
    await fetch("/api/collections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, kind }),
    });
    await load();
  }

  async function deleteCollection(id: string) {
    if (!confirm("Delete this collection?")) return;
    await fetch("/api/collections", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await load();
  }

  async function addTag() {
    if (!newTag.trim()) return;
    await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTag, kind: "static" }),
    });
    setNewTag("");
    await load();
  }

  async function renameTag(id: string, name: string) {
    const next = prompt("Rename tag (updates all bookmarks using it)", name);
    if (!next?.trim()) return;
    await fetch("/api/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: next.trim() }),
    });
    await load();
  }

  async function deleteTag(id: string) {
    if (!confirm("Delete this tag?")) return;
    await fetch("/api/tags", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await load();
  }

  async function onImport(file: File | null) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/import", { method: "POST", body: form });
    const data = await res.json();
    setImportResult(
      res.ok
        ? `Imported ${data.imported}, skipped ${data.skipped} (of ${data.total}) — ${data.scope}`
        : data.error || "Import failed",
    );
  }

  async function reindexAll() {
    const res = await fetch("/api/reindex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all" }),
    });
    const data = await res.json();
    setMessage(res.ok ? `Queued ${data.queued} for reindex` : data.error);
  }

  async function handleSuggestion(id: string, action: "accept" | "reject") {
    await fetch("/api/org-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    await load();
  }

  if (!settings) {
    return (
      <div className="text-sm" style={{ color: "var(--muted)" }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          AI credentials, organization rules, theme, and imports
        </p>
      </div>

      <form onSubmit={save} className="fm-card p-4 space-y-3">
        <h2 className="font-medium">AI (OpenAI-compatible)</h2>
        <label className="block text-sm space-y-1">
          <span>Base URL (e.g. https://proxy.example/v1)</span>
          <input
            className="fm-input"
            value={settings.openaiBaseUrl}
            onChange={(e) =>
              setSettings({ ...settings, openaiBaseUrl: e.target.value })
            }
          />
        </label>
        <label className="block text-sm space-y-1">
          <span>
            API key {settings.hasApiKey ? "(saved — leave blank to keep)" : ""}
          </span>
          <input
            className="fm-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <label className="block text-sm space-y-1">
          <span>Chat / summarize model</span>
          <input
            className="fm-input"
            value={settings.openaiModel}
            onChange={(e) =>
              setSettings({ ...settings, openaiModel: e.target.value })
            }
          />
        </label>
        <label className="block text-sm space-y-1">
          <span>Embedding model (optional)</span>
          <input
            className="fm-input"
            value={settings.embeddingModel}
            onChange={(e) =>
              setSettings({ ...settings, embeddingModel: e.target.value })
            }
          />
        </label>
        <div className="flex gap-2">
          <button className="fm-btn fm-btn-primary" type="submit">
            Save settings
          </button>
          <button className="fm-btn" type="button" onClick={() => void testAi()}>
            Test AI connection
          </button>
        </div>
        {message ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {message}
          </p>
        ) : null}
      </form>

      <section className="fm-card p-4 space-y-3">
        <h2 className="font-medium">Organization rules</h2>
        <label className="block text-sm space-y-1">
          <span>Max AI tags per bookmark (0–5)</span>
          <input
            className="fm-input"
            type="number"
            min={0}
            max={5}
            value={settings.maxAiTags}
            onChange={(e) =>
              setSettings({
                ...settings,
                maxAiTags: Math.max(0, Math.min(5, Number(e.target.value) || 0)),
              })
            }
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.cleanTitles}
            onChange={(e) =>
              setSettings({ ...settings, cleanTitles: e.target.checked })
            }
          />
          Clean website names (default on)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.allowDynamicCollections}
            onChange={(e) =>
              setSettings({
                ...settings,
                allowDynamicCollections: e.target.checked,
              })
            }
          />
          Allow AI to suggest new dynamic collections (⚡)
        </label>
        <label className="block text-sm space-y-1">
          <span>Default page size</span>
          <select
            className="fm-input"
            value={settings.pageSize}
            onChange={(e) =>
              setSettings({ ...settings, pageSize: Number(e.target.value) })
            }
          >
            {[25, 50, 75, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm space-y-1">
          <span>Timezone</span>
          <input
            className="fm-input"
            value={settings.timezone}
            onChange={(e) =>
              setSettings({ ...settings, timezone: e.target.value })
            }
          />
        </label>
        <label className="block text-sm space-y-1">
          <span>Theme</span>
          <select
            className="fm-input"
            value={settings.theme}
            onChange={(e) =>
              setSettings({
                ...settings,
                theme: e.target.value as Settings["theme"],
              })
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="block text-sm space-y-1">
          <span>Logo URL</span>
          <input
            className="fm-input"
            value={settings.logoUrl}
            onChange={(e) =>
              setSettings({ ...settings, logoUrl: e.target.value })
            }
          />
        </label>
        <label className="block text-sm space-y-1">
          <span>Upload logo</span>
          <input
            className="fm-input"
            type="file"
            accept="image/*,.svg"
            onChange={(e) => void uploadLogo(e.target.files?.[0] || null)}
          />
        </label>
        <button className="fm-btn" type="button" onClick={(e) => void save(e as unknown as FormEvent)}>
          Save organization rules
        </button>
      </section>

      {suggestions.length ? (
        <section className="fm-card p-4 space-y-3">
          <h2 className="font-medium">AI collection suggestions</h2>
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b py-2"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="text-sm">
                ⚡ Suggest collection: <strong>{s.payload?.name}</strong>
              </span>
              <span className="flex gap-2">
                <button
                  className="fm-btn fm-btn-primary"
                  type="button"
                  onClick={() => void handleSuggestion(s.id, "accept")}
                >
                  Accept
                </button>
                <button
                  className="fm-btn"
                  type="button"
                  onClick={() => void handleSuggestion(s.id, "reject")}
                >
                  Reject
                </button>
              </span>
            </div>
          ))}
        </section>
      ) : null}

      <section className="fm-card p-4 space-y-3">
        <h2 className="font-medium">Collections</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className="fm-input max-w-xs"
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
            placeholder="New collection name"
          />
          <select
            className="fm-input max-w-[8rem]"
            value={collectionKind}
            onChange={(e) =>
              setCollectionKind(e.target.value as "static" | "dynamic")
            }
          >
            <option value="static">Static</option>
            <option value="dynamic">Dynamic ⚡</option>
          </select>
          <select
            className="fm-input max-w-[12rem]"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">No parent</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                Child of {c.name}
              </option>
            ))}
          </select>
          <button className="fm-btn" type="button" onClick={addCollection}>
            Add
          </button>
        </div>
        <ul className="text-sm space-y-2">
          {collections.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 border-b py-1"
              style={{ borderColor: "var(--border)" }}
            >
              <span>
                {c.kind === "dynamic" ? "⚡ " : ""}
                {c.name}
              </span>
              <span className="flex gap-2 flex-wrap">
                <select
                  className="fm-input max-w-[7rem] fm-input-sm"
                  value={c.kind || "static"}
                  onChange={(e) =>
                    void updateCollectionKind(
                      c.id,
                      e.target.value as "static" | "dynamic",
                    )
                  }
                >
                  <option value="static">Static</option>
                  <option value="dynamic">Dynamic</option>
                </select>
                <button
                  className="fm-btn"
                  type="button"
                  onClick={() => void renameCollection(c.id, c.name)}
                >
                  Rename
                </button>
                <button
                  className="fm-btn"
                  type="button"
                  onClick={() => void deleteCollection(c.id)}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="fm-card p-4 space-y-3">
        <h2 className="font-medium">Tags</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className="fm-input max-w-xs"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="New static tag"
          />
          <button className="fm-btn" type="button" onClick={() => void addTag()}>
            Add tag
          </button>
        </div>
        <ul className="text-sm space-y-1 max-h-64 overflow-auto">
          {tags.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 border-b py-1"
              style={{ borderColor: "var(--border)" }}
            >
              <span>
                {t.name}{" "}
                <span className="opacity-60 text-xs">({t.kind || "dynamic"})</span>
              </span>
              <span className="flex gap-2">
                <button
                  className="fm-btn"
                  type="button"
                  onClick={() => void renameTag(t.id, t.name)}
                >
                  Rename
                </button>
                <button
                  className="fm-btn"
                  type="button"
                  onClick={() => void deleteTag(t.id)}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="fm-card p-4 space-y-3">
        <h2 className="font-medium">Import & reindex</h2>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Bookmark HTML import always goes into <strong>your</strong> library
          unless an admin uses Admin → import for a selected user.
        </p>
        <label className="block text-sm space-y-1">
          <span>Firefox / Chrome bookmarks HTML</span>
          <input
            className="fm-input"
            type="file"
            accept=".html,.htm"
            onChange={(e) => void onImport(e.target.files?.[0] || null)}
          />
        </label>
        {importResult ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {importResult}
          </p>
        ) : null}
        <button className="fm-btn" type="button" onClick={reindexAll}>
          Reindex all bookmarks
        </button>
      </section>

      <section className="fm-card p-4 space-y-2 text-sm">
        <h2 className="font-medium">Firefox extension install</h2>
        <ol className="list-decimal pl-5 space-y-1" style={{ color: "var(--muted)" }}>
          <li>Open <code>about:debugging#/runtime/this-firefox</code></li>
          <li>Click <strong>Load Temporary Add-on…</strong></li>
          <li>
            Select <code>extension/manifest.json</code> from your FastMark repo
          </li>
          <li>Open the toolbar popup, set your FastMark server URL, and sign in</li>
          <li>
            Use the popup, context menu “Save to FastMark”, or highlight → search
          </li>
        </ol>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Temporary add-ons unload when Firefox restarts — reload the manifest again.
          Chromium: chrome://extensions → Developer mode → Load unpacked →
          <code>extension/</code>.
        </p>
      </section>
    </div>
  );
}
