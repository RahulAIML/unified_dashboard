// ─────────────────────────────────────────────────────────────
//  Translations — EN / ES
//  Usage:
//    import { useT } from '@/lib/lang-store'
//    const t = useT()
//    <h2>{t.totalUsers}</h2>
// ─────────────────────────────────────────────────────────────

export const translations = {
  en: {
    // ── Navigation ───────────────────────────────────────────
    navOverview:     'Overview',
    navLms:          'LMS',
    navCoach:        'Master Coach',
    navSimulator:    'Simulator',
    navCertification:'Certification',
    navSecondBrain:  'Second Brain',
    navSettings:     'Settings',
    lightMode:       'Light mode',
    darkMode:        'Dark mode',
    phaseLabel:      'v1.0 · Phase 1 Launch',

    // ── Global filter bar ────────────────────────────────────
    filterSolutions: 'Solutions',
    last:            'last',
    days:            'days',

    // ── Page titles / subtitles ──────────────────────────────
    overviewTitle:   'Global Overview',
    overviewSub:     'Platform-wide analytics across all solutions',
    lmsTitle:        'LMS',
    lmsSub:          'Learning module assignments and completions',
    coachTitle:      'Master Coach',
    coachSub:        'Use case configurations and user assignments',
    simTitle:        'Practice Simulator',
    simSub:          'Scenario sessions, scores, and pass rates',
    certTitle:       'Expert Certification',
    certSub:         'Evaluation results, pass rates, and score distributions',
    sbTitle:         'Second Brain',
    sbSub:           'Knowledge base content inventory and document tracking',
    settingsTitle:   'Settings',
    settingsSub:     'Customize the dashboard look and feel for each client',
    brandColors:     'Brand Colors',
    brandColorsSub:  'Set the primary brand color used across the dashboard',

    // ── KPI card labels ──────────────────────────────────────
    totalUsers:           'Total Users',
    assignedToScenarios:  'Assigned to Scenarios',
    practiceSessions:     'Practice Sessions',
    avgSessionScore:      'Avg Session Score',
    overallPassRate:      'Overall Pass Rate',
    certifiedUsers:       'Certified Users',
    configuredUseCases:   'Configured Use Cases',
    assignedUsers:        'Assigned Users',
    activeTeams:          'Active Teams',
    knowledgeStages:      'Knowledge Stages',
    configuredScenarios:  'Configured Scenarios',
    totalSessions:        'Total Sessions',
    avgScore:             'Avg Score',
    candidatesEvaluated:  'Candidates Evaluated',
    passRate:             'Pass Rate',
    pendingEvaluations:   'Pending Evaluations',
    knowledgeDocuments:   'Knowledge Documents',
    fileTypesIndexed:     'File Types Indexed',
    contentSegments:      'Content Segments',
    avgSegmentsPerUsecase:'Avg Segments / Use Case',
    enrolledUsers:        'Enrolled Users',
    completionRate:       'Completion Rate',
    avgQuizScore:         'Avg Quiz Score',
    modulesCompleted:     'Modules Completed',
    vsPrior:              'vs prior period',

    // ── Chart titles ─────────────────────────────────────────
    activityTrend:        'Activity Trend',
    activityTrendSub:     'Daily sessions',
    moduleDistribution:   'Module Distribution',
    moduleDistSub:        'Sessions by solution',
    sessionsByModule:     'Sessions by Module',
    sessionsByModuleSub:  'Total vs passed per solution',
    useCaseDeployment:    'Use Case Deployment Over Time',
    useCaseDeploymentSub: 'Cumulative use cases configured',
    scoreTrend:           'Average Score Trend',
    scoreTrendSub:        'Rolling avg score',
    passFailOverTime:     'Pass / Fail Over Time',
    passFailSub:          'Daily evaluations',
    documentUploads:      'Document Uploads Over Time',
    documentUploadsSub:   'New docs added',

    // ── Section headers ──────────────────────────────────────
    userSummary:          'User Summary',
    userSummarySub:       'Session activity for the last',
    useCaseInventory:     'Use Case Inventory',
    useCaseInventorySub:  'All configured coach use cases with assignment details',
    scenarioBreakdown:    'Scenario Breakdown',
    scenarioBreakdownSub: 'Sessions and scores for the last',
    evaluationResults:    'Evaluation Results',
    evaluationsSub:       'evaluations in the last',
    documentInventory:    'Document Inventory',
    documentsSub:         'documents added in the last',
    documentsSubAll:      'documents in total',

    // ── Table headers ────────────────────────────────────────
    colUser:         'User',
    colScenarios:    'Scenarios',
    colSessions:     'Sessions',
    colAvgScore:     'Avg Score',
    colPassRate:     'Pass Rate',
    colJoined:       'Joined',
    colUseCase:      'Use Case',
    colUsers:        'Users',
    colStages:       'Stages',
    colMode:         'Mode',
    colCreated:      'Created',
    colScenario:     'Scenario',
    colLastActive:   'Last Active',
    colCandidate:    'Candidate',
    colSegment:      'Segment',
    colScore:        'Score',
    colResult:       'Result',
    colDate:         'Date',
    colDocument:     'Document',
    colType:         'Type',
    colSegments:     'Segments',
    colDateAdded:    'Date Added',

    // ── Table / DataTable UI ─────────────────────────────────
    searchPlaceholder: 'Search…',
    showing:           'Showing',
    of:                'of',
    usersLabel:        'users',
    pageLabel:         'Page',
    prev:              'Prev',
    next:              'Next',

    // ── Phase 2 banners ──────────────────────────────────────
    phase2Note:       'Phase 2 note',
    phase2Coach:      'Activity metrics (sessions started, questions asked, topics queried) require activity tracking infrastructure and a privacy policy update. Deferred to Phase 2.',
    phase2SB:         'Query analytics (total queries, top topics, satisfaction scores) require activity tracking infrastructure. Deferred to Phase 2.',

    // ── LMS empty state ──────────────────────────────────────
    lmsNoData:        'LMS data not available',
    lmsNoDataSub:     'LMS modules, completions, and quiz scores are stored in the rolplay.pro database — a separate schema from coach_app. A dedicated schema audit and backend endpoint are required before this view can show real data.',
    lmsAuditNeeded:   'Schema audit required',

    // ── Source badges ────────────────────────────────────────
    sourceUsers:      'Source: coach_users + saved_reports',
    sourceCoach:      'Source: coach_usecases + coach_usecase_user',
    sourceSim:        'Source: rolplay_pro_analytics · report_field_current',
    sourceCert:       'Source: rolplay_pro_analytics · report_field_current',
    sourceSB:         'Source: segment_contents + usecase_segment + coach_usecases',

    // ── Loading / error / empty states ───────────────────────
    loading:          'Loading…',
    errorLoading:     'Failed to load data',
    noData:           'No data for this period',
    retryLabel:       'Retry',

    // ── Real-data column labels ───────────────────────────────
    colReportId:      'Report ID',
    colUsecaseId:     'Use Case ID',
    colEvaluations:   'Evaluations',
    colAvgScoreShort: 'Avg Score',
    colPassed:        'Passed',

    // ── Evaluation results ────────────────────────────────────
    passLabel:        'PASS',
    failLabel:        'FAIL',
    evalCountTrend:   'Daily Evaluations',
    evalCountSub:     'Evaluations submitted per day',
    usecaseBreakdown: 'Use Case Breakdown',
    usecaseBreakdownSub: 'Score and pass rate by use case',
  },

  es: {
    // ── Navigation ───────────────────────────────────────────
    navOverview:     'Resumen',
    navLms:          'LMS',
    navCoach:        'Coach Experto',
    navSimulator:    'Simulador',
    navCertification:'Certificación',
    navSecondBrain:  'Segunda Mente',
    navSettings:     'Ajustes',
    lightMode:       'Modo claro',
    darkMode:        'Modo oscuro',
    phaseLabel:      'v1.0 · Fase 1 Lanzamiento',

    // ── Global filter bar ────────────────────────────────────
    filterSolutions: 'Soluciones',
    last:            'últimos',
    days:            'días',

    // ── Page titles / subtitles ──────────────────────────────
    overviewTitle:   'Resumen Global',
    overviewSub:     'Analítica de toda la plataforma en todas las soluciones',
    lmsTitle:        'LMS',
    lmsSub:          'Asignaciones y completaciones de módulos de aprendizaje',
    coachTitle:      'Coach Experto',
    coachSub:        'Configuraciones de casos de uso y asignaciones de usuarios',
    simTitle:        'Simulador de Práctica',
    simSub:          'Sesiones de escenarios, puntuaciones y tasas de aprobación',
    certTitle:       'Certificación Experta',
    certSub:         'Resultados de evaluaciones, tasas de aprobación y distribución de puntuaciones',
    sbTitle:         'Segunda Mente',
    sbSub:           'Inventario de base de conocimiento y seguimiento de documentos',
    settingsTitle:   'Ajustes',
    settingsSub:     'Personaliza el aspecto del panel para cada cliente',
    brandColors:     'Colores de Marca',
    brandColorsSub:  'Define el color principal utilizado en todo el panel',

    // ── KPI card labels ──────────────────────────────────────
    totalUsers:           'Usuarios Totales',
    assignedToScenarios:  'Asignados a Escenarios',
    practiceSessions:     'Sesiones de Práctica',
    avgSessionScore:      'Puntuación Media de Sesión',
    overallPassRate:      'Tasa de Aprobación Global',
    certifiedUsers:       'Usuarios Certificados',
    configuredUseCases:   'Casos de Uso Configurados',
    assignedUsers:        'Usuarios Asignados',
    activeTeams:          'Equipos Activos',
    knowledgeStages:      'Etapas de Conocimiento',
    configuredScenarios:  'Escenarios Configurados',
    totalSessions:        'Sesiones Totales',
    avgScore:             'Puntuación Media',
    candidatesEvaluated:  'Candidatos Evaluados',
    passRate:             'Tasa de Aprobación',
    pendingEvaluations:   'Evaluaciones Pendientes',
    knowledgeDocuments:   'Documentos de Conocimiento',
    fileTypesIndexed:     'Tipos de Archivo Indexados',
    contentSegments:      'Segmentos de Contenido',
    avgSegmentsPerUsecase:'Prom. Segmentos / Caso de Uso',
    enrolledUsers:        'Usuarios Matriculados',
    completionRate:       'Tasa de Completación',
    avgQuizScore:         'Puntuación Media de Cuestionario',
    modulesCompleted:     'Módulos Completados',
    vsPrior:              'vs período anterior',

    // ── Chart titles ─────────────────────────────────────────
    activityTrend:        'Tendencia de Actividad',
    activityTrendSub:     'Sesiones diarias',
    moduleDistribution:   'Distribución por Módulo',
    moduleDistSub:        'Sesiones por solución',
    sessionsByModule:     'Sesiones por Módulo',
    sessionsByModuleSub:  'Total vs aprobadas por solución',
    useCaseDeployment:    'Despliegue de Casos de Uso',
    useCaseDeploymentSub: 'Casos de uso configurados acumulados',
    scoreTrend:           'Tendencia de Puntuación Media',
    scoreTrendSub:        'Puntuación media acumulada',
    passFailOverTime:     'Aprobados / Reprobados en el Tiempo',
    passFailSub:          'Evaluaciones diarias',
    documentUploads:      'Documentos Subidos en el Tiempo',
    documentUploadsSub:   'Nuevos documentos añadidos',

    // ── Section headers ──────────────────────────────────────
    userSummary:          'Resumen de Usuarios',
    userSummarySub:       'Actividad de sesiones de los últimos',
    useCaseInventory:     'Inventario de Casos de Uso',
    useCaseInventorySub:  'Todos los casos de uso configurados con detalles de asignación',
    scenarioBreakdown:    'Desglose de Escenarios',
    scenarioBreakdownSub: 'Sesiones y puntuaciones de los últimos',
    evaluationResults:    'Resultados de Evaluación',
    evaluationsSub:       'evaluaciones en los últimos',
    documentInventory:    'Inventario de Documentos',
    documentsSub:         'documentos añadidos en los últimos',
    documentsSubAll:      'documentos en total',

    // ── Table headers ────────────────────────────────────────
    colUser:         'Usuario',
    colScenarios:    'Escenarios',
    colSessions:     'Sesiones',
    colAvgScore:     'Punt. Media',
    colPassRate:     'Tasa Aprob.',
    colJoined:       'Registrado',
    colUseCase:      'Caso de Uso',
    colUsers:        'Usuarios',
    colStages:       'Etapas',
    colMode:         'Modo',
    colCreated:      'Creado',
    colScenario:     'Escenario',
    colLastActive:   'Última Actividad',
    colCandidate:    'Candidato',
    colSegment:      'Segmento',
    colScore:        'Puntuación',
    colResult:       'Resultado',
    colDate:         'Fecha',
    colDocument:     'Documento',
    colType:         'Tipo',
    colSegments:     'Segmentos',
    colDateAdded:    'Fecha Añadido',

    // ── Table / DataTable UI ─────────────────────────────────
    searchPlaceholder: 'Buscar…',
    showing:           'Mostrando',
    of:                'de',
    usersLabel:        'usuarios',
    pageLabel:         'Página',
    prev:              'Ant.',
    next:              'Sig.',

    // ── Phase 2 banners ──────────────────────────────────────
    phase2Note:       'Nota Fase 2',
    phase2Coach:      'Las métricas de actividad (sesiones iniciadas, preguntas realizadas, temas consultados) requieren infraestructura de seguimiento y actualización de la política de privacidad. Diferidas a la Fase 2.',
    phase2SB:         'Las analíticas de consultas (total de consultas, temas principales, satisfacción) requieren infraestructura de seguimiento. Diferidas a la Fase 2.',

    // ── LMS empty state ──────────────────────────────────────
    lmsNoData:        'Datos de LMS no disponibles',
    lmsNoDataSub:     'Los módulos LMS, completaciones y puntuaciones de cuestionarios están almacenados en la base de datos de rolplay.pro — un esquema separado de coach_app. Se requiere una auditoría de esquema dedicada antes de que esta vista pueda mostrar datos reales.',
    lmsAuditNeeded:   'Auditoría de esquema requerida',

    // ── Source badges ────────────────────────────────────────
    sourceUsers:      'Fuente: coach_users + saved_reports',
    sourceCoach:      'Fuente: coach_usecases + coach_usecase_user',
    sourceSim:        'Fuente: rolplay_pro_analytics · report_field_current',
    sourceCert:       'Fuente: rolplay_pro_analytics · report_field_current',
    sourceSB:         'Fuente: segment_contents + usecase_segment + coach_usecases',

    // ── Loading / error / empty states ───────────────────────
    loading:          'Cargando…',
    errorLoading:     'Error al cargar los datos',
    noData:           'Sin datos para este período',
    retryLabel:       'Reintentar',

    // ── Real-data column labels ───────────────────────────────
    colReportId:      'ID Reporte',
    colUsecaseId:     'ID Caso de Uso',
    colEvaluations:   'Evaluaciones',
    colAvgScoreShort: 'Punt. Media',
    colPassed:        'Aprobados',

    // ── Evaluation results ────────────────────────────────────
    passLabel:        'APROBADO',
    failLabel:        'REPROBADO',
    evalCountTrend:   'Evaluaciones Diarias',
    evalCountSub:     'Evaluaciones enviadas por día',
    usecaseBreakdown: 'Desglose por Caso de Uso',
    usecaseBreakdownSub: 'Puntuación y tasa de aprobación por caso de uso',
  },
} as const

export type Lang = keyof typeof translations
export type TranslationKey = keyof typeof translations.en
export type T = typeof translations.en


