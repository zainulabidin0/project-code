import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { projects, reviewPageSettings, reviews } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getProjectNetScore } from "@/lib/sentiment/score";

type Props = { params: { slug: string } };

export const dynamic = "force-dynamic";

export default async function PublicReviewsPage({ params }: Props) {
  const [row] = await db
    .select({
      projectId: reviewPageSettings.projectId,
      pageTitle: reviewPageSettings.pageTitle,
      description: reviewPageSettings.description,
      showScores: reviewPageSettings.showScores,
      projectName: projects.name,
    })
    .from(reviewPageSettings)
    .innerJoin(projects, eq(reviewPageSettings.projectId, projects.id))
    .where(
      and(
        eq(reviewPageSettings.slug, params.slug),
        eq(reviewPageSettings.isPublic, true)
      )
    )
    .limit(1);

  if (!row) notFound();

  const list = await db
    .select({
      id: reviews.id,
      reviewText: reviews.reviewText,
      sentiment: reviews.sentiment,
      score: reviews.score,
      reviewerName: reviews.reviewerName,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(eq(reviews.projectId, row.projectId))
    .orderBy(desc(reviews.createdAt))
    .limit(200);

  const net = await getProjectNetScore(row.projectId);
  const title = row.pageTitle || `${row.projectName} — Reviews`;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-white">{title}</h1>
          {row.description ? (
            <p className="mt-2 text-sm text-zinc-400">{row.description}</p>
          ) : null}
          {row.showScores ? (
            <p className="mt-4 text-sm text-zinc-300">
              Net score: <span className="font-mono text-emerald-400">{net}</span>
            </p>
          ) : null}
        </header>
        <ul className="space-y-4">
          {list.length === 0 ? (
            <li className="text-zinc-500">No reviews yet.</li>
          ) : (
            list.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-wrap text-sm text-zinc-200">
                    {r.reviewText}
                  </p>
                  {row.showScores && (
                    <span
                      className={
                        r.score > 0
                          ? "shrink-0 rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300"
                          : "shrink-0 rounded bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300"
                      }
                    >
                      {r.score > 0 ? "+1" : "-1"}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  {r.reviewerName ? `${r.reviewerName} · ` : null}
                  {r.sentiment}
                </p>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
