"""Score extraction for the rolplay.app query-endpoint platform.

Mirrors SCORE_SQL in the Next.js runtime (lib/bridge-rolplay-app.ts). The legacy
r_user_session.score column is essentially never populated, but the real 0-100
overall score IS available:
  1. raw_closing_data JSON -> "overall_score"  (all new sessions; generic)
  2. closing_analysis HTML score element        (legacy sessions; per-template)
HTML markup differs per report template, so a short explicit marker list covers
the known ones (Siigo / M8 / Takeda). Kept in sync with the TS version.
"""

# A SQL expression yielding a 0-100 score for r_user_session row aliased `s`, or NULL.
SCORE_SQL = """CASE
  WHEN JSON_VALID(s.raw_closing_data)
       AND JSON_EXTRACT(s.raw_closing_data,'$.overall_score') IS NOT NULL
       AND JSON_UNQUOTE(JSON_EXTRACT(s.raw_closing_data,'$.overall_score')) REGEXP '^[0-9]+([.][0-9]+)?$'
    THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(s.raw_closing_data,'$.overall_score')) AS DECIMAL(6,2))
  WHEN LOCATE('rp-sim-report-score-number">', s.closing_analysis) > 0
    THEN CAST(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(s.closing_analysis,'rp-sim-report-score-number">',-1),'<',1)) AS DECIMAL(6,2))
  WHEN LOCATE('rpt-score-num">', s.closing_analysis) > 0
    THEN CAST(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(s.closing_analysis,'rpt-score-num">',-1),'<',1)) AS DECIMAL(6,2))
  WHEN LOCATE('total-score">', s.closing_analysis) > 0
    THEN CAST(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(s.closing_analysis,'total-score">',-1),'<',1),'/',1)) AS DECIMAL(6,2))
  ELSE NULL
END"""

PASS_THRESHOLD = 70
"""
Score-stats subquery for a client. Wrap as:
  SELECT COUNT(*) total, COUNT(sc) scored, ROUND(AVG(sc),2) avg_score,
         SUM(CASE WHEN sc>=70 THEN 1 ELSE 0 END) passed
  FROM ( <scoreStatsInner(client_id)> ) t
"""


def score_stats_inner(client_id: int) -> str:
    return (
        f"SELECT {SCORE_SQL} AS sc "
        "FROM r_user_session s JOIN r_user u ON u.ID=s.user_id "
        f"WHERE u.client_id={int(client_id)}"
    )


def score_stats_sql(client_id: int) -> str:
    return (
        "SELECT COUNT(*) total, COUNT(sc) scored, ROUND(AVG(sc),2) avg_score, "
        f"SUM(CASE WHEN sc>={PASS_THRESHOLD} THEN 1 ELSE 0 END) passed "
        f"FROM ({score_stats_inner(client_id)}) t"
    )
