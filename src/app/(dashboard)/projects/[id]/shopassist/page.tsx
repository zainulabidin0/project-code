"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

type ShopAssistPayload = {
  store: {
    id: string;
    shopDomain: string;
    isActive: boolean;
    authStatus: string;
    themeVersion: string;
    hasStorefrontToken: boolean;
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
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await authorizedFetch(`/api/dashboard/projects/${id}/shopassist`);
    if (!res.ok) return;
    const json = (await res.json()) as { data: ShopAssistPayload };
    setData(json.data);
    if (!json.data.store?.hasStorefrontToken) setShowTokenForm(true);
  }, [authorizedFetch, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasStore = Boolean(data?.store);
  const needsReauth = data?.store?.authStatus === "REAUTH_REQUIRED";
  const isConnected = Boolean(data?.store?.isActive) && !needsReauth;
  const showStorePanel = hasStore && (isConnected || needsReauth);
  const isOs2Theme = data?.store?.themeVersion === "os2";

  const installUrl = useMemo(() => {
    const domain = shopDomain.trim().toLowerCase();
    if (!domain) return "";
    return `/api/shopify/install?shop=${encodeURIComponent(domain)}&projectId=${encodeURIComponent(id)}`;
  }, [shopDomain, id]);

  const reconnectUrl = useMemo(() => {
    if (!data?.store?.shopDomain) return "";
    return `/api/shopify/install?shop=${encodeURIComponent(data.store.shopDomain)}&projectId=${encodeURIComponent(id)}`;
  }, [data?.store?.shopDomain, id]);

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

  async function saveStorefrontToken() {
    if (!data?.store || !tokenInput.trim()) return;
    setTokenSaving(true);
    setError(null);
    const res = await authorizedFetch("/api/dashboard/shopassist/storefront-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: id,
        storefrontToken: tokenInput.trim(),
      }),
    });
    if (!res.ok) {
      setError("Failed to save Storefront token");
    } else {
      setTokenInput("");
      setShowTokenForm(false);
    }
    setTokenSaving(false);
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

      {needsReauth && (
        <div className="mt-6 rounded-lg border border-red-800 bg-red-950/40 p-4">
          <p className="font-semibold text-red-200">Shopify connection lost</p>
          <p className="mt-1 text-sm text-red-300/90">
            App permissions were revoked or expired. Your widget has stopped working. Reconnect to restore it.
          </p>
          <a
            href={reconnectUrl}
            className="mt-3 inline-block rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-500"
          >
            Reconnect Shopify store
          </a>
        </div>
      )}

      {!showStorePanel ? (
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
          {isOs2Theme && (
            <div className="rounded-lg border border-yellow-700/50 bg-yellow-950/30 p-4">
              <p className="font-semibold text-yellow-200">Your store uses an Online Store 2.0 theme</p>
              <p className="mt-1 text-sm text-yellow-200/80">
                Script tags may not appear on OS 2.0 themes. If the widget is missing, add it via the Theme Editor:
              </p>
              <ol className="mt-2 list-decimal pl-5 text-sm text-yellow-200/80">
                <li>Online Store → Themes → Customize</li>
                <li>Click Add section → Apps</li>
                <li>Select ShopAssist Widget (or paste the script manually)</li>
              </ol>
            </div>
          )}

          <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/15 p-4 text-emerald-200">
            Connected: <span className="font-medium">{data?.store?.shopDomain}</span>
          </div>

          <div className="rounded-lg border border-zinc-800 p-4">
            <h2 className="text-lg font-medium text-white">Storefront API token</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Required for product search. Generate from Shopify Admin → Settings → Apps and sales channels →
              Develop apps → Your app → API credentials (Storefront API).
            </p>
            {data?.store?.hasStorefrontToken && !showTokenForm ? (
              <div className="mt-3 flex items-center gap-3 text-emerald-400">
                <span className="text-sm">✓ Token saved</span>
                <button
                  type="button"
                  onClick={() => setShowTokenForm(true)}
                  className="text-sm text-zinc-400 underline hover:text-white"
                >
                  Update
                </button>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <input
                  type="password"
                  placeholder="shpat_xxxxxxxxxxxxxxxx"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
                />
                <button
                  type="button"
                  disabled={tokenSaving || !tokenInput.trim()}
                  onClick={() => void saveStorefrontToken()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  {tokenSaving ? "Saving…" : "Save token"}
                </button>
              </div>
            )}
            {!data?.store?.hasStorefrontToken && (
              <p className="mt-2 text-xs text-red-400">
                Product search will not work until a Storefront API token is saved.
              </p>
            )}
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
