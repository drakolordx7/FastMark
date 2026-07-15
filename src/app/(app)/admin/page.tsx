"use client";

import { FormEvent, useEffect, useState } from "react";

type AdminUser = {
  id: string;
  username: string;
  role: string;
  disabled: boolean;
  aiDailyCap: number | null;
};

type Usage = {
  userId: string;
  day: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
};

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [system, setSystem] = useState({
    globalOpenaiBaseUrl: "",
    globalOpenaiModel: "",
    globalEmbeddingModel: "",
    hasGlobalApiKey: false,
    crawlMaxHtmlBytes: 2_000_000,
    crawlMaxTextChars: 500_000,
    crawlTimeoutMs: 20_000,
    logoUrl: "/logo.svg",
  });
  const [globalKey, setGlobalKey] = useState("");
  const [newUser, setNewUser] = useState({ username: "", password: "" });
  const [msg, setMsg] = useState("");
  const [queue, setQueue] = useState<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  } | null>(null);

  async function load() {
    const res = await fetch("/api/admin");
    if (res.status === 403) {
      setMsg("Admin only");
      return;
    }
    const data = await res.json();
    setUsers(data.users || []);
    setUsage(data.usage || []);
    setSystem(data.system);
    const q = await fetch("/api/admin/queue").then((r) => r.json());
    if (q.queue) setQueue(q.queue);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_user", ...newUser }),
    });
    setNewUser({ username: "", password: "" });
    setMsg("User created");
    await load();
  }

  async function saveSystem(e: FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "system",
        globalOpenaiBaseUrl: system.globalOpenaiBaseUrl,
        globalOpenaiModel: system.globalOpenaiModel,
        globalEmbeddingModel: system.globalEmbeddingModel,
        crawlMaxHtmlBytes: system.crawlMaxHtmlBytes,
        crawlMaxTextChars: system.crawlMaxTextChars,
        crawlTimeoutMs: system.crawlTimeoutMs,
        logoUrl: system.logoUrl,
        globalOpenaiApiKey: globalKey.trim() || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? "System settings saved" : data.error || "Failed to save");
    if (res.ok) setGlobalKey("");
    await load();
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Users, global AI default, crawl limits, usage
        </p>
      </div>
      {msg ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {msg}
        </p>
      ) : null}

      <form onSubmit={createUser} className="fm-card p-5 space-y-3">
        <h2 className="font-medium">Create user</h2>
        <input
          className="fm-input"
          placeholder="Username"
          value={newUser.username}
          onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
        />
        <input
          className="fm-input"
          type="password"
          placeholder="Password"
          value={newUser.password}
          onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
        />
        <button className="fm-btn fm-btn-primary">Create</button>
      </form>

      <section className="fm-card p-5 space-y-3">
        <h2 className="font-medium">Users</h2>
        <div className="space-y-2">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b py-2"
              style={{ borderColor: "var(--border)" }}
            >
              <div>
                <div className="font-medium">
                  {u.username}{" "}
                  <span className="text-xs opacity-60">({u.role})</span>
                </div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  cap: {u.aiDailyCap ?? "none"} ·{" "}
                  {u.disabled ? "disabled" : "active"}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="fm-btn"
                  onClick={async () => {
                    await fetch("/api/admin", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "patch_user",
                        userId: u.id,
                        disabled: !u.disabled,
                      }),
                    });
                    await load();
                  }}
                >
                  {u.disabled ? "Enable" : "Disable"}
                </button>
                <button
                  className="fm-btn"
                  onClick={async () => {
                    const cap = prompt(
                      "Daily AI cap (blank = none)",
                      u.aiDailyCap?.toString() ?? "",
                    );
                    await fetch("/api/admin", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "patch_user",
                        userId: u.id,
                        aiDailyCap: cap === "" || cap === null ? null : Number(cap),
                      }),
                    });
                    await load();
                  }}
                >
                  Set cap
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <form onSubmit={saveSystem} className="fm-card p-5 space-y-3">
        <h2 className="font-medium">Global AI & crawl</h2>
        <input
          className="fm-input"
          placeholder="Global base URL https://…/v1"
          value={system.globalOpenaiBaseUrl}
          onChange={(e) =>
            setSystem({ ...system, globalOpenaiBaseUrl: e.target.value })
          }
        />
        <input
          className="fm-input"
          type="password"
          placeholder={
            system.hasGlobalApiKey
              ? "Global API key (saved — blank keeps)"
              : "Global API key"
          }
          value={globalKey}
          onChange={(e) => setGlobalKey(e.target.value)}
        />
        <input
          className="fm-input"
          placeholder="Global model"
          value={system.globalOpenaiModel}
          onChange={(e) =>
            setSystem({ ...system, globalOpenaiModel: e.target.value })
          }
        />
        <input
          className="fm-input"
          placeholder="Global embedding model"
          value={system.globalEmbeddingModel}
          onChange={(e) =>
            setSystem({ ...system, globalEmbeddingModel: e.target.value })
          }
        />
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="text-sm space-y-1">
            <span>Max HTML bytes</span>
            <input
              className="fm-input"
              type="number"
              value={system.crawlMaxHtmlBytes}
              onChange={(e) =>
                setSystem({
                  ...system,
                  crawlMaxHtmlBytes: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="text-sm space-y-1">
            <span>Max text chars</span>
            <input
              className="fm-input"
              type="number"
              value={system.crawlMaxTextChars}
              onChange={(e) =>
                setSystem({
                  ...system,
                  crawlMaxTextChars: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="text-sm space-y-1">
            <span>Timeout ms</span>
            <input
              className="fm-input"
              type="number"
              value={system.crawlTimeoutMs}
              onChange={(e) =>
                setSystem({
                  ...system,
                  crawlTimeoutMs: Number(e.target.value),
                })
              }
            />
          </label>
        </div>
        <input
          className="fm-input"
          placeholder="System logo URL"
          value={system.logoUrl}
          onChange={(e) => setSystem({ ...system, logoUrl: e.target.value })}
        />
        <label className="block text-sm space-y-1">
          <span>Upload system logo</span>
          <input
            className="fm-input"
            type="file"
            accept="image/*,.svg"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.append("file", file);
              form.append("scope", "system");
              const res = await fetch("/api/logo", { method: "POST", body: form });
              const data = await res.json();
              if (res.ok) {
                setSystem({ ...system, logoUrl: data.logoUrl });
                setMsg("System logo uploaded");
              } else {
                setMsg(data.error || "Upload failed");
              }
            }}
          />
        </label>
        <button className="fm-btn fm-btn-primary">Save system</button>
      </form>

      <section className="fm-card p-5 space-y-3">
        <h2 className="font-medium">Index queue</h2>
        {queue ? (
          <div className="text-sm grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div>waiting: {queue.waiting}</div>
            <div>active: {queue.active}</div>
            <div>delayed: {queue.delayed}</div>
            <div>completed: {queue.completed}</div>
            <div>failed: {queue.failed}</div>
          </div>
        ) : (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Queue unavailable
          </p>
        )}
        <button className="fm-btn" type="button" onClick={() => void load()}>
          Refresh
        </button>
      </section>

      <section className="fm-card p-5 space-y-3">
        <h2 className="font-medium">Usage (recent)</h2>
        <div className="text-sm space-y-1">
          {usage.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No usage yet</p>
          ) : (
            usage.map((u) => (
              <div key={`${u.userId}-${u.day}`}>
                {u.day}: user {u.userId.slice(0, 8)}… — {u.requests} req,{" "}
                {u.promptTokens + u.completionTokens} tokens
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
