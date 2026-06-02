import { GROQ_INTENT_MODEL, groqChatCompletion } from "@/lib/groq/client";
import type { ParsedIntent } from "@/lib/shopify/intent-parser";
import type { QueryRecoveryResult } from "@/lib/shopify/types";

type RecoveryInput = {
  userMessage: string;
  initialPlan: ParsedIntent;
  failedQuery: string;
  errorMessage: string;
};

function fallbackClarification(reason: string): QueryRecoveryResult {
  return {
    status: "clarification",
    reason,
    clarification: {
      question: "I could not understand that search. Do you want the latest products instead?",
      suggestions: [
        "Show latest products",
        "Show best selling products",
        "Show products under $50",
      ],
    },
  };
}

function recoverByRules(input: RecoveryInput): QueryRecoveryResult {
  const text = input.userMessage.toLowerCase();
  if (/\b(new|latest|recent|just arrived)\b/.test(text)) {
    return {
      status: "rewritten",
      reason: "rule:latest",
      plan: {
        ...input.initialPlan,
        intent: "product_search",
        shopifyQuery: "",
        sortKey: "CREATED_AT",
        reverse: true,
        confidence: "medium",
        needsClarification: false,
      },
    };
  }
  if (/\b(cheap|budget|under|lowest)\b/.test(text)) {
    return {
      status: "rewritten",
      reason: "rule:cheap",
      plan: {
        ...input.initialPlan,
        intent: "product_search",
        shopifyQuery: input.initialPlan.shopifyQuery || "products",
        sortKey: "PRICE",
        reverse: false,
        confidence: "medium",
        needsClarification: false,
      },
    };
  }
  return fallbackClarification("rule:fallback");
}

/**
 * Single retry planner for failed Shopify Storefront product queries.
 * Returns either a rewritten plan or a user-facing clarification payload.
 */
export async function recoverSearchPlan(
  input: RecoveryInput
): Promise<QueryRecoveryResult> {
  const result = await groqChatCompletion({
    model: GROQ_INTENT_MODEL,
    max_tokens: 260,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You repair a failed Shopify product search plan.
Reply JSON only.

Output schema:
{
  "status": "rewritten" | "clarification",
  "reason": "short reason",
  "plan": {
    "intent": "product_search",
    "shopifyQuery": "keyword only query",
    "sortKey": "RELEVANCE|CREATED_AT|PRICE|BEST_SELLING",
    "reverse": true|false
  },
  "clarification": {
    "question": "short question",
    "suggestions": ["opt1","opt2","opt3"]
  }
}

Rules:
- If failure was likely malformed query, return status=rewritten with a safer query.
- For "new/latest/recent", prefer sortKey=CREATED_AT and reverse=true.
- If uncertain, return status=clarification with 2-4 suggestions.
- Never include markdown.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          userMessage: input.userMessage,
          initialPlan: input.initialPlan,
          failedQuery: input.failedQuery,
          errorMessage: input.errorMessage,
        }),
      },
    ],
  });

  if (!result.ok) {
    return recoverByRules(input);
  }

  try {
    const parsed = JSON.parse(result.content || "{}") as Record<string, unknown>;
    const status =
      parsed.status === "rewritten" || parsed.status === "clarification"
        ? parsed.status
        : "clarification";
    const reason = typeof parsed.reason === "string" ? parsed.reason : "llm-recovery";

    if (status === "rewritten") {
      const plan = parsed.plan as Record<string, unknown> | undefined;
      const shopifyQuery =
        typeof plan?.shopifyQuery === "string" ? plan.shopifyQuery.trim() : "";
      const sortKey =
        plan?.sortKey === "RELEVANCE" ||
        plan?.sortKey === "CREATED_AT" ||
        plan?.sortKey === "PRICE" ||
        plan?.sortKey === "BEST_SELLING"
          ? plan.sortKey
          : input.initialPlan.sortKey ?? "RELEVANCE";
      const reverse =
        typeof plan?.reverse === "boolean"
          ? plan.reverse
          : input.initialPlan.reverse ?? false;

      return {
        status: "rewritten",
        reason,
        plan: {
          ...input.initialPlan,
          intent: "product_search",
          shopifyQuery,
          sortKey,
          reverse,
          confidence: "medium",
          needsClarification: false,
        },
      };
    }

    const clarification = parsed.clarification as Record<string, unknown> | undefined;
    const question =
      typeof clarification?.question === "string" && clarification.question.trim()
        ? clarification.question
        : "I could not understand that search. Do you want latest products instead?";
    const suggestions = Array.isArray(clarification?.suggestions)
      ? clarification!.suggestions.filter((v): v is string => typeof v === "string").slice(0, 4)
      : [];
    return {
      status: "clarification",
      reason,
      clarification: {
        question,
        suggestions:
          suggestions.length > 0
            ? suggestions
            : ["Show latest products", "Show best selling products", "Show products under $50"],
      },
    };
  } catch {
    return recoverByRules(input);
  }
}
