import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Shop-Domain, X-Session-Token",
    "Access-Control-Max-Age": "86400",
  };
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (pathname.startsWith("/api/v1/shopify")) {
    if (req.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: corsHeaders() });
    }
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(corsHeaders())) {
      res.headers.set(k, v);
    }
    return res;
  }
  return proxy(req);
}

export const config = {
  matcher: [
    "/api/v1/shopify/:path*",
    "/dashboard/:path*",
    "/projects/:path*",
    "/usage/:path*",
    "/settings/:path*",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/api/dashboard/:path*",
  ],
};
