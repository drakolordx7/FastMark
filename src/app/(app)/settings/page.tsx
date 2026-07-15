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
};

type Collection = {
  id: string;
  name: string;
  parentId: string | null;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [parentId, setParentId] = useState("");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [importResult, setImportResult] = useState("");

  async function load() {
    const [s, c] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/collections").then((r) => r.json()),
    ]);
    setSettings(s.settings);
    setCollections(c.collections || []);
  }

  useEffect(() => {
    void load();
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

  async function deleteCollection(id: string) {
    if (!confirm("Delete this collection?")) return;
    await fetch("/api/collections", {
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
        ? `Imported ${data.imported}, skipped ${data.skipped} (of ${data.total})`
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

  if (!settings) {
    return (
      <div className="text-sm" style={{ color: "var(--muted)" }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          AI credentials, theme, timezone, logo, and imports
        </p>
      </div>

      <form onSubmit={save} className="fm-card p-5 space-y-4">
        <h2 className="font-medium">AI (OpenAI-compatible)</h2>
        <label className="block text-sm space-y-1">
          <span>Base URL (e.g. https://proxy.example/v1)</span>
          <input
            className="fm-input"
            value={settings.openaiBaseUrl}
            onChange={(e) =>
              setSettings({ ...settings, openaiBaseUrl: e.target.value })
            }
            placeholder="https://example.com/v1"
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
            placeholder="sk-…"
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
            placeholder="Leave blank until ready"
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
            placeholder="/logo.svg"
          />
        </label>
        <label className="block text-sm space-y-1">
          <span>Upload logo (swap placeholder)</span>
          <input
            className="fm-input"
            type="file"
            accept="image/*,.svg"
            onChange={(e) => void uploadLogo(e.target.files?.[0] || null)}
          />
        </label>
        <button className="fm-btn fm-btn-primary" type="submit">
          Save settings
        </button>
        {message ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {message}
          </p>
        ) : null}
      </form>

      <section className="fm-card p-5 space-y-3">
        <h2 className="font-medium">Collections</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className="fm-input max-w-xs"
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
            placeholder="New collection name"
          />
          <select
            className="fm-input max-w-[12rem]"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">No parent (top level)</option>
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
                {c.name}
                {c.parentId ? (
                  <span className="opacity-60 text-xs">
                    {" "}
                    · nested under{" "}
                    {collections.find((p) => p.id === c.parentId)?.name || "…"}
                  </span>
                ) : null}
              </span>
              <span className="flex gap-2">
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

      <section className="fm-card p-5 space-y-3">
        <h2 className="font-medium">Import & reindex</h2>
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
    </div>
  );
}
