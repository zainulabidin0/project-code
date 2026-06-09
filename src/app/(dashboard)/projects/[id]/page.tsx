"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectSubNav } from "@/components/ProjectSubNav";

type KeyRow = {
  id: string;
  name: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

export default function ProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const router = useRouter();
  const { authorizedFetch } = useAuth();
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [projectName, setProjectName] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [playground, setPlayground] = useState("");
  const [playResult, setPlayResult] = useState<string | null>(null);
  const [sentimentText, setSentimentText] = useState("");
  const [sentimentResult, setSentimentResult] = useState<string | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");

  const load = useCallback(async () => {
    const [pr, kr] = await Promise.all([
      authorizedFetch(`/api/dashboard/projects/${id}`),
      authorizedFetch(`/api/dashboard/projects/${id}/keys`),
    ]);
    if (pr.ok) {
      const j = await pr.json();
      setProjectName(j.data.name);
    }
    if (kr.ok) {
      const j = await kr.json();
      setKeys(j.data);
    }
  }, [authorizedFetch, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createKey() {
    setNewKey(null);
    const res = await authorizedFetch(`/api/dashboard/projects/${id}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const j = await res.json();
    if (res.ok && j.data?.key) {
      setNewKey(j.data.key as string);
      await load();
    }
  }

  async function revokeKey(keyId: string) {
    await authorizedFetch(`/api/dashboard/keys/${keyId}`, { method: "DELETE" });
    await load();
  }

  async function deleteProject() {
    if (
      !window.confirm(
        "Delete this project and all its API keys and usage history? This cannot be undone."
      )
    ) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      const res = await authorizedFetch(`/api/dashboard/projects/${id}`, {
        method: "DELETE",
      });
      const j = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setDeleteError(j.error?.message ?? "Failed to delete project");
        return;
      }
      router.push("/projects");
    } finally {
      setDeleting(false);
    }
  }

  async function tryCorrect() {
    setPlayResult(null);
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const res = await fetch(`${base}/api/v1/correct`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKeyInput.trim(),
      },
      body: JSON.stringify({
        address: playground,
        options: { includeMetadata: true },
      }),
    });
    const j = await res.json();
    setPlayResult(JSON.stringify(j, null, 2));
  }

  async function trySentiment() {
    const key = apiKeyInput.trim();
    const review = sentimentText.trim();
    if (!key) {
      setSentimentResult(
        JSON.stringify(
          { error: "Paste your API key above (af_live_...)." },
          null,
          2
        )
      );
      return;
    }
    if (!review) {
      setSentimentResult(
        JSON.stringify({ error: "Enter some review text to analyze." }, null, 2)
      );
      return;
    }
    setSentimentResult(null);
    setSentimentLoading(true);
    try {
      const base = typeof window !== "undefined" ? window.location.origin : "";
      const res = await fetch(`${base}/api/v1/sentiment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
        },
        body: JSON.stringify({ review }),
      });
      const j = await res.json();
      setSentimentResult(JSON.stringify(j, null, 2));
    } finally {
      setSentimentLoading(false);
    }
  }

  return (
    <div>
      <Link href="/projects" className="text-sm text-zinc-500 hover:text-white">
        ← Projects
      </Link>
      <h1 className="mt-4 font-display text-3xl font-semibold text-white">
        {projectName || "Project"}
      </h1>
      <ProjectSubNav projectId={id} active="overview" />

      <section className="mt-8">
        <h2 className="text-lg font-medium text-white">API keys</h2>
        <button
          type="button"
          onClick={() => void createKey()}
          className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white"
        >
          Generate key
        </button>
        {newKey && (
          <p className="mt-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-200">
            Copy now: <code className="break-all">{newKey}</code>
          </p>
        )}
        <ul className="mt-4 space-y-2">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2"
            >
              <span className="text-sm text-zinc-300">
                {k.name} · {k.isActive ? "active" : "revoked"}
              </span>
              {k.isActive && (
                <button
                  type="button"
                  onClick={() => void revokeKey(k.id)}
                  className="text-xs text-red-400 hover:underline"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium text-white">Playground</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Use a project API key (same key for both tools below). Keys are only
          shown once when created — paste from your password manager if needed.
        </p>
        <input
          placeholder="af_live_..."
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white"
        />

        <div className="mt-8 border-t border-zinc-800 pt-8">
          <h3 className="text-base font-medium text-white">Address correction</h3>
          <p className="mt-1 text-sm text-zinc-500">
            <code className="text-zinc-400">POST /api/v1/correct</code>
          </p>
          <textarea
            placeholder="Address to correct"
            value={playground}
            onChange={(e) => setPlayground(e.target.value)}
            rows={3}
            className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          />
          <button
            type="button"
            onClick={() => void tryCorrect()}
            className="mt-2 rounded-lg border border-zinc-600 px-4 py-2 text-sm text-white hover:bg-zinc-800"
          >
            Run correction
          </button>
          {playResult && (
            <pre className="mt-4 overflow-auto rounded-lg bg-zinc-900 p-4 text-xs text-zinc-300">
              {playResult}
            </pre>
          )}
        </div>

        <div className="mt-10 border-t border-zinc-800 pt-8">
          <h3 className="text-base font-medium text-white">Sentiment analysis</h3>
          <p className="mt-1 text-sm text-zinc-500">
            <code className="text-zinc-400">POST /api/v1/sentiment</code> — classifies
            the review, stores it for this project, and returns{" "}
            <code className="text-zinc-400">projectNetScore</code>.
          </p>
          <textarea
            placeholder="Review text to analyze (e.g. Great product, fast shipping!)"
            value={sentimentText}
            onChange={(e) => setSentimentText(e.target.value)}
            rows={4}
            className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          />
          <button
            type="button"
            disabled={sentimentLoading}
            onClick={() => void trySentiment()}
            className="mt-2 rounded-lg border border-violet-600/60 bg-violet-950/30 px-4 py-2 text-sm text-violet-100 hover:bg-violet-950/50 disabled:opacity-50"
          >
            {sentimentLoading ? "Analyzing…" : "Run sentiment"}
          </button>
          {sentimentResult && (
            <pre className="mt-4 overflow-auto rounded-lg bg-zinc-900 p-4 text-xs text-zinc-300">
              {sentimentResult}
            </pre>
          )}
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-red-900/50 bg-red-950/20 p-4">
        <h2 className="text-lg font-medium text-red-200">Danger zone</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Permanently delete this project, all API keys, and related usage logs.
        </p>
        {deleteError && (
          <p className="mt-2 text-sm text-red-400">{deleteError}</p>
        )}
        <button
          type="button"
          disabled={deleting}
          onClick={() => void deleteProject()}
          className="mt-3 rounded-lg border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-200 hover:bg-red-950/60 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete project"}
        </button>
      </section>
    </div>
  );
}
