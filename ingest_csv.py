import csv
import json
import os
from datetime import datetime
from typing import Dict, Optional, Tuple

import psycopg2
from psycopg2.extras import execute_values

PG_DSN = os.getenv("PG_DSN", "dbname=geo_portal user=postgres password=postgres host=127.0.0.1 port=5432")
BATCH = int(os.getenv("BATCH", "5000"))
SAVE_RAW = os.getenv("SAVE_RAW", "1") == "1"


def parse_ts(s: str) -> Optional[datetime]:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def to_float(s) -> Optional[float]:
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    s = s.replace(",", ".")
    try:
        return float(s)
    except Exception:
        return None


def detect_source_type(header: list[str]) -> int:
    h = {c.strip() for c in header}
    if "dateTime" in h and ("gps_latitude" in h or "ueLatitude" in h):
        return 1
    if "Time" in h and "Latitude" in h and "Longitude" in h:
        return 2
    return 0


def normalize_row(source_type: int, row: Dict[str, str]) -> Tuple[Optional[datetime], Optional[str], Optional[str], Optional[float], Optional[float], Optional[float]]:
    def valid_latlon(lat: Optional[float], lon: Optional[float]) -> bool:
        if lat is None or lon is None:
            return False
        # 0,0 casi siempre es “sin dato”
        if abs(lat) < 1e-9 and abs(lon) < 1e-9:
            return False
        return (-90.0 <= lat <= 90.0) and (-180.0 <= lon <= 180.0)

    if source_type == 1:
        ts = parse_ts(row.get("dateTime", ""))
        imsi = (row.get("imsi") or "").strip() or None
        imei = (row.get("imei") or "").strip() or None

        ue_lat = to_float(row.get("ueLatitude"))
        ue_lon = to_float(row.get("ueLongitude"))
        gps_lat = to_float(row.get("gps_latitude"))
        gps_lon = to_float(row.get("gps_longitude"))

        # Preferir UE si es válida; si no, GPS; si no, None
        if valid_latlon(ue_lat, ue_lon):
            lat, lon = ue_lat, ue_lon
        elif valid_latlon(gps_lat, gps_lon):
            lat, lon = gps_lat, gps_lon
        else:
            lat, lon = None, None

        dist = to_float(row.get("relative_ue_distance"))
        return ts, imsi, imei, lat, lon, dist

    if source_type == 2:
        ts = parse_ts(row.get("Time", ""))
        imsi = (row.get("IMSI") or "").strip() or None
        imei = (row.get("IMEI") or "").strip() or None
        lat = to_float(row.get("Latitude"))
        lon = to_float(row.get("Longitude"))
        return ts, imsi, imei, lat, lon, None

    return None, None, None, None, None, None



def ensure_partition(cur, ts: datetime):
    cur.execute("SELECT ensure_detection_partition(%s, %s);", (ts.year, ts.month))


def flush(cur, buf_det, buf_raw) -> int:
    sql_det = """
        INSERT INTO detections
        (ts, imsi, imei, lat, lon, geom, distance_m, source_type, source_file, source_row)
        VALUES %s
        ON CONFLICT (source_file, source_row, ts) DO NOTHING;
    """

    tmpl_det = """
    (%s,%s,%s,%s,%s,
     CASE
       WHEN %s IS NULL OR %s IS NULL THEN NULL
       ELSE ST_SetSRID(ST_MakePoint(%s,%s), 4326)::geography
     END,
     %s,%s,%s,%s)
    """

    expanded = []
    for (ts, imsi, imei, lat, lon, dist, source_type, source_file, row_idx) in buf_det:
        expanded.append((
            ts, imsi, imei, lat, lon,
            lat, lon,      # null-check
            lon, lat,      # MakePoint(lon,lat)
            dist,
            source_type, source_file, row_idx
        ))

    execute_values(cur, sql_det, expanded, template=tmpl_det, page_size=len(expanded))

    if SAVE_RAW and buf_raw:
        sql_raw = """
            INSERT INTO detections_raw (ts, source_type, source_file, source_row, raw)
            VALUES %s;
        """
        tmpl_raw = "(%s,%s,%s,%s,%s::jsonb)"
        execute_values(cur, sql_raw, buf_raw, template=tmpl_raw, page_size=len(buf_raw))

    return len(buf_det)


def ingest_file(path: str):
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    source_file = os.path.basename(path)

    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        source_type = detect_source_type(header)
        if source_type == 0:
            raise RuntimeError(f"No pude detectar el tipo de CSV. Header: {header[:30]}")

        conn = psycopg2.connect(PG_DSN)
        conn.autocommit = False

        loaded = 0
        seen = 0

        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM ingest_files WHERE source_file = %s;", (source_file,))
                if cur.fetchone():
                    print(f"[SKIP] Ya cargado: {source_file}")
                    conn.rollback()
                    return

                cur.execute(
                    "INSERT INTO ingest_files (source_file, source_type, rows_seen, rows_loaded, notes) VALUES (%s,%s,0,0,%s);",
                    (source_file, source_type, "pending")
                )

                buf_det = []
                buf_raw = []

                for row_idx, row in enumerate(reader, start=1):
                    seen += 1
                    ts, imsi, imei, lat, lon, dist = normalize_row(source_type, row)
                    if ts is None:
                        continue

                    ensure_partition(cur, ts)

                    geom_wkt = None
                    if lat is not None and lon is not None:
                        geom_wkt = f"SRID=4326;POINT({lon} {lat})"

                    buf_det.append((ts, imsi, imei, lat, lon, dist, source_type, source_file, row_idx))
                    if SAVE_RAW:
                        buf_raw.append((ts, source_type, source_file, row_idx, json.dumps(row, ensure_ascii=False)))

                    if len(buf_det) >= BATCH:
                        loaded += flush(cur, buf_det, buf_raw)
                        buf_det.clear()
                        buf_raw.clear()

                if buf_det:
                    loaded += flush(cur, buf_det, buf_raw)

                cur.execute(
                    "UPDATE ingest_files SET rows_seen=%s, rows_loaded=%s, loaded_at=now(), notes=%s WHERE source_file=%s;",
                    (seen, loaded, "ok", source_file)
                )

            conn.commit()
            print(f"[OK] {source_file}: seen={seen} loaded={loaded} type={source_type}")
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Uso: python ingest_csv.py archivo1.csv [archivo2.csv ...]")
        raise SystemExit(2)

    for p in sys.argv[1:]:
        ingest_file(p)
