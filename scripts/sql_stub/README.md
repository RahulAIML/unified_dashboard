Local Rolplay SQL stub

Purpose:
- Provide a safe, local endpoint that mimics the production ROLPLAY_APP_SQL_URL remote-access API.
- Use this during local E2E tests so the Dashboard Builder queries real-ish SQL data without touching production.

Files:
- `main.py`: FastAPI app that accepts POST JSON { "sql": "..." } and returns { result: 'success', data: [...] }.
- `data.json`: Sample tables returned by the stub (r_client, r_user, r_user_session).

Run (requires Python 3.10+, uvicorn, fastapi):

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install fastapi uvicorn
python d:\Rolplay_Dashboard_Project\scripts\sql_stub\main.py
```

By default the stub listens on `http://127.0.0.1:9000/`.

Usage:
- Set `ROLPLAY_APP_SQL_URL` to `http://127.0.0.1:9000/` in your Next.js app environment (local `.env` or process env when running dev server).
- The stub responds to simple `SELECT` queries for the demo datasets present in `data.json`.

Notes:
- This stub is intentionally minimal and heuristic-based. It is for local acceptance testing only.
- Do NOT use this in production.
