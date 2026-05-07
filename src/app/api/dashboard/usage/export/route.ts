import { NextRequest, NextResponse } from "next/server";
import { getAccessPayload } from "@/lib/auth/session";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { usageLogs, projects } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);

  const rows = await db
    .select({
      createdAt: usageLogs.createdAt,
      projectId: usageLogs.projectId,
      inputAddress: usageLogs.inputAddress,
      outputAddress: usageLogs.outputAddress,
      correctionType: usageLogs.correctionType,
      processingMs: usageLogs.processingMs,
      status: usageLogs.status,
    })
    .from(usageLogs)
    .innerJoin(projects, eq(usageLogs.projectId, projects.id))
    .where(eq(projects.userId, access.sub))
    .orderBy(desc(usageLogs.createdAt))
    .limit(5000);

  const header =
    "createdAt,projectId,inputAddress,outputAddress,correctionType,processingMs,status\n";
  const lines = rows.map((r) =>
    [
      r.createdAt?.toISOString() ?? "",
      r.projectId,
      csvEscape(r.inputAddress),
      csvEscape(r.outputAddress),
      r.correctionType,
      r.processingMs,
      r.status,
    ].join(",")
  );
  const csv = header + lines.join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="usage.csv"',
    },
  });
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
