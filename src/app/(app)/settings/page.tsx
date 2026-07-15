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

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [importResult, setImportResult] = useState("");

  async function load() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    setSettings(data.settings);
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
        ...settings,
        openaiApiKey: apiKey || undefined,
      }),
    });
    setMessage(res.ok ? "Saved" : "Failed to save");
    setApiKey("");
    await load();
    const theme = settings.theme;
    const dark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }

  async function addCollection() {
    if (!collectionName.trim()) return;
    await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: collectionName }),
    });
    setCollectionName("");
    setMessage("Collection created");
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
    return <div className="text-sm" style={{ color: "var(--muted)" }}>Loading…</div>;
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          AI credentials, theme, timezone, and imports
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
          <span>Logo URL (placeholder path or uploaded URL)</span>
          <input
            className="fm-input"
            value={settings.logoUrl}
            onChange={(e) =>
              setSettings({ ...settings, logoUrl: e.target.value })
            }
            placeholder="/logo.svg"
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
        <div className="flex gap-2">
          <input
            className="fm-input"
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
            placeholder="New collection name"
          />
          <button className="fm-btn" type="button" onClick={addCollection}>
            Add
          </button>
        </div>
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
