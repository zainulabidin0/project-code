"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

type Settings = {
  isPublic: boolean;
  slug: string | null;
  pageTitle: string | null;
  description: string | null;
  showScores: boolean;
};

export default function ReviewPageSettingsPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const { authorizedFetch } = useAuth();
  const [data, setData] = useState<Settings | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [slug, setSlug] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showScores, setShowScores] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const baseUrl =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      : "";

  const load = useCallback(async () => {
    const res = await authorizedFetch(
      `/api/dashboard/projects/${id}/reviews/settings`
    );
    if (!res.ok) return;
    const j = (await res.json()) as { data: Settings };
    const d = j.data;
    setData(d);
    setIsPublic(d.isPublic);
    setSlug(d.slug ?? "");
    setPageTitle(d.pageTitle ?? "");
    setDescription(d.description ?? "");
    setShowScores(d.showScores);
  }, [authorizedFetch, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setMsg(null);
    setSaving(true);
    try {
      const res = await authorizedFetch(
        `/api/dashboard/projects/${id}/reviews/settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isPublic,
            slug: slug.trim() || null,
            pageTitle: pageTitle.trim() || null,
            description: description.trim() || null,
            showScores,
          }),
        }
      );
      const j = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setMsg(j.error?.message ?? "Save failed");
        return;
      }
      setMsg("Saved.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  const publicUrl =
    slug.trim() && isPublic ? `${baseUrl}/reviews/${slug.trim()}` : "";

  return (
    <div>
      <Link
        href={`/projects/${id}/reviews`}
        className="text-sm text-zinc-500 hover:text-white"
      >
        ← Reviews
      </Link>
      <h1 className="mt-4 font-display text-3xl font-semibold text-white">
        Public reviews page
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        When public, anyone with the link can view stored reviews (no API key).
      </p>

      {data && (
        <div className="mt-8 max-w-lg space-y-4">
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            Public page
          </label>
          <div>
            <label className="text-xs text-zinc-500">URL slug</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="my-store"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Lowercase letters, numbers, and hyphens; 3–100 characters. Required
              when public.
            </p>
          </div>
          <div>
            <label className="text-xs text-zinc-500">Page title (optional)</label>
            <input
              value={pageTitle}
              onChange={(e) => setPageTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={showScores}
              onChange={(e) => setShowScores(e.target.checked)}
            />
            Show +1 / −1 on public page
          </label>

          {publicUrl && (
            <p className="text-sm text-emerald-400">
              <a href={publicUrl} className="underline break-all">
                {publicUrl}
              </a>
            </p>
          )}

          {msg && <p className="text-sm text-amber-300">{msg}</p>}

          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
