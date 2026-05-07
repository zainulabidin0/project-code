"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import Link from "next/link";
import type { Framework, DocNavItem } from "@/lib/docs-content";
import {
  getAddressPrompt,
  getSentimentPrompt,
  getShopifyPrompt,
} from "@/lib/docs-content";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="absolute right-3 top-3 flex h-8 items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
    >
      {copied ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          Copied
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
          Copy
        </>
      )}
    </button>
  );
}

export function CodeBlock({
  code,
  language = "",
}: {
  code: string;
  language?: string;
}) {
  return (
    <div className="group relative mt-3 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950">
      {language && (
        <div className="border-b border-zinc-800/60 px-4 py-2 text-[11px] font-medium uppercase tracking-widest text-zinc-600">
          {language}
        </div>
      )}
      <CopyButton text={code} />
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed text-zinc-300">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function FrameworkTabs({
  active,
  onChange,
}: {
  active: Framework;
  onChange: (f: Framework) => void;
}) {
  const tabs: { id: Framework; label: string; icon: string }[] = [
    { id: "html", label: "HTML / JS", icon: "{ }" },
    { id: "react", label: "React", icon: "⚛" },
    { id: "nextjs", label: "Next.js", icon: "▲" },
  ];

  return (
    <div className="flex gap-1 rounded-xl bg-zinc-900/80 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            active === t.id
              ? "bg-emerald-500/15 text-emerald-400 shadow-inner shadow-emerald-500/5"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <span className="text-xs opacity-70">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function DocsSidebar({ active, items }: { active: string; items: DocNavItem[] }) {
  return (
    <nav className="sticky top-24 hidden max-h-[calc(100vh-8rem)] w-48 shrink-0 self-start overflow-y-auto lg:block">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600">
        On this page
      </div>
      <ul className="mt-3 space-y-1">
        {items.map((n) => (
          <li key={n.id}>
            <a
              href={`#${n.id}`}
              className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                active === n.id
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {n.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const OPTIONS: { id: Framework; label: string; desc: string; icon: string }[] = [
  { id: "html", label: "HTML / CSS / JS", desc: "Single file, no build tools", icon: "{ }" },
  { id: "react", label: "React", desc: "Vite or CRA with hooks", icon: "⚛" },
  { id: "nextjs", label: "Next.js", desc: "App Router + Server Actions", icon: "▲" },
];

export function IntegrationPromptModal({
  open,
  onClose,
  apiBase,
  kind,
}: {
  open: boolean;
  onClose: () => void;
  apiBase: string;
  kind: "address" | "sentiment" | "shopify";
}) {
  const [selected, setSelected] = useState<Framework | null>(null);
  const [copied, setCopied] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setCopied(false);
    }
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function getActivePrompt() {
    if (!selected) return "";
    if (kind === "address") return getAddressPrompt(selected, apiBase);
    if (kind === "shopify") return getShopifyPrompt(selected, apiBase);
    return getSentimentPrompt(selected, apiBase);
  }

  function handleCopy() {
    if (!selected) return;
    navigator.clipboard.writeText(getActivePrompt());
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-zinc-800/70 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-white">
              Copy integration prompt
            </h3>
            <p className="mt-0.5 text-sm text-zinc-500">
              {kind === "address"
                ? "Address correction"
                : kind === "shopify"
                  ? "ShopAssist for Shopify"
                  : "Sentiment and reviews"}{" "}
              — choose your stack
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>

        <div className="space-y-2 px-6 py-5">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                setSelected(o.id);
                setCopied(false);
              }}
              className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition-all ${
                selected === o.id
                  ? "border-emerald-500/40 bg-emerald-500/[0.07] shadow-inner shadow-emerald-500/5"
                  : "border-zinc-800/70 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900"
              }`}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold ${
                  selected === o.id
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {o.icon}
              </span>
              <div>
                <div
                  className={`text-sm font-medium ${
                    selected === o.id ? "text-emerald-400" : "text-zinc-200"
                  }`}
                >
                  {o.label}
                </div>
                <div className="text-xs text-zinc-500">{o.desc}</div>
              </div>
              {selected === o.id && (
                <svg className="ml-auto text-emerald-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              )}
            </button>
          ))}
        </div>

        {selected && (
          <div className="border-t border-zinc-800/70 px-6 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-widest text-zinc-600">
                Prompt preview
              </span>
              <span className="text-xs text-zinc-600">
                {getActivePrompt().length} chars
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-800/60 bg-zinc-900/60 p-3 text-xs leading-relaxed text-zinc-400">
              {getActivePrompt().slice(0, 600)}…
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-zinc-800/70 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg px-4 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={handleCopy}
            className={`flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-semibold transition-all ${
              selected
                ? copied
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400 active:scale-[0.97]"
                : "cursor-not-allowed bg-zinc-800 text-zinc-600"
            }`}
          >
            {copied ? "Copied" : "Copy prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}

type DocsSubnav = "hub" | "address" | "reviews" | "shopify";

function SubnavPill({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        current
          ? "bg-emerald-500/20 text-emerald-400"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </Link>
  );
}

export function DocsChrome({
  subnav,
  showCopyPrompt,
  onOpenPrompt,
  children,
}: {
  subnav: DocsSubnav;
  showCopyPrompt: boolean;
  onOpenPrompt?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-300">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/30 via-zinc-950 to-zinc-950" />
      <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjAuNSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIvPjwvc3ZnPg==')] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]" />

      <header className="relative z-10 mx-auto flex h-auto min-h-20 max-w-7xl flex-col gap-3 px-6 py-4 sm:h-20 sm:flex-row sm:items-center sm:justify-between sm:py-0">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight text-white"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-sm font-bold text-emerald-400">
            A
          </span>
          AddressFix
        </Link>

        <nav className="flex flex-wrap items-center justify-center gap-1 sm:absolute sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2">
          <SubnavPill href="/docs" current={subnav === "hub"}>
            Overview
          </SubnavPill>
          <SubnavPill href="/docs/address" current={subnav === "address"}>
            Address API
          </SubnavPill>
          <SubnavPill href="/docs/reviews" current={subnav === "reviews"}>
            Reviews API
          </SubnavPill>
          <SubnavPill href="/docs/shopify" current={subnav === "shopify"}>
            ShopAssist
          </SubnavPill>
        </nav>

        <div className="flex items-center justify-end gap-3">
          {showCopyPrompt && onOpenPrompt && (
            <button
              type="button"
              onClick={onOpenPrompt}
              className="flex h-10 items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-400 transition-all hover:border-emerald-500/50 hover:bg-emerald-500/20 sm:px-5"
            >
              Copy prompt
            </button>
          )}
          <div className="hidden items-center gap-4 text-sm text-zinc-400 sm:flex">
            <Link href="/login" className="hover:text-white">
              Log in
            </Link>
            <Link
              href="/register"
              className="inline-flex h-10 items-center rounded-full bg-emerald-500/90 px-4 font-medium text-zinc-950 hover:bg-emerald-400"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}

export function useDocsActiveSection(navIds: string[]) {
  const [active, setActive] = useState(navIds[0] ?? "");
  const key = navIds.join(",");

  useEffect(() => {
    const ids = key.split(",");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [key]);

  return active;
}
