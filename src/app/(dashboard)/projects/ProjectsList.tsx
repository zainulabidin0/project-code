"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { LinkStoreModal } from "@/components/shopify/LinkStoreModal";

type Project = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  reviewTotal: number;
  reviewPositive: number;
  reviewNegative: number;
  reviewNetScore: number;
};

export function ProjectsList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authorizedFetch } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const shopifyConnected = searchParams.get("shopify_connected");
  const storeName = searchParams.get("store_name");
  const encryptedToken = searchParams.get("token");

  const load = useCallback(async () => {
    const res = await authorizedFetch("/api/dashboard/projects");
    if (!res.ok) return;
    const j = await res.json();
    setProjects(j.data);
  }, [authorizedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLinkStore(projectId: string) {
    if (!shopifyConnected || !encryptedToken) return;
    const res = await authorizedFetch("/api/shopify/link-store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        shopDomain: shopifyConnected,
        encryptedToken,
        storeName: storeName || undefined,
      }),
    });
    if (!res.ok) throw new Error("link failed");
    router.replace("/projects");
    router.push(`/projects/${projectId}/shopassist`);
  }

  function dismissLinkModal() {
    router.replace("/projects");
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await authorizedFetch("/api/dashboard/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await res.json();
    if (!res.ok) {
      setError(j.error?.message ?? "Failed");
      return;
    }
    setName("");
    await load();
  }

  async function deleteProject(projectId: string, projectName: string) {
    if (
      !window.confirm(
        `Delete “${projectName}” and all its API keys and usage history? This cannot be undone.`
      )
    ) {
      return;
    }
    setError(null);
    setDeletingId(projectId);
    try {
      const res = await authorizedFetch(`/api/dashboard/projects/${projectId}`, {
        method: "DELETE",
      });
      const j = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setError(j.error?.message ?? "Failed to delete project");
        return;
      }
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      {shopifyConnected && encryptedToken && projects.length > 0 && (
        <LinkStoreModal
          shopDomain={shopifyConnected}
          storeName={storeName}
          encryptedToken={encryptedToken}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          onClose={dismissLinkModal}
          onLink={handleLinkStore}
        />
      )}

      <h1 className="font-display text-3xl font-semibold text-white">Projects</h1>
      <form onSubmit={create} className="mt-6 flex max-w-md gap-2">
        <input
          placeholder="New project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          required
        />
        <button
          type="submit"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
        >
          Create
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <ul className="mt-8 space-y-2">
        {projects.map((p) => (
          <li
            key={p.id}
            className="flex items-stretch gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 hover:border-zinc-600"
          >
            <Link href={`/projects/${p.id}`} className="min-w-0 flex-1 px-4 py-3">
              <span className="font-medium text-white">{p.name}</span>
              {p.description && <p className="text-sm text-zinc-500">{p.description}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                <span>
                  <span className="text-zinc-400">{p.reviewTotal ?? 0}</span> reviews
                </span>
                <span className="text-emerald-400/90">
                  +{p.reviewPositive ?? 0} positive
                </span>
                <span className="text-red-400/90">
                  {p.reviewNegative ?? 0} negative
                </span>
                <span>
                  Net{" "}
                  <span
                    className={
                      (p.reviewNetScore ?? 0) >= 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }
                  >
                    {(p.reviewNetScore ?? 0) > 0 ? "+" : ""}
                    {p.reviewNetScore ?? 0}
                  </span>
                </span>
                <Link
                  href={`/projects/${p.id}/reviews`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-emerald-500 hover:underline"
                >
                  Review stats →
                </Link>
              </div>
            </Link>
            <button
              type="button"
              disabled={deletingId !== null}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void deleteProject(p.id, p.name);
              }}
              className="shrink-0 self-center px-3 py-2 text-xs text-red-400 hover:underline disabled:opacity-50"
            >
              {deletingId === p.id ? "Deleting…" : "Delete"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
