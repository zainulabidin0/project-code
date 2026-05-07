import Link from "next/link";

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/40 via-zinc-950 to-zinc-950" />
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-xl font-semibold tracking-tight text-white">
          AddressFix
        </span>
        <nav className="flex gap-4 text-sm text-zinc-400">
          <Link href="/login" className="hover:text-white">
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-emerald-500/90 px-4 py-2 font-medium text-zinc-950 hover:bg-emerald-400"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-16">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-emerald-400/90">
          MicroSaaS for developers
        </p>
        <h1 className="font-display max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-5xl md:text-6xl">
          &amp; standardize addresses globally
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-zinc-400">
          Two-layer pipeline: fast regex normalization plus optional Groq AI
          for spelling, casing, and formatting. REST API, dashboard, and npm
          SDK.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/register"
            className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-zinc-200"
          >
            Create account
          </Link>
          <Link
            href="/docs"
            className="rounded-full border border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-200 hover:border-zinc-500"
          >
            API docs
          </Link>
        </div>

        <section className="mt-24 grid gap-8 md:grid-cols-3">
          {[
            {
              title: "API keys & projects",
              body: "Per-project keys, SHA-256 at rest, plan-based quotas and rate limits.",
            },
            {
              title: "Regex + AI",
              body: "Deterministic rules first; Groq (Llama 3.3) when structure still needs help.",
            },
            {
              title: "npm SDK",
              body: "`addressfix` client with retries, timeouts, and typed errors.",
            },
          ].map((c) => (
            <div
              key={c.title}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur"
            >
              <h2 className="font-display text-lg font-semibold text-white">
                {c.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {c.body}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-24 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8">
          <h2 className="font-display text-2xl font-semibold text-white">
            Pricing (plans)
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["FREE", "500 / mo", "10 / min"],
              ["STARTER", "10k / mo", "60 / min"],
              ["PRO", "100k / mo", "200 / min"],
              ["ENTERPRISE", "Unlimited", "1000 / min"],
            ].map(([name, mo, rpm]) => (
              <div key={name} className="rounded-xl border border-zinc-800 p-4">
                <p className="text-sm font-semibold text-emerald-400">{name}</p>
                <p className="mt-2 text-sm text-zinc-300">{mo}</p>
                <p className="text-xs text-zinc-500">{rpm}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
