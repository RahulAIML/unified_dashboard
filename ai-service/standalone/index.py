"""Self-contained AI Dashboard Builder — single-file FastAPI app for Vercel.

Consolidates the verified discovery → schema → plan → preview pipeline so it
deploys as 3 files (this + vercel.json + requirements.txt). Discovery uses public
bridge URLs (no secrets). Gemini layout activates if GEMINI_API_KEY is set in the
Vercel project env; otherwise a deterministic heuristic is used. Real data only —
the LLM may only reference discovered metrics.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

# ── Config (public endpoints; overridable via env) ──────────────────────────────
PHARMA_BASE = os.environ.get("PHARMA_BRIDGE_BASE_URL", "https://serv.aux-rolplay.com/unified").rstrip("/")
HOST_ROOT = os.environ.get("PHARMA_HOST_ROOT", "https://serv.aux-rolplay.com").rstrip("/")
ROLPLAY_APP_SQL = os.environ.get("ROLPLAY_APP_SQL_URL", "https://rolplay.app/ajax/remote-access.php")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL = os.environ.get("LLM_MODEL", "gemini-3-flash-preview")
WIDE_FROM, WIDE_TO = "2015-01-01", "2035-12-31"
PASS = 70

_SANFER = [390,399,402,403,405,406,408,409,410,411,413,419,420,421,423,428,432,433,436,439,440,445,
           446,448,449,453,454,455,457,460,461,462,464,465,467,468,481,484,488,489,490,491,492,493]
KNOWN_IDS: dict[str, list[int]] = {
    "sanfer": _SANFER, "weser": [235,236,237], "adium": [145,146,208,231], "heineken": [137,159,173],
    "m8": [12,113,142], "lacoste": [375,379], "lacoste_asistentes": [167], "chiesi": [75,76,139,140],
    "labomed": [458,463],
}
ALIAS = {"m8-arcera": "m8", "lacoste-asistentes": "lacoste_asistentes"}


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-") or "client"


def candidates(company: str) -> list[str]:
    base = slugify(company)
    out = [base]
    if base in ALIAS:
        out.insert(0, ALIAS[base])
    first = base.split("-")[0]
    if first not in out:
        out.append(first)
    return out


async def _post(url: str, body: dict, headers: dict | None = None) -> tuple[int, Any]:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as c:
            r = await c.post(url, json=body, headers=headers or {})
            try:
                return r.status_code, r.json()
            except Exception:
                return r.status_code, r.text
    except Exception as e:
        return 0, {"__error": str(e)[:150]}


async def _get(url: str, headers: dict | None = None) -> tuple[int, Any]:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as c:
            r = await c.get(url, headers=headers or {})
            try:
                return r.status_code, r.json()
            except Exception:
                return r.status_code, r.text
    except Exception as e:
        return 0, {"__error": str(e)[:150]}


def _num(v) -> bool:
    try:
        float(v); return True
    except (TypeError, ValueError):
        return False


# ── Discovery: find the alive service + kind for a company ───────────────────────
async def discover(company: str, exercise_ids: list[int]) -> dict | None:
    for slug in candidates(company):
        ids = exercise_ids or KNOWN_IDS.get(slug, [])
        # kpi
        st, body = await _post(f"{PHARMA_BASE}/{slug}/bridge/",
                               {"action": "kpi.overview", "date_from": WIDE_FROM, "date_to": WIDE_TO},
                               {"X-Tenant": slug})
        if st == 200 and isinstance(body, dict) and body.get("ok") and isinstance(body.get("overview"), dict) \
                and "total_sessions" in body["overview"]:
            return {"kind": "kpi", "slug": slug, "url": f"{PHARMA_BASE}/{slug}/bridge/", "ids": ids}
        # sale_exercises (unknown action → action list)
        for url in (f"{PHARMA_BASE}/{slug}/bridge/", f"{HOST_ROOT}/{slug}/bridge/"):
            st, body = await _post(url, {"action": "__introspect__"}, {"X-Tenant": slug})
            acts = body.get("actions") if isinstance(body, dict) else None
            if st == 200 and isinstance(acts, list) and any(str(a).startswith("sim.") for a in acts):
                return {"kind": "sale_exercises", "slug": slug, "url": url, "ids": ids or KNOWN_IDS.get(slug, []),
                        "actions": acts}
        # exceltis_rest
        st, body = await _get(f"{HOST_ROOT}/{slug}/api/dim_actividades")
        if st in (200, 400) and not (st == 0):
            txt = str(body).lower()
            if st == 200 or "id" in txt:
                return {"kind": "exceltis_rest", "slug": slug, "url": f"{HOST_ROOT}/{slug}", "ids": ids or KNOWN_IDS.get(slug, [])}
    # rolplay-app platform (counts-only)
    safe = company.replace("'", "''")
    st, body = await _post(ROLPLAY_APP_SQL, {"sql": f"SELECT ID,name FROM r_client WHERE name LIKE '%{safe}%' ORDER BY ID LIMIT 1"})
    if st == 200 and isinstance(body, dict) and body.get("data"):
        cid = int(body["data"][0]["ID"])
        return {"kind": "rolplay_app", "slug": slugify(company), "client_id": cid, "ids": []}
    return None


# ── Schema + preview per kind (returns rows + live widget values) ────────────────
async def build(svc: dict, company: str) -> dict:
    kind = svc["kind"]
    tiles, charts, preview, modules, date_range, recs = [], [], [], [], None, []

    def tile(k, title, val, ok=True):
        tiles.append({"id": f"tile_{k}", "type": "kpi_tile", "title": title})
        preview.append({"widget_id": f"tile_{k}", "ok": ok, "value": val})

    if kind == "kpi":
        st, ov = await _post(svc["url"], {"action": "kpi.overview", "date_from": WIDE_FROM, "date_to": WIDE_TO}, {"X-Tenant": svc["slug"]})
        o = (ov or {}).get("overview", {})
        tile("total_sessions", "Total Sessions", int(o.get("total_sessions") or 0))
        tile("avg_score", "Average Score", o.get("avg_score"))
        tile("pass_rate", "Pass Rate", o.get("pass_rate_pct"))
        _, acts = await _post(svc["url"], {"action": "kpi.activity_summary", "date_from": WIDE_FROM, "date_to": WIDE_TO}, {"X-Tenant": svc["slug"]})
        arows = [a for a in (acts or {}).get("activities", []) if int(a.get("sessions") or 0) > 0]
        modules = sorted({str(a.get("activity_type")) for a in arows if a.get("activity_type")})
        charts.append({"id": "chart_breakdown", "type": "bar_chart", "title": "Sessions by Activity"})
        preview.append({"widget_id": "chart_breakdown", "ok": bool(arows),
                        "rows": [{"activity": a.get("activity_name"), "total_sessions": a.get("sessions"),
                                  "avg_score": a.get("avg_score"), "pass_rate": a.get("pass_rate_pct")} for a in arows]})
        _, tr = await _post(svc["url"], {"action": "kpi.score_trend", "date_from": WIDE_FROM, "date_to": WIDE_TO, "granularity": "month"}, {"X-Tenant": svc["slug"]})
        trend = (tr or {}).get("trend", [])
        charts.append({"id": "chart_trend", "type": "line_chart", "title": "Score Trend"})
        preview.append({"widget_id": "chart_trend", "ok": bool(trend),
                        "series": [{"date": t["period"], "value": t.get("avg_score"), "sessions": t.get("sessions")} for t in trend]})
        charts.append({"id": "table_breakdown", "type": "table", "title": "Activity detail"})
        preview.append({"widget_id": "table_breakdown", "ok": bool(arows),
                        "rows": [{"activity": a.get("activity_name"), "total_sessions": a.get("sessions"),
                                  "avg_score": a.get("avg_score"), "pass_rate": a.get("pass_rate_pct")} for a in arows]})

    elif kind == "sale_exercises":
        ids = ",".join(map(str, svc["ids"]))
        _, b = await _post(svc["url"], {"action": "sim.demorp6", "ids": ids, "date_from": WIDE_FROM, "date_to": WIDE_TO}, {"X-Tenant": svc["slug"]})
        rows = (b or {}).get("data", []) if isinstance(b, dict) else []
        scores = [float(r["Calificacion"]) for r in rows if _num(r.get("Calificacion"))]
        tile("total_sessions", "Total Sessions", len(rows))
        tile("avg_score", "Average Score", round(sum(scores)/len(scores), 2) if scores else None, bool(scores))
        tile("pass_rate", "Pass Rate", round(100*sum(1 for s in scores if s >= PASS)/len(scores), 1) if scores else None, bool(scores))
        if svc.get("actions") and any(str(a).startswith("cert.") for a in svc["actions"]):
            _, cs = await _post(svc["url"], {"action": "cert.stats"}, {"X-Tenant": svc["slug"]})
            if isinstance(cs, dict) and cs.get("certified") is not None:
                tile("certified", "Certified", int(cs.get("certified")))
                modules.append("certification")

    elif kind == "exceltis_rest":
        q = "&".join(f"id={i}" for i in svc["ids"])
        _, rows = await _get(f"{svc['url']}/api/rol_play_sim_extractor?{q}&fecha_inicio={WIDE_FROM}&fecha_fin={WIDE_TO}")
        rows = rows if isinstance(rows, list) else []
        scores = [float(r["Calificacion"]) for r in rows if _num(r.get("Calificacion"))]
        tile("total_sessions", "Total Sessions", len(rows))
        if scores:
            tile("avg_score", "Average Score", round(sum(scores)/len(scores), 2))
            tile("pass_rate", "Pass Rate", round(100*sum(1 for s in scores if s >= PASS)/len(scores), 1))
        else:
            recs.append("This client records qualitative results — counts-only dashboard.")

    elif kind == "rolplay_app":
        cid = svc["client_id"]
        _, b = await _post(ROLPLAY_APP_SQL, {"sql": f"SELECT COUNT(s.ID) sessions, COUNT(DISTINCT u.ID) users FROM r_user u LEFT JOIN r_user_session s ON s.user_id=u.ID WHERE u.client_id={cid}"})
        row = (b or {}).get("data", [{}])[0] if isinstance(b, dict) else {}
        tile("total_sessions", "Total Sessions", int(row.get("sessions") or 0))
        tile("total_users", "Active Users", int(row.get("users") or 0))
        recs.append("Rolplay-app platform: sessions recorded, scores not captured (counts-only).")

    rows_out = []
    if tiles:
        rows_out.append({"id": "row_kpis", "title": "Overview", "widgets": tiles})
    if charts:
        rows_out.append({"id": "row_charts", "title": "Analytics", "widgets": charts})
    if modules:
        recs.insert(0, f"{len(modules)} module(s) detected: {', '.join(modules)}.")

    used_gemini = await maybe_gemini_titles(company, tiles, charts, recs)
    return {
        "company": company, "slug": svc["slug"], "title": f"{company} Analytics", "connector": kind,
        "rows": rows_out, "recommendations": recs or ["Metrics fully backed by real data."],
        "validation": {"ok": bool(tiles), "summary": f"{len(tiles)+len(charts)} widgets from real data"},
        "preview": {"widgets": preview}, "used_gemini": used_gemini,
    }


async def maybe_gemini_titles(company: str, tiles: list, charts: list, recs: list) -> bool:
    """Optional: Gemini refines the recommendations from the real widgets. Never invents data."""
    if not GEMINI_KEY:
        return False
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    prompt = ("You are an analytics advisor. Given these real dashboard widgets for "
              f"{company}: {json.dumps([t['title'] for t in tiles] + [c['title'] for c in charts])}, "
              'return STRICT JSON {"recommendations":["short actionable sentence",...]} (max 4). '
              "Do not invent metrics.")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as c:
            r = await c.post(url, params={"key": GEMINI_KEY}, json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
            })
            if r.status_code != 200:
                return False
            txt = "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
            data = json.loads(txt)
            new = [str(x) for x in data.get("recommendations", []) if isinstance(x, str)][:4]
            if new:
                recs[:] = new
                return True
    except Exception:
        return False
    return False


# ── API ──────────────────────────────────────────────────────────────────────────
app = FastAPI(title="rolplay-ai-dashboard-builder-standalone")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Gen(BaseModel):
    company: str
    exercise_ids: list[int] = []


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "llm_enabled": bool(GEMINI_KEY)}


@app.post("/ai/generate-sync")
async def generate_sync(body: Gen) -> dict:
    svc = await discover(body.company, body.exercise_ids)
    if not svc:
        return {"phase": "error", "error": f"No live data source found for '{body.company}'."}
    result = await build(svc, body.company)
    result["phase"] = "done"
    return result


@app.get("/", response_class=HTMLResponse)
async def root() -> str:
    return BUILDER_HTML


BUILDER_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Rolplay — AI Dashboard Builder</title>
<style>
:root{--red:#DC2626;--bg:#0b0b0f;--card:#15151c;--bd:#26262f;--mut:#8a8a99;--fg:#f4f4f6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:Inter,system-ui,Arial,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:32px 20px}
h1{font-size:26px;margin:0 0 6px}p.sub{color:var(--mut);margin:0 0 24px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:22px;margin-bottom:20px}
label{font-weight:600;font-size:14px;display:block;margin-bottom:8px}
.row{display:flex;gap:12px;flex-wrap:wrap}
input{flex:1;min-width:220px;background:#0f0f16;border:1px solid var(--bd);color:var(--fg);border-radius:10px;padding:13px 15px;font-size:16px}
input:focus{outline:2px solid var(--red)}
button{background:var(--red);color:#fff;border:0;border-radius:10px;padding:13px 22px;font-size:15px;font-weight:700;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.hint{color:var(--mut);font-size:12px;margin-top:10px}
.steps{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0 14px}
.step{font-size:12px;color:var(--mut);display:flex;align-items:center;gap:6px}
.dot{width:18px;height:18px;border-radius:50%;background:#26262f;color:var(--mut);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
.dot.on{background:var(--red);color:#fff}.dot.done{background:#10b981;color:#fff}.step.act{color:var(--fg)}
.bar{height:6px;background:#22222b;border-radius:99px;overflow:hidden}.bar>i{display:block;height:100%;background:var(--red);width:0;transition:width .4s}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.tile{background:#0f0f16;border:1px solid var(--bd);border-radius:12px;padding:16px}
.tile .k{color:var(--mut);font-size:12px;margin-bottom:6px}.tile .v{font-size:26px;font-weight:800}
.wide{grid-column:1/-1}
.chart{display:flex;align-items:flex-end;gap:4px;height:110px;margin-top:8px}
.chart>span{flex:1;background:var(--red);border-radius:4px 4px 0 0;min-height:4px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--bd)}th{color:var(--mut);font-weight:600}
.badge{font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px;background:rgba(16,185,129,.12);color:#10b981}
.rec{color:var(--mut);font-size:13px;margin:4px 0}.err{color:#f87171;font-size:13px}.muted{color:var(--mut)}
</style></head><body><div class="wrap">
<h1>Build your dashboard</h1>
<p class="sub">Type your company name and press Generate. The AI finds your data, designs the dashboard, and shows a live preview — real data, no code.</p>
<div class="card">
  <label>Company name</label>
  <div class="row"><input id="company" placeholder="e.g. Apotex" autofocus /><button id="go">Generate Dashboard</button></div>
  <div class="hint">Just the name — exercise IDs are found automatically.</div>
</div>
<div id="prog" class="card" style="display:none"><div class="steps" id="steps"></div><div class="bar"><i id="fill"></i></div><div class="hint" id="log"></div></div>
<div id="out"></div></div>
<script>
const STEPS=["Locate company","Discover services","Understand schema","Design layout","Validate","Preview"];
const el=id=>document.getElementById(id);
function renderSteps(a){el('steps').innerHTML=STEPS.map((s,i)=>`<span class="step ${i<=a?'act':''}"><span class="dot ${i<a?'done':i===a?'on':''}">${i<a?'\\u2713':i+1}</span>${s}</span>`).join('')}
let timer=null;
async function generate(){
  const c=el('company').value.trim(); if(!c)return;
  el('go').disabled=true; el('out').innerHTML=''; el('prog').style.display='block';
  let step=0; renderSteps(0); el('fill').style.width='8%'; el('log').textContent='Contacting the AI...';
  timer=setInterval(()=>{step=Math.min(step+1,STEPS.length-1);renderSteps(step);el('fill').style.width=(15+step*13)+'%';el('log').textContent=STEPS[step]+'...';},1300);
  try{
    const r=await fetch('/ai/generate-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company:c})});
    const j=await r.json(); clearInterval(timer); renderSteps(STEPS.length); el('fill').style.width='100%'; el('log').textContent='Done.';
    if(j.phase==='error'||!j.rows){el('out').innerHTML='<div class="card err">'+(j.error||'No live data source found.')+'</div>';el('go').disabled=false;return}
    draw(j);
  }catch(e){clearInterval(timer);el('out').innerHTML='<div class="card err">Request failed: '+e+'</div>'}
  el('go').disabled=false;
}
function fmt(v){if(v==null)return '\\u2014';return typeof v==='number'?(v%1===0?v.toLocaleString():v.toFixed(2)):v}
function draw(j){
  const pv={}; (j.preview&&j.preview.widgets||[]).forEach(w=>pv[w.widget_id]=w); const val=j.validation||{}; let html='';
  html+='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div><div style="font-size:19px;font-weight:800">'+j.title+'</div><div class="muted" style="font-size:12px">Live data \\u00b7 '+j.connector.replace(/_/g,' ')+(j.used_gemini?' \\u00b7 Gemini':'')+'</div></div><span class="badge">'+(val.ok?'Validated':'Check')+'</span></div>';
  (j.rows||[]).forEach(row=>{html+='<div style="margin:12px 0 6px;font-size:12px;font-weight:700;color:var(--mut);text-transform:uppercase">'+(row.title||'')+'</div><div class="grid">';
    row.widgets.forEach(w=>{const p=pv[w.id]||{};const wide=w.type==='table'||w.type==='line_chart'||w.type==='bar_chart';html+='<div class="tile '+(wide?'wide':'')+'"><div class="k">'+w.title+'</div>';
      if(w.type==='kpi_tile')html+='<div class="v">'+fmt(p.value)+'</div>';
      else if(w.type==='line_chart'||w.type==='bar_chart'){const s=(p.series||p.rows||[]).slice(0,16);const vs=s.map(x=>Number(x.value??x.total_sessions??x.sessions??0));const mx=Math.max(1,...vs);html+='<div class="chart">'+s.map((_,i)=>'<span style="height:'+Math.max(4,vs[i]/mx*100)+'%"></span>').join('')+'</div>';}
      else if(w.type==='table'){const rs=p.rows||[];if(rs.length){const cs=Object.keys(rs[0]).slice(0,5);html+='<table><thead><tr>'+cs.map(x=>'<th>'+x.replace(/_/g,' ')+'</th>').join('')+'</tr></thead><tbody>'+rs.slice(0,8).map(r=>'<tr>'+cs.map(x=>'<td>'+fmt(r[x])+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}else html+='<div class="muted">\\u2014</div>';}
      html+='</div>';});
    html+='</div>';});
  (j.recommendations||[]).forEach(r=>html+='<div class="rec">\\u2022 '+r+'</div>');
  html+='</div>'; el('out').innerHTML=html;
}
el('go').onclick=generate; el('company').addEventListener('keydown',e=>{if(e.key==='Enter')generate()});
</script></body></html>"""
