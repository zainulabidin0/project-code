"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const j = await res.json();
    setMessage(j.message ?? "If an account exists, check your email.");
    if (j.devResetToken) {
      setMessage(
        `Dev token: use /reset-password?token=${j.devResetToken}`
      );
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/login" className="mb-8 text-zinc-400 hover:text-white">
        ← Back to login
      </Link>
      <h1 className="font-display text-3xl font-semibold text-white">
        Forgot password
      </h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
        />
        <button
          type="submit"
          className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white"
        >
          Send reset link
        </button>
      </form>
      {message && <p className="mt-4 text-sm text-zinc-400">{message}</p>}
    </div>
  );
}
