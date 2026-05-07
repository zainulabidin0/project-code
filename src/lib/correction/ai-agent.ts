const SYSTEM_PROMPT = `You are an address correction engine. You receive a 
partially-corrected address and must:

1. Fix any remaining spelling errors
2. Ensure proper capitalization of place names
3. Standardize formatting for the detected region/country
4. Preserve all information — do not remove components
5. Do NOT guess or add information that isn't implied

Respond with ONLY a JSON object (valid JSON — no trailing commas, no unquoted text):
{
  "corrected": "The corrected address string",
  "confidence": 0.0-1.0,
  "changes": ["each entry must be one JSON string in double quotes"],
  "detectedCountry": "ISO 3166-1 alpha-2 code or null"
}

Rules for "changes": every item is a single string. Describe edits in plain words, e.g.
"Fixed spelling Towr to Tower" or "Standardized HS and No."
Never put pseudo-syntax like "Towr" to "Tower" inside the array — that breaks JSON.`;

export interface AiCorrectionResult {
  corrected: string;
  confidence: number;
  changes: string[];
  detectedCountry: string | null;
}

const MAX_LOG_SNIPPET = 400;

function truncateForLog(s: string, max = MAX_LOG_SNIPPET): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Unescape a JSON string fragment (after the opening quote). */
function unescapeJsonStringValue(escaped: string): string {
  let out = "";
  for (let i = 0; i < escaped.length; i++) {
    const c = escaped[i];
    if (c === "\\" && i + 1 < escaped.length) {
      const n = escaped[++i];
      if (n === "n") out += "\n";
      else if (n === "t") out += "\t";
      else if (n === "r") out += "\r";
      else if (n === '"' || n === "\\") out += n;
      else out += n;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * When the model returns almost-valid JSON but breaks the "changes" array (e.g.
 * ["Towr" to "Tower"] is not valid JSON), still recover corrected + confidence.
 */
function extractCorrectionFromBrokenJson(
  jsonSlice: string
): AiCorrectionResult | null {
  const correctedRe = /"corrected"\s*:\s*"((?:[^"\\]|\\.)*)"/;
  const cm = jsonSlice.match(correctedRe);
  if (!cm) return null;
  const corrected = unescapeJsonStringValue(cm[1]);

  const confM = jsonSlice.match(/"confidence"\s*:\s*([\d.]+)/);
  let confidence = 0.75;
  if (confM) {
    const n = parseFloat(confM[1]);
    if (Number.isFinite(n)) confidence = Math.min(1, Math.max(0, n));
  }

  let detectedCountry: string | null = null;
  if (/"detectedCountry"\s*:\s*null\b/.test(jsonSlice)) {
    detectedCountry = null;
  } else {
    const dm = jsonSlice.match(/"detectedCountry"\s*:\s*"([^"]*)"/);
    if (dm) detectedCountry = dm[1] || null;
  }

  return {
    corrected,
    confidence,
    changes: [
      "AI returned malformed JSON in changes[]; address field was recovered",
    ],
    detectedCountry,
  };
}

function parseAiCorrectionObject(jsonSlice: string): AiCorrectionResult {
  try {
    const parsed = JSON.parse(jsonSlice) as Record<string, unknown>;
    if (typeof parsed.corrected !== "string") {
      const loose = extractCorrectionFromBrokenJson(jsonSlice);
      if (loose) return loose;
      throw new Error(
        `Invalid AI payload (corrected): ${truncateForLog(JSON.stringify(parsed))}`
      );
    }
    const changesRaw = parsed.changes;
    const changes = Array.isArray(changesRaw)
      ? changesRaw.filter((c): c is string => typeof c === "string")
      : [];
    return {
      corrected: parsed.corrected,
      confidence:
        typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
          ? parsed.confidence
          : 0.8,
      changes,
      detectedCountry:
        parsed.detectedCountry === null ||
        parsed.detectedCountry === undefined
          ? null
          : String(parsed.detectedCountry),
    };
  } catch (e) {
    const loose = extractCorrectionFromBrokenJson(jsonSlice);
    if (loose) return loose;
    if (e instanceof Error && !e.message.startsWith("Invalid AI")) {
      throw new Error(`Invalid AI JSON: ${truncateForLog(jsonSlice)}`);
    }
    throw e;
  }
}

export async function correctWithGroq(
  partialAddress: string
): Promise<AiCorrectionResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error("GROQ_API_KEY missing");
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: partialAddress },
      ],
      temperature: 0.2,
      max_tokens: 512,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(
      `Groq HTTP ${res.status}: ${truncateForLog(t, 800)}`
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      content
        ? `Invalid AI response (no JSON object): ${truncateForLog(content)}`
        : "Invalid AI response (empty content)"
    );
  }
  return parseAiCorrectionObject(jsonMatch[0]);
}
