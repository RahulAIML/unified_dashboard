# Sanfer dashboard (sanfer-dashboard.onrender.com) — full page & KPI inventory

Captured live 2026-07-21 from the standalone Sanfer deploy (v2.0.0), for parity
in the unified dashboard. This is the per-service Simulator dashboard; every
page below is scoped to ONE tenant (Sanfer). Sidebar groups: SIMULADOR /
PLATAFORMA / MÁS. Global controls in the header: refresh, dark-mode toggle,
ES/EN language switch.

## 1. Vista General (`/`)
- Welcome banner: "N simulaciones en el período · N asesores activos".
- Period filter bar: All / 7D / 15D / 3M / 6M / 12M + custom date range; "Asesores" (advisors) dropdown; "Sim. CSV" export.
- 6 KPI tiles, each with MoM delta (↑/↓ vs mes anterior):
  1. Total Simulaciones (2583)  2. Puntaje Promedio (92%)  3. Asesores Activos (889)
  4. % Certificación (94%)  5. Total Actividades (45 = "15 líneas × 3 simuladores")  6. Total Participantes (915)
- "Tendencia de Puntaje" area chart with a **Meta 75%** goal line.
- ⚠️ Two lower chart cards never rendered (stuck skeleton) — real load/timeout bug on this deploy.

## 2. Certificación (`/certification`)
- Active-period badge ("1 jun 2026 – presente").
- 5 tiles: Líneas (15), Ejercicios asignados (45), Jefes de Capacitación (5), Sesiones en el período (2583), Certificados (858).
- "Avance de certificación" progress bar: `completed / (asesores × 3 simuladores)` with % and formula caption.
- "Asesores Certificados" grouped by business line (e.g. Minotauros (ENIF) 77); each advisor chip shows their 3 simulator scores. Rule caption: "Certificado = completó los 3 simuladores asignados a su línea durante el período."

## 3. Simulaciones (`/simulations`)
- Search box + period filter + custom date range + "Approval criteria" dropdown + total count.
- Session log table: Adviser · Activity · Date · Score(%) · expand chevron (per-session drilldown).

## 4. Inteligencia Conversacional (`/conversational`)
- Header chips: N interacciones activas · Prom. puntos (0.72) · Prom. aprobación (72%).
- Radar "Perfil de Interacciones" (Puntaje Prom. + Tasa Aprobación per interaction 1–5).
- Bar chart "Puntuación por Interacción".
- "Detalle por Interacción" table: Interaction · Evaluations · Average score · Approval Rate.
- "Handling Objections" — success rate by physician objection type; MORE DIFFICULT vs EASIER columns; "Worst first" sort; full table: # · Doctor's Objection · Simulator · Times · Success Rate.

## 5. Coaching IA (`/coaching`)
- 3 cards: Fortalezas (top 5 performers), Áreas de Mejora (bottom 5), Consejos de Coaching (auto-generated text advice referencing weakest interactions, materials to review, and target vs platform avg).

## 6. Clasificación (`/leaderboard`)
- "Estadísticas históricas — todos los simuladores": Registros Totales (best attempt per asesor×sim), Promedio Mejor Intento (92%), Registros ≥80% (+ % of total), Asesores Activos (+ distinct simulators).
- "Clasificación — periodo seleccionado": search + filter dropdown; ranking table Pos · Asesor · Simulaciones · Prom. Puntaje · Mejor; medals for top 3.

## 7. Actividades (`/activities`)
- "Desglose por Actividad" bar chart across all ~45 activities.
- Per-activity card grid: Simulations · Average Score · Approval Rate · pass/fail counts (✓/✗); tagged by type (Certification).

## 8. Organización (`/organization`)
- 3 tiles: Administradores (77), Supervisores (17), Total Participantes (915).
- "Estructura Organizacional" hierarchical tree: user + email + role badge (Tenant / Admin / Enradmin / Supervisor) + count.

## 9. Líneas de Negocio (`/business-lines`)
- 3 tiles: Total Líneas (32), Líneas Activas (15), Mejor Línea (name + avg%).
- Horizontal bars: Simulaciones por Línea; Puntaje Promedio por Línea.
- Radar "Comparación por Línea (Top 6)".
- "Detalle por Línea" table.

## 10. Reportes (`/reports`)
- 4 tiles: Simulaciones · Usuarios Activos · Actividades · Miembros.
- "Exportar datos": Resumen Simulador (CSV), Detalle de Simulaciones (CSV).
- "Plantillas de reporte" (all "Próximamente"/Soon): Reporte Ejecutivo Semanal, Análisis por Línea de Negocio, Rendimiento por Administrador, Progresión de Asesores.

## 11. Configuración (`/settings`)
- Apariencia (theme: Claro/Oscuro), Idioma (Español/English), Plataforma (Nombre: "Sanfer Inteligencia de Entrenamiento IA", Versión 2.0.0).
- Note: "Configuraciones avanzadas de usuarios, permisos y notificaciones … en futuras versiones."

---

# Reference dashboards compared (Sanfer / Apotex / Siigo / M8)

Explored live 2026-07-21. All four are the SAME per-simulator analytics template,
themed + scoped per tenant. They are organized as sub-VIEWS of one simulator
product — NOT by solution like the unified platform.

| Dashboard | URL | Theme | Accent | Nav scope | Overview |
|-----------|-----|-------|--------|-----------|----------|
| Sanfer | sanfer-dashboard.onrender.com | Light | Red | Full + Certification | 6 KPI + trend(goal line) |
| Apotex | apotex-dashboard.vercel.app | Light | Blue | Full − Certification | **Richest** |
| Siigo | siigo-dashboard.onrender.com | Dark | Blue | Lean (no coaching/lines/cert) | 6 KPI + trend + approval |
| M8 | m8-pharma-dashboard.onrender.com | Dark | Red | Full | 6 KPI + trend + approval |

## Apotex Overview — the richest target (widgets beyond Sanfer)
- KPI tiles: Total Simulaciones, Puntaje Promedio, Tasa de Aprobación, Asesores Activos, Actividades, Miembros — each w/ MoM %.
- "Tendencia de Puntaje" line chart with **Este período vs Anterior vs Goal** + **Daily/Weekly/Monthly** granularity dropdown.
- "Aprobación vs. Reprobación" **donut** (Aprobados/Reprobados counts + %).
- "Desglose por Actividad" — top-5 activities w/ % bars + "Ver todas" link.
- "Mejores Desempeños" — ranked top performers (avatar, sims, score, ↑approval) + "Ver todos" link.
- "Perspectivas IA" — AI insight warnings + RECOMENDACIÓN text + "Ver todo" link.
- Header: user-account menu, ES/EN, dark toggle, refresh.

## Session drilldown (Apotex Simulaciones — verified working)
- Row expand chevron opens an inline detail: header (name, email, activity, slug, date, %pass/fail, Sim ID) + "Descargar sesión" button.
- Then per-interaction cards INTERACCIÓN 1..N, each w/ score (e.g. 2/10), the AI evaluator prompt, and the advisor's quoted reply. = full conversation transcript w/ per-step scoring.
- Simulaciones table adds a STATE badge (Passed/Failed) + email/slug sublines vs Sanfer.

## Deploy-specific notes
- Apotex (Vercel) 404s on direct deep-links — client-side routing w/o rewrites; must navigate via sidebar. (Their bug, not ours.)
- Siigo/M8 on onrender free tier: ~20s cold start.

# Current unified platform — baseline (what already exists)
- Organized BY SOLUTION (LMS / Master Coach / Simulator / Certification / Second Brain) with a module filter, NOT per-view nav.
- Overview (`components/DashboardContent.tsx`) already has: KPI tiles, trend line, donut, module bar chart, data table w/ **drilldown** (`/drilldown/[id]`), export, Second Brain metrics, best performers.
- Pages present: certification, coach, lms, simulator, second-brain, settings, drilldown/[id], auth.
- Gaps vs reference: per-view breakout pages (Conversational/Activities/Org/Business-Lines/Reports as first-class), richer overview (period-vs-prev + granularity, top-performers panel, AI-insights panel), per-brand accent theming + polished dark mode, session drilldown transcript styling.

## Observed bugs on this deploy (for parity, fix in unified)
- Vista General: bottom two charts stuck in skeleton (never load).
- Actividades: main "Desglose por Actividad" bar chart renders axes but no bars.
- Both likely slow/failed data fetches on the onrender free tier.
