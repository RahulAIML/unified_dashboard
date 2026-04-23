# RolplayPro Analytics Dashboard

**Version:** 1.0 — Phase 1 Launch
**Author:** Diego Merigo
**Stack:** Next.js 16 · Shadcn UI · Recharts · Zustand · Framer Motion
**Architecture:** Standalone application (independent from coach / rolplay.pro)

---

## What This Is

The RolplayPro Unified Dashboard is a single analytics interface that gives clients real-time visibility into how their teams progress across all five core solutions:

| Solution | What it does |
|----------|-------------|
| **LMS** | Learning module assignments, completions, quiz scores |
| **Master Coach** | AI-powered coaching use cases and role-play conversations |
| **Practice Simulator** | Scored simulation sessions with pass/fail outcomes |
| **Expert Certification** | Formal evaluation sessions with rubric-based scoring |
| **Second Brain** | Knowledge base document indexing and retrieval |

One global dashboard, filterable by solution and date range. No five disconnected tools.

---

## Project Context

### Why it was built
Clients need visible ROI. Sales demos need a data story. The platform must feel like a unified ecosystem.

### Key constraints discovered during audit
- **No analytics backend exists.** Every endpoint must be built from scratch.
- **No user activity tracking.** The current privacy policy explicitly states this. Session timestamps, interaction counts, and page views cannot be collected until a privacy policy update is made and legal has reviewed it. All such metrics are deferred to **Phase 2**.
- **Standalone architecture.** Built as a separate Next.js app, embeddable when needed.
- **Platform transition.** Rolplay2 is the upcoming successor to `coach`. The dashboard is designed to align with Rolplay2's direction.

### Data availability tiers

| Tier | Label | Meaning |
|------|-------|---------|
| **T-A** | Available now | Derivable from existing transactional DB. Requires only an API endpoint. |
| **T-B** | Backend build required | Requires new aggregation queries on existing data. No privacy impact. |
| **T-C** | Deferred — Phase 2 | Requires session-level activity tracking + privacy policy update. Not in v1. |

Every KPI card in the dashboard is labeled with its tier.

---

## Project Structure

```
Rolplay_Dashboard_Project/
├── dashboard/                  ← Next.js app (the dashboard itself)
│   ├── app/
│   │   ├── page.tsx            ← Global Overview
│   │   ├── lms/page.tsx        ← LMS view
│   │   ├── coach/page.tsx      ← Master Coach view
│   │   ├── simulator/page.tsx  ← Practice Simulator view
│   │   ├── certification/      ← Expert Certification view
│   │   └── second-brain/       ← Second Brain view
│   ├── components/
│   │   ├── Sidebar.tsx         ← Navigation + dark mode toggle
│   │   ├── ThemeProvider.tsx   ← Light/dark persistence (localStorage)
│   │   ├── DashboardHeader.tsx ← Title + date presets + module filter
│   │   ├── SummaryCard.tsx     ← KPI card (value, delta %, tier badge)
│   │   ├── ChartCard.tsx       ← Chart wrapper with title/subtitle
│   │   ├── DataTable.tsx       ← Sortable, searchable, paginated table
│   │   ├── EmptyState.tsx      ← No-data placeholder
│   │   └── charts/
│   │       ├── ActivityLineChart.tsx   ← Area chart (trends over time)
│   │       ├── ModuleBarChart.tsx      ← Grouped bar (by module)
│   │       ├── StackedBarChart.tsx     ← Stacked bar (pass/fail)
│   │       └── DonutChart.tsx          ← Distribution donut
│   ├── lib/
│   │   ├── types.ts            ← All TypeScript types (mirroring DB schema)
│   │   ├── mock-data.ts        ← Structured mock data (real API shapes)
│   │   ├── store.ts            ← Zustand: selectedModules + dateRange
│   │   └── utils.ts            ← cn, fmt, deltaColor helpers
│   └── package.json
├── coach_app.sql               ← Full MySQL database schema (audited)
├── RolplayPro Dashboard Roadmap.docx
└── README.md                   ← This file
```

---

## Getting Started

```bash
cd dashboard
npm install
npm run dev
# → http://localhost:3000
```

### Build for production
```bash
npm run build
npm start
```

---

## Dashboard Features

### Global Overview (default landing page)
- 6 KPI summary cards with delta % vs prior period and tier badges
- Activity trend area chart (sessions over selected date range)
- Module distribution donut chart
- Grouped bar chart (sessions + passed, by solution)
- User summary table with pass rate badges

### Per-solution views (Coach / Simulator / Certification / Second Brain / LMS)
- Solution-specific KPI cards
- Primary chart relevant to each solution's data
- Detailed data table with search, sort, and pagination

### Filters (affect all data simultaneously)
- **Date presets:** 7 days / 30 days / 90 days
- **Module filter:** multi-select toggle on Global Overview
- Charts and KPI values update live on every filter change

### UI / UX
- Full **dark / light mode** with localStorage persistence
- **Framer Motion** animations: card entry, hover lift, table row fade
- Sticky header with backdrop blur
- Responsive: desktop + tablet
- Empty states for every view (e.g. LMS page with audit note)
- Phase 2 banners where activity tracking is required

---

## Data Layer

### Mock data (current state)
All data in `lib/mock-data.ts` uses **deterministic seeded pseudo-random values** — identical on server and client (no hydration errors). Every mock function accepts a `DateRange` and returns data scoped to that period.

### Swapping in real data
Each mock function has a clear signature and return type. To connect real data:

```ts
// Before (mock):
export function getSimulatorData(range: DateRange): SimulatorData {
  // ... seeded mock values
}

// After (real):
export async function getSimulatorData(range: DateRange): Promise<SimulatorData> {
  const res = await fetch(`/api/simulator?from=${range.from.toISOString()}&to=${range.to.toISOString()}`)
  return res.json()
}
```

The component shapes and TypeScript types stay unchanged.

### Planned API endpoints (to build in Week 2)

| Endpoint | Data source | Priority |
|----------|------------|---------|
| `GET /api/overview` | `coach_users`, `saved_reports`, `coach_usecase_user` | High |
| `GET /api/certification` | `saved_reports`, `coach_evaluation_sessions`, `segment_contents` | High |
| `GET /api/simulator` | `saved_reports`, `coach_usecases`, `coach_usecase_user` | High |
| `GET /api/coach` | `coach_usecases`, `coach_usecase_user`, `coach_teams`, `usecase_stages` | Medium |
| `GET /api/second-brain` | `segment_contents`, `usecase_segment`, `coach_usecases` | Medium |
| `GET /api/lms` | rolplay.pro DB — schema audit required | Low (blocked) |

All endpoints must accept `?from=&to=&customerId=` query parameters.

---

## KPI Reference

### Global
| KPI | Tier | SQL source |
|-----|------|-----------|
| Total Users | T-A | `COUNT(*) FROM coach_users` |
| Assigned to Scenarios | T-A | `COUNT(DISTINCT user_id) FROM coach_usecase_user` |
| Practice Sessions | T-A | `COUNT(*) FROM saved_reports` |
| Avg Session Score | T-B | `AVG(score) FROM saved_reports` |
| Overall Pass Rate | T-B | `SUM(passed_flag) / COUNT(*) FROM saved_reports` |
| Certified Users | T-A | `COUNT(DISTINCT coach_user_id) WHERE eval_session_id IS NOT NULL AND passed_flag = 1` |

### Expert Certification (richest data at launch)
| KPI | Tier | SQL source |
|-----|------|-----------|
| Candidates Evaluated | T-A | `COUNT(DISTINCT coach_user_id)` in `saved_reports` where `eval_session_id IS NOT NULL` |
| Pass Rate | T-B | `SUM(passed_flag=1) / COUNT(*)` filtered to eval sessions |
| Avg Score | T-B | `AVG(score)` filtered to eval sessions |
| Pending Evaluations | T-B | Users in `coach_usecase_user` with no matching `saved_reports` row |

### Practice Simulator
| KPI | Tier | SQL source |
|-----|------|-----------|
| Configured Scenarios | T-A | `COUNT(*) FROM coach_usecases` |
| Total Sessions | T-B | `COUNT(*) FROM saved_reports WHERE eval_session_id IS NULL` |
| Avg Score | T-B | `AVG(score) FROM saved_reports` |
| Pass Rate | T-B | `SUM(passed_flag) / COUNT(*)` |

### Master Coach
| KPI | Tier | SQL source |
|-----|------|-----------|
| Configured Use Cases | T-A | `COUNT(*) FROM coach_usecases` |
| Assigned Users | T-A | `COUNT(DISTINCT user_id) FROM coach_usecase_user` |
| Active Teams | T-A | `COUNT(*) FROM coach_teams` |
| Knowledge Stages | T-A | `COUNT(*) FROM usecase_stages` |

### Second Brain
| KPI | Tier | SQL source |
|-----|------|-----------|
| Knowledge Documents | T-A | `COUNT(*) FROM segment_contents` |
| File Types Indexed | T-A | `COUNT(DISTINCT file_extension) FROM segment_contents` |
| Content Segments | T-A | `COUNT(*) FROM segment_contents` |

---

## Phase 2 Roadmap (blocked on privacy decision)

These metrics require session-level activity tracking, which requires a privacy policy update and legal review before implementation can begin:

- Session duration and frequency per user
- Master Coach: questions asked, topics queried, session depth
- Second Brain: query volume, top searched topics, response satisfaction
- Practice Simulator: per-session score trends and improvement rate
- Cross-solution adoption rate (users active in 2+ solutions)
- AI-powered insight summaries

---

## Technology Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Framework | Next.js 16 (App Router) | SSR + static generation, production-ready |
| UI | Shadcn UI + Tailwind v4 | Composable, unstyled-first, easy to theme |
| Charts | Recharts | React-native, lightweight, composable |
| State | Zustand | Minimal, no boilerplate, perfect for filter state |
| Animations | Framer Motion | Production-quality, declarative |
| Theme | oklch color space (Shadcn v4) | Perceptually uniform, great dark mode |
