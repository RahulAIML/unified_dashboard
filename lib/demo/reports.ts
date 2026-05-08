/**
 * lib/demo/reports.ts
 *
 * Twenty realistic drilldown session reports for DEMO MODE.
 * IDs 5001–5020. Each maps to a specific use-case scenario with
 * realistic scoring fields, AI coaching feedback, and interaction data.
 *
 * Field structure mirrors DrilldownResult from lib/data-provider.ts:
 *   { fieldKey, fieldLabel, valueNum, valueText, valueLongtext, normalizedValue }
 */

import type { DrilldownResult, DrilldownField } from '@/lib/data-provider'

// ── Helpers ───────────────────────────────────────────────────────────────────
const num = (key: string, label: string, val: number): DrilldownField => ({
  fieldKey: key, fieldLabel: label,
  valueNum: val, valueText: null, valueLongtext: null,
  normalizedValue: val,
})

const txt = (key: string, label: string, val: string): DrilldownField => ({
  fieldKey: key, fieldLabel: label,
  valueNum: null, valueText: val, valueLongtext: null,
  normalizedValue: val,
})

const long = (key: string, label: string, val: string): DrilldownField => ({
  fieldKey: key, fieldLabel: label,
  valueNum: null, valueText: null, valueLongtext: val,
  normalizedValue: val,
})

// ── Report 5001 — Discovery Call Mastery · PASS ───────────────────────────────
const r5001: DrilldownResult = {
  savedReportId: 5001,
  usecaseId: 101,
  date: '2026-05-06',
  closingJson: {
    session_type: 'Discovery Call',
    evaluator: 'Rolplay AI Engine v3.2',
    certification_level: 'Advanced',
    percentile: 92,
  },
  fields: [
    num('overall_score',              'Overall Score',              88),
    txt('overall_result',             'Overall Result',             'Pass'),
    num('needs_identification_score', 'Needs Identification',       91),
    num('questioning_technique_score','Questioning Technique',      86),
    num('active_listening_score',     'Active Listening',           89),
    num('rapport_building_score',     'Rapport Building',           85),
    num('value_articulation_score',   'Value Articulation',         90),
    txt('interaction_quality',        'Interaction Quality',        'Excellent'),
    txt('call_structure',             'Call Structure',             'Well-structured BANT flow with strong discovery questions'),
    long('strengths',                 'Strengths & Highlights',
      'The rep demonstrated exceptional questioning technique throughout the discovery phase. ' +
      'Open-ended questions were used effectively to uncover the prospect\'s pain points around ' +
      'sales team productivity and CRM data quality. The transition from rapport building to ' +
      'needs exploration was seamless and natural, creating an environment where the prospect ' +
      'felt comfortable sharing detailed information about their current challenges.\n\n' +
      'Particularly notable was the use of the "5 Whys" technique to drill down from a surface-level ' +
      'complaint ("our reps don\'t update the CRM") to the root cause ("we lack accountability ' +
      'systems and visibility into daily activities"). This depth of discovery positions the solution ' +
      'as a strategic investment rather than a tactical tool.\n\n' +
      'Active listening was consistently demonstrated through accurate reflection of stated concerns ' +
      'and thoughtful follow-up questions that referenced earlier answers.'
    ),
    long('areas_for_improvement',     'Areas for Improvement',
      'While the overall performance was strong, there are two areas that would elevate this ' +
      'from a good discovery call to a great one:\n\n' +
      '1. **Budget Qualification Timing**: The budget conversation was introduced too early ' +
      '(approximately 8 minutes in), before sufficient pain had been established. Prospects ' +
      'are more willing to discuss investment when they feel the pain is fully understood. ' +
      'Recommend moving budget discovery to after the impact quantification step.\n\n' +
      '2. **Decision-Maker Mapping**: The rep did not probe sufficiently into the buying committee. ' +
      'Understanding who else is involved in the decision (IT, Finance, C-suite sign-off thresholds) ' +
      'is critical for deal velocity. A simple "Who else besides yourself would be involved in ' +
      'evaluating a solution like this?" would have uncovered this.'
    ),
    long('coaching_summary',          'AI Coaching Summary',
      'This was a high-quality discovery call that demonstrates strong command of core discovery ' +
      'methodology. The rep scored in the 92nd percentile across all users in this scenario. ' +
      'The primary growth opportunity is in stakeholder mapping and budget conversation sequencing.\n\n' +
      '**Recommended Next Steps:**\n' +
      '• Complete the "Multi-Threading Deals" advanced module\n' +
      '• Practice the MEDDIC qualification framework in the next 2 simulator sessions\n' +
      '• Review the "Budget Before Pain is Dangerous" coaching video in the LMS\n\n' +
      'Overall trajectory is excellent — this rep is on track for Advanced certification.'
    ),
  ],
}

// ── Report 5002 — Objection Handling · FAIL ───────────────────────────────────
const r5002: DrilldownResult = {
  savedReportId: 5002,
  usecaseId: 102,
  date: '2026-05-05',
  closingJson: {
    session_type: 'Objection Handling',
    evaluator: 'Rolplay AI Engine v3.2',
    top_objection: 'Price too high',
    resolution_rate: '38%',
  },
  fields: [
    num('overall_score',               'Overall Score',              61),
    txt('overall_result',              'Overall Result',             'Fail'),
    num('objection_acknowledgment',    'Objection Acknowledgment',   72),
    num('empathy_demonstration',       'Empathy Demonstration',      68),
    num('value_reframing_score',       'Value Reframing',            55),
    num('price_justification_score',   'Price Justification',        48),
    num('closing_attempt_score',       'Next Step Closure',          62),
    txt('interaction_quality',         'Interaction Quality',        'Needs Improvement'),
    txt('primary_objection_type',      'Primary Objection',          'Price / ROI concerns'),
    long('strengths',                  'Strengths & Highlights',
      'The rep showed genuine empathy when the prospect expressed budget concerns, which prevented ' +
      'the conversation from becoming adversarial. The opening acknowledgment ("I completely ' +
      'understand that investment is a key consideration...") was well-delivered and bought ' +
      'goodwill with the prospect.\n\n' +
      'There were also bright spots in the active listening section — the rep correctly identified ' +
      'that the stated price objection was actually masking an unstated concern about internal ' +
      'approval processes. This shows good instinct for reading between the lines.'
    ),
    long('areas_for_improvement',      'Areas for Improvement',
      'The core issue in this session was an inability to effectively reframe the price conversation ' +
      'in terms of ROI and business impact. When the prospect said "It\'s too expensive," the rep ' +
      'responded primarily with discounting language ("we could work something out") rather than ' +
      'anchoring to value.\n\n' +
      '**Critical gaps identified:**\n\n' +
      '1. **No ROI Calculation**: The rep never attempted to quantify the cost of the problem ' +
      'the solution solves. "If your reps spend 2 hours/week on admin tasks, and you have 20 reps, ' +
      'that\'s 40 hours/week of lost selling time — at an average deal size of $X, that\'s $Y in ' +
      'at-risk revenue annually." This math would have reframed the price conversation entirely.\n\n' +
      '2. **Premature Discounting**: Offering discount flexibility before the prospect asked for it ' +
      'signals low confidence in the product\'s value and trains prospects to push for more.\n\n' +
      '3. **No "Feel, Felt, Found" Framework**: The classic objection-handling structure was not used, ' +
      'which would have provided a more structured path through the objection.'
    ),
    long('coaching_summary',           'AI Coaching Summary',
      'This session did not meet the pass threshold (75 pts). The rep\'s empathy skills are a strong ' +
      'foundation, but the value-reframing capabilities need focused development before this scenario ' +
      'is retaken.\n\n' +
      '**Required Development Actions:**\n' +
      '• Complete "ROI Selling Mastery" module in LMS (mandatory before retake)\n' +
      '• Study the "Feel, Felt, Found" coaching video\n' +
      '• Practice the Price Objection simulator with focus on value anchoring\n' +
      '• Schedule 1:1 coaching session with team lead focused on ROI calculation exercises\n\n' +
      'Estimated time to pass: 2–3 weeks with consistent practice. This is a common sticking point ' +
      'for reps who are naturally empathetic but have not yet developed commercial confidence.'
    ),
  ],
}

// ── Report 5003 — Product Demo Excellence · PASS ─────────────────────────────
const r5003: DrilldownResult = {
  savedReportId: 5003,
  usecaseId: 103,
  date: '2026-05-04',
  closingJson: {
    session_type: 'Product Demo',
    evaluator: 'Rolplay AI Engine v3.2',
    demo_flow: 'Problem → Solution → Proof → CTA',
    features_covered: 7,
  },
  fields: [
    num('overall_score',              'Overall Score',              85),
    txt('overall_result',             'Overall Result',             'Pass'),
    num('opening_impact_score',       'Opening Impact',             87),
    num('problem_framing_score',      'Problem Framing',            83),
    num('feature_relevance_score',    'Feature Relevance',          88),
    num('storytelling_score',         'Storytelling Quality',       86),
    num('prospect_engagement_score',  'Prospect Engagement',        82),
    num('call_to_action_score',       'Call to Action',             84),
    txt('demo_structure',             'Demo Structure',             'Problem-led, persona-tailored'),
    txt('interaction_quality',        'Interaction Quality',        'Strong'),
    long('strengths',                 'Strengths & Highlights',
      'Excellent execution of the "show the pain before the gain" demo principle. The rep opened ' +
      'by walking the prospect through a day-in-the-life of their current situation — the manual ' +
      'spreadsheet tracking, the missed coaching moments, the end-of-month scramble — before ' +
      'showing how the platform changes each scenario. This narrative approach kept the prospect ' +
      'engaged throughout.\n\n' +
      'Feature selection was highly disciplined. Rather than showing all capabilities, the rep ' +
      'showcased exactly 7 features directly relevant to the three pain points identified in the ' +
      'prior discovery call. This restraint is a mark of a mature seller.\n\n' +
      'The "live proof" moment — pulling up an actual client dashboard to show real results — ' +
      'was powerfully executed and created a visible shift in prospect body language (leaned in, ' +
      'began taking notes).'
    ),
    long('areas_for_improvement',     'Areas for Improvement',
      '1. **Handling Interruptions**: When the prospect interrupted mid-demo to ask a tangential ' +
      'question about integrations, the rep lost their narrative thread and took 3 minutes to ' +
      'recover the story arc. Recommend practicing "parking lot" language: "Great question — ' +
      'I\'ll show you exactly that in 2 minutes. First let me finish this thought..."\n\n' +
      '2. **Trial Close Frequency**: There were only 2 trial closes in a 45-minute demo. Best ' +
      'practice is a mini-confirmation every 10–12 minutes: "Does this solve the challenge you ' +
      'described earlier with X?" More frequent check-ins prevent objection accumulation at the end.'
    ),
    long('coaching_summary',          'AI Coaching Summary',
      'Strong demo performance placing this rep in the top quartile for this scenario. The ' +
      'storytelling-first approach is a genuine differentiator and should be reinforced.\n\n' +
      '**Recommended Next Steps:**\n' +
      '• Advance to "Executive Demo Mastery" (C-suite audience track)\n' +
      '• Practice "Objection Interruption Recovery" drill (5 sessions recommended)\n' +
      '• This rep is ready to shadow and co-deliver live customer demos'
    ),
  ],
}

// ── Report 5004 — Negotiation Techniques · PASS ──────────────────────────────
const r5004: DrilldownResult = {
  savedReportId: 5004,
  usecaseId: 104,
  date: '2026-05-03',
  closingJson: {
    session_type: 'Negotiation',
    evaluator: 'Rolplay AI Engine v3.2',
    concession_count: 2,
    deal_closed: true,
  },
  fields: [
    num('overall_score',              'Overall Score',              79),
    txt('overall_result',             'Overall Result',             'Pass'),
    num('anchor_setting_score',       'Anchor Setting',             82),
    num('concession_management',      'Concession Management',      74),
    num('urgency_creation_score',     'Urgency Creation',           81),
    num('walk_away_readiness',        'Walk-Away Readiness',        77),
    num('mutual_value_creation',      'Mutual Value Creation',      83),
    txt('negotiation_style',          'Negotiation Style',          'Collaborative / Win-Win'),
    txt('deal_outcome',               'Deal Outcome',               'Closed — 3% pricing concession, extended onboarding'),
    long('strengths',                 'Strengths & Highlights',
      'Solid command of principled negotiation fundamentals. The rep opened with a confident ' +
      'anchor at full price, avoided the common mistake of offering concessions before being asked, ' +
      'and successfully traded concessions for concessions (discount in exchange for longer contract ' +
      'term and faster payment schedule).\n\n' +
      'The urgency creation technique was particularly effective — referencing the Q2 pricing ' +
      'adjustment and the limited implementation slots created legitimate time pressure without ' +
      'feeling artificial or high-pressure.'
    ),
    long('areas_for_improvement',     'Areas for Improvement',
      '1. **Concession Sequencing**: The second concession (extended onboarding support) was offered ' +
      'too quickly after the first (pricing). A longer pause and more deliberate consideration would ' +
      'have increased perceived value of each concession.\n\n' +
      '2. **Conditional Language Consistency**: Occasionally used "we can do X" instead of ' +
      '"if you can do Y, then I can explore X." The conditional structure is critical to signal ' +
      'that every concession requires something in return.'
    ),
    long('coaching_summary',          'AI Coaching Summary',
      'Pass achieved with a solid collaborative negotiation style. The rep successfully closed the ' +
      'deal while protecting margin effectively — a 3% concession vs. the 8–12% typical for this ' +
      'scenario is excellent margin discipline.\n\n' +
      '**Next Level Focus Areas:**\n' +
      '• Multi-party negotiation scenarios (procurement + finance + end-user)\n' +
      '• Advanced anchoring techniques with BATNA development\n' +
      '• This rep\'s collaborative style makes them ideal for complex, long-cycle enterprise deals'
    ),
  ],
}

// ── Report 5005 — Technical Deep Dive · PASS ─────────────────────────────────
const r5005: DrilldownResult = {
  savedReportId: 5005,
  usecaseId: 105,
  date: '2026-05-02',
  closingJson: {
    session_type: 'Technical Deep Dive',
    evaluator: 'Rolplay AI Engine v3.2',
    audience_type: 'CTO + Engineering Lead',
    technical_depth_level: 'Advanced',
  },
  fields: [
    num('overall_score',              'Overall Score',              91),
    txt('overall_result',             'Overall Result',             'Pass'),
    num('technical_accuracy_score',   'Technical Accuracy',         94),
    num('architecture_explanation',   'Architecture Explanation',   89),
    num('security_positioning',       'Security & Compliance',      92),
    num('integration_knowledge',      'Integration Knowledge',      88),
    num('technical_storytelling',     'Technical Storytelling',     91),
    txt('audience_engagement',        'Audience Engagement',        'Highly engaged — multiple follow-up questions'),
    txt('technical_confidence',       'Technical Confidence',       'Expert-level command of subject matter'),
    long('strengths',                 'Strengths & Highlights',
      'Outstanding technical presentation with near-flawless accuracy on all platform architecture ' +
      'questions. The rep\'s explanation of the data isolation model — including multi-tenant ' +
      'architecture, field-level encryption, and SOC 2 Type II compliance posture — was clear, ' +
      'accurate, and appropriately detailed for a CTO-level audience.\n\n' +
      'The whiteboard sequence for explaining the AI evaluation engine (data flow → prompt engineering → ' +
      'scoring logic → calibration process) was the highlight of the session. The CTO persona asked ' +
      'four follow-up questions — a strong signal of genuine interest and credibility establishment.\n\n' +
      'Integration question handling was excellent: REST API documentation, webhook architecture, ' +
      'and the existing Salesforce + HubSpot connectors were presented with confidence and accuracy.'
    ),
    long('areas_for_improvement',     'Areas for Improvement',
      '1. **Non-Technical Stakeholder Translation**: When the session included the Finance lead ' +
      'persona, the rep struggled slightly to translate technical concepts into business value. ' +
      '"99.9% uptime SLA" should have been translated to: "That\'s less than 9 hours of downtime ' +
      'per year — your team will never wait on us."\n\n' +
      '2. **Competitive Differentiation**: Technical differentiators were described but not ' +
      'contrasted against alternatives. Prospects evaluating tech solutions appreciate side-by-side ' +
      'comparisons. Recommend developing a "vs. alternatives" technical battle card.'
    ),
    long('coaching_summary',          'AI Coaching Summary',
      'Exceptional session — 91st percentile overall for this advanced scenario. This rep has ' +
      'the technical depth to handle the most demanding prospect conversations.\n\n' +
      '**Recognition:** This score qualifies for Technical Expert certification path.\n\n' +
      '**Development Path:**\n' +
      '• "Executive Translation" module (bridging technical to financial language)\n' +
      '• Competitive Intelligence certification\n' +
      '• This rep should be designated as a Technical Champion resource for the team — ' +
      'available to join other reps\' technical calls'
    ),
  ],
}

// ── Reports 5006–5020 (condensed but realistic) ───────────────────────────────
function makeReport(
  id: number, ucId: number, score: number, date: string,
  ucName: string, sessionType: string,
): DrilldownResult {
  const passed = score >= 75
  const level  = score >= 90 ? 'Exceptional' : score >= 80 ? 'Strong' : passed ? 'Satisfactory' : 'Needs Improvement'
  const scoreLabel = passed ? 'Pass' : 'Fail'

  const interaction1 = Math.round(score * (0.95 + (id % 7) * 0.01))
  const interaction2 = Math.round(score * (0.88 + (id % 5) * 0.02))
  const interaction3 = Math.round(score * (0.92 + (id % 3) * 0.01))

  return {
    savedReportId: id,
    usecaseId:     ucId,
    date,
    closingJson: {
      session_type:     sessionType,
      evaluator:        'Rolplay AI Engine v3.2',
      performance_tier: level,
    },
    fields: [
      num('overall_score',     'Overall Score',      score),
      txt('overall_result',    'Overall Result',     scoreLabel),
      num('interaction_1',     'Interaction 1 Score', interaction1),
      num('interaction_2',     'Interaction 2 Score', interaction2),
      num('interaction_3',     'Interaction 3 Score', interaction3),
      txt('performance_level', 'Performance Level',   level),
      txt('use_case',          'Use Case',            ucName),
      long('strengths',        'Strengths & Highlights',
        passed
          ? `The representative demonstrated ${level.toLowerCase()} command of the core competencies ` +
            `required for ${sessionType}. Communication clarity, structure adherence, and prospect ` +
            `engagement were all highlights of this session. The ability to adapt the approach based ` +
            `on real-time feedback from the prospect persona showed genuine mastery of the scenario.`
          : `Despite not reaching the pass threshold, the rep showed promising development in several ` +
            `areas. The opening sequence and initial rapport building were well-executed, creating ` +
            `a positive first impression that a stronger core performance can be built upon.`
      ),
      long('areas_for_improvement', 'Areas for Improvement',
        passed
          ? `Primary growth opportunity: deepening ${ucName.toLowerCase().includes('objection') ? 'ROI calculation and value reframing' : 'executive-level communication and stakeholder alignment'}. ` +
            `Advancing to the next difficulty tier within this scenario is recommended as the immediate next step.`
          : `Core competency gap identified in ${ucName.toLowerCase().includes('discovery') ? 'needs identification and qualification depth' : 'structured handling of the primary scenario challenge'}. ` +
            `Targeted practice with specific coaching resources recommended before retaking this assessment.`
      ),
      long('coaching_summary', 'AI Coaching Summary',
        `**Session ${id} | ${ucName} | ${scoreLabel} (${score} pts)**\n\n` +
        (passed
          ? `Well-executed session with clear strengths to build on. ` +
            `Performance at the ${level.toLowerCase()} level positions this rep for continued advancement. ` +
            `Recommended next action: advance to the next difficulty level or take the certification exam for this scenario.`
          : `This session requires retake after completing the recommended development activities. ` +
            `With focused practice, passing this scenario within 2–3 weeks is an achievable target. ` +
            `The coaching resources linked in the LMS specifically address the identified gaps.`
        )
      ),
    ],
  }
}

const DATES = [
  '2026-05-01','2026-04-30','2026-04-29','2026-04-28','2026-04-27',
  '2026-04-26','2026-04-25','2026-04-24','2026-04-23','2026-04-22',
  '2026-04-21','2026-04-20','2026-04-19','2026-04-18','2026-04-17',
]

const SCORES = [82, 74, 93, 67, 88, 76, 91, 70, 85, 78, 96, 65, 83, 89, 72]
const UC_IDS = [101,102,103,104,105,101,102,103,104,105,101,102,103,104,105]
const UC_NAMES = SCORES.map((_, i) => {
  const id = UC_IDS[i]
  return id === 101 ? 'Discovery Call Mastery'
       : id === 102 ? 'Objection Handling Pro'
       : id === 103 ? 'Product Demo Excellence'
       : id === 104 ? 'Negotiation Techniques'
       :              'Technical Deep Dive'
})
const SESSION_TYPES = SCORES.map((_, i) => {
  const id = UC_IDS[i]
  return id === 101 ? 'Discovery Call'
       : id === 102 ? 'Objection Handling'
       : id === 103 ? 'Product Demo'
       : id === 104 ? 'Negotiation'
       :              'Technical Deep Dive'
})

const generatedReports = SCORES.map((score, i) =>
  makeReport(5006 + i, UC_IDS[i], score, DATES[i], UC_NAMES[i], SESSION_TYPES[i])
)

// ── Master report registry ─────────────────────────────────────────────────────
const ALL_REPORTS: DrilldownResult[] = [
  r5001, r5002, r5003, r5004, r5005,
  ...generatedReports,
]

const REPORT_MAP = new Map<number, DrilldownResult>(
  ALL_REPORTS.map(r => [r.savedReportId, r])
)

export function getDemoReport(id: number): DrilldownResult | null {
  return REPORT_MAP.get(id) ?? null
}

export { ALL_REPORTS }
