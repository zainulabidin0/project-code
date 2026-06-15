"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectSubNav } from "@/components/ProjectSubNav";

type ReviewRow = {
  id: string;
  reviewText: string;
  sentiment: string;
  score: number;
  confidence: number | null;
  createdAt: string;
};

type Stats = { total: number; positive: number; negative: number; netScore: number };

type ShopStore = {
  shopDomain: string;
  isActive: boolean;
  authStatus: string;
} | null;

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
  const [shopStore, setShopStore] = useState<ShopStore>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const apiBase =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      : "";

  const load = useCallback(async () => {
    setErr(null);
    const [r1, r2, r3] = await Promise.all([
      authorizedFetch(`/api/dashboard/projects/${id}/reviews?limit=50`),
      authorizedFetch(`/api/dashboard/projects/${id}/reviews/stats`),
      authorizedFetch(`/api/dashboard/projects/${id}/shopassist`),
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
    if (r3.ok) {
      const j3 = (await r3.json()) as {
        data: { store: ShopStore };
      };
      setShopStore(j3.data.store);
    }
  }, [authorizedFetch, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const shopConnected =
    Boolean(shopStore?.isActive) && shopStore?.authStatus !== "REAUTH_REQUIRED";

  const themeSnippet = useMemo(() => {
    const base = apiBase.replace(/\/+$/, "");
    const shop = shopStore?.shopDomain ?? "your-store.myshopify.com";
    return `{# In product template: {% render 'product-review-form' %} #}
{# Full file: ${base}/shopify/product-review-form.liquid #}
{# Replace YOUR_APP_URL in the snippet with: ${base} #}
POST ${base}/api/v1/shopify/sentiment
Header: X-Shop-Domain: ${shop}`;
  }, [apiBase, shopStore?.shopDomain]);

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(themeSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <Link href={`/projects/${id}`} className="text-sm text-zinc-500 hover:text-white">
        ← Project
      </Link>
      <h1 className="mt-4 font-display text-3xl font-semibold text-white">Reviews</h1>
      <ProjectSubNav projectId={id} active="reviews" />
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

      <section className="mt-8 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-lg font-medium text-white">Shopify product reviews</h2>
        <p className="mt-2 text-sm text-zinc-500">
          When a customer submits a review on your Shopify product page, it is analyzed
          and stored here automatically.
        </p>
        {shopConnected ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-emerald-400">
              Store connected: <span className="font-medium">{shopStore?.shopDomain}</span>
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-400">
              <li>
                Download the theme snippet from{" "}
                <a
                  href={`${apiBase.replace(/\/+$/, "")}/shopify/product-review-form.liquid`}
                  className="text-emerald-500 underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  product-review-form.liquid
                </a>
              </li>
              <li>
                In Shopify: Online Store → Themes → Edit code → Snippets → Add snippet →
                paste as <code className="text-zinc-300">product-review-form</code>
              </li>
              <li>
                Set <code className="text-zinc-300">YOUR_APP_URL</code> to{" "}
                <code className="text-zinc-300">{apiBase.replace(/\/+$/, "")}</code>
              </li>
              <li>
                In your product template, add:{" "}
                <code className="text-zinc-300">{`{% render 'product-review-form' %}`}</code>
              </li>
            </ol>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
              {themeSnippet}
            </pre>
            <button
              type="button"
              onClick={() => void copySnippet()}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              {copied ? "Copied!" : "Copy setup summary"}
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-sm text-amber-300/90">
              Connect your Shopify store first so reviews can be linked to this project.
            </p>
            <Link
              href={`/projects/${id}/shopassist`}
              className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500"
            >
              Connect via ShopAssist
            </Link>
          </div>
        )}
      </section>

      <ul className="mt-8 space-y-2">
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
