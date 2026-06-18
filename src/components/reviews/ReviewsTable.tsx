type ReviewRow = {
  id: string;
  reviewText: string;
  sentiment: string;
  score: number;
  confidence: number | null;
  createdAt: string;
};

type ReviewsTableProps = {
  rows: ReviewRow[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
};

function sentimentBadge(sentiment: string) {
  const isPositive = sentiment === "POSITIVE";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        isPositive
          ? "bg-emerald-950/60 text-emerald-300 ring-1 ring-emerald-800/60"
          : "bg-red-950/60 text-red-300 ring-1 ring-red-800/60"
      }`}
    >
      {sentiment}
    </span>
  );
}

export function ReviewsTable({
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  loading,
}: ReviewsTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-white">All reviews</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {total} stored review{total === 1 ? "" : "s"}
          </p>
        </div>
        {total > 0 && (
          <p className="text-sm text-zinc-500">
            Showing {from}–{to} of {total}
          </p>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Review</th>
              <th className="px-4 py-3 font-medium">Sentiment</th>
              <th className="px-4 py-3 font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/80">
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  Loading reviews…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No reviews yet. Submit one via the API or connect Shopify.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="bg-zinc-900/20 hover:bg-zinc-900/40">
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="max-w-md px-4 py-3 text-zinc-200">
                    <p className="line-clamp-2 whitespace-pre-wrap">{r.reviewText}</p>
                  </td>
                  <td className="px-4 py-3">{sentimentBadge(r.sentiment)}</td>
                  <td className="px-4 py-3 font-mono text-zinc-300">
                    {r.score > 0 ? "+" : ""}
                    {r.score}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {r.confidence != null ? `${r.confidence}%` : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={page <= 0 || loading}
            onClick={() => onPageChange(page - 1)}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-sm text-zinc-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1 || loading}
            onClick={() => onPageChange(page + 1)}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}
