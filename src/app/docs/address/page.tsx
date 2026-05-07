"use client";

import { useState, useMemo } from "react";
import {
  DEFAULT_API_BASE,
  DOCS_NAV_ADDRESS,
  buildBatchSnippets,
  buildSingleCorrectSnippets,
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

export default function AddressApiDocsPage() {
  const apiBase = useMemo(
    () =>
      normalizeBase(process.env.NEXT_PUBLIC_APP_URL || DEFAULT_API_BASE),
    []
  );
  const singleSnip = useMemo(
    () => buildSingleCorrectSnippets(apiBase),
    [apiBase]
  );
  const batchSnip = useMemo(() => buildBatchSnippets(apiBase), [apiBase]);

  const [fw, setFw] = useState<Framework>("html");
  const [modalOpen, setModalOpen] = useState(false);
  const activeSec = useDocsActiveSection(
    DOCS_NAV_ADDRESS.map((n) => n.id)
  );

  return (
    <>
      <DocsChrome
        subnav="address"
        showCopyPrompt
        onOpenPrompt={() => setModalOpen(true)}
      >
        <main className="relative z-10 mx-auto flex max-w-7xl items-start gap-12 px-6 pb-32 pt-12">
          <DocsSidebar active={activeSec} items={DOCS_NAV_ADDRESS} />
          <div className="min-w-0 max-w-3xl flex-1">
            <h1 className="text-4xl font-bold tracking-tight text-white">
              Address API
            </h1>
            <p className="mt-3 text-base text-zinc-500">
              Correct and standardize addresses with regex and AI. Base URL:{" "}
              <code className="text-zinc-400">{apiBase}</code>
            </p>
            <div className="mt-8">
              <FrameworkTabs active={fw} onChange={setFw} />
            </div>

            <DocsAuthSection fw={fw} />

            <section id="single" className="mt-16 scroll-mt-24">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-bold text-blue-400">
                  POST
                </span>
                <h2 className="text-xl font-semibold text-white">
                  /api/v1/correct
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed">
                Send a single address string. The API runs it through regex
                normalization first, then AI correction if needed.
              </p>
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                Request body
              </h3>
              <CodeBlock
                language="json"
                code={`{
  "address": "house 5, BLk C, mdl town, lahore",
  "options": {
    "regexOnly": false,
    "format": "standard",
    "includeMetadata": true
  }
}`}
              />
              <h3 className="mt-8 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                {fw === "html"
                  ? "JavaScript example"
                  : fw === "react"
                    ? "React hook"
                    : "Next.js Server Action"}
              </h3>
              <CodeBlock
                language={fw === "html" ? "html" : "typescript"}
                code={singleSnip[fw]}
              />
            </section>

            <section id="batch" className="mt-16 scroll-mt-24">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-bold text-blue-400">
                  POST
                </span>
                <h2 className="text-xl font-semibold text-white">
                  /api/v1/correct/batch
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed">
                Send up to <strong className="text-zinc-200">50 addresses</strong>{" "}
                in a single request. Each address is corrected independently.
              </p>
              <CodeBlock
                language={fw === "html" ? "javascript" : "typescript"}
                code={batchSnip[fw]}
              />
            </section>

            <section id="response" className="mt-16 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white">Response</h2>
              <p className="mt-3 text-sm leading-relaxed">
                On success, <code className="text-emerald-400">data</code> contains
                the correction result and metadata.
              </p>
              <CodeBlock
                language="json"
                code={`{
  "success": true,
  "data": {
    "original": "house 5, BLk C, mdl town, lahore",
    "corrected": "House 5, Block C, Model Town, Lahore",
    "confidence": 0.95,
    "correctionType": "AI_CORRECTED",
    "changes": [
      "house → House (capitalization)",
      "BLk → Block (abbreviation)"
    ],
    "processingMs": 342
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
                      ["original", "string", "The raw input you sent"],
                      ["corrected", "string", "Cleaned, standardized address"],
                      ["confidence", "number", "0–1 score of correction confidence"],
                      [
                        "correctionType",
                        "enum",
                        "REGEX_ONLY | AI_CORRECTED | NO_CHANGE",
                      ],
                      ["changes", "string[]", "Human-readable list of changes"],
                      ["processingMs", "number", "Server-side processing time in ms"],
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
        kind="address"
      />
    </>
  );
}
