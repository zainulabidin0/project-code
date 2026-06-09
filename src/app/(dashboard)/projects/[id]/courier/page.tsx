"use client";

import Link from "next/link";
import { useState } from "react";
import { ProjectSubNav } from "@/components/ProjectSubNav";

export default function CourierComparePage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [weightKg, setWeightKg] = useState("1");
  const [codAmount, setCodAmount] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function tryCompare() {
    const key = apiKeyInput.trim();
    const from = fromAddress.trim();
    const to = toAddress.trim();
    const weight = Number(weightKg);

    if (!key) {
      setResult(
        JSON.stringify(
          { error: "Paste your API key above (af_live_...)." },
          null,
          2
        )
      );
      return;
    }
    if (!from || !to) {
      setResult(
        JSON.stringify(
          { error: "Enter both from and to delivery addresses." },
          null,
          2
        )
      );
      return;
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      setResult(
        JSON.stringify({ error: "Enter a valid weight in kg." }, null, 2)
      );
      return;
    }

    const body: Record<string, unknown> = {
      fromAddress: from,
      toAddress: to,
      weightKg: weight,
    };
    const cod = codAmount.trim();
    if (cod) {
      const codNum = Number(cod);
      if (!Number.isFinite(codNum) || codNum < 0) {
        setResult(
          JSON.stringify({ error: "COD amount must be a valid number." }, null, 2)
        );
        return;
      }
      body.codAmount = codNum;
    }

    setResult(null);
    setLoading(true);
    try {
      const base = typeof window !== "undefined" ? window.location.origin : "";
      const res = await fetch(`${base}/api/v1/courier/compare`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
        },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      setResult(JSON.stringify(j, null, 2));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Link href={`/projects/${id}`} className="text-sm text-zinc-500 hover:text-white">
        ← Projects
      </Link>
      <h1 className="mt-4 font-display text-3xl font-semibold text-white">
        Courier compare
      </h1>
      <ProjectSubNav projectId={id} active="courier" />
      <p className="mt-4 max-w-2xl text-sm text-zinc-500">
        Compare TCS and Leopards shipping for Pakistan routes. Enter pickup and
        delivery addresses with parcel weight; optionally include a COD amount to
        factor in cash-on-delivery fees.
      </p>

      <section className="mt-8 max-w-2xl">
        <h2 className="text-lg font-medium text-white">Playground</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Use your project API key. Keys are only shown once when created — paste
          from your password manager if needed.
        </p>
        <input
          placeholder="af_live_..."
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white"
        />

        <div className="mt-8 rounded-lg border border-zinc-800 p-4">
          <h3 className="text-base font-medium text-white">TCS vs Leopards</h3>
          <p className="mt-1 text-sm text-zinc-500">
            <code className="text-zinc-400">POST /api/v1/courier/compare</code>
          </p>

          <label className="mt-4 block text-sm text-zinc-400">From address</label>
          <input
            placeholder="e.g. Saddar, Karachi"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          />

          <label className="mt-4 block text-sm text-zinc-400">To address</label>
          <input
            placeholder="e.g. Model Town, Lahore"
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-zinc-400">Weight (kg)</label>
              <input
                type="number"
                min="0.1"
                max="50"
                step="0.1"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400">
                COD amount (PKR, optional)
              </label>
              <input
                type="number"
                min="0"
                placeholder="e.g. 5000"
                value={codAmount}
                onChange={(e) => setCodAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void tryCompare()}
            className="mt-4 rounded-lg border border-emerald-600/60 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-950/50 disabled:opacity-50"
          >
            {loading ? "Comparing…" : "Compare couriers"}
          </button>

          {result && (
            <pre className="mt-4 overflow-auto rounded-lg bg-zinc-900 p-4 text-xs text-zinc-300">
              {result}
            </pre>
          )}
        </div>
      </section>
    </div>
  );
}
