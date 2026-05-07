"use client";

import { useState, useMemo } from "react";
import {
  DEFAULT_API_BASE,
  DOCS_NAV_SHOPIFY,
  buildShopifyChatSnippets,
  buildShopifyVoiceSnippets,
  buildShopifyCartSnippets,
  buildShopifyWidgetSnippets,
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
import { DocsErrorsSection, DocsRateLimitsSection } from "@/components/docs/DocsErrorsAndLimits";

export default function ShopifyApiDocsPage() {
  const apiBase = useMemo(
    () => normalizeBase(process.env.NEXT_PUBLIC_APP_URL || DEFAULT_API_BASE),
    []
  );
  const chatSnip = useMemo(() => buildShopifyChatSnippets(apiBase), [apiBase]);
  const voiceSnip = useMemo(
    () => buildShopifyVoiceSnippets(apiBase),
    [apiBase]
  );
  const cartSnip = useMemo(() => buildShopifyCartSnippets(apiBase), [apiBase]);
  const widgetSnip = useMemo(
    () => buildShopifyWidgetSnippets(apiBase),
    [apiBase]
  );

  const [fw, setFw] = useState<Framework>("html");
  const [modalOpen, setModalOpen] = useState(false);
  const activeSec = useDocsActiveSection(DOCS_NAV_SHOPIFY.map((n) => n.id));

  return (
    <>
      <DocsChrome
        subnav="shopify"
        showCopyPrompt
        onOpenPrompt={() => setModalOpen(true)}
      >
        <main className="relative z-10 mx-auto flex max-w-7xl items-start gap-12 px-6 pb-32 pt-12">
          <DocsSidebar active={activeSec} items={DOCS_NAV_SHOPIFY} />
          <div className="min-w-0 max-w-3xl flex-1">
            <h1 className="text-4xl font-bold tracking-tight text-white">
              ShopAssist (Shopify) API
            </h1>
            <p className="mt-3 text-base text-zinc-500">
              Embed an AI shopping assistant — chat, voice, and cart — on any
              Shopify storefront. Base URL:{" "}
              <code className="text-zinc-400">{apiBase}</code>
            </p>
            <div className="mt-8">
              <FrameworkTabs active={fw} onChange={setFw} />
            </div>

            <section id="auth" className="mt-12 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white">Authentication</h2>
              <p className="mt-3 text-sm leading-relaxed">
                ShopAssist endpoints under{" "}
                <code className="text-zinc-500">/api/v1/shopify/*</code> do{" "}
                <strong className="text-zinc-200">not</strong> use the project{" "}
                <code className="text-zinc-500">x-api-key</code>. Instead, the
                widget identifies the storefront by sending a{" "}
                <code className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-emerald-400">
                  X-Shop-Domain
                </code>{" "}
                header. The shop domain is validated against the installed
                Shopify store on every request, and an anonymous{" "}
                <code className="text-zinc-500">sessionToken</code> in
                localStorage is used to maintain conversation history.
              </p>
              <CodeBlock
                language="headers"
                code={`Content-Type: application/json
X-Shop-Domain: mystore.myshopify.com`}
              />
              <p className="mt-3 text-sm text-zinc-500">
                Usage is counted against the project that owns the connected
                Shopify store and shares the same monthly quota as address and
                reviews.
              </p>
            </section>

            <section id="install" className="mt-16 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white">Install flow</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Connect a Shopify store to a project from the dashboard. The
                merchant is redirected to Shopify to grant scopes, and on
                success a script tag is installed on the store.
              </p>
              <ul className="mt-4 list-inside list-disc space-y-2 text-sm text-zinc-400">
                <li>
                  <strong className="text-zinc-200">GET</strong>{" "}
                  <code className="text-violet-300">
                    /api/shopify/install?shop=&lt;domain&gt;&amp;projectId=&lt;id&gt;
                  </code>{" "}
                  — Redirects to Shopify OAuth.
                </li>
                <li>
                  <strong className="text-zinc-200">GET</strong>{" "}
                  <code className="text-violet-300">/api/shopify/callback</code>{" "}
                  — Exchanges code, stores tokens, installs widget script.
                </li>
                <li>
                  <strong className="text-zinc-200">POST</strong>{" "}
                  <code className="text-violet-300">/api/shopify/webhooks</code>{" "}
                  — Handles{" "}
                  <code className="text-zinc-500">app/uninstalled</code>.
                </li>
              </ul>
              <p className="mt-3 text-sm text-zinc-500">
                In the dashboard, open a project and visit the{" "}
                <code className="text-zinc-400">ShopAssist</code> tab to start
                the install or manage settings.
              </p>
            </section>

            <section id="widget" className="mt-16 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white">Widget embed</h2>
              <p className="mt-3 text-sm leading-relaxed">
                After install, AddressFix automatically injects this script on
                the storefront. You can also embed it manually in your{" "}
                <code className="text-zinc-500">theme.liquid</code>:
              </p>
              <CodeBlock language="html" code={widgetSnip.embed} />
              <p className="mt-3 text-sm text-zinc-500">
                The widget reads its color, position, and greeting from the
                widget-config endpoint, then talks to{" "}
                <code className="text-zinc-500">/chat</code>,{" "}
                <code className="text-zinc-500">/voice</code>, and{" "}
                <code className="text-zinc-500">/cart</code>.
              </p>
            </section>

            <section id="chat" className="mt-16 scroll-mt-24">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-bold text-blue-400">
                  POST
                </span>
                <h2 className="text-xl font-semibold text-white">
                  /api/v1/shopify/chat
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed">
                Send a customer message. The server pulls the conversation
                history for the session, runs a Shopify product search, and
                returns an assistant reply plus matching products.
              </p>
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                Request body
              </h3>
              <CodeBlock
                language="json"
                code={`{
  "message": "show me red shirts under 2000",
  "sessionToken": "sess_anon_abc123"
}`}
              />
              <h3 className="mt-8 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                {fw === "html"
                  ? "JavaScript example"
                  : fw === "react"
                    ? "React helper"
                    : "Next.js Server Action"}
              </h3>
              <CodeBlock
                language={fw === "html" ? "html" : "typescript"}
                code={chatSnip[fw]}
              />
            </section>

            <section id="voice" className="mt-16 scroll-mt-24">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-bold text-blue-400">
                  POST
                </span>
                <h2 className="text-xl font-semibold text-white">
                  /api/v1/shopify/voice
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed">
                Upload a recorded audio blob (webm / mp4 / wav) as{" "}
                <code className="text-zinc-500">multipart/form-data</code> with
                field <code className="text-zinc-500">audio</code>. The server
                returns the transcript via Whisper.
              </p>
              <CodeBlock
                language={fw === "html" ? "javascript" : "typescript"}
                code={voiceSnip[fw]}
              />
            </section>

            <section id="cart" className="mt-16 scroll-mt-24">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-bold text-blue-400">
                  POST
                </span>
                <h2 className="text-xl font-semibold text-white">
                  /api/v1/shopify/cart
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed">
                Add a Shopify variant to the visitor&apos;s cart. Reuses the cart
                stored on the chat session, or creates a new one. Returns a{" "}
                <code className="text-zinc-500">checkoutUrl</code> you can
                redirect to.
              </p>
              <CodeBlock
                language={fw === "html" ? "html" : "typescript"}
                code={cartSnip[fw]}
              />
            </section>

            <section id="widget-config" className="mt-16 scroll-mt-24">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-400">
                  GET
                </span>
                <h2 className="text-xl font-semibold text-white">
                  /api/v1/shopify/widget-config
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed">
                Loaded once when the widget mounts. No headers required — pass{" "}
                <code className="text-zinc-500">?shop=&lt;domain&gt;</code>.
              </p>
              <CodeBlock language="typescript" code={widgetSnip.widgetConfig} />
            </section>

            <section id="response-shopify" className="mt-16 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white">Response</h2>
              <p className="mt-3 text-sm leading-relaxed">
                All ShopAssist responses use{" "}
                <code className="text-emerald-400">success: true</code> and a{" "}
                <code className="text-emerald-400">data</code> object. Errors
                follow the same shape as the rest of the API.
              </p>
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                Chat — 200
              </h3>
              <CodeBlock
                language="json"
                code={`{
  "success": true,
  "data": {
    "message": "I found 3 red shirts in size M under 2000.",
    "intent": "product_search",
    "products": [
      {
        "id": "gid://shopify/Product/123",
        "title": "Classic Red Polo Shirt",
        "price": "1499",
        "currency": "PKR",
        "image": "https://cdn.shopify.com/...",
        "url": "https://mystore.myshopify.com/products/...",
        "variants": [
          { "id": "gid://shopify/ProductVariant/456", "title": "M / Red", "available": true }
        ]
      }
    ],
    "cartAction": null,
    "sessionToken": "sess_anon_abc123"
  }
}`}
              />
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                Cart — 200
              </h3>
              <CodeBlock
                language="json"
                code={`{
  "success": true,
  "data": {
    "cartId": "gid://shopify/Cart/xyz",
    "checkoutUrl": "https://mystore.myshopify.com/cart/c/xyz",
    "lineItems": [],
    "totalPrice": null
  }
}`}
              />
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                Voice — 200
              </h3>
              <CodeBlock
                language="json"
                code={`{
  "success": true,
  "data": {
    "transcript": "show me red shirts under two thousand"
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
                        "intent",
                        "string",
                        "product_search | add_to_cart | show_cart | start_checkout | chitchat",
                      ],
                      ["message", "string", "Assistant reply for the shopper"],
                      [
                        "products",
                        "array",
                        "Top matching products from Shopify Storefront",
                      ],
                      [
                        "sessionToken",
                        "string",
                        "Echoed back so the client can persist it",
                      ],
                      [
                        "checkoutUrl",
                        "string",
                        "Redirect target after successful cart add",
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
        kind="shopify"
      />
    </>
  );
}
