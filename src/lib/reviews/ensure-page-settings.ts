import { db } from "@/lib/db";
import { reviewPageSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** Ensures a review_page_settings row exists (for projects created before this feature). */
export async function ensureReviewPageSettings(projectId: string) {
  const existing = await db
    .select()
    .from(reviewPageSettings)
    .where(eq(reviewPageSettings.projectId, projectId))
    .limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db
    .insert(reviewPageSettings)
    .values({ projectId, isPublic: false, showScores: true })
    .returning();
  return row;
}
