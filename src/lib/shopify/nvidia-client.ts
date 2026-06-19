import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export const nvidia = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  maxRetries: 2,
  timeout: 15000,
});

export const NVIDIA_MODEL =
  process.env.NVIDIA_MODEL ?? "qwen/qwen3.5-122b-a10b";

export type NvidiaChatMessage = ChatCompletionMessageParam;

export type NvidiaChatResult =
  | {
      ok: true;
      content: string;
      usage?: {
        total_tokens?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
      };
    }
  | { ok: false; status: number };

/**
 * Wrap calls with explicit error logging since NVIDIA errors may have a
 * different shape than Groq's SDK errors.
 */
export async function callNvidiaChat(params: {
  messages: NvidiaChatMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
}): Promise<NvidiaChatResult> {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) return { ok: false, status: 503 };

  try {
    const response = await nvidia.chat.completions.create({
      model: params.model ?? NVIDIA_MODEL,
      messages: params.messages,
      max_tokens: params.max_tokens ?? 400,
      temperature: params.temperature ?? 0.2,
      ...(params.response_format && { response_format: params.response_format }),
    });

    const content = response.choices[0]?.message?.content?.trim() ?? "";
    return {
      ok: true,
      content,
      usage: response.usage
        ? {
            total_tokens: response.usage.total_tokens,
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string; code?: string };
    console.error("[nvidia] API call failed", {
      status: err?.status,
      message: err?.message,
      code: err?.code,
    });
    return { ok: false, status: err?.status ?? 502 };
  }
}
