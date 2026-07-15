"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

type Me = {
  user: { id: string; username: string; role: string };
  settings: { logoUrl: string; theme: string };
};

type CollectionNode = {
  id: string;
  name: string;
  parentId?: string | null;
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
            className="block rounded-lg px-3 py-2 hover:bg-white/10"
            style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}
          >
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
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
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
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const nav = [
    { href: "/library", label: "All" },
    { href: "/library?view=favorites", label: "Favorites" },
    { href: "/library?view=read_later", label: "Read later" },
    { href: "/library?view=manual", label: "Needs manual index" },
  ];

  return (
    <div className="min-h-screen flex">
      <aside
        className="w-64 shrink-0 p-4 flex flex-col gap-4"
        style={{ background: "var(--sidebar)", color: "var(--sidebar-fg)" }}
      >
        <div className="flex items-center gap-2 px-1">
          <Image
            src={me?.settings.logoUrl || "/logo.svg"}
            alt="FastMark"
            width={32}
            height={32}
            unoptimized
          />
          <div>
            <div className="font-semibold tracking-tight">FastMark</div>
            <div className="text-xs opacity-70">{me?.user.username}</div>
          </div>
        </div>

        <nav className="space-y-1 text-sm">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-2 hover:bg-white/10"
              style={{
                background:
                  pathname === "/library" && item.href.includes(pathname)
                    ? "rgba(255,255,255,0.08)"
                    : undefined,
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="text-xs uppercase tracking-wide opacity-60 px-3 pt-2">
          Collections
        </div>
        <nav className="space-y-1 text-sm flex-1 overflow-auto">
          <CollectionTree collections={collections} />
        </nav>

        <div className="space-y-1 text-sm">
          <Link href="/settings" className="block rounded-lg px-3 py-2 hover:bg-white/10">
            Settings
          </Link>
          {me?.user.role === "admin" ? (
            <Link href="/admin" className="block rounded-lg px-3 py-2 hover:bg-white/10">
              Admin
            </Link>
          ) : null}
          <button
            type="button"
            onClick={logout}
            className="w-full text-left rounded-lg px-3 py-2 hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 border-b px-4 flex items-center justify-between gap-3" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Library
          </div>
          <button className="fm-btn" type="button" onClick={() => setChatOpen((v) => !v)}>
            {chatOpen ? "Hide chat" : "AI chat"}
          </button>
        </header>
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-auto p-4 md:p-6">{children}</div>
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
    if (!message.trim()) return;
    setBusy(true);
    const userMsg = message;
    setMessage("");
    setMessages((m) => [...m, { role: "user", content: userMsg }]);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMsg, sessionId }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.error || "Chat failed" },
      ]);
      return;
    }
    setSessionId(data.sessionId);
    setMessages((m) => [
      ...m,
      { role: "assistant", content: data.reply, proposals: data.proposals },
    ]);
    setPending(data.proposals?.length ? data.proposals : null);
  }

  async function apply() {
    if (!pending) return;
    setBusy(true);
    await fetch("/api/chat/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposals: pending }),
    });
    setBusy(false);
    setPending(null);
    setMessages((m) => [
      ...m,
      { role: "assistant", content: "Applied confirmed proposals." },
    ]);
  }

  return (
    <aside
      className="w-full max-w-md border-l flex flex-col"
      style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
    >
      <div className="p-3 border-b text-sm font-medium" style={{ borderColor: "var(--border)" }}>
        Organization chat
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-3 text-sm">
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
        <div className="px-3 pb-2">
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
      <div className="p-3 border-t flex gap-2" style={{ borderColor: "var(--border)" }}>
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
