"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export default function UsagePage() {
  const { authorizedFetch } = useAuth();
  const [data, setData] = useState<{
    monthlyUsed: number;
    monthlyLimit: number;
    recent: Array<{
      id: string;
      inputAddress: string;
      correctionType: string;
      createdAt: string;
    }>;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await authorizedFetch("/api/dashboard/usage");
      if (!res.ok) return;
      const j = await res.json();
      setData(j.data);
    })();
  }, [authorizedFetch]);

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold text-white">Usage</h1>
      {data && (
        <>
          <p className="mt-4 text-zinc-400">
            This month:{" "}
            <strong className="text-white">{data.monthlyUsed}</strong> /{" "}
            {data.monthlyLimit >= 1e9 ? "∞" : data.monthlyLimit}
          </p>
          <a
            href="/api/dashboard/usage/export"
            className="mt-4 inline-block text-sm text-emerald-400 hover:underline"
            onClick={async (e) => {
              e.preventDefault();
              const res = await authorizedFetch("/api/dashboard/usage/export");
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "usage.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export CSV
          </a>
          <ul className="mt-8 space-y-2">
            {data.recent.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300"
              >
                <span className="text-zinc-500">
                  {new Date(r.createdAt).toLocaleString()}
                </span>{" "}
                · {r.correctionType}
                <p className="truncate text-zinc-400">{r.inputAddress}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
