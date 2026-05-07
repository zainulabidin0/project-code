"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

type ReviewRow = {
  id: string;
  reviewText: string;
  sentiment: string;
  score: number;
  confidence: number | null;
  createdAt: string;
};

type Stats = { total: number; positive: number; negative: number; netScore: number };

export default function ProjectReviewsPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const { authorizedFetch } = useAuth();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const [r1, r2] = await Promise.all([
      authorizedFetch(`/api/dashboard/projects/${id}/reviews?limit=50`),
      authorizedFetch(`/api/dashboard/projects/${id}/reviews/stats`),
    ]);
    if (r1.ok) {
      const j = (await r1.json()) as { data: { reviews: ReviewRow[]; total: number } };
      setRows(j.data.reviews);
      setTotal(j.data.total);
    } else {
      setErr("Could not load reviews");
    }
    if (r2.ok) {
      const j2 = (await r2.json()) as { data: Stats };
      setStats(j2.data);
    }
  }, [authorizedFetch, id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <Link href={`/projects/${id}`} className="text-sm text-zinc-500 hover:text-white">
        ← Project
      </Link>
      <h1 className="mt-4 font-display text-3xl font-semibold text-white">Reviews</h1>
      {stats && (
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-zinc-300">
          <span>
            Net: <span className="font-mono text-emerald-400">{stats.netScore}</span>
          </span>
          <span>Total: {stats.total}</span>
          <span>Positive: {stats.positive}</span>
          <span>Negative: {stats.negative}</span>
        </div>
      )}
      <p className="mt-2 text-sm text-zinc-500">
        {total} stored review{total === 1 ? "" : "s"}. For API access use{" "}
        <code className="text-zinc-400">GET /api/v1/reviews</code> with your project API key.
      </p>
      {err && <p className="mt-2 text-sm text-amber-400">{err}</p>}

      <ul className="mt-6 space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-200"
          >
            <p className="whitespace-pre-wrap">{r.reviewText}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {r.sentiment} · {r.confidence != null ? `${r.confidence}% · ` : null}
              {r.id}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm">
        <Link
          href={`/projects/${id}/reviews/settings`}
          className="text-emerald-500 hover:underline"
        >
          Review page settings
        </Link>
      </p>
    </div>
  );
}
