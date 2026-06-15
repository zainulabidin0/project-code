import Link from "next/link";
import { DEFAULT_API_BASE, normalizeBase } from "@/lib/docs-content";
import { DocsChrome } from "@/components/docs/DocsClient";

export default function DocsHubPage() {
  const base = normalizeBase(
    process.env.NEXT_PUBLIC_APP_URL || DEFAULT_API_BASE
  );

  return (
    <DocsChrome subnav="hub" showCopyPrompt={false}>
      <main className="relative z-10 mx-auto max-w-3xl px-6 pb-32 pt-12">
        <h1 className="text-4xl font-bold tracking-tight text-white">
          API documentation
        </h1>
        <p className="mt-3 text-base text-zinc-500">
          AddressFix exposes REST APIs for address correction, sentiment analysis
          with stored reviews, courier comparison (TCS vs Leopards for Pakistan),
          and a Shopify shopping assistant (ShopAssist). Address, reviews, and
          courier APIs use one API key per project; ShopAssist uses an installed
          Shopify store domain instead. Base:{" "}
          <code className="text-zinc-400">{base}</code>
        </p>

        <ul className="mt-10 space-y-4">
          <li>
            <Link
              href="/docs/address"
              className="block rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition-colors hover:border-emerald-500/40 hover:bg-zinc-900/80"
            >
              <h2 className="text-lg font-semibold text-white">Address API</h2>
              <p className="mt-2 text-sm text-zinc-500">
                <code className="text-violet-300">POST /api/v1/correct</code> and
                batch correction — regex + AI, response fields, and examples in
                HTML, React, and Next.js.
              </p>
              <p className="mt-3 text-sm font-medium text-emerald-400">
                Open address docs →
              </p>
            </Link>
          </li>
          <li>
            <Link
              href="/docs/reviews"
              className="block rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition-colors hover:border-emerald-500/40 hover:bg-zinc-900/80"
            >
              <h2 className="text-lg font-semibold text-white">Reviews and sentiment API</h2>
              <p className="mt-2 text-sm text-zinc-500">
                <code className="text-violet-300">/api/v1/sentiment</code>, batch,
                list and stats, public review pages — plus shared errors and rate
                limits.
              </p>
              <p className="mt-3 text-sm font-medium text-emerald-400">
                Open reviews docs →
              </p>
            </Link>
          </li>
          <li>
            <Link
              href="/docs/shopify"
              className="block rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition-colors hover:border-emerald-500/40 hover:bg-zinc-900/80"
            >
              <h2 className="text-lg font-semibold text-white">
                ShopAssist (Shopify) API
              </h2>
              <p className="mt-2 text-sm text-zinc-500">
                <code className="text-violet-300">/api/v1/shopify/*</code> chat,
                voice, cart and widget config — embed an AI shopping assistant on
                a Shopify storefront.
              </p>
              <p className="mt-3 text-sm font-medium text-emerald-400">
                Open ShopAssist docs →
              </p>
            </Link>
          </li>
          <li>
            <Link
              href="/docs/courier"
              className="block rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition-colors hover:border-emerald-500/40 hover:bg-zinc-900/80"
            >
              <h2 className="text-lg font-semibold text-white">
                Courier compare API
              </h2>
              <p className="mt-2 text-sm text-zinc-500">
                <code className="text-violet-300">POST /api/v1/courier/compare</code>{" "}
                — compare TCS and Leopards for Pakistan routes by price, remote
                coverage, and COD support.
              </p>
              <p className="mt-3 text-sm font-medium text-emerald-400">
                Open courier docs →
              </p>
            </Link>
          </li>
        </ul>
      </main>
    </DocsChrome>
  );
}
