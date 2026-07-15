"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

type Me = {
  user: { id: string; username: string; role: string };
  settings: { logoUrl: string; theme: string };
};

type CollectionNode = {
  id: string;
  name: string;
  parentId?: string | null;
  kind?: "static" | "dynamic" | string;
};

function CollectionTree({
  collections,
  parentId = null,
  depth = 0,
}: {
  collections: CollectionNode[];
  parentId?: string | null;
  depth?: number;
}) {
  const kids = collections.filter((c) => (c.parentId ?? null) === parentId);
  return (
    <>
      {kids.map((c) => (
        <div key={c.id}>
          <Link
            href={`/library?collectionId=${c.id}`}
            className="block rounded-lg px-3 py-1.5 hover:bg-white/10 text-sm"
            style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}
          >
            {c.kind === "dynamic" ? (
              <span className="mr-1 opacity-80" title="Dynamic collection">
                ⚡
              </span>
            ) : null}
            {c.name}
          </Link>
          <CollectionTree
            collections={collections}
            parentId={c.id}
            depth={depth + 1}
          />
        </div>
      ))}
    </>
  );
}

export function AppShell({
  children,
  collections,
}: {
  children: ReactNode;
  collections: CollectionNode[];
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [liveCollections, setLiveCollections] = useState<CollectionNode[] | null>(
    null,
  );
  const displayCollections = liveCollections ?? collections;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch("/api/auth/me")
        .then(async (r) => {
          if (r.status === 401) {
            router.replace("/login");
            return null;
          }
          return r.json();
        })
        .then((d) => {
          if (!d) return;
          setMe(d);
          const theme = d.settings?.theme || "system";
          const dark =
            theme === "dark" ||
            (theme === "system" &&
              window.matchMedia("(prefers-color-scheme: dark)").matches);
          document.documentElement.classList.toggle("dark", dark);
        });
      void fetch("/api/collections")
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d.collections)) setLiveCollections(d.collections);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router, pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const currentView = sp.get("view");
  const nav = [
    { href: "/library", label: "All", view: null },
    { href: "/library?view=ready", label: "Ready", view: "ready" },
    { href: "/library?view=queued", label: "Queued", view: "queued" },
    { href: "/library?view=indexing", label: "Indexing", view: "indexing" },
    { href: "/library?view=manual", label: "Needs manual index", view: "manual" },
    { href: "/library?view=failed", label: "Failed", view: "failed" },
    { href: "/library?view=favorites", label: "Favorites", view: "favorites" },
    { href: "/library?view=read_later", label: "Read later", view: "read_later" },
  ];

  return (
    <div className="h-screen overflow-hidden flex">
      <aside
        className="w-60 shrink-0 p-3 flex flex-col gap-2 h-full"
        style={{ background: "var(--sidebar)", color: "var(--sidebar-fg)" }}
      >
        <div className="flex items-center gap-2 px-1">
          <Image
            src={me?.settings.logoUrl || "/logo.svg"}
            alt="FastMark"
            width={28}
            height={28}
            unoptimized
          />
          <div className="min-w-0">
            <div className="font-semibold tracking-tight text-sm">FastMark</div>
            <div className="text-xs opacity-70 truncate">{me?.user.username}</div>
          </div>
        </div>

        <nav className="space-y-0.5 text-sm overflow-auto">
          {nav.map((item) => {
            const active =
              pathname === "/library" &&
              (item.view ? currentView === item.view : !currentView && !sp.get("collectionId"));
            return (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-lg px-3 py-1.5 hover:bg-white/10"
                style={{
                  background: active ? "rgba(255,255,255,0.08)" : undefined,
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="text-xs uppercase tracking-wide opacity-60 px-3 pt-1">
          Collections
        </div>
        <nav className="space-y-0.5 text-sm flex-1 min-h-0 overflow-auto">
          <CollectionTree collections={displayCollections} />
        </nav>

        <div className="space-y-0.5 text-sm shrink-0 border-t pt-2" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <Link href="/settings" className="block rounded-lg px-3 py-1.5 hover:bg-white/10">
            Settings
          </Link>
          {me?.user.role === "admin" ? (
            <Link href="/admin" className="block rounded-lg px-3 py-1.5 hover:bg-white/10">
              Admin
            </Link>
          ) : null}
          <button
            type="button"
            onClick={logout}
            className="w-full text-left rounded-lg px-3 py-1.5 hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        <header
          className="h-12 shrink-0 border-b px-4 flex items-center justify-between gap-3"
          style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
        >
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Library
          </div>
          <button className="fm-btn" type="button" onClick={() => setChatOpen((v) => !v)}>
            {chatOpen ? "Hide chat" : "AI chat"}
          </button>
        </header>
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto p-3 md:p-4">{children}</div>
          {chatOpen ? <ChatSidebar /> : null}
        </div>
      </div>
    </div>
  );
}

function ChatSidebar() {
  const [message, setMessage] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<
    { role: string; content: string; proposals?: unknown }[]
  >([]);
  const [pending, setPending] = useState<unknown[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!message.trim() || busy) return;
    setBusy(true);
    const userMsg = message;
    setMessage("");
    setMessages((m) => [...m, { role: "user", content: userMsg }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, sessionId }),
      });
      const text = await res.text();
      let data: {
        error?: string;
        sessionId?: string;
        reply?: string;
        proposals?: unknown[];
      } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {
          error: text
            ? `Bad response (${res.status}): ${text.slice(0, 200)}`
            : `${res.status} status code (no body)`,
        };
      }
      if (!res.ok) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: data.error || `${res.status} status code (no body)`,
          },
        ]);
        return;
      }
      setSessionId(data.sessionId);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply || "", proposals: data.proposals },
      ]);
      setPending(data.proposals?.length ? data.proposals : null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setMessages((m) => [...m, { role: "assistant", content: msg }]);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposals: pending }),
      });
      const text = await res.text();
      let data: { error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text || "Apply failed" };
      }
      if (!res.ok) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: data.error || "Apply failed" },
        ]);
        return;
      }
      setPending(null);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Applied confirmed proposals." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      className="w-full max-w-md border-l flex flex-col h-full min-h-0 shrink-0"
      style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
    >
      <div
        className="p-3 border-b text-sm font-medium shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        Organization chat
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3 text-sm">
        {messages.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Ask to reorganize, tag, or move bookmarks. Proposals require confirm.
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div
            key={i}
            className="rounded-lg p-3"
            style={{
              background:
                m.role === "user" ? "var(--accent-soft)" : "var(--bg)",
            }}
          >
            <div className="text-xs mb-1 opacity-60">{m.role}</div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
      </div>
      {pending ? (
        <div className="px-3 pb-2 shrink-0">
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
            {Array.isArray(pending) ? pending.length : 0} proposal(s) awaiting
            confirmation
          </div>
          <div className="flex gap-2">
            <button className="fm-btn fm-btn-primary" disabled={busy} onClick={apply}>
              Confirm apply
            </button>
            <button className="fm-btn" disabled={busy} onClick={() => setPending(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      <div
        className="p-3 border-t flex gap-2 shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <input
          className="fm-input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Reorganize, tag, merge…"
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        <button className="fm-btn fm-btn-primary" disabled={busy} onClick={send}>
          Send
        </button>
      </div>
    </aside>
  );
}
