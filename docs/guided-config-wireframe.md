# Guided configuration flow — wireframe

Goal: a non-technical teammate configures a client's dashboard in minutes.
Three steps: **pick contracted services → enter the identifier → fetch data**.

Deliberately simple: one page, three sections revealed in order, no wizard
framework, no extra routes. It extends the existing `/dashboard-builder` page
rather than adding a competing flow.

---

## Step 1 — Which services has the client contracted?

```
┌───────────────────────────────────────────────────────────────────┐
│  New client dashboard                                    Step 1/3 │
├───────────────────────────────────────────────────────────────────┤
│  Which Rolplay services does this client have?                    │
│                                                                   │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│   │ ☑ Simulator  │ │ ☑ Master     │ │ ☐ Certifier  │              │
│   │              │ │   Coach      │ │   Coach      │              │
│   └──────────────┘ └──────────────┘ └──────────────┘              │
│   ┌──────────────┐ ┌──────────────┐                               │
│   │ ☐ LMS        │ │ ☑ Second     │                               │
│   │              │ │   Brain      │                               │
│   └──────────────┘ └──────────────┘                               │
│                                                                   │
│   ⓘ Only the selected services appear on their dashboard.          │
│     Not sure? Leave all selected — we detect what has data.        │
│                                                                   │
│                                          [ Continue → ]           │
└───────────────────────────────────────────────────────────────────┘
```

- Multi-select cards (big click targets, not a dropdown).
- Default = all selected, so a rushed user can't create an empty dashboard.
- This is the **contracted** set; the platform still verifies which of those
  actually have data (see `/api/dashboard/modules`), so a service that is
  contracted-but-empty never renders a blank tab.

## Step 2 — Identifier

```
┌───────────────────────────────────────────────────────────────────┐
│  New client dashboard                                    Step 2/3 │
├───────────────────────────────────────────────────────────────────┤
│  Company name                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Acme Pharma                                                 │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Company email domain            (recommended)                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ acmepharma.com                                              │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  Everyone signing in with this domain sees this dashboard.         │
│  Leave blank and we derive it from their users.                    │
│                                                                   │
│  ▸ Advanced (optional)                                            │
│      Exercise / activity IDs   ┌──────────────────────────────┐    │
│                               │ 235, 236, 237                │    │
│                               └──────────────────────────────┘    │
│      Second Brain admin email  ┌──────────────────────────────┐    │
│                               │ admin@acmepharma.com         │    │
│                               └──────────────────────────────┘    │
│                                                                   │
│                            [ ← Back ]  [ Fetch data → ]           │
└───────────────────────────────────────────────────────────────────┘
```

- **Company name is the only required field.** Everything else is optional
  because the platform can discover it:
  - `client_id` ← looked up from the name on the query-endpoint platform
  - login domain ← derived from the client's real users if left blank
  - exercise IDs ← discovered per connector
- Advanced fields exist only for the exceptions (a Second Brain owner email that
  doesn't follow the convention, or a client whose IDs must be pinned).

## Step 3 — Fetch + review, then publish

```
┌───────────────────────────────────────────────────────────────────┐
│  New client dashboard                                    Step 3/3 │
├───────────────────────────────────────────────────────────────────┤
│  ✓ Found "Acme Pharma"  ·  client_id 41  ·  domain acmepharma.com │
│  ✓ Simulator      1,284 sessions   avg 78.4                       │
│  ✓ Master Coach     312 sessions   avg 81.0                       │
│  ✓ Second Brain      44 members                                   │
│  ⚠ Certifier Coach   no data yet — will stay hidden               │
│  — LMS             not contracted                                 │
│                                                                   │
│  ┌─ Preview ───────────────────────────────────────────────────┐  │
│  │  [ KPI ] [ KPI ] [ KPI ] [ KPI ]                            │  │
│  │  [ ~~ score trend ~~~~~~~~~~~~ ] [ ◕ approval ]             │  │
│  │  [ ▤ per-activity breakdown    ] [ ≡ sessions ]              │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│                     [ ← Back ]   [ Publish dashboard ]            │
└───────────────────────────────────────────────────────────────────┘
```

- Each line is a real probe result, so the user sees **before** publishing what
  the client will get — including honest "no data yet" / "not contracted".
- Publish registers login routing (domain → client), so their users can sign in
  immediately. Failure states say what is missing instead of claiming success.

---

## Rules that keep it simple

1. **One required field** (company name). Everything else is discovered.
2. **Never invent data** — a contracted service with no data is shown as hidden,
   not as a zero.
3. **Contracted ∩ has-data = rendered.** Step 1 is intent; the platform verifies.
4. **No new route.** Steps 1–3 are sections of `/dashboard-builder`.
5. Wide/rare options live behind **Advanced**, collapsed by default.

## Mapping to existing endpoints

| Step | Uses |
|------|------|
| 1 · services | `services[]` on the generate request (contracted set) |
| 2 · identifier | `POST /ai/generate-dashboard` `{company, domains[], exercise_ids[]}` |
| 3 · fetch/preview | `GET /ai/status/{job_id}` (discovery + per-widget live preview) |
| 3 · publish | `POST /ai/publish` → registers tenant + domain routing |
| runtime | `GET /api/dashboard/modules` (contracted ∩ has-data) |
