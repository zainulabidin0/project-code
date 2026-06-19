# ShopAssist — Phase 4: Migrate from Groq to NVIDIA NIM (Qwen3.5-122B-A10B)

## Goal

Replace every call to `llama-3.3-70b-versatile` (Groq) with `qwen/qwen3.5-122b-a10b` 
(NVIDIA NIM) across the entire ShopAssist stack. Groq is fully removed — no fallback.

This affects:
- `planner.ts` — the single planning LLM call
- `reply-composer.ts` — the small LLM fallback for ambiguous replies (also switches to NVIDIA, just using the same model — NVIDIA doesn't have a tiny model equivalent to `llama-3.1-8b-instant` in this stack, so we use Qwen for both, just with smaller `max_tokens`)

---

## Model Reference

| Field | Value |
|---|---|
| Model ID | `qwen/qwen3.5-122b-a10b` |
| Provider | NVIDIA NIM (build.nvidia.com) |
| Type | 122B MoE (10B active params) — text, image, video capable, text-only usage here |
| API style | OpenAI-compatible `/chat/completions` |
| Base URL | `https://integrate.api.nvidia.com/v1` |
| Auth | `Authorization: Bearer $NVIDIA_API_KEY` |
| Context length | Up to 262,144 tokens natively |
| Tool/function calling | Supported via OpenAI-compatible `tools` parameter |
| JSON mode | Supported via `response_format: { type: "json_object" }` — verify with a test call before relying on it in production |

---

## Step 1 — Environment Variables

### Remove
```
GROQ_API_KEY
```

### Add
```
NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxxxxxx
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=qwen/qwen3.5-122b-a10b
```

Get the API key from build.nvidia.com → sign in → select the Qwen3.5-122B-A10B model page → "Get API Key".

---

## Step 2 — Install OpenAI SDK (NVIDIA NIM uses OpenAI-compatible API)

```bash
npm install openai
npm uninstall groq-sdk
```

NVIDIA NIM endpoints are OpenAI-API-compatible, so we use the standard `openai` package pointed at NVIDIA's base URL instead of `groq-sdk`.

---

## Step 3 — New Shared Client File

**File:** `src/lib/shopify/nvidia-client.ts` (new — replaces any `groq-client.ts`)

```typescript
import OpenAI from "openai";

export const nvidia = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
});

export const NVIDIA_MODEL = process.env.NVIDIA_MODEL ?? "qwen/qwen3.5-122b-a10b";
```

---

## Step 4 — Update `planner.ts`

### Before (Groq)
```typescript
import Groq from "groq-sdk";
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const response = await groq.chat.completions.create({
  model: "llama-3.3-70b-versatile",
  messages: [...],
  response_format: { type: "json_object" },
  temperature: 0.1,
  max_tokens: 400,
});
```

### After (NVIDIA NIM)
```typescript
import { nvidia, NVIDIA_MODEL } from "./nvidia-client";

const response = await nvidia.chat.completions.create({
  model: NVIDIA_MODEL,
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `...` }
  ],
  response_format: { type: "json_object" },
  temperature: 0.1,
  max_tokens: 400,
});

const raw = response.choices[0].message.content;

// Log token usage same as before
console.log("[planner] token usage", { 
  total_tokens: response.usage?.total_tokens,
  model: NVIDIA_MODEL 
});
```

**Full updated function:**

```typescript
import { nvidia, NVIDIA_MODEL } from "./nvidia-client";

export async function generatePlan(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  stateSnapshot: string
): Promise<Plan> {
  const response = await nvidia.chat.completions.create({
    model: NVIDIA_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { 
        role: "user", 
        content: `## Conversation history (last 6 turns)\n${formatHistory(history)}\n\n## Current state\n${stateSnapshot}\n\n## User message\n"${userMessage}"\n\nOutput the JSON plan now.` 
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 400,
  });

  console.log("[planner] token usage", { 
    total_tokens: response.usage?.total_tokens,
    model: NVIDIA_MODEL,
  });

  const raw = response.choices[0].message.content;
  try {
    return JSON.parse(raw!) as Plan;
  } catch (err) {
    console.error("[planner] Failed to parse plan JSON:", raw);
    return {
      actions: [{ type: "search", query: userMessage }],
      userIntent: "browse",
      replyTemplate: "search_results",
      language: "en",
    };
  }
}
```

---

## Step 5 — Update `reply-composer.ts`

### Before (Groq, small model)
```typescript
import Groq from "groq-sdk";
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function composeWithLLM(plan: Plan, exec: ExecutionResult, userMessage: string): Promise<string> {
  const response = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [...],
    max_tokens: 100,
    temperature: 0.5,
  });
  return response.choices[0].message.content ?? "...";
}
```

### After (NVIDIA NIM — same Qwen model, smaller token budget)
```typescript
import { nvidia, NVIDIA_MODEL } from "./nvidia-client";

export async function composeWithLLM(
  plan: Plan, 
  exec: ExecutionResult, 
  userMessage: string
): Promise<string> {
  const response = await nvidia.chat.completions.create({
    model: NVIDIA_MODEL,
    messages: [
      { 
        role: "system", 
        content: `You are a friendly Shopify sales assistant. Write ONE short, 
        natural reply (max 2 sentences) based on this situation. Be concise and helpful.
        Default to English unless the user's message is clearly in Roman Urdu — 
        in that case reply in Roman Urdu.` 
      },
      { 
        role: "user", 
        content: `User said: "${userMessage}"\nSituation: ${plan.clarificationNeeded ?? JSON.stringify(exec.replyData)}\nWrite the reply.` 
      }
    ],
    max_tokens: 100,
    temperature: 0.5,
  });

  console.log("[reply-composer] fallback token usage", { 
    total_tokens: response.usage?.total_tokens,
    model: NVIDIA_MODEL,
  });

  return response.choices[0].message.content ?? "Could you tell me more about what you're looking for?";
}
```

---

## Step 6 — Voice & Sentiment (Unaffected — Verify Only)

| Service | Stays on |
|---|---|
| Whisper STT (`whisper.ts`) | **Keep on Groq** — `whisper-large-v3-turbo` has no NVIDIA NIM equivalent in this guide's scope. Unless you want to also migrate this, leave `GROQ_API_KEY` defined ONLY for voice/TTS routes if those still use Groq. |
| Orpheus TTS (`tts.ts`) | **Keep on Groq** — same reasoning as above. |
| Sentiment (Python sklearn service) | Unaffected — not an LLM call at all. |

**Important:** If voice/TTS still need Groq, do NOT fully delete `GROQ_API_KEY` from env vars — only remove it from the chat/planner pipeline. Clarify this with the team before deleting the key entirely. If voice/TTS should ALSO move to NVIDIA, that's a separate follow-up (NVIDIA NIM does not currently offer a direct Whisper/Orpheus equivalent — would need Riva ASR/TTS, which is a bigger migration).

---

## Step 7 — Rate Limits & Retry Handling

NVIDIA NIM free endpoints have stricter rate limits than Groq's paid tier typically allows. Add retry handling:

**File:** `src/lib/shopify/nvidia-client.ts` (extend)

```typescript
import OpenAI from "openai";

export const nvidia = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  maxRetries: 2,        // auto-retry on transient errors
  timeout: 15000,       // 15s timeout — NVIDIA NIM can be slower than Groq's LPU inference
});

export const NVIDIA_MODEL = process.env.NVIDIA_MODEL ?? "qwen/qwen3.5-122b-a10b";

/**
 * Wrap calls with explicit error logging since NVIDIA errors may have a 
 * different shape than Groq's SDK errors.
 */
export async function callNvidiaChat(params: any) {
  try {
    return await nvidia.chat.completions.create(params);
  } catch (error: any) {
    console.error("[nvidia] API call failed", {
      status: error?.status,
      message: error?.message,
      code: error?.code,
    });
    throw error;
  }
}
```

Update `planner.ts` and `reply-composer.ts` to use `callNvidiaChat()` instead of `nvidia.chat.completions.create()` directly, for centralized error logging.

---

## Step 8 — Verify JSON Mode Actually Works

Before fully relying on `response_format: { type: "json_object" }`, run a manual test since not all OpenAI-compatible endpoints implement this identically:

```typescript
// Quick test script: scripts/test-nvidia-json-mode.ts
import { nvidia, NVIDIA_MODEL } from "../src/lib/shopify/nvidia-client";

async function test() {
  const response = await nvidia.chat.completions.create({
    model: NVIDIA_MODEL,
    messages: [
      { role: "system", content: "Respond with ONLY valid JSON: { \"status\": \"ok\", \"value\": 42 }" },
      { role: "user", content: "test" }
    ],
    response_format: { type: "json_object" },
    max_tokens: 50,
  });
  console.log("Raw response:", response.choices[0].message.content);
  try {
    console.log("Parsed:", JSON.parse(response.choices[0].message.content!));
  } catch (e) {
    console.error("JSON mode NOT working as expected — fallback needed");
  }
}

test();
```

Run with: `npx tsx scripts/test-nvidia-json-mode.ts`

**If JSON mode is unreliable:** fall back to prompt-engineering the JSON requirement strongly in the system prompt (which you already do) and strip markdown fences defensively:

```typescript
function extractJson(raw: string): string {
  return raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
}
```

Apply this in `generatePlan()` before `JSON.parse()`.

---

## Step 9 — Latency Expectations

NVIDIA NIM (GPU-based inference) will likely be **slower** than Groq's LPU-based inference. Set realistic expectations and add timeout handling:

| Metric | Groq (llama-3.3-70b) | NVIDIA NIM (Qwen3.5-122B-A10B) — estimate |
|---|---|---|
| Typical latency for ~1000 token response | 300-800ms | 1-3s (varies by load on free endpoint) |
| Free tier rate limits | Generous | More restrictive — monitor 429s closely |

Add a frontend loading state adjustment if needed (widget.js) since responses may take noticeably longer.

---

## Cursor Implementation Checklist

### Setup
- [ ] Sign up at build.nvidia.com, get API key for `qwen/qwen3.5-122b-a10b`
- [ ] Add `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `NVIDIA_MODEL` to `.env` and Vercel env vars
- [ ] `npm install openai`
- [ ] Decide: keep `GROQ_API_KEY` for voice/TTS only, 
### Code changes
- [ ] Create `src/lib/shopify/nvidia-client.ts` with the client + `callNvidiaChat()` wrapper
- [ ] Update `src/lib/shopify/planner.ts` — swap Groq client for NVIDIA client, same prompt/logic
- [ ] Update `src/lib/shopify/reply-composer.ts` — swap Groq client for NVIDIA client in `composeWithLLM()`
- [ ] Remove `import Groq from "groq-sdk"` from both files
- [ ] Add `extractJson()` defensive stripping in `generatePlan()` in case of markdown-fenced JSON
- [ ] Update all console.log token usage tracking to reflect NVIDIA model name

### Testing
- [ ] Run `scripts/test-nvidia-json-mode.ts` to confirm JSON mode works before deploying
- [ ] Test full flow: "I want to buy 2 wireless chargers" → plan generated correctly via NVIDIA
- [ ] Test ambiguous case that triggers `composeWithLLM()` fallback — confirm it still works
- [ ] Monitor latency in Vercel logs — compare against Groq baseline, adjust widget loading UI if much slower
- [ ] Monitor for 429 rate limit errors from NVIDIA free endpoint — add backoff if frequent
- [ ] Confirm voice (`/api/v1/shopify/voice`) and TTS (`/api/v1/shopify/speak`) still work 
- [ ] Re-run the full test suite from Phase 3 checklist (buy flow, browse flow, clear cart, checkout flow, saved address, Roman Urdu, edit checkout details) against the new model

### Rollback plan
- [ ] Keep the Groq code path commented out (not deleted) for one deployment cycle in case NVIDIA NIM has unexpected reliability issues on the free endpoint
- [ ] Add a feature flag env var `USE_NVIDIA_MODEL=true/false` if you want instant rollback capability without a redeploy:

```typescript
const useNvidia = process.env.USE_NVIDIA_MODEL !== "false";
const client = useNvidia ? nvidia : groq;
const model = useNvidia ? NVIDIA_MODEL : "llama-3.3-70b-versatile";
```