import { globalRules } from "./rules/global";

export function applyRegexLayer(input: string): {
  output: string;
  appliedCategories: string[];
} {
  const sorted = [...globalRules].sort((a, b) => a.priority - b.priority);
  let output = input.trim();
  const appliedCategories: string[] = [];
  for (const rule of sorted) {
    const before = output;
    output = output.replace(rule.pattern, rule.replacement);
    if (before !== output && !appliedCategories.includes(rule.category)) {
      appliedCategories.push(rule.category);
    }
  }
  // Title-case segments lightly: capitalize first letter of each comma-separated part
  output = output
    .split(", ")
    .map((part) => {
      const t = part.trim();
      if (!t) return t;
      return t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join(", ");
  return { output, appliedCategories };
}

export function normalizeForCacheKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}
