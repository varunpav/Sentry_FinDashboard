export const EXPENSE_CATEGORIES = [
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "TRANSPORTATION",
  "TRAVEL",
  "RENT_AND_UTILITIES",
  "OTHER",
];

// Fixed categorical hue assignment — identity follows the category, never its rank
// in a given chart's sort order, so the same category always reads as the same color
// everywhere it appears (dashboard donut, category bar chart, month comparison).
// Only the 7 categories that actually show up with volume in real usage get a
// dedicated hue from the validated --series-1..8 ramp (see globals.css); everything
// else folds into a shared muted "other" bucket rather than consuming a look-alike hue.
const CATEGORY_COLOR_VAR: Record<string, string> = {
  RENT_AND_UTILITIES: "var(--series-1)",
  FOOD_AND_DRINK: "var(--series-2)",
  GENERAL_MERCHANDISE: "var(--series-3)",
  TRANSPORTATION: "var(--series-4)",
  TRAVEL: "var(--series-5)",
  ENTERTAINMENT: "var(--series-6)",
  PERSONAL_CARE: "var(--series-7)",
};

const OTHER_CATEGORY_COLOR = "var(--baseline)";

export function getCategoryColor(category: string | null | undefined): string {
  if (!category) return OTHER_CATEGORY_COLOR;
  return CATEGORY_COLOR_VAR[category] ?? OTHER_CATEGORY_COLOR;
}
