export async function transcribeAudio(file: File): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");

  const form = new FormData();
  form.append("file", file);
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    body: form,
  });
  if (!res.ok) throw new Error("Whisper transcription failed");
  const json = (await res.json()) as { text?: string };
  return json.text?.trim() ?? "";
}
