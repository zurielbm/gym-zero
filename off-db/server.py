"""Self-hosted Open Food Facts mirror for Gym Zero barcode scans.

On first boot this downloads the OFF CSV export (~1 GB compressed), imports
barcode + name + brand + macros into a local SQLite file, and then serves:

    GET /product/<barcode>.json   OFF v2-compatible subset: {"status":1,"product":{...}}
    GET /meta                     {"status":"ready","sourceSchema":"off-v2","exportDate":...}

The app treats this as source #1 and falls back to the public OFF API when
it's unreachable or missing a product, so a half-finished import never breaks
scanning. /meta answers during the import too (status "downloading"/
"importing" with progress) so Settings can show what's happening.

The import stores individual, unmodified OFF product rows — plain use of the
database under ODbL, not an enriched derivative. Attribution lives in the app.

Environment:
    PORT            listen port (default 8321)
    DATA_DIR        where products.db + the export live (default /data)
    OFF_CSV_URL     export to download (default the official OFF CSV export)
    OFF_CSV_FILE    path to an already-downloaded .csv.gz — skips the download
    FORCE_REIMPORT  "1" re-imports even if products.db exists
    KEEP_EXPORT     "1" keeps the downloaded .csv.gz after a successful import

Stdlib only — no pip installs.
"""

import csv
import gzip
import json
import os
import sqlite3
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT") or "8321")
DATA_DIR = os.environ.get("DATA_DIR") or "/data"
CSV_URL = os.environ.get("OFF_CSV_URL") or (
    "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz"
)
CSV_FILE = os.environ.get("OFF_CSV_FILE") or ""
FORCE_REIMPORT = os.environ.get("FORCE_REIMPORT") == "1"
KEEP_EXPORT = os.environ.get("KEEP_EXPORT") == "1"

DB_PATH = os.path.join(DATA_DIR, "products.db")

COLUMNS = [
    "code", "product_name", "brands",
    "energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g",
    "serving_quantity", "serving_size",
]

state = {"status": "starting", "progress": "", "error": ""}


def log(msg):
    print(f"[off-db] {msg}", flush=True)


def parse_float(raw):
    try:
        n = float(raw)
    except (TypeError, ValueError):
        return None
    return n if 0 <= n < 100000 else None


def download_export(dest):
    """Resumable download; returns the export's Last-Modified date (ISO) if known."""
    part = dest + ".part"
    pos = os.path.getsize(part) if os.path.exists(part) else 0
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "gym-zero-off-db/1.0"})
    if pos:
        req.add_header("Range", f"bytes={pos}-")
    with urllib.request.urlopen(req, timeout=120) as resp:
        last_modified = resp.headers.get("Last-Modified")
        mode = "ab" if pos and resp.status == 206 else "wb"
        done = pos if mode == "ab" else 0
        with open(part, mode) as f:
            while chunk := resp.read(1 << 20):
                f.write(chunk)
                done += len(chunk)
                if done % (100 << 20) < (1 << 20):
                    state["progress"] = f"{done >> 20:,} MB downloaded"
                    log(state["progress"])
    os.replace(part, dest)
    if last_modified:
        try:
            return parsedate_to_datetime(last_modified).date().isoformat()
        except (TypeError, ValueError):
            pass
    return None


def import_export(path, export_date):
    """Stream the gzipped TSV into a fresh SQLite file, then swap it in atomically."""
    tmp = DB_PATH + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    db = sqlite3.connect(tmp)
    db.execute("PRAGMA journal_mode=OFF")
    db.execute("PRAGMA synchronous=OFF")
    db.execute(
        "CREATE TABLE products (code TEXT PRIMARY KEY, name TEXT, brands TEXT,"
        " kcal REAL, protein REAL, carbs REAL, fat REAL,"
        " serving_quantity REAL, serving_size TEXT)"
    )
    db.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")

    csv.field_size_limit(1 << 30)
    imported = 0
    batch = []
    with gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(reader)
        try:
            idx = [header.index(c) for c in COLUMNS]
        except ValueError as e:
            raise RuntimeError(f"export is missing an expected column: {e}")
        width = max(idx) + 1
        for row in reader:
            if len(row) < width:
                continue
            code = row[idx[0]].strip()
            kcal = parse_float(row[idx[3]])
            # digits-only codes with usable calories — same rule the app applies
            if not code.isdigit() or kcal is None or kcal > 1200:
                continue
            batch.append((
                code,
                row[idx[1]].strip()[:120] or None,
                row[idx[2]].strip()[:80] or None,
                kcal,
                parse_float(row[idx[4]]),
                parse_float(row[idx[5]]),
                parse_float(row[idx[6]]),
                parse_float(row[idx[7]]),
                row[idx[8]].strip()[:60] or None,
            ))
            if len(batch) >= 5000:
                db.executemany("INSERT OR REPLACE INTO products VALUES (?,?,?,?,?,?,?,?,?)", batch)
                imported += len(batch)
                batch.clear()
                if imported % 100000 == 0:
                    state["progress"] = f"{imported:,} products imported"
                    log(state["progress"])
    if batch:
        db.executemany("INSERT OR REPLACE INTO products VALUES (?,?,?,?,?,?,?,?,?)", batch)
        imported += len(batch)

    count = db.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    meta = {
        "source": "openfoodfacts",
        "sourceSchema": "off-v2",
        "exportDate": export_date or "",
        "productCount": str(count),
        "importedAt": str(int(time.time() * 1000)),
    }
    db.executemany("INSERT INTO meta VALUES (?,?)", meta.items())
    db.commit()
    db.close()
    os.replace(tmp, DB_PATH)
    log(f"import done: {count:,} products")


def prepare():
    try:
        if os.path.exists(DB_PATH) and not FORCE_REIMPORT:
            state["status"] = "ready"
            log("existing products.db found — serving it")
            return
        os.makedirs(DATA_DIR, exist_ok=True)
        export_date = None
        if CSV_FILE:
            path = CSV_FILE
            export_date = datetime.fromtimestamp(
                os.path.getmtime(path), tz=timezone.utc
            ).date().isoformat()
            log(f"using provided export {path}")
        else:
            path = os.path.join(DATA_DIR, "off-export.csv.gz")
            if not os.path.exists(path):
                state["status"] = "downloading"
                log(f"downloading {CSV_URL}")
                export_date = download_export(path)
            else:
                export_date = datetime.fromtimestamp(
                    os.path.getmtime(path), tz=timezone.utc
                ).date().isoformat()
        state["status"] = "importing"
        state["progress"] = "starting import"
        import_export(path, export_date)
        if not CSV_FILE and not KEEP_EXPORT:
            os.remove(path)
        state["status"] = "ready"
        state["progress"] = ""
    except Exception as e:  # keep serving /meta so the app can show what broke
        state["status"] = "error"
        state["error"] = str(e)
        log(f"ERROR: {e}")


def read_meta():
    db = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        rows = dict(db.execute("SELECT key, value FROM meta").fetchall())
    finally:
        db.close()
    return {
        "status": "ready",
        "source": rows.get("source", "openfoodfacts"),
        "sourceSchema": rows.get("sourceSchema", "off-v2"),
        "exportDate": rows.get("exportDate") or None,
        "productCount": int(rows.get("productCount", "0")),
        "importedAt": int(rows.get("importedAt", "0")),
    }


def read_product(code):
    db = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        row = db.execute(
            "SELECT name, brands, kcal, protein, carbs, fat, serving_quantity, serving_size"
            " FROM products WHERE code = ?", (code,)
        ).fetchone()
    finally:
        db.close()
    if not row:
        return {"status": 0}
    name, brands, kcal, protein, carbs, fat, serving_quantity, serving_size = row
    return {
        "status": 1,
        "product": {
            "product_name": name,
            "brands": brands,
            "nutriments": {
                "energy-kcal_100g": kcal,
                "proteins_100g": protein,
                "carbohydrates_100g": carbs,
                "fat_100g": fat,
            },
            "serving_quantity": serving_quantity,
            "serving_size": serving_size,
        },
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):  # quiet per-request logging
        pass

    def send(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send(204, {})

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path == "/meta":
            if state["status"] == "ready":
                return self.send(200, read_meta())
            return self.send(200, {
                "status": state["status"],
                "sourceSchema": "off-v2",
                "progress": state["progress"],
                "error": state["error"] or None,
            })
        if path.startswith("/product/"):
            if state["status"] != "ready":
                return self.send(503, {"status": 0, "error": state["status"]})
            code = path.removeprefix("/product/").removesuffix(".json")
            if not code.isdigit():
                return self.send(400, {"status": 0})
            return self.send(200, read_product(code))
        if path in ("", "/"):
            return self.send(200, {"service": "gym-zero off-db", "see": "/meta"})
        return self.send(404, {"error": "not found"})


def main():
    threading.Thread(target=prepare, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log(f"listening on :{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
