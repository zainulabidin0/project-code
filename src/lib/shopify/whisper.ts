import { getGroqKey, GROQ_TRANSCRIBE_URL, GROQ_WHISPER_MODEL } from "@/lib/groq/client";

export async function transcribeAudio(file: File): Promise<string> {
  const key = getGroqKey();
  if (!key) throw new Error("GROQ_API_KEY is not configured");

  const form = new FormData();
  form.append("file", file);
  form.append("model", GROQ_WHISPER_MODEL);

  const res = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    body: form,
  });
  if (!res.ok) throw new Error("Groq transcription failed");
  const json = (await res.json()) as { text?: string };
  return json.text?.trim() ?? "";
}
