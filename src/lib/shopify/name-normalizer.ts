import { getGroqKey, groqChatCompletion, GROQ_INTENT_MODEL } from "@/lib/groq/client";

const CONVERSATIONAL_PREFIXES = [
  /^(?:my\s+name\s+is|i\s*am|i'm|im|this\s+is|it's|its|call\s+me)\s+/i,
  /^(?:mera\s+naam\s+(?:hai\s+)?|naam\s+(?:hai\s+)?)/i,
  /^(?:name\s*[:-]\s*)/i,
];

const CONVERSATIONAL_PATTERNS =
  /\b(my\s+name\s+is|i\s+am|i'm|im|mera\s+naam|naam\s+hai|this\s+is|call\s+me|name\s+is)\b/i;

const FILLER_WORDS = /\b(my|name|is|the|this|that|please|checkout|hello|hi)\b/i;

export function stripConversationalNamePrefix(message: string): string {
  let text = message.trim().replace(/[.!?,;:]+$/g, "").trim();
  for (const pattern of CONVERSATIONAL_PREFIXES) {
    text = text.replace(pattern, "").trim();
  }
  text = text.replace(/\s+hai$/i, "").trim();
  return text;
}

export function looksConversationalFullName(message: string): boolean {
  const lower = message.trim().toLowerCase();
  if (CONVERSATIONAL_PATTERNS.test(lower)) return true;
  if (/\bname\s+is\b/i.test(lower)) return true;
  const words = lower.split(/\s+/).filter(Boolean);
  return words.length > 4;
}

export function isPlausibleFullName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  if (FILLER_WORDS.test(trimmed)) return false;
  return /^[a-zA-Z\u00C0-\u024F\u0600-\u06FF\s'.-]+$/.test(trimmed);
}

async function extractFullNameWithGroq(
  message: string
): Promise<{ ok: true; fullName: string } | { ok: false; reason: string }> {
  const result = await groqChatCompletion({
    model: GROQ_INTENT_MODEL,
    max_tokens: 120,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Extract the person's real name from the shopper message for a delivery form.
Return strict JSON:
{
  "fullName": "clean full name only",
  "needsClarification": false,
  "reason": "optional short reason when needsClarification is true"
}
Rules:
- Strip phrases like "my name is", "I am", "mera naam", "call me".
- fullName should be 1-4 name words only (e.g. "Ali Khan", "Abuburr").
- If no clear personal name exists, set needsClarification true.
- Never include sentences or filler words in fullName.`,
      },
      { role: "user", content: message },
    ],
  });

  if (!result.ok) {
    return { ok: false, reason: "Please enter just your name, for example: Ali Khan" };
  }

  try {
    const parsed = JSON.parse(result.content || "{}") as {
      fullName?: string;
      needsClarification?: boolean;
      reason?: string;
    };
    if (parsed.needsClarification) {
      return {
        ok: false,
        reason:
          typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim()
            : "Please enter just your name, for example: Ali Khan",
      };
    }
    const fullName =
      typeof parsed.fullName === "string" ? stripConversationalNamePrefix(parsed.fullName) : "";
    if (!isPlausibleFullName(fullName)) {
      return { ok: false, reason: "Please enter just your name, for example: Ali Khan" };
    }
    return { ok: true, fullName };
  } catch {
    return { ok: false, reason: "Please enter just your name, for example: Ali Khan" };
  }
}

/**
 * Normalize a checkout fullName answer: rules first, Groq for conversational input.
 */
export async function normalizeFullNameInput(
  message: string
): Promise<{ ok: true; fullName: string } | { ok: false; reason: string }> {
  const trimmed = message.trim();
  if (trimmed.length < 2) {
    return { ok: false, reason: "Please enter your full name." };
  }

  const ruleBased = stripConversationalNamePrefix(trimmed);

  if (isPlausibleFullName(ruleBased)) {
    return { ok: true, fullName: ruleBased };
  }

  if (looksConversationalFullName(trimmed) && getGroqKey()) {
    const groqResult = await extractFullNameWithGroq(trimmed);
    if (groqResult.ok) return groqResult;
  }

  return {
    ok: false,
    reason: "Please enter just your name, for example: Ali Khan",
  };
}
