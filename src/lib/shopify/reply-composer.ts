import { callNvidiaChat, NVIDIA_MODEL } from "@/lib/shopify/nvidia-client";
import type { ExecutionResult } from "@/lib/shopify/action-executor";
import type { Plan } from "@/lib/shopify/planner";

const CHECKOUT_FIELD_LABELS: Record<string, string> = {
  fullName: "Name",
  email: "Email",
  phone: "Phone",
  address1: "Address",
  address2: "Address line 2",
  city: "City",
  zip: "Postal code",
};

function formatCheckoutSummary(draft: Record<string, unknown>): string {
  return Object.entries(draft)
    .filter(([, v]) => v != null && String(v).trim())
    .map(([k, v]) => `${CHECKOUT_FIELD_LABELS[k] ?? k}: ${v}`)
    .join(", ");
}

function formatFieldLabel(field: unknown): string {
  return CHECKOUT_FIELD_LABELS[String(field)] ?? String(field);
}

/**
 * Template-based replies — instant, free, zero hallucination risk.
 */
export function composeFromTemplate(plan: Plan, exec: ExecutionResult): string | null {
  const d = exec.replyData;
  const lang = plan.language;
  const originalTemplate = plan.replyTemplate;

  // Override template when execution data contradicts the planner's guess
  if (d.found === false || d.buyIntentNoMatch) {
    plan.replyTemplate = "no_results";
  }

  if (originalTemplate !== plan.replyTemplate) {
    console.warn("[reply-composer] Template overridden", {
      original: originalTemplate,
      corrected: plan.replyTemplate,
      query: d.query,
      buyIntentNoMatch: d.buyIntentNoMatch,
    });
  }

  switch (plan.replyTemplate) {
    case "single_match_confirm": {
      if (d.needsVariantChoice) {
        const product = d.product as { title: string };
        const variants = (d.variants as Array<{ title: string }>) ?? [];
        const options = variants.map((v) => v.title).join(", ");
        return t(
          lang,
          `Found ${product.title}! It comes in: ${options}. Which one would you like?`,
          `${product.title} mil gaya! Ye options hain: ${options}. Konsa chahiye?`
        );
      }
      if (!d.singleMatch) return null;
      const qty = Number(d.quantity) || 1;
      const qtyText =
        qty > 1
          ? `${qty} pieces = PKR ${d.totalPrice} total`
          : `PKR ${d.unitPrice}`;
      const product = d.product as { title: string };
      return t(
        lang,
        `Found it! ${product.title} — PKR ${d.unitPrice} each. ${qtyText}. Want me to add it to your cart?`,
        `Mil gaya! ${product.title} — PKR ${d.unitPrice} each. ${qtyText}. Cart mein add karu?`
      );
    }

    case "added_confirmation": {
      if (d.error === "no_pending_product") return null;
      const qty = Number(d.quantity) || 1;
      const qtyPrefix = qty > 1 ? `${qty}x ` : "";
      return t(
        lang,
        `Done! ${qtyPrefix}${d.title} added to your cart 🛒 Ready to checkout?`,
        `Ho gaya! ${qtyPrefix}${d.title} cart mein add ho gaya 🛒 Checkout karna hai?`
      );
    }

    case "search_results": {
      if (!d.found) {
        return t(
          lang,
          `I couldn't find anything matching "${d.query}". Want me to show similar items?`,
          `"${d.query}" nahi mila. Kuch aur dikhaun?`
        );
      }
      return t(
        lang,
        `Here's what I found for "${d.query}":`,
        `"${d.query}" ke liye ye mile:`
      );
    }

    case "cart_summary": {
      const cart = d.cart as { lines?: Array<{ quantity: number; title: string }>; total?: string | null } | null;
      if (!cart?.lines?.length) {
        return t(
          lang,
          "Your cart is empty. What would you like to add?",
          "Aap ka cart khali hai. Kya add karna hai?"
        );
      }
      const itemsText = cart.lines.map((l) => `${l.quantity}x ${l.title}`).join(", ");
      return t(
        lang,
        `Your cart: ${itemsText}. Total: PKR ${cart.total ?? "0"}.`,
        `Aap ka cart: ${itemsText}. Total: PKR ${cart.total ?? "0"}.`
      );
    }

    case "cart_cleared":
      return t(lang, "Done! Your cart is now empty.", "Ho gaya! Cart khali kar diya.");

    case "ask_checkout_field": {
      if (d.checkoutUrl && !d.reaskField) {
        return t(
          lang,
          "All set! Tap below to complete your order 🎉",
          "Sab ready hai! Order complete karne ke liye neeche tap karein 🎉"
        );
      }
      if (d.savedProfileFound) {
        const profile = d.profile as { address1?: string; city?: string };
        return t(
          lang,
          `I have your saved address: ${profile.address1}, ${profile.city}. Use this?`,
          `Aap ka saved address hai: ${profile.address1}, ${profile.city}. Yehi use karu?`
        );
      }
      if (d.invalidField === "email") {
        return t(
          lang,
          "That email doesn't look right. Can you try again?",
          "Email theek nahi laga. Dobara batayein?"
        );
      }
      return typeof d.prompt === "string" ? d.prompt : null;
    }

    case "checkout_url_ready":
      return t(
        lang,
        "All set! Tap below to complete your order 🎉",
        "Sab ready hai! Order complete karne ke liye neeche tap karein 🎉"
      );

    case "checkout_details_summary": {
      const draft = d.checkoutSummary as Record<string, unknown> | undefined;
      if (!draft || Object.keys(draft).length === 0) {
        return t(
          lang,
          "I haven't collected any checkout details yet. Want to start?",
          "Abhi tak koi checkout detail nahi li. Shuru karein?"
        );
      }
      const lines = formatCheckoutSummary(draft);
      return t(
        lang,
        `Here's what I have so far: ${lines}. Want to change anything?`,
        `Ye details hain: ${lines}. Kuch change karna hai?`
      );
    }

    case "checkout_field_update": {
      if (d.invalidField) {
        return t(
          lang,
          `That doesn't look right for ${formatFieldLabel(d.invalidField)}. Can you try again?`,
          `${formatFieldLabel(d.invalidField)} theek nahi laga. Dobara batayein?`
        );
      }
      if (d.fieldUpdated) {
        return t(
          lang,
          `Updated! Your ${formatFieldLabel(d.fieldUpdated)} is now ${d.newValue}. Say "checkout now" when you're ready to place your order.`,
          `Update ho gaya! ${formatFieldLabel(d.fieldUpdated)}: ${d.newValue}. Order ke liye "checkout now" keh dein.`
        );
      }
      return t(
        lang,
        `Sure, what's the new ${formatFieldLabel(d.awaitingNewValue)}?`,
        `Theek hai, naya ${formatFieldLabel(d.awaitingNewValue)} batayein?`
      );
    }

    case "no_results":
      if (plan.userIntent === "checkout") {
        return t(
          lang,
          "Your cart is empty. Add something first, then we can checkout!",
          "Aap ka cart khali hai. Pehle kuch add karein, phir checkout karte hain!"
        );
      }
      return t(
        lang,
        `I couldn't find "${d.query ?? "that"}" in the store. Want me to check something else?`,
        `"${d.query ?? "woh"}" store mein nahi mila. Kuch aur dekhain?`
      );

    case "off_topic_redirect":
      return t(
        lang,
        "I'm here to help you shop! What are you looking for today?",
        "Main shopping mein madad karta hoon! Aaj kya dhoondh rahe hain?"
      );

    case "chitchat_reply":
      return t(lang, "Hi there! What can I help you find today?", "Hello! Aaj kya chahiye?");

    case "needs_clarification":
      return null;

    default:
      return null;
  }
}

function t(lang: string, en: string, ur: string): string {
  return lang === "en" ? en : ur;
}

export type ComposeResult = {
  reply: string;
  usedLlmFallback: boolean;
  usage?: { total_tokens?: number };
};

/**
 * Fallback — only when template returns null (genuinely novel situation).
 */
export async function composeWithLLM(
  plan: Plan,
  exec: ExecutionResult,
  userMessage: string
): Promise<ComposeResult> {
  console.log("[reply-composer] LLM fallback triggered", {
    template: plan.replyTemplate,
    clarification: plan.clarificationNeeded,
  });

  const response = await callNvidiaChat({
    model: NVIDIA_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a friendly Shopify sales assistant. Write ONE short, natural reply (max 2 sentences) based on this situation. Be concise and helpful. Default to English unless the user's message is clearly in Roman Urdu — in that case reply in Roman Urdu.`,
      },
      {
        role: "user",
        content: `User said: "${userMessage}"\nSituation: ${plan.clarificationNeeded ?? JSON.stringify(exec.replyData)}\nWrite the reply.`,
      },
    ],
    max_tokens: 100,
    temperature: 0.5,
  });

  if (response.ok && response.usage?.total_tokens) {
    console.log("[reply-composer] fallback token usage", {
      total_tokens: response.usage.total_tokens,
      model: NVIDIA_MODEL,
    });
  }

  const reply =
    response.ok && response.content
      ? response.content
      : "Could you tell me more about what you're looking for?";

  return {
    reply,
    usedLlmFallback: true,
    usage: response.ok ? response.usage : undefined,
  };
}

export async function composeReply(
  plan: Plan,
  exec: ExecutionResult,
  userMessage: string
): Promise<ComposeResult> {
  const templateReply = composeFromTemplate(plan, exec);
  if (templateReply) {
    return { reply: templateReply, usedLlmFallback: false };
  }
  return composeWithLLM(plan, exec, userMessage);
}
