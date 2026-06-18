const EMAIL_PREFIXES = [
  /^(?:my\s+email\s+is|email\s+is|email\s*[:-]\s*|it's|its|e\s*mail\s+is)\s+/i,
  /^(?:meri\s+email\s+(?:hai\s+)?|email\s+(?:hai\s+)?)/i,
];

const COMMON_EMAIL_DOMAINS = [
  "gmail",
  "yahoo",
  "hotmail",
  "outlook",
  "icloud",
  "live",
  "protonmail",
  "ymail",
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function stripConversationalEmailPrefix(message: string): string {
  let text = message.trim();
  for (const pattern of EMAIL_PREFIXES) {
    text = text.replace(pattern, "").trim();
  }
  return text;
}

/**
 * Convert spoken email patterns to a standard address.
 * e.g. "zain at gmail" → "zain@gmail.com", "zain at the rate gmail dot com" → "zain@gmail.com"
 */
export function normalizeSpokenEmail(message: string): string {
  let text = stripConversationalEmailPrefix(message).toLowerCase();

  text = text.replace(/\s+at\s+the\s+rate\s+/gi, "@");
  text = text.replace(/\s+at\s+the\s+rate$/gi, "");
  text = text.replace(/\s+at\s+/gi, "@");
  text = text.replace(/\s+dot\s+/gi, ".");
  text = text.replace(/\s+dot$/gi, "");
  text = text.replace(/\s+/g, "");

  for (const domain of COMMON_EMAIL_DOMAINS) {
    if (text.endsWith(`@${domain}`)) {
      text = `${text}.com`;
      break;
    }
  }

  return text;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function normalizeEmailInput(
  message: string
): { ok: true; email: string } | { ok: false; reason: string } {
  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, reason: "Please enter your email address." };
  }

  const normalized = normalizeSpokenEmail(trimmed);
  if (!isValidEmail(normalized)) {
    return {
      ok: false,
      reason:
        "That doesn't look like a valid email. Try something like zain@gmail.com or say \"zain at gmail dot com\".",
    };
  }

  return { ok: true, email: normalized };
}
