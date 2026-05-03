/**
 * field-labels.ts — Convert technical field names to business-friendly labels.
 *
 * Priority order when resolving a field:
 *  1. Exact match in FIELD_LABEL_MAP
 *  2. Prefix-match (e.g. "skill_communication_score" → "Communication Score")
 *  3. Generic snake_case → Title Case fallback
 */

// ── Exact matches ─────────────────────────────────────────────────────────────

const FIELD_LABEL_MAP: Record<string, string> = {
  // ── Scores & Results ────────────────────────────────────────────────────────
  overall_score:              "Overall Score",
  final_score:                "Final Score",
  score:                      "Score",
  total_score:                "Total Score",
  weighted_score:             "Weighted Score",
  raw_score:                  "Raw Score",
  performance_score:          "Performance Score",
  evaluation_score:           "Evaluation Score",
  competency_score:           "Competency Score",
  criteria_score:             "Criteria Score",
  rubric_score:               "Rubric Score",
  quiz_score:                 "Quiz Score",
  assessment_score:           "Assessment Score",

  // ── Pass / Fail ─────────────────────────────────────────────────────────────
  overall_result:             "Final Result",
  passed_flag:                "Result",
  result:                     "Result",
  pass_fail:                  "Pass / Fail",
  evaluation_result:          "Evaluation Result",
  certification_result:       "Certification Result",

  // ── Feedback & Narrative ────────────────────────────────────────────────────
  strengths:                  "Strengths",
  general_strengths:          "Strengths",
  key_strengths:              "Key Strengths",
  improvement_areas:          "Areas for Improvement",
  general_improvement_areas:  "Areas for Improvement",
  areas_for_improvement:      "Areas for Improvement",
  development_areas:          "Development Areas",
  feedback:                   "Feedback",
  general_feedback:           "General Feedback",
  evaluator_feedback:         "Evaluator Feedback",
  coach_feedback:             "Coach Feedback",
  ai_feedback:                "AI Feedback",
  instructor_notes:           "Instructor Notes",
  comments:                   "Comments",
  observations:               "Observations",
  summary:                    "Summary",
  evaluation_summary:         "Evaluation Summary",
  session_summary:            "Session Summary",
  performance_summary:        "Performance Summary",
  recommendations:            "Recommendations",
  next_steps:                 "Next Steps",
  action_items:               "Action Items",

  // ── Communication & Language ────────────────────────────────────────────────
  communication_score:        "Communication Score",
  communication_skills:       "Communication Skills",
  verbal_communication:       "Verbal Communication",
  written_communication:      "Written Communication",
  clarity_score:              "Clarity Score",
  clarity:                    "Clarity",
  tone:                       "Tone",
  tone_score:                 "Tone Score",
  language_accuracy:          "Language Accuracy",
  language_score:             "Language Score",
  vocabulary:                 "Vocabulary",
  grammar:                    "Grammar",
  pronunciation:              "Pronunciation",
  active_listening:           "Active Listening",
  listening_score:            "Listening Score",
  empathy_score:              "Empathy Score",
  empathy:                    "Empathy",

  // ── Sales & Negotiation ─────────────────────────────────────────────────────
  sales_technique:            "Sales Technique",
  sales_technique_score:      "Sales Technique Score",
  objection_handling:         "Objection Handling",
  objection_handling_score:   "Objection Handling Score",
  closing_technique:          "Closing Technique",
  closing_score:              "Closing Score",
  needs_identification:       "Needs Identification",
  product_knowledge:          "Product Knowledge",
  product_knowledge_score:    "Product Knowledge Score",
  rapport_building:           "Rapport Building",
  rapport_score:              "Rapport Score",
  persuasion_score:           "Persuasion Score",
  persuasion:                 "Persuasion",
  negotiation_score:          "Negotiation Score",
  negotiation:                "Negotiation",
  upselling:                  "Upselling",
  cross_selling:              "Cross-Selling",
  value_proposition:          "Value Proposition",
  customer_discovery:         "Customer Discovery",

  // ── Customer Service ────────────────────────────────────────────────────────
  customer_service_score:     "Customer Service Score",
  customer_satisfaction:      "Customer Satisfaction",
  csat_score:                 "CSAT Score",
  resolution_score:           "Resolution Score",
  first_call_resolution:      "First Call Resolution",
  response_time:              "Response Time",
  follow_up:                  "Follow-Up",
  professionalism:            "Professionalism",
  professionalism_score:      "Professionalism Score",
  courtesy:                   "Courtesy",
  patience:                   "Patience",

  // ── Coaching & Leadership ────────────────────────────────────────────────────
  coaching_score:             "Coaching Score",
  leadership_score:           "Leadership Score",
  leadership:                 "Leadership",
  mentoring_score:            "Mentoring Score",
  feedback_quality:           "Feedback Quality",
  guidance_score:             "Guidance Score",
  motivation_score:           "Motivation Score",
  delegation:                 "Delegation",
  decision_making:            "Decision Making",
  problem_solving:            "Problem Solving",
  problem_solving_score:      "Problem Solving Score",
  critical_thinking:          "Critical Thinking",
  adaptability:               "Adaptability",
  adaptability_score:         "Adaptability Score",

  // ── Compliance & Process ─────────────────────────────────────────────────────
  compliance_score:           "Compliance Score",
  compliance:                 "Compliance",
  process_adherence:          "Process Adherence",
  protocol_adherence:         "Protocol Adherence",
  script_adherence:           "Script Adherence",
  procedure_score:            "Procedure Score",
  regulatory_compliance:      "Regulatory Compliance",
  quality_score:              "Quality Score",
  quality:                    "Quality",
  accuracy_score:             "Accuracy Score",
  accuracy:                   "Accuracy",
  error_rate:                 "Error Rate",

  // ── Knowledge & Technical ────────────────────────────────────────────────────
  knowledge_score:            "Knowledge Score",
  technical_knowledge:        "Technical Knowledge",
  technical_score:            "Technical Score",
  domain_knowledge:           "Domain Knowledge",
  subject_matter_expertise:   "Subject Matter Expertise",
  information_accuracy:       "Information Accuracy",
  documentation:              "Documentation",
  system_navigation:          "System Navigation",
  tool_usage:                 "Tool Usage",

  // ── Session Metadata ─────────────────────────────────────────────────────────
  session_duration:           "Session Duration",
  duration:                   "Duration",
  duration_seconds:           "Duration (sec)",
  duration_minutes:           "Duration (min)",
  session_date:               "Session Date",
  report_created_at:          "Date",
  created_at:                 "Date",
  usecase_id:                 "Use Case",
  usecase_name:               "Use Case Name",
  scenario:                   "Scenario",
  scenario_name:              "Scenario",
  module:                     "Module",
  agent_name:                 "Agent Name",
  user_name:                  "Participant",
  user_email:                 "Email",
  evaluator:                  "Evaluator",
  evaluator_name:             "Evaluator",
  coach_name:                 "Coach",
  trainer:                    "Trainer",
  attempt_number:             "Attempt",
  attempt:                    "Attempt",
  session_id:                 "Session ID",
  report_id:                  "Report ID",

  // ── LMS / Learning ───────────────────────────────────────────────────────────
  completion_rate:            "Completion Rate",
  completion_status:          "Completion Status",
  progress:                   "Progress",
  progress_percentage:        "Progress %",
  modules_completed:          "Modules Completed",
  lessons_completed:          "Lessons Completed",
  time_on_task:               "Time on Task",
  engagement_score:           "Engagement Score",
  participation_score:        "Participation Score",
  participation:              "Participation",
  quiz_attempts:              "Quiz Attempts",
  correct_answers:            "Correct Answers",
  incorrect_answers:          "Incorrect Answers",
  pass_rate:                  "Pass Rate",

  // ── Status indicators ────────────────────────────────────────────────────────
  status:                     "Status",
  is_complete:                "Completed",
  is_passed:                  "Passed",
  is_certified:               "Certified",
  certification_status:       "Certification Status",
  badge_awarded:              "Badge Awarded",

  // ── Question / Item scores (q1_score, q2_score, etc.) ──────────────────────
  q1_score:                   "Question 1 Score",
  q2_score:                   "Question 2 Score",
  q3_score:                   "Question 3 Score",
  q4_score:                   "Question 4 Score",
  q5_score:                   "Question 5 Score",
  q6_score:                   "Question 6 Score",
  q7_score:                   "Question 7 Score",
  q8_score:                   "Question 8 Score",
  q9_score:                   "Question 9 Score",
  q10_score:                  "Question 10 Score",
  q1_result:                  "Question 1 Result",
  q2_result:                  "Question 2 Result",
  q3_result:                  "Question 3 Result",
  q1:                         "Question 1",
  q2:                         "Question 2",
  q3:                         "Question 3",
  q4:                         "Question 4",
  q5:                         "Question 5",
  q6:                         "Question 6",
  q7:                         "Question 7",
  q8:                         "Question 8",
  q9:                         "Question 9",
  q10:                        "Question 10",
  overall_assessment:          "Overall Assessment",
  assessment:                 "Assessment",
  evaluation_assessment:       "Evaluation Assessment",

  // ── Miscellaneous ────────────────────────────────────────────────────────────
  notes:                      "Notes",
  raw_transcript:             "Conversation Transcript",
  transcript:                 "Transcript",
  conversation:               "Conversation",
  closing_json:               "Closing Report",
  payload:                    "Report Data",
  metadata:                   "Metadata",
  tags:                       "Tags",
  category:                   "Category",
  level:                      "Level",
  difficulty:                 "Difficulty",
  grade:                      "Grade",
  rank:                       "Rank",
  percentile:                 "Percentile",
  benchmark:                  "Benchmark",
  target_score:               "Target Score",
  gap:                        "Gap",
  improvement_pct:            "Improvement %",
}

// ── Prefix patterns (applied when no exact match found) ──────────────────────

const PREFIX_PATTERNS: Array<{ prefix: string; suffix: (rest: string) => string }> = [
  { prefix: 'skill_',          suffix: rest => `${titleCase(rest)} Skill`     },
  { prefix: 'criteria_',       suffix: rest => `${titleCase(rest)} Criteria`  },
  { prefix: 'dimension_',      suffix: rest => `${titleCase(rest)}`           },
  { prefix: 'competency_',     suffix: rest => `${titleCase(rest)} Competency`},
  { prefix: 'category_',       suffix: rest => `${titleCase(rest)} Category`  },
  { prefix: 'rubric_',         suffix: rest => `${titleCase(rest)} Rubric`    },
  { prefix: 'module_',         suffix: rest => `${titleCase(rest)} Module`    },
  { prefix: 'section_',        suffix: rest => `${titleCase(rest)} Section`   },
  { prefix: 'topic_',          suffix: rest => `${titleCase(rest)} Topic`     },
  { prefix: 'phase_',          suffix: rest => `${titleCase(rest)} Phase`     },
  { prefix: 'step_',           suffix: rest => `Step ${titleCase(rest)}`      },
  { prefix: 'level_',          suffix: rest => `Level ${titleCase(rest)}`     },
  { prefix: 'score_',          suffix: rest => `${titleCase(rest)} Score`     },
  { prefix: 'avg_',            suffix: rest => `Avg. ${titleCase(rest)}`      },
  { prefix: 'total_',          suffix: rest => `Total ${titleCase(rest)}`     },
  { prefix: 'is_',             suffix: rest => titleCase(rest)                },
  { prefix: 'has_',            suffix: rest => `Has ${titleCase(rest)}`       },
  { prefix: 'num_',            suffix: rest => `# ${titleCase(rest)}`         },
  { prefix: 'count_',          suffix: rest => `${titleCase(rest)} Count`     },
  { prefix: 'pct_',            suffix: rest => `${titleCase(rest)} %`         },
  { prefix: 'percent_',        suffix: rest => `${titleCase(rest)} %`         },
  { prefix: 'general_',        suffix: rest => titleCase(rest)                },
  { prefix: 'overall_',        suffix: rest => `Overall ${titleCase(rest)}`   },
  { prefix: 'final_',          suffix: rest => `Final ${titleCase(rest)}`     },
  { prefix: 'initial_',        suffix: rest => `Initial ${titleCase(rest)}`   },
  { prefix: 'pre_',            suffix: rest => `Pre-${titleCase(rest)}`       },
  { prefix: 'post_',           suffix: rest => `Post-${titleCase(rest)}`      },
  // qN patterns: q11_score → "Question 11 Score", q3_comment → "Question 3 Comment"
  { prefix: 'q',               suffix: rest => {
    const match = rest.match(/^(\d+)_?(.*)$/)
    if (match) {
      const num = match[1]
      const sub = match[2]
      return sub ? `Question ${num} ${titleCase(sub)}` : `Question ${num}`
    }
    return `Q ${titleCase(rest)}`
  }},
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleCase(snakeOrRaw: string): string {
  return snakeOrRaw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a technical field key or DB label to a human-friendly display name.
 *
 * Examples:
 *   "overall_score"               → "Overall Score"
 *   "general_improvement_areas"   → "Areas for Improvement"
 *   "skill_communication_score"   → "Communication Score Skill"
 *   "my_custom_kpi"               → "My Custom Kpi"   (generic fallback)
 */
export function formatFieldLabel(fieldKeyOrLabel: string | null | undefined): string {
  if (!fieldKeyOrLabel) return "—"

  const trimmed = fieldKeyOrLabel.trim()

  // 1. Exact match
  if (FIELD_LABEL_MAP[trimmed]) return FIELD_LABEL_MAP[trimmed]

  // 2. Case-insensitive exact match (e.g. "Overall_Score")
  const lower = trimmed.toLowerCase()
  if (FIELD_LABEL_MAP[lower]) return FIELD_LABEL_MAP[lower]

  // 3. Suffix match: if the key ends with a known key (e.g. "v2_final_score")
  for (const [key, label] of Object.entries(FIELD_LABEL_MAP)) {
    if (lower.endsWith(`_${key}`) || lower === key) return label
  }

  // 4. Prefix patterns
  for (const { prefix, suffix } of PREFIX_PATTERNS) {
    if (lower.startsWith(prefix)) {
      const rest = lower.slice(prefix.length)
      if (rest.length > 0) return suffix(rest)
    }
  }

  // 5. Generic: snake_case / camelCase → Title Case
  return trimmed
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → spaces
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Batch version: convert multiple field labels in one call.
 */
export function formatFieldLabels(labels: (string | null | undefined)[]): string[] {
  return labels.map(formatFieldLabel)
}
