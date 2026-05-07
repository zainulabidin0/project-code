import { db } from "@/lib/db";
import { reviews } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function getProjectNetScore(projectId: string): Promise<number> {
  const [row] = await db
    .select({ s: sql<number>`coalesce(sum(${reviews.score}), 0)::int` })
    .from(reviews)
    .where(eq(reviews.projectId, projectId));
  return row?.s ?? 0;
}
