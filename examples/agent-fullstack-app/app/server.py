"""A tiny full-stack app: JSON API + a frontend that consumes it.

Stdlib only (http.server + sqlite3) so it runs in a fresh sandbox with no
install step. The point isn't the framework — it's that an agent can stand this
up, call the endpoints, change the data, and view the UI, all inside one microVM.

Endpoints:
  GET    /            -> the frontend (HTML+JS, fetches /api/tasks)
  GET    /api/tasks   -> list tasks
  POST   /api/tasks   -> create a task   {"title": "...", "status": "todo"}
  PATCH  /api/tasks/<id> -> update status {"status": "done"}
  GET    /api/health  -> {"ok": true, "tasks": N}
"""
import json
import sqlite3
from http.server import BaseHTTPRequestHandler, HTTPServer

DB = "/home/tenki/app.db"
PORT = 8000

INDEX = """<!doctype html>
<title>Tasks — running in a Tenki sandbox</title>
<style>
 body{font:16px system-ui;margin:40px auto;max-width:640px;background:#0b1020;color:#e6ebff}
 h1{font-size:20px} li{margin:8px 0;display:flex;gap:10px;align-items:center}
 .s{font-size:12px;padding:2px 8px;border-radius:99px;background:#1e2a4a}
 .done{background:#14532d} .doing{background:#78350f}
</style>
<h1>Tasks <small style="color:#7c8db5">— served from a Tenki microVM</small></h1>
<ul id="list">loading…</ul>
<script>
fetch('/api/tasks').then(r=>r.json()).then(tasks=>{
  document.getElementById('list').innerHTML = tasks.map(t =>
    `<li><span class="s ${t.status}">${t.status}</span><span>${t.title}</span></li>`).join('');
});
</script>
"""


def q(sql, args=(), commit=False):
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.execute(sql, args)
    if commit:
        conn.commit()
        out = cur.lastrowid
    else:
        out = [dict(r) for r in cur.fetchall()]
    conn.close()
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload, ctype="application/json"):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if self.path == "/":
            return self._send(200, INDEX.encode(), "text/html; charset=utf-8")
        if self.path == "/api/tasks":
            return self._send(200, q("SELECT id, title, status FROM tasks ORDER BY id"))
        if self.path == "/api/health":
            return self._send(200, {"ok": True, "tasks": q("SELECT COUNT(*) c FROM tasks")[0]["c"]})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/tasks":
            return self._send(404, {"error": "not found"})
        b = self._body()
        if not b.get("title"):
            return self._send(400, {"error": "title required"})
        new_id = q("INSERT INTO tasks (title, status) VALUES (?, ?)",
                   (b["title"], b.get("status", "todo")), commit=True)
        return self._send(201, {"id": new_id, "title": b["title"], "status": b.get("status", "todo")})

    def do_PATCH(self):
        if not self.path.startswith("/api/tasks/"):
            return self._send(404, {"error": "not found"})
        task_id = self.path.rsplit("/", 1)[-1]
        status = self._body().get("status")
        if not status:
            return self._send(400, {"error": "status required"})
        q("UPDATE tasks SET status = ? WHERE id = ?", (status, task_id), commit=True)
        rows = q("SELECT id, title, status FROM tasks WHERE id = ?", (task_id,))
        return self._send(200 if rows else 404, rows[0] if rows else {"error": "not found"})

    def log_message(self, *a):  # keep sandbox logs quiet
        pass


if __name__ == "__main__":
    print(f"serving on :{PORT}", flush=True)
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
