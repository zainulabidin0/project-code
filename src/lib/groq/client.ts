export const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/** Default chat model (same family as address correction). */
export const GROQ_CHAT_MODEL = "llama-3.3-70b-versatile";

/** Fast intent routing (optional; chat model works too). */
export const GROQ_INTENT_MODEL = "llama-3.1-8b-instant";

export const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

export function getGroqKey(): string | undefined {
  return process.env.GROQ_API_KEY?.trim() || undefined;
}

export type GroqChatMessage = { role: string; content: string };

export async function groqChatCompletion(params: {
  messages: GroqChatMessage[];
  model?: string;
  max_tokens?: number;
  response_format?: { type: "json_object" };
}): Promise<{ ok: true; content: string } | { ok: false; status: number }> {
  const key = getGroqKey();
  if (!key) return { ok: false, status: 503 };

  const res = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: params.model ?? GROQ_CHAT_MODEL,
      messages: params.messages,
      max_tokens: params.max_tokens ?? 400,
      temperature: 0.2,
      ...(params.response_format && { response_format: params.response_format }),
    }),
  });

  if (!res.ok) return { ok: false, status: res.status };

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim() ?? "";
  return { ok: true, content };
}
