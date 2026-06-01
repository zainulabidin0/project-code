import { NextRequest, NextResponse } from "next/server";
import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { shopChatSessions } from "@/lib/db/schema";
import { jsonError } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || auth !== `Bearer ${secret}`) {
    return jsonError("UNAUTHORIZED", "Unauthorized", 401);
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const deleted = await db
    .delete(shopChatSessions)
    .where(lt(shopChatSessions.updatedAt, thirtyDaysAgo))
    .returning({ id: shopChatSessions.id });

  return NextResponse.json({
    success: true,
    deletedCount: deleted.length,
    message: "Cleaned up sessions older than 30 days",
  });
}
