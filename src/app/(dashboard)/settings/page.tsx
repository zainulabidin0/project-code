"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export default function SettingsPage() {
  const { authorizedFetch, user, setSession, clearSession, accessToken } =
    useAuth();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await authorizedFetch("/api/dashboard/account");
      if (!res.ok) return;
      const j = await res.json();
      setName(j.data.name ?? "");
    })();
  }, [authorizedFetch]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await authorizedFetch("/api/dashboard/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await res.json();
    if (!res.ok) {
      setMessage(j.error?.message ?? "Failed");
      return;
    }
    const t =
      accessToken ?? (typeof window !== "undefined" ? sessionStorage.getItem("af_access_token") : null);
    if (user && j.data && t) {
      setSession(t, {
        ...user,
        name: j.data.name,
      });
    }
    setMessage("Saved");
  }

  async function logoutAll() {
    await authorizedFetch("/api/auth/logout-all", { method: "POST" });
    clearSession();
    window.location.href = "/login";
  }

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold text-white">Settings</h1>
      <form onSubmit={save} className="mt-8 max-w-md space-y-4">
        <div>
          <label className="text-sm text-zinc-400">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          />
        </div>
        {message && <p className="text-sm text-zinc-400">{message}</p>}
        <button
          type="submit"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white"
        >
          Save
        </button>
      </form>
      <div className="mt-12 border-t border-zinc-800 pt-8">
        <h2 className="text-lg font-medium text-white">Sessions</h2>
        <button
          type="button"
          onClick={() => void logoutAll()}
          className="mt-2 text-sm text-red-400 hover:underline"
        >
          Log out all devices
        </button>
      </div>
    </div>
  );
}
