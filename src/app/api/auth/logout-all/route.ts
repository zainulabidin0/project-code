import { NextRequest, NextResponse } from "next/server";
import { getAccessPayload } from "@/lib/auth/session";
import { jsonError } from "@/lib/errors";
import { revokeAllRefreshForUser } from "@/lib/auth/refresh-rotation";
import { REFRESH_COOKIE } from "@/lib/auth/constants";

export async function POST(req: NextRequest) {
  const access = await getAccessPayload(req);
  if (!access) {
    return jsonError("UNAUTHORIZED", "Unauthorized", 401);
  }

  await revokeAllRefreshForUser(access.sub);

  const res = NextResponse.json({ success: true });
  res.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
