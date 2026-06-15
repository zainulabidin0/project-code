"use client";

import { useState, useMemo } from "react";
import {
  DEFAULT_API_BASE,
  DOCS_NAV_COURIER,
  buildCourierCompareSnippets,
  normalizeBase,
} from "@/lib/docs-content";
import type { AddressFramework } from "@/lib/docs-content";
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

export default function CourierApiDocsPage() {
  const apiBase = useMemo(
    () =>
      normalizeBase(process.env.NEXT_PUBLIC_APP_URL || DEFAULT_API_BASE),
    []
  );
  const compareSnip = useMemo(
    () => buildCourierCompareSnippets(apiBase),
    [apiBase]
  );

  const [fw, setFw] = useState<AddressFramework>("html");
  const [modalOpen, setModalOpen] = useState(false);
  const activeSec = useDocsActiveSection(
    DOCS_NAV_COURIER.map((n) => n.id)
  );

  return (
    <>
      <DocsChrome
        subnav="courier"
        showCopyPrompt
        onOpenPrompt={() => setModalOpen(true)}
      >
        <main className="relative z-10 mx-auto flex max-w-7xl items-start gap-12 px-6 pb-32 pt-12">
          <DocsSidebar active={activeSec} items={DOCS_NAV_COURIER} />
          <div className="min-w-0 max-w-3xl flex-1">
            <h1 className="text-4xl font-bold tracking-tight text-white">
              Courier compare API
            </h1>
            <p className="mt-3 text-base text-zinc-500">
              Compare TCS and Leopards shipping for Pakistan routes. Send pickup and
              delivery addresses with parcel weight; get a recommendation based on
              price, remote-area coverage, and COD support. Base URL:{" "}
              <code className="text-zinc-400">{apiBase}</code>
            </p>
            <div className="mt-8">
              <FrameworkTabs active={fw} onChange={setFw} includeShopify />
            </div>

            <DocsAuthSection fw={fw} />

            <section id="compare" className="mt-16 scroll-mt-24">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-400">
                  POST
                </span>
                <h2 className="text-xl font-semibold text-white">
                  /api/v1/courier/compare
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed">
                Resolves <code className="text-zinc-400">fromAddress</code> and{" "}
                <code className="text-zinc-400">toAddress</code> to supported
                Pakistan cities, quotes both carriers, and returns the cheaper /
                best option for the route. Each successful call counts toward your
                monthly quota.
              </p>
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                Request body
              </h3>
              <CodeBlock
                language="json"
                code={`{
  "fromAddress": "Plot 12, Saddar, Karachi",
  "toAddress": "Model Town, Lahore",
  "weightKg": 1,
  "codAmount": 5000
}`}
              />
              <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800/70">
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
                      ["fromAddress", "string", "Pickup address (3–500 chars). City name must appear in text."],
                      ["toAddress", "string", "Delivery address (3–500 chars). City name must appear in text."],
                      ["weightKg", "number", "Parcel weight in kg (0.1–50). Billed by weight slab."],
                      ["codAmount", "number?", "Optional COD order value in PKR. Adds COD fee to totals when set."],
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
              <h3 className="mt-8 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                {fw === "html"
                  ? "JavaScript example"
                  : fw === "react"
                    ? "React example"
                    : fw === "nextjs"
                      ? "Next.js Server Action"
                      : "Shopify App Proxy"}
              </h3>
              <CodeBlock
                language={
                  fw === "html" || fw === "shopify" ? "javascript" : "typescript"
                }
                code={compareSnip[fw]}
              />
              <h3 className="mt-8 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                cURL
              </h3>
              <CodeBlock
                language="bash"
                code={`curl -sS -X POST "${apiBase}/api/v1/courier/compare" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: af_live_xxxxxxxxxxxx" \\
  -d '{
    "fromAddress": "Karachi",
    "toAddress": "Lahore",
    "weightKg": 1,
    "codAmount": 5000
  }'`}
              />
            </section>

            <section id="coverage" className="mt-16 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white">City coverage</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Addresses are matched against a curated list of{" "}
                <strong className="text-zinc-200">92+ Pakistan cities</strong>{" "}
                grouped into zones:{" "}
                <code className="text-zinc-400">metro</code>,{" "}
                <code className="text-zinc-400">tier2</code>, and{" "}
                <code className="text-zinc-400">remote</code>. Rates use zone-pair
                pricing (not exact city-to-city tables) from one-time scraped
                public tariff data.
              </p>
              <ul className="mt-4 list-inside list-disc space-y-2 text-sm text-zinc-400">
                <li>
                  <strong className="text-zinc-300">TCS</strong> — all listed cities
                  including remote northern areas (Gilgit, Skardu, Hunza, etc.)
                </li>
                <li>
                  <strong className="text-zinc-300">Leopards</strong> — major and
                  tier-2 cities; remote northern destinations are excluded from
                  coverage
                </li>
                <li>
                  Include the city name in the address string (e.g.{" "}
                  <code className="text-zinc-400">&quot;Gujrat, Punjab&quot;</code>
                  ). Aliases like <code className="text-zinc-400">KHI</code> for
                  Karachi are supported.
                </li>
                <li>
                  If multiple cities match one address, the API returns{" "}
                  <code className="text-amber-400">AMBIGUOUS_CITY</code> with{" "}
                  <code className="text-zinc-400">suggestedCities</code>.
                </li>
              </ul>
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3 text-sm text-amber-200/80">
                <strong className="text-amber-300">Note:</strong> Returned rates are
                approximate estimates. Confirm final pricing with the carrier before
                booking. The response includes <code className="text-amber-300">dataAsOf</code>{" "}
                for the tariff snapshot date.
              </div>
            </section>

            <section id="response" className="mt-16 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white">Response</h2>
              <p className="mt-3 text-sm leading-relaxed">
                On success, <code className="text-emerald-400">data</code> contains
                the recommendation, per-carrier quotes, and resolved cities.
              </p>
              <CodeBlock
                language="json"
                code={`{
  "success": true,
  "data": {
    "recommended": "leopards",
    "reason": "LEOPARDS is recommended with an estimated total of PKR 230...",
    "resolved": {
      "fromCity": "Karachi",
      "toCity": "Lahore",
      "fromZone": "metro",
      "toZone": "metro",
      "sameCity": false
    },
    "quotes": {
      "tcs": {
        "carrier": "tcs",
        "basePrice": 288,
        "codFee": 75,
        "totalPrice": 363,
        "coverage": "supported",
        "codSupported": true,
        "zonePair": "metro_to_metro",
        "weightSlabKg": 1
      },
      "leopards": {
        "carrier": "leopards",
        "basePrice": 170,
        "codFee": 60,
        "totalPrice": 230,
        "coverage": "supported",
        "codSupported": true,
        "zonePair": "metro_to_metro",
        "weightSlabKg": 1
      }
    },
    "dataAsOf": "2026-06-09",
    "disclaimer": "Rates are approximate estimates...",
    "processingMs": 12
  }
}`}
              />
              <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800/70">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800/70 bg-zinc-900/50 text-left">
                      <th className="px-4 py-3 font-medium text-zinc-400">Field</th>
                      <th className="px-4 py-3 font-medium text-zinc-400">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {[
                      ["recommended", "tcs | leopards | null — null when neither carrier can service the route"],
                      ["reason", "Human-readable explanation including price and coverage factors"],
                      ["resolved", "Matched from/to city names, zones, and sameCity flag"],
                      ["quotes.tcs / quotes.leopards", "basePrice, codFee, totalPrice (PKR), coverage, codSupported"],
                      ["dataAsOf", "Date of the tariff data used for the quote"],
                      ["processingMs", "Server-side processing time in milliseconds"],
                    ].map(([field, desc]) => (
                      <tr key={field} className="text-zinc-400">
                        <td className="px-4 py-2.5">
                          <code className="text-emerald-400">{field}</code>
                        </td>
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
        kind="courier"
      />
    </>
  );
}
