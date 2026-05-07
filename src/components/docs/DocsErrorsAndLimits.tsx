"use client";

import { CodeBlock } from "./DocsClient";
import { DOCS_ERROR_ROWS, DOCS_PLAN_ROWS } from "@/lib/docs-content";

export function DocsErrorsSection() {
  return (
    <section id="errors" className="mt-16 scroll-mt-24">
      <h2 className="text-xl font-semibold text-white">Error codes</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Errors return{" "}
        <code className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-red-400">
          {`"success": false`}
        </code>{" "}
        with a structured error object.
      </p>
      <CodeBlock
        language="json"
        code={`{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Upgrade for higher limits.",
    "retryAfter": 45
  }
}`}
      />
      <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800/70">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800/70 bg-zinc-900/50 text-left">
              <th className="px-4 py-3 font-medium text-zinc-400">Code</th>
              <th className="px-4 py-3 font-medium text-zinc-400">HTTP</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Meaning</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {DOCS_ERROR_ROWS.map(([code, http, desc]) => (
              <tr key={code} className="text-zinc-400">
                <td className="px-4 py-2.5">
                  <code className="text-red-400">{code}</code>
                </td>
                <td className="px-4 py-2.5 text-zinc-500">{http}</td>
                <td className="px-4 py-2.5">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DocsRateLimitsSection() {
  return (
    <section id="rate-limits" className="mt-16 scroll-mt-24">
      <h2 className="text-xl font-semibold text-white">Rate limits</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Limits are enforced per API key.{" "}
        <strong className="font-medium text-zinc-300">Monthly</strong> request
        counts are <strong className="text-zinc-200">shared</strong> between
        address correction and sentiment (each successful correction log and
        each stored review counts as one). Check response headers for
        per-minute rate limits.
      </p>
      <CodeBlock
        language="response headers"
        code={`X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1700000060`}
      />
      <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800/70">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800/70 bg-zinc-900/50 text-left">
              <th className="px-4 py-3 font-medium text-zinc-400">Plan</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Monthly</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Per minute</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Projects</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {DOCS_PLAN_ROWS.map(([plan, monthly, perMin, projects]) => (
              <tr key={plan} className="text-zinc-400">
                <td className="px-4 py-2.5 font-medium text-zinc-200">{plan}</td>
                <td className="px-4 py-2.5">{monthly}</td>
                <td className="px-4 py-2.5">{perMin}</td>
                <td className="px-4 py-2.5">{projects}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
