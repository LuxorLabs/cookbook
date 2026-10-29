"""
The judge: a small HTTP front for one frozen hill. It runs in the judge sandbox,
next to the hill, its private/ data and the hills signing key, none of which ever
leave this machine. The climbing agent, in another sandbox, only sees this API:

  GET  /describe   `hills describe <hill>`: the task, params and submission contract
  POST /eval       body: a .tar.gz of the submission folder -> the signed report
  POST /verify     body: a report -> whether its signature is valid on this machine

POSTs need `Authorization: Bearer $JUDGE_TOKEN`. Standard library only.
Run: JUDGE_TOKEN=... python3 judge.py   (env: HILL, HILLS_PROJECT, PORT)
"""
import hmac
import io
import json
import os
import subprocess
import tarfile
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

HILL = os.environ.get("HILL", "circle-packing")
PROJECT = os.path.expanduser(os.environ.get("HILLS_PROJECT", "~/judge"))
TOKEN = os.environ["JUDGE_TOKEN"]
PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY = 64 * 1024 * 1024


def hills(*args, timeout=None):
    return subprocess.run(["hills", *args], cwd=PROJECT, capture_output=True, text=True, timeout=timeout)


class Judge(BaseHTTPRequestHandler):
    def send(self, status, body):
        data = json.dumps(body, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError(f"body over {MAX_BODY} bytes")
        return self.rfile.read(length)

    def authorized(self):
        given = self.headers.get("Authorization", "").removeprefix("Bearer ")
        return hmac.compare_digest(given.encode(), TOKEN.encode())

    def do_GET(self):
        if self.path == "/describe":
            r = hills("describe", HILL)
            return self.send(200, json.loads(r.stdout)) if r.returncode == 0 else self.send(500, {"error": r.stderr})
        self.send(404, {"error": "GET /describe, POST /eval, POST /verify"})

    def do_POST(self):
        if not self.authorized():
            return self.send(401, {"error": "missing or wrong bearer token"})
        try:
            if self.path == "/eval":
                return self.evaluate(self.body())
            if self.path == "/verify":
                return self.verify(self.body())
        except Exception as e:  # noqa: BLE001
            return self.send(400, {"error": f"{type(e).__name__}: {e}"})
        self.send(404, {"error": "POST /eval or /verify"})

    def evaluate(self, tarball):
        with tempfile.TemporaryDirectory() as tmp:
            submission = os.path.join(tmp, "submission")
            with tarfile.open(fileobj=io.BytesIO(tarball), mode="r:gz") as tar:
                tar.extractall(submission, filter="data")  # no absolute paths, .., or links out
            report = os.path.join(tmp, "report.json")
            # hills itself enforces the hill's watchdog; this only guards the HTTP request.
            r = hills("eval", submission, "-H", HILL, "-o", report, timeout=3600)
            if not os.path.exists(report):
                return self.send(422, {"error": "no report", "log": (r.stdout + r.stderr)[-4000:]})
            with open(report) as f:
                self.send(200, json.load(f))

    def verify(self, report):
        with tempfile.NamedTemporaryFile(suffix=".json") as f:
            f.write(report)
            f.flush()
            r = hills("verify", f.name)
        self.send(200, {"valid": r.returncode == 0, "output": (r.stdout + r.stderr).strip()})


if __name__ == "__main__":
    # One request at a time: evaluations queue instead of competing for the CPU,
    # so every score is measured under the same conditions.
    print(f"judging {HILL} on :{PORT}", flush=True)
    HTTPServer(("0.0.0.0", PORT), Judge).serve_forever()
