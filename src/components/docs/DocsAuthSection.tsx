"use client";

import type { AddressFramework } from "@/lib/docs-content";
import { CodeBlock } from "./DocsClient";

export function DocsAuthSection({ fw }: { fw: AddressFramework }) {
  return (
    <section id="auth" className="mt-12 scroll-mt-24">
      <h2 className="text-xl font-semibold text-white">Authentication</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Every request to the public v1 APIs (
        <code className="text-zinc-500">/api/v1/*</code>) must include your
        project API key in the{" "}
        <code className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-emerald-400">
          x-api-key
        </code>{" "}
        header. The same key authorizes address correction, sentiment, review
        management, and courier compare. Keys start with{" "}
        <code className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-emerald-400">
          af_live_
        </code>{" "}
        and are shown only once at creation — store them securely.
      </p>
      {fw === "nextjs" && (
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3 text-sm text-amber-200/80">
          <strong className="text-amber-300">Next.js tip:</strong> Store your key
          in <code className="text-amber-300">.env.local</code> as{" "}
          <code className="text-amber-300">ADDRESSFIX_API_KEY</code> and call the
          API from a Server Action — never expose the key on the client.
        </div>
      )}
      {fw === "shopify" && (
        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3 text-sm text-emerald-200/80">
          <strong className="text-emerald-300">Shopify tip:</strong> Never embed{" "}
          <code className="text-emerald-300">x-api-key</code> in{" "}
          <code className="text-emerald-300">theme.liquid</code>. Configure an{" "}
          <strong className="text-emerald-300">App Proxy</strong> (
          <code className="text-emerald-300">/apps/addressfix/*</code>) on your
          Shopify app so the theme calls your server, and your server attaches the
          API key when forwarding to AddressFix.
        </div>
      )}
      <CodeBlock
        language="headers"
        code={`Content-Type: application/json\nx-api-key: af_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}
      />
    </section>
  );
}
