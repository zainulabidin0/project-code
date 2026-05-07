"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

type ShopAssistPayload = {
  store: {
    shopDomain: string;
    isActive: boolean;
    widgetPosition: "bottom-right" | "bottom-left";
    widgetColor: string;
    widgetGreeting: string;
  } | null;
  usage: Record<string, number>;
};

export default function ShopAssistPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { authorizedFetch } = useAuth();
  const [shopDomain, setShopDomain] = useState("");
  const [data, setData] = useState<ShopAssistPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await authorizedFetch(`/api/dashboard/projects/${id}/shopassist`);
    if (!res.ok) return;
    const json = (await res.json()) as { data: ShopAssistPayload };
    setData(json.data);
  }, [authorizedFetch, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isConnected = Boolean(data?.store?.isActive);
  const installUrl = useMemo(() => {
    const domain = shopDomain.trim().toLowerCase();
    if (!domain) return "";
    return `/api/shopify/install?shop=${encodeURIComponent(domain)}&projectId=${encodeURIComponent(id)}`;
  }, [shopDomain, id]);

  async function saveSettings() {
    if (!data?.store) return;
    setSaving(true);
    setError(null);
    const res = await authorizedFetch(`/api/dashboard/projects/${id}/shopassist`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        widgetPosition: data.store.widgetPosition,
        widgetColor: data.store.widgetColor,
        widgetGreeting: data.store.widgetGreeting,
      }),
    });
    if (!res.ok) setError("Failed to save settings");
    setSaving(false);
    await load();
  }

  async function disconnectStore() {
    const ok = window.confirm("Disconnect this Shopify store?");
    if (!ok) return;
    const res = await authorizedFetch(`/api/dashboard/projects/${id}/shopassist`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disconnect: true }),
    });
    if (!res.ok) setError("Failed to disconnect store");
    await load();
  }

  return (
    <div>
      <Link href={`/projects/${id}`} className="text-sm text-zinc-500 hover:text-white">
        ← Back to project
      </Link>
      <h1 className="mt-4 font-display text-3xl font-semibold text-white">ShopAssist</h1>
      <p className="mt-2 text-sm text-zinc-500">Connect a Shopify store and configure your assistant widget.</p>

      {!isConnected ? (
        <section className="mt-8 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-lg font-medium text-white">Connect Shopify store</h2>
          <input
            className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            placeholder="mystore.myshopify.com"
            value={shopDomain}
            onChange={(e) => setShopDomain(e.target.value)}
          />
          <a
            href={installUrl || "#"}
            className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Install on Shopify
          </a>
        </section>
      ) : (
        <section className="mt-8 space-y-4">
          <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/15 p-4 text-emerald-200">
            Connected: <span className="font-medium">{data?.store?.shopDomain}</span>
          </div>

          <div className="rounded-lg border border-zinc-800 p-4">
            <h2 className="text-lg font-medium text-white">Widget settings</h2>
            <label className="mt-3 block text-sm text-zinc-400">Position</label>
            <select
              value={data?.store?.widgetPosition ?? "bottom-right"}
              onChange={(e) =>
                setData((prev) =>
                  prev && prev.store
                    ? {
                        ...prev,
                        store: {
                          ...prev.store,
                          widgetPosition: e.target.value as "bottom-right" | "bottom-left",
                        },
                      }
                    : prev
                )
              }
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            >
              <option value="bottom-right">bottom-right</option>
              <option value="bottom-left">bottom-left</option>
            </select>

            <label className="mt-3 block text-sm text-zinc-400">Color</label>
            <input
              value={data?.store?.widgetColor ?? "#000000"}
              onChange={(e) =>
                setData((prev) =>
                  prev && prev.store
                    ? { ...prev, store: { ...prev.store, widgetColor: e.target.value } }
                    : prev
                )
              }
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />

            <label className="mt-3 block text-sm text-zinc-400">Greeting</label>
            <input
              value={data?.store?.widgetGreeting ?? ""}
              onChange={(e) =>
                setData((prev) =>
                  prev && prev.store
                    ? { ...prev, store: { ...prev.store, widgetGreeting: e.target.value } }
                    : prev
                )
              }
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />

            <button
              type="button"
              disabled={saving}
              onClick={() => void saveSettings()}
              className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>

          <div className="rounded-lg border border-zinc-800 p-4">
            <h2 className="text-lg font-medium text-white">Usage (this month)</h2>
            <p className="mt-2 text-sm text-zinc-300">Chat: {data?.usage?.chat ?? 0}</p>
            <p className="text-sm text-zinc-300">Voice: {data?.usage?.voice ?? 0}</p>
            <p className="text-sm text-zinc-300">Cart add: {data?.usage?.cart_add ?? 0}</p>
          </div>

          <button
            type="button"
            onClick={() => void disconnectStore()}
            className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-200"
          >
            Disconnect store
          </button>
        </section>
      )}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
