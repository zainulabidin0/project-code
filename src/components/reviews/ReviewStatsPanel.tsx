export type ReviewStats = {
  total: number;
  positive: number;
  negative: number;
  netScore: number;
  timeline?: Array<{
    date: string;
    positive: number;
    negative: number;
    total: number;
  }>;
};

function pct(part: number, whole: number) {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

function SentimentDonut({ positive, negative, total }: ReviewStats) {
  const size = 160;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const positiveLen = total > 0 ? (positive / total) * circumference : 0;
  const negativeLen = total > 0 ? (negative / total) * circumference : 0;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-zinc-800"
        />
        {positiveLen > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeDasharray={`${positiveLen} ${circumference - positiveLen}`}
            strokeLinecap="round"
            className="text-emerald-500"
          />
        )}
        {negativeLen > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeDasharray={`${negativeLen} ${circumference - negativeLen}`}
            strokeDashoffset={-positiveLen}
            strokeLinecap="round"
            className="text-red-500"
          />
        )}
      </svg>
      <div className="pointer-events-none -mt-[5.5rem] flex h-[5.5rem] w-[5.5rem] flex-col items-center justify-center text-center">
        <span className="font-display text-2xl font-semibold text-white">{total}</span>
        <span className="text-xs text-zinc-500">reviews</span>
      </div>
      <div className="mt-4 flex gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
          Positive {pct(positive, total)}%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
          Negative {pct(negative, total)}%
        </span>
      </div>
    </div>
  );
}

function SentimentBars({ positive, negative, total }: ReviewStats) {
  const positivePct = total > 0 ? (positive / total) * 100 : 0;
  const negativePct = total > 0 ? (negative / total) * 100 : 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-emerald-400">Positive</span>
          <span className="font-mono text-zinc-300">{positive}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${positivePct}%` }}
          />
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-red-400">Negative</span>
          <span className="font-mono text-zinc-300">{negative}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-red-500 transition-all"
            style={{ width: `${negativePct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function TimelineChart({
  timeline,
}: {
  timeline: NonNullable<ReviewStats["timeline"]>;
}) {
  if (timeline.length === 0) {
    return (
      <p className="text-sm text-zinc-500">No reviews in the last 30 days yet.</p>
    );
  }

  const maxTotal = Math.max(...timeline.map((d) => d.total), 1);
  const chartHeight = 120;
  const barWidth = Math.min(28, Math.max(8, 480 / timeline.length - 4));

  return (
    <div className="overflow-x-auto">
      <div
        className="flex items-end gap-1"
        style={{ minHeight: chartHeight + 28 }}
      >
        {timeline.map((day) => {
          const posH = (day.positive / maxTotal) * chartHeight;
          const negH = (day.negative / maxTotal) * chartHeight;
          const label = new Date(day.date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
          return (
            <div
              key={day.date}
              className="flex flex-col items-center gap-1"
              title={`${label}: ${day.positive} positive, ${day.negative} negative`}
            >
              <div
                className="flex flex-col justify-end"
                style={{ height: chartHeight, width: barWidth }}
              >
                {day.negative > 0 && (
                  <div
                    className="w-full rounded-t-sm bg-red-500/90"
                    style={{ height: negH }}
                  />
                )}
                {day.positive > 0 && (
                  <div
                    className={`w-full bg-emerald-500/90 ${day.negative > 0 ? "" : "rounded-t-sm"}`}
                    style={{ height: posH }}
                  />
                )}
                {day.total === 0 && (
                  <div className="h-px w-full bg-zinc-700" />
                )}
              </div>
              <span className="max-w-[3rem] truncate text-[10px] text-zinc-500">
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />
          Positive per day
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-red-500" />
          Negative per day
        </span>
      </div>
    </div>
  );
}

export function ReviewStatsPanel({ stats }: { stats: ReviewStats }) {
  const positiveRate = pct(stats.positive, stats.total);

  return (
    <div className="mt-6 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <p className="text-sm text-zinc-500">Total reviews</p>
          <p className="mt-2 font-display text-2xl font-semibold text-white">
            {stats.total}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-5">
          <p className="text-sm text-emerald-400/80">Positive</p>
          <p className="mt-2 font-display text-2xl font-semibold text-emerald-300">
            {stats.positive}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{positiveRate}% of total</p>
        </div>
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-5">
          <p className="text-sm text-red-400/80">Negative</p>
          <p className="mt-2 font-display text-2xl font-semibold text-red-300">
            {stats.negative}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {pct(stats.negative, stats.total)}% of total
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <p className="text-sm text-zinc-500">Net score</p>
          <p
            className={`mt-2 font-display text-2xl font-semibold ${
              stats.netScore >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {stats.netScore > 0 ? "+" : ""}
            {stats.netScore}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Sum of review scores</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="text-lg font-medium text-white">Sentiment breakdown</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Share of positive vs negative reviews
          </p>
          <div className="mt-6 flex flex-col items-center gap-8 sm:flex-row sm:items-start sm:justify-around">
            <SentimentDonut {...stats} />
            <div className="w-full max-w-xs">
              <SentimentBars {...stats} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="text-lg font-medium text-white">Last 30 days</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Daily review volume by sentiment
          </p>
          <div className="mt-6">
            <TimelineChart timeline={stats.timeline ?? []} />
          </div>
        </section>
      </div>
    </div>
  );
}
