"""Vercel serverless entry — serves the self-contained AI Dashboard Builder.

One Python function serves BOTH the builder UI (GET /) and the API (/ai/*, /health).
Discovery uses the hardcoded public bridge URLs, so real-data dashboards work with
NO secrets. Set GEMINI_API_KEY in the Vercel project env to enable LLM layout.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.responses import HTMLResponse  # noqa: E402
from app.main import app  # noqa: E402  (exposes the ASGI `app` Vercel serves)

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
.rec{color:var(--mut);font-size:13px;margin:4px 0}
.err{color:#f87171;font-size:13px}
.muted{color:var(--mut)}
</style></head><body><div class="wrap">
<h1>Build your dashboard</h1>
<p class="sub">Type your company name and press Generate. The AI finds your data, designs the dashboard, and shows a live preview — real data, no code.</p>
<div class="card">
  <label>Company name</label>
  <div class="row">
    <input id="company" placeholder="e.g. Apotex" autofocus />
    <button id="go">✨ Generate Dashboard</button>
  </div>
  <div class="hint">Just the name — exercise IDs are found automatically.</div>
</div>
<div id="prog" class="card" style="display:none">
  <div class="steps" id="steps"></div>
  <div class="bar"><i id="fill"></i></div>
  <div class="hint" id="log"></div>
</div>
<div id="out"></div>
</div>
<script>
const STEPS=["Locate company","Discover services","Understand schema","Design (Gemini)","Validate","Preview"];
const el=id=>document.getElementById(id);
function renderSteps(active){el('steps').innerHTML=STEPS.map((s,i)=>`<span class="step ${i<=active?'act':''}"><span class="dot ${i<active?'done':i===active?'on':''}">${i<active?'✓':i+1}</span>${s}</span>`).join('')}
let timer=null;
async function generate(){
  const c=el('company').value.trim(); if(!c)return;
  el('go').disabled=true; el('out').innerHTML=''; el('prog').style.display='block';
  let step=0; renderSteps(0); el('fill').style.width='8%'; el('log').textContent='Contacting the AI…';
  timer=setInterval(()=>{step=Math.min(step+1,STEPS.length-1);renderSteps(step);el('fill').style.width=(15+step*13)+'%';el('log').textContent=STEPS[step]+'…';},1400);
  try{
    const r=await fetch('/ai/generate-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company:c})});
    const j=await r.json(); clearInterval(timer);
    renderSteps(STEPS.length); el('fill').style.width='100%'; el('log').textContent='Done.';
    if(j.phase==='error'||!j.dashboard){el('out').innerHTML='<div class="card err">'+(j.error||'No live data source found for this company.')+'</div>';el('go').disabled=false;return}
    draw(j);
  }catch(e){clearInterval(timer);el('out').innerHTML='<div class="card err">Request failed: '+e+'</div>'}
  el('go').disabled=false;
}
function fmt(v){if(v==null)return '—';return typeof v==='number'?(v%1===0?v.toLocaleString():v.toFixed(2)):v}
function draw(j){
  const d=j.dashboard, pv={}; (j.preview&&j.preview.widgets||[]).forEach(w=>pv[w.widget_id]=w);
  const val=j.validation||{}; let html='';
  html+='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'
    +'<div><div style="font-size:19px;font-weight:800">'+d.title+'</div><div class="muted" style="font-size:12px">Live data · '+d.connector.replace(/_/g,' ')+'</div></div>'
    +'<span class="badge">'+(val.ok?'Validation passed':'Check')+'</span></div>';
  (d.rows||[]).forEach(row=>{
    html+='<div style="margin:12px 0 6px;font-size:12px;font-weight:700;color:var(--mut);text-transform:uppercase">'+(row.title||'')+'</div><div class="grid">';
    row.widgets.forEach(w=>{const p=pv[w.id]||{};const wide=w.type==='table'||w.type==='line_chart'||w.type==='bar_chart';
      html+='<div class="tile '+(wide?'wide':'')+'"><div class="k">'+w.title+'</div>';
      if(w.type==='kpi_tile')html+='<div class="v">'+fmt(p.value)+'</div>';
      else if(w.type==='line_chart'||w.type==='bar_chart'){const s=(p.series||p.rows||[]).slice(0,16);const vals=s.map(x=>Number(x.value??x.total_sessions??x.sessions??0));const mx=Math.max(1,...vals);html+='<div class="chart">'+s.map((_,i)=>'<span style="height:'+Math.max(4,vals[i]/mx*100)+'%"></span>').join('')+'</div>';}
      else if(w.type==='table'){const rs=p.rows||[];if(rs.length){const cols=Object.keys(rs[0]).slice(0,5);html+='<table><thead><tr>'+cols.map(c=>'<th>'+c.replace(/_/g,' ')+'</th>').join('')+'</tr></thead><tbody>'+rs.slice(0,8).map(r=>'<tr>'+cols.map(c=>'<td>'+fmt(r[c])+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}else html+='<div class="muted">—</div>';}
      if(p.ok===false)html+='<div class="err" style="font-size:12px;margin-top:4px">no data</div>';
      html+='</div>';});
    html+='</div>';
  });
  (d.recommendations||[]).forEach(r=>html+='<div class="rec">• '+r+'</div>');
  html+='</div>';
  el('out').innerHTML=html;
}
el('go').onclick=generate;
el('company').addEventListener('keydown',e=>{if(e.key==='Enter')generate()});
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
async def builder() -> str:
    return BUILDER_HTML
