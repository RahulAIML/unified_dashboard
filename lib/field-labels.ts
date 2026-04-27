/**
 * field-labels.ts — Convert technical field names to business-friendly labels
 */

const FIELD_LABEL_MAP: Record<string, string> = {
  // Core fields
  overall_score: "Overall Score",
  final_score: "Final Score",
  overall_result: "Final Result",
  status: "Status",

  // Qualitative/extra fields
  strengths: "Strengths",
  general_strengths: "Strengths",
  improvement_areas: "Areas for Improvement",
  general_improvement_areas: "Areas for Improvement",

  // Common generic transformations
};

/**
 * Convert a technical field key or label to a business-friendly format
 * Examples:
 *  "overall_score" → "Overall Score"
 *  "improvement_areas" → "Areas for Improvement"
 *  "general_strengths" → "Strengths"
 */
export function formatFieldLabel(fieldKeyOrLabel: string | null | undefined): string {
  if (!fieldKeyOrLabel) return "—";

  const trimmed = fieldKeyOrLabel.trim();

  // Check if there's an explicit mapping
  if (FIELD_LABEL_MAP[trimmed]) {
    return FIELD_LABEL_MAP[trimmed];
  }

  // Generic transformation: convert snake_case to Title Case
  return trimmed
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Batch version: convert multiple field labels
 */
export function formatFieldLabels(labels: (string | null | undefined)[]): string[] {
  return labels.map(formatFieldLabel);
}
