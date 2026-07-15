"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Setup failed");
      return;
    }
    router.push("/library");
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form onSubmit={onSubmit} className="fm-card w-full max-w-md p-8 space-y-5">
        <div className="flex items-center gap-3">
          <Image src="/logo.svg" alt="FastMark" width={40} height={40} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">FastMark</h1>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Create the first admin account
            </p>
          </div>
        </div>
        <label className="block space-y-1 text-sm">
          <span>Username</span>
          <input
            className="fm-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Password</span>
          <input
            className="fm-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {error ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}
        <button className="fm-btn fm-btn-primary w-full" disabled={loading}>
          {loading ? "Creating…" : "Create admin"}
        </button>
      </form>
    </main>
  );
}
