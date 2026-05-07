import { ensurePythonProcess, sentimentServiceUrl } from "./process-manager";

type PredictResult = {
  review: string;
  sentiment: "POSITIVE" | "NEGATIVE";
  score: number;
  confidence: number;
};

export async function predictSentiment(review: string): Promise<PredictResult> {
  await ensurePythonProcess();
  const res = await fetch(`${sentimentServiceUrl}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `predict failed: ${res.status}`);
  }
  return res.json() as Promise<PredictResult>;
}

export async function predictSentimentBatch(
  reviews: string[]
): Promise<{ results: PredictResult[] }> {
  await ensurePythonProcess();
  const res = await fetch(`${sentimentServiceUrl}/predict/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviews }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `batch predict failed: ${res.status}`);
  }
  return res.json() as Promise<{ results: PredictResult[] }>;
}
