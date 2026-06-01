"use client";

import { useState } from "react";

type Project = { id: string; name: string };

type Props = {
  shopDomain: string;
  storeName: string | null;
  encryptedToken: string;
  projects: Project[];
  onClose: () => void;
  onLink: (projectId: string) => Promise<void>;
};

export function LinkStoreModal({
  shopDomain,
  storeName,
  projects,
  onClose,
  onLink,
}: Props) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!projectId) {
      setError("Select a project");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onLink(projectId);
      onClose();
    } catch {
      setError("Failed to link store");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-white">Link Shopify store</h2>
        <p className="mt-2 text-sm text-zinc-400">
          <span className="font-medium text-zinc-200">{storeName || shopDomain}</span> connected.
          Choose which project should own this store.
        </p>
        <label className="mt-4 block text-sm text-zinc-400">Project</label>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !projectId}
            onClick={() => void submit()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Linking…" : "Link store"}
          </button>
        </div>
      </div>
    </div>
  );
}
