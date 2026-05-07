export interface RegexRule {
  pattern: RegExp;
  replacement: string;
  category: string;
  priority: number;
}

export const globalRules: RegexRule[] = [
  { pattern: /\s{2,}/g, replacement: " ", category: "spacing", priority: 0 },
  { pattern: /\s*,\s*/g, replacement: ", ", category: "punctuation", priority: 0 },

  { pattern: /\bblk\b/gi, replacement: "Block", category: "abbreviation", priority: 1 },
  { pattern: /\bst\b/gi, replacement: "Street", category: "abbreviation", priority: 1 },
  { pattern: /\bapt\b/gi, replacement: "Apartment", category: "abbreviation", priority: 1 },
  { pattern: /\bave?\b/gi, replacement: "Avenue", category: "abbreviation", priority: 1 },
  { pattern: /\bblvd\b/gi, replacement: "Boulevard", category: "abbreviation", priority: 1 },
  { pattern: /\bdr\b/gi, replacement: "Drive", category: "abbreviation", priority: 1 },
  { pattern: /\brd\b/gi, replacement: "Road", category: "abbreviation", priority: 1 },
  { pattern: /\bln\b/gi, replacement: "Lane", category: "abbreviation", priority: 1 },
  { pattern: /\bct\b/gi, replacement: "Court", category: "abbreviation", priority: 1 },
  { pattern: /\bhse\b/gi, replacement: "House", category: "abbreviation", priority: 1 },
  { pattern: /\bfl\b/gi, replacement: "Floor", category: "abbreviation", priority: 1 },

  { pattern: /\bmdl\b/gi, replacement: "Model", category: "typo", priority: 2 },
  { pattern: /\btwn\b/gi, replacement: "Town", category: "typo", priority: 2 },
  { pattern: /\bstrt\b/gi, replacement: "Street", category: "typo", priority: 2 },
  { pattern: /\byrok\b/gi, replacement: "York", category: "typo", priority: 2 },
];
