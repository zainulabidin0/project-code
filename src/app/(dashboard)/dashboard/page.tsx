"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

export default function DashboardHome() {
  const { authorizedFetch, user } = useAuth();
  const [stats, setStats] = useState<{
    monthlyUsed: number;
    monthlyLimit: number;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await authorizedFetch("/api/dashboard/usage");
      if (!res.ok) return;
      const j = await res.json();
      setStats({
        monthlyUsed: j.data.monthlyUsed,
        monthlyLimit: j.data.monthlyLimit,
      });
    })();
  }, [authorizedFetch]);

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold text-white">
        Dashboard
      </h1>
      <p className="mt-2 text-zinc-400">
        Signed in as {user?.email} · plan <span className="text-emerald-400">{user?.plan}</span>
      </p>
      {stats && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
            <p className="text-sm text-zinc-500">Monthly usage</p>
            <p className="mt-2 font-display text-2xl text-white">
              {stats.monthlyUsed} /{" "}
              {stats.monthlyLimit >= 1e9 ? "∞" : stats.monthlyLimit}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
            <p className="text-sm text-zinc-500">Quick actions</p>
            <Link
              href="/projects"
              className="mt-3 inline-block text-emerald-400 hover:underline"
            >
              Manage projects →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
