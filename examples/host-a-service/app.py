# A tiny web app: counts visits to / and keeps the count on the volume.
# Standard library only. Replace it with your own app.
import http.server
import pathlib
import socket

COUNT = pathlib.Path("/home/tenki/data/visits")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/":  # don't count /favicon.ico and friends
            self.send_error(404)
            return
        n = int(COUNT.read_text()) + 1 if COUNT.exists() else 1
        COUNT.write_text(str(n))
        body = f"visit {n}, served by {socket.gethostname()}\n".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


http.server.HTTPServer(("", 8000), Handler).serve_forever()
