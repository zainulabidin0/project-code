import { NextRequest, NextResponse } from "next/server";
import { getAccessPayload } from "@/lib/auth/session";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { projects, reviewPageSettings } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { ensureReviewPageSettings } from "@/lib/reviews/ensure-page-settings";
import { reviewPageSettingsPatchSchema } from "@/lib/validations/sentiment";

export const runtime = "nodejs";

type Params = { params: { id: string } };

async function assertProject(userId: string, projectId: string) {
  const row = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return row[0] ?? null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(_req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);

  const p = await assertProject(access.sub, params.id);
  if (!p) return jsonError("NOT_FOUND", "Project not found", 404);

  const row = await ensureReviewPageSettings(params.id);
  return NextResponse.json({ success: true, data: row });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);

  const p = await assertProject(access.sub, params.id);
  if (!p) return jsonError("NOT_FOUND", "Project not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }

  const parsed = reviewPageSettingsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_INPUT", parsed.error.message, 400);
  }

  const current = await ensureReviewPageSettings(params.id);
  const isPublic = parsed.data.isPublic ?? current.isPublic;
  const slugInput = parsed.data.slug;
  const nextSlug =
    slugInput === "" || slugInput === null
      ? null
      : slugInput === undefined
        ? current.slug
        : slugInput;

  if (isPublic && !nextSlug) {
    return jsonError(
      "INVALID_INPUT",
      "A slug is required when the reviews page is public",
      400
    );
  }

  if (nextSlug) {
    const taken = await db
      .select({ id: reviewPageSettings.id })
      .from(reviewPageSettings)
      .where(
        and(
          eq(reviewPageSettings.slug, nextSlug),
          ne(reviewPageSettings.projectId, params.id)
        )
      )
      .limit(1);
    if (taken[0]) {
      return jsonError("INVALID_INPUT", "This slug is already in use", 400);
    }
  }

  const [row] = await db
    .update(reviewPageSettings)
    .set({
      ...(parsed.data.isPublic !== undefined && {
        isPublic: parsed.data.isPublic,
      }),
      ...(slugInput !== undefined && { slug: nextSlug }),
      ...(parsed.data.pageTitle !== undefined && {
        pageTitle: parsed.data.pageTitle,
      }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description,
      }),
      ...(parsed.data.showScores !== undefined && {
        showScores: parsed.data.showScores,
      }),
      updatedAt: new Date(),
    })
    .where(eq(reviewPageSettings.projectId, params.id))
    .returning();

  return NextResponse.json({ success: true, data: row });
}
