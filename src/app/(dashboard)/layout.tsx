"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

const nav = [
  { href: "/dashboard", label: "Overview" },
  { href: "/projects", label: "Projects" },
  { href: "/usage", label: "Usage" },
  { href: "/settings", label: "Settings" },
  { href: "/docs", label: "Docs" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { clearSession } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const t = sessionStorage.getItem("af_access_token");
    if (!t) router.replace("/login");
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionStorage.getItem("af_access_token") ?? ""}`,
      },
      credentials: "include",
    });
    clearSession();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-zinc-800 bg-zinc-900/50 p-4 md:block">
        <Link href="/" className="font-display text-lg font-semibold text-white">
          AddressFix
        </Link>
        <nav className="mt-8 flex flex-col gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm ${
                pathname === item.href
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:bg-zinc-800/60 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => void logout()}
          className="mt-8 w-full rounded-lg border border-zinc-700 px-3 py-2 text-left text-sm text-zinc-400 hover:border-zinc-500 hover:text-white"
        >
          Log out
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 md:hidden">
          <Link href="/dashboard" className="font-display font-semibold text-white">
            AddressFix
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm text-zinc-400"
          >
            Log out
          </button>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
