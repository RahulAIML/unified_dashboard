from fastapi import FastAPI, Request
from pydantic import BaseModel
import uvicorn
import json
import re

app = FastAPI()

with open('d:/Rolplay_Dashboard_Project/scripts/sql_stub/data.json', 'r', encoding='utf-8') as f:
    DATA = json.load(f)

class SQLIn(BaseModel):
    sql: str

@app.post('/')
async def remote_access(body: SQLIn):
    sql = body.sql or ''
    # Very small heuristic to determine which dataset to return
    # Look for FROM r_client or r_user or r_user_session and optional client_id
    sql_lower = sql.lower()
    # Default empty
    rows = []
    try:
        # r_client listing
        if 'from r_client' in sql_lower:
            rows = DATA.get('r_client', [])
        elif 'from r_user' in sql_lower and 'count(*)' in sql_lower:
            # count per client queries
            m = re.search(r"client_id\s*=\s*(\d+)", sql, re.IGNORECASE)
            if m:
                cid = int(m.group(1))
                users = [u for u in DATA.get('r_user', []) if u.get('client_id') == cid]
                rows = [{ 'n': len(users) }]
            else:
                rows = DATA.get('r_user', [])
        elif 'from r_user_session' in sql_lower:
            m = re.search(r"client_id\s*=\s*(\d+)", sql, re.IGNORECASE)
            if m:
                cid = int(m.group(1))
                rows = [s for s in DATA.get('r_user_session', []) if s.get('client_id') == cid]
            else:
                rows = DATA.get('r_user_session', [])
        else:
            # Fallback: return empty
            rows = []
    except Exception:
        rows = []

    return { 'result': 'success', 'data': rows }

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=9000)
