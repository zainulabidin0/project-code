"use client";

import { useState, useMemo } from "react";
import {
  DEFAULT_API_BASE,
  DOCS_NAV_REVIEWS,
  buildReviewsSnippets,
  buildSentimentBatchSnippets,
  buildSentimentSingleSnippets,
  normalizeBase,
} from "@/lib/docs-content";
import type { Framework } from "@/lib/docs-content";
import {
  CodeBlock,
  DocsChrome,
  DocsSidebar,
  FrameworkTabs,
  IntegrationPromptModal,
  useDocsActiveSection,
} from "@/components/docs/DocsClient";
import { DocsAuthSection } from "@/components/docs/DocsAuthSection";
import { DocsErrorsSection, DocsRateLimitsSection } from "@/components/docs/DocsErrorsAndLimits";

export default function ReviewsApiDocsPage() {
  const apiBase = useMemo(
    () =>
      normalizeBase(process.env.NEXT_PUBLIC_APP_URL || DEFAULT_API_BASE),
    []
  );
  const sentSingle = useMemo(
    () => buildSentimentSingleSnippets(apiBase),
    [apiBase]
  );
  const sentBatch = useMemo(
    () => buildSentimentBatchSnippets(apiBase),
    [apiBase]
  );
  const reviewSnip = useMemo(
    () => buildReviewsSnippets(apiBase),
    [apiBase]
  );

  const [fw, setFw] = useState<Framework>("html");
  const [modalOpen, setModalOpen] = useState(false);
  const activeSec = useDocsActiveSection(
    DOCS_NAV_REVIEWS.map((n) => n.id)
  );

  return (
    <>
      <DocsChrome
        subnav="reviews"
        showCopyPrompt
        onOpenPrompt={() => setModalOpen(true)}
      >
        <main className="relative z-10 mx-auto flex max-w-7xl items-start gap-12 px-6 pb-32 pt-12">
          <DocsSidebar active={activeSec} items={DOCS_NAV_REVIEWS} />
          <div className="min-w-0 max-w-3xl flex-1">
            <h1 className="text-4xl font-bold tracking-tight text-white">
              Reviews and sentiment API
            </h1>
            <p className="mt-3 text-base text-zinc-500">
              Classify reviews, store them per project, list and delete via API, or
              expose a public page. Base URL:{" "}
              <code className="text-zinc-400">{apiBase}</code>
            </p>
            <div className="mt-8">
              <FrameworkTabs active={fw} onChange={setFw} />
            </div>

            <DocsAuthSection fw={fw} />

            <section id="sentiment" className="mt-16 scroll-mt-24">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-violet-500/15 px-2.5 py-1 text-xs font-bold text-violet-300">
                  POST
                </span>
                <h2 className="text-xl font-semibold text-white">
                  /api/v1/sentiment
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed">
                Classify a review, persist it, and return{" "}
                <code className="text-emerald-400">projectNetScore</code>. Each
                call counts toward your monthly quota.
              </p>
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                Request body
              </h3>
              <CodeBlock
                language="json"
                code={`{
  "review": "This product is absolutely fantastic! Best purchase ever.",
  "reviewerName": "John Doe",
  "reviewerMeta": {
    "email": "john@example.com",
    "avatarUrl": "https://example.com/avatar.png"
  }
}`}
              />
              <p className="mt-2 text-sm text-zinc-500">
                <code className="text-zinc-400">reviewerName</code> and{" "}
                <code className="text-zinc-400">reviewerMeta</code> are optional.
                Review text is limited to 5,000 characters.
              </p>
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                {fw === "html"
                  ? "JavaScript example"
                  : fw === "react"
                    ? "React example"
                    : "Next.js Server Action"}
              </h3>
              <CodeBlock
                language={fw === "html" ? "html" : "typescript"}
                code={sentSingle[fw]}
              />
            </section>

            <section id="sentiment-batch" className="mt-16 scroll-mt-24">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-violet-500/15 px-2.5 py-1 text-xs font-bold text-violet-300">
                  POST
                </span>
                <h2 className="text-xl font-semibold text-white">
                  /api/v1/sentiment/batch
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed">
                Up to <strong className="text-zinc-200">50</strong> reviews per
                request. Each row is stored; response includes ids and
                project-level totals.
              </p>
              <CodeBlock
                language="json"
                code={`{
  "reviews": [
    { "review": "Great product!", "reviewerName": "Alice" },
    { "review": "Terrible experience, never again." }
  ]
}`}
              />
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                {fw === "html" ? "JavaScript" : fw === "react" ? "React" : "Next.js"}
              </h3>
              <CodeBlock
                language={fw === "html" ? "javascript" : "typescript"}
                code={sentBatch[fw]}
              />
            </section>

            <section id="reviews" className="mt-16 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white">Reviews API</h2>
              <p className="mt-3 text-sm leading-relaxed">
                All routes use <code className="text-emerald-400">x-api-key</code>{" "}
                and the project attached to that key.
              </p>
              <ul className="mt-4 list-inside list-disc space-y-2 text-sm text-zinc-400">
                <li>
                  <strong className="text-zinc-200">GET</strong>{" "}
                  <code className="text-violet-300">/api/v1/reviews</code> — Query{" "}
                  <code className="text-zinc-500">limit</code> (1–100, default 20),{" "}
                  <code className="text-zinc-500">offset</code>.
                </li>
                <li>
                  <strong className="text-zinc-200">GET</strong>{" "}
                  <code className="text-violet-300">/api/v1/reviews/stats</code> —{" "}
                  Totals and <code>netScore</code>.
                </li>
                <li>
                  <strong className="text-zinc-200">GET</strong> /{" "}
                  <strong className="text-zinc-200">DELETE</strong>{" "}
                  <code className="text-violet-300">/api/v1/reviews/:id</code>
                </li>
              </ul>
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                List, stats, delete (cURL)
              </h3>
              <CodeBlock language="bash" code={reviewSnip.curl} />
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                JavaScript (list + stats)
              </h3>
              <CodeBlock language="typescript" code={reviewSnip.list} />
              <div className="mt-3">
                <CodeBlock language="typescript" code={reviewSnip.stats} />
              </div>
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                PHP
              </h3>
              <CodeBlock language="php" code={reviewSnip.php} />
            </section>

            <section id="public-reviews" className="mt-16 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white">Public reviews page</h2>
              <p className="mt-3 text-sm leading-relaxed">
                No API key. Enable in the dashboard, set a slug, then share:
              </p>
              <CodeBlock
                language="url"
                code={`${apiBase}/reviews/your-slug-here`}
              />
              <p className="mt-3 text-sm text-zinc-500">
                Slugs: 3–100 chars, lowercase letters, numbers, hyphens. If not
                public, the URL returns 404.
              </p>
            </section>

            <section id="response-sentiment" className="mt-16 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white">Response</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Single and batch sentiment responses use{" "}
                <code className="text-emerald-400">success: true</code> and a{" "}
                <code className="text-emerald-400">data</code> object. Review ids
                are CUIDs from the database.
              </p>
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                Single — 200
              </h3>
              <CodeBlock
                language="json"
                code={`{
  "success": true,
  "data": {
    "id": "clx…",
    "review": "This product is absolutely fantastic!",
    "sentiment": "POSITIVE",
    "score": 1,
    "confidence": 92,
    "reviewerName": "John Doe",
    "processingMs": 28,
    "projectNetScore": 47
  }
}`}
              />
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                Batch — 200
              </h3>
              <CodeBlock
                language="json"
                code={`{
  "success": true,
  "data": {
    "results": [
      { "id": "clx…", "review": "…", "sentiment": "POSITIVE", "score": 1, "confidence": 95 }
    ],
    "projectNetScore": 47,
    "processingMs": 45
  }
}`}
              />
              <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800/70">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800/70 bg-zinc-900/50 text-left">
                      <th className="px-4 py-3 font-medium text-zinc-400">Field</th>
                      <th className="px-4 py-3 font-medium text-zinc-400">Type</th>
                      <th className="px-4 py-3 font-medium text-zinc-400">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {[
                      [
                        "sentiment",
                        "string",
                        "POSITIVE or NEGATIVE (maps to +1 / −1)",
                      ],
                      ["score", "number", "1 or −1"],
                      ["confidence", "number", "0–100 when available from model"],
                      [
                        "projectNetScore",
                        "number",
                        "Sum of scores for the project",
                      ],
                      [
                        "reviewerName / reviewerMeta",
                        "optional",
                        "From request; meta stored as JSON",
                      ],
                    ].map(([field, type, desc]) => (
                      <tr key={field} className="text-zinc-400">
                        <td className="px-4 py-2.5">
                          <code className="text-emerald-400">{field}</code>
                        </td>
                        <td className="px-4 py-2.5 text-zinc-500">{type}</td>
                        <td className="px-4 py-2.5">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <DocsErrorsSection />
            <DocsRateLimitsSection />
          </div>
        </main>
      </DocsChrome>
      <IntegrationPromptModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        apiBase={apiBase}
        kind="sentiment"
      />
    </>
  );
}
