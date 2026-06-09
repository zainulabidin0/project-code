import {
  getGroqTtsModel,
  getGroqTtsVoice,
  GROQ_TTS_MAX_INPUT_CHARS,
  groqSpeechSynthesis,
  type GroqTtsLanguage,
} from "@/lib/groq/client";

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Split assistant text into Orpheus-safe chunks (max 200 chars each). */
export function chunkTextForTts(text: string, maxLen = GROQ_TTS_MAX_INPUT_CHARS): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const parts = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clean];
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    const sentence = part.trim();
    if (!sentence) continue;

    if (sentence.length > maxLen) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxLen) {
        chunks.push(sentence.slice(i, i + maxLen).trim());
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      if (current) chunks.push(current.trim());
      current = sentence;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

export function detectTtsLanguage(text: string, preferred?: GroqTtsLanguage): GroqTtsLanguage {
  if (preferred === "en" || preferred === "ar") return preferred;
  return ARABIC_SCRIPT.test(text) ? "ar" : "en";
}

export async function synthesizeReplyAudio(params: {
  text: string;
  lang?: GroqTtsLanguage;
}): Promise<{ chunks: Buffer[]; lang: GroqTtsLanguage }> {
  const lang = detectTtsLanguage(params.text, params.lang);
  const model = getGroqTtsModel(lang);
  const voice = getGroqTtsVoice(lang);
  const textChunks = chunkTextForTts(params.text);

  if (!textChunks.length) {
    return { chunks: [], lang };
  }

  const buffers: Buffer[] = [];
  for (const chunk of textChunks) {
    const audio = await groqSpeechSynthesis({ input: chunk, model, voice });
    buffers.push(Buffer.from(audio));
  }

  return { chunks: buffers, lang };
}
