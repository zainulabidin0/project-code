"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, Suspense } from "react";
import Link from "next/link";

function Form() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const j = await res.json();
    if (!res.ok) {
      setError(j.error?.message ?? "Reset failed");
      return;
    }
    router.push("/login");
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      {!token && (
        <p className="text-sm text-amber-400">Missing token in URL.</p>
      )}
      <input
        type="password"
        required
        minLength={8}
        placeholder="New password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={!token}
        className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white disabled:opacity-50"
      >
        Update password
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/login" className="mb-8 text-zinc-400 hover:text-white">
        ← Back to login
      </Link>
      <h1 className="font-display text-3xl font-semibold text-white">
        Reset password
      </h1>
      <Suspense fallback={null}>
        <Form />
      </Suspense>
    </div>
  );
}
