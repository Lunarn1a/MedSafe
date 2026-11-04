"""Serve the local MedSafe demo and its trained suggestion model on one origin."""

from __future__ import annotations

import argparse
import json
import logging
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from model_runtime import SuggestionService


STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/drugs-data.js": ("drugs-data.js", "text/javascript; charset=utf-8"),
    "/drugs.json": ("drugs.json", "application/json; charset=utf-8"),
    "/model-suggestions.js": ("model-suggestions.js", "text/javascript; charset=utf-8"),
}
MAX_BODY_BYTES = 4096


class LocalHTTPServer(ThreadingHTTPServer):
    # Windows otherwise permits two reused listeners to report the same address,
    # leaving a browser talking to an older model process after a restart.
    allow_reuse_address = not hasattr(socket, "SO_EXCLUSIVEADDRUSE")

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def create_server(service: SuggestionService, port: int = 8000) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # A medicine selection can abort an in-flight browser request.

        def json_reply(self, status: int, payload: dict) -> None:
            self.reply(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

        def do_GET(self) -> None:
            route = urlsplit(self.path).path
            if route == "/api/health":
                self.json_reply(200, service.health())
                return
            entry = STATIC_FILES.get(route)
            if entry is None:
                self.json_reply(404, {"error": "Not found."})
                return
            filename, content_type = entry
            self.reply(200, (service.app_dir / filename).read_bytes(), content_type)

        def do_POST(self) -> None:
            route = urlsplit(self.path).path
            if route not in ("/api/suggestions", "/api/guidance"):
                self.json_reply(404, {"error": "Not found."})
                return
            if self.headers.get_content_type() != "application/json":
                self.json_reply(415, {"error": "Send an application/json request."})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.json_reply(400, {"error": "Invalid content length."})
                return
            if not 0 < length <= MAX_BODY_BYTES:
                self.json_reply(413, {"error": "The request body is empty or too large."})
                return
            try:
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict) or set(payload) != {"drug_a", "drug_b"}:
                    raise ValueError("Send only drug_a and drug_b; reference features are supplied by the server.")
                operation = service.guidance if route == "/api/guidance" else service.suggest
                result = operation(payload["drug_a"], payload["drug_b"])
            except (ValueError, UnicodeDecodeError) as error:
                self.json_reply(400, {"error": str(error)})
                return
            except Exception:
                logging.exception("Suggestion inference failed")
                self.json_reply(503, {"error": "Model-selected questions are currently unavailable."})
                return
            self.json_reply(200, result)

    server = LocalHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--check", action="store_true", help="Validate the model and data, then exit.")
    args = parser.parse_args()
    try:
        service = SuggestionService()
        if args.check:
            print(json.dumps(service.health()), flush=True)
            return
        try:
            server = create_server(service, args.port)
        except OSError as error:
            raise OSError(f"Could not bind port {args.port}. Stop the previous server or choose another --port. {error}") from error
    except (OSError, ValueError, RuntimeError, ImportError) as error:
        parser.exit(1, f"MedSafe could not start: {error}\n")
    print(f"MedSafe: http://127.0.0.1:{server.server_port}/", flush=True)
    print(f"Trained suggestion models loaded. Coverage: {len(service.catalog)} documented pairs. Ctrl+C stops the demo.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
