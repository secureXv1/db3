import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse";
import { pool } from "../db.js";

const router = Router();

const UPLOAD_DIR = path.resolve("uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer: guarda archivo en /uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-() ]+/g, "_");
    const stamp = Date.now();
    cb(null, `${stamp}__${safe}`);
  },
});
const upload = multer({ storage });

// ===== Helpers =====
function toFloat(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseTs(v) {
  if (!v) return null;
  const s0 = String(v).trim();
  if (!s0) return null;

  // Si por algún motivo viene "toda la línea", extraemos SOLO el timestamp
  const m = s0.match(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/);
  if (m) return m[0].replace("T", " ");

  // También soporta "dd/mm/yyyy hh:mm:ss"
  const m2 = s0.match(/\b\d{2}\/\d{2}\/\d{4}[ T]\d{2}:\d{2}:\d{2}\b/);
  if (m2) return m2[0];

  return null;
}


function validLatLon(lat, lon) {
  if (lat == null || lon == null) return false;
  if (Math.abs(lat) < 1e-9 && Math.abs(lon) < 1e-9) return false;
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// obtiene columna aunque cambie mayúsculas/minúsculas
function pick(row, ...names) {
  const keys = Object.keys(row || {});
  for (const n of names) {
    if (row[n] != null) return row[n];
    const found = keys.find((k) => k.toLowerCase() === String(n).toLowerCase());
    if (found) return row[found];
  }
  return null;
}

function detectType(headers) {
  const h = new Set((headers || []).map((x) => String(x).trim().toLowerCase()));
  if (h.has("datetime") && (h.has("gps_latitude") || h.has("uelatitude"))) return 1; // Tipo1
  if (h.has("time") && h.has("latitude") && h.has("longitude")) return 2; // Tipo2
  return 0;
}

// leer primera línea para detectar delimitador y headers
function readFirstLine(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    let text = buf.slice(0, bytes).toString("utf8");
    text = text.replace(/^\uFEFF/, ""); // BOM
    const line = (text.split(/\r?\n/)[0] || "").trim();
    return line;
  } finally {
    fs.closeSync(fd);
  }
}

function readFirstTwoLines(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(256 * 1024);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    let text = buf.slice(0, bytes).toString("utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return {
      header: lines[0] || "",
      sample: lines[1] || ""
    };
  } finally {
    fs.closeSync(fd);
  }
}

function detectDelimiterSmart(filePath) {
  const { header, sample } = readFirstTwoLines(filePath);

  const candidates = [",", ";", "\t", "|"];
  let best = { delim: ",", score: -1, headers: [] };

  for (const d of candidates) {
    const hCols = header.split(d).map(s => s.trim()).filter(Boolean);
    const sCols = sample.split(d).map(s => s.trim());

    // scoring:
    // queremos muchos headers y que la data tenga >= headers
    const score = (hCols.length * 10) + Math.min(sCols.length, 200) - Math.abs(sCols.length - hCols.length);

    if (hCols.length >= 4 && score > best.score) {
      best = { delim: d, score, headers: hCols };
    }
  }

  // fallback: si no encontró algo decente, usa la vieja heurística
  if (best.score < 0) {
    const headerLine = readFirstLine(filePath);
    const d = sniffDelimiter(headerLine);
    return { delimiter: d, headers: headerLine.split(d).map(s => s.trim()).filter(Boolean) };
  }

  return { delimiter: best.delim, headers: best.headers };
}

function sniffDelimiter(headerLine) {
  const counts = {
    ",": (headerLine.match(/,/g) || []).length,
    ";": (headerLine.match(/;/g) || []).length,
    "\t": (headerLine.match(/\t/g) || []).length,
    "|": (headerLine.match(/\|/g) || []).length,
  };
  let best = ",";
  let bestCount = counts[","];
  for (const k of Object.keys(counts)) {
    if (counts[k] > bestCount) {
      best = k;
      bestCount = counts[k];
    }
  }
  return bestCount === 0 ? "," : best;
}

async function ensurePartition(tsStr) {
  const q = `SELECT ensure_detection_partition(
    EXTRACT(YEAR FROM $1::timestamptz)::int,
    EXTRACT(MONTH FROM $1::timestamptz)::int
  );`;
  await pool.query(q, [tsStr]);
}

// Inserción por lotes
async function insertBatch({ rows, saveRaw }) {
  const values = [];
  const params = [];
  let p = 1;

  for (const r of rows) {
    // geom desde lat/lon en SQL
    values.push(`(
      $${p++},$${p++},$${p++},$${p++},$${p++},$${p++},
      CASE WHEN $${p}::double precision IS NULL OR $${p + 1}::double precision IS NULL THEN NULL
          ELSE ST_SetSRID(ST_MakePoint($${p + 1}::double precision,$${p}::double precision),4326)::geography
      END,
      $${p + 2},$${p + 3},$${p + 4},$${p + 5}
    )`);

    params.push(
      r.ts, r.imsi, r.imei, r.operator,   // 👈 operator aquí
      r.lat, r.lon,
      r.lat, r.lon,                        // para CASE
      r.distance_m,
      r.source_type, r.source_file, r.source_row
    );

    p += 6;
  }

  const sqlDet = `
    INSERT INTO detections
      (ts, imsi, imei, operator, lat, lon, geom, distance_m, source_type, source_file, source_row)
    VALUES ${values.join(",")}
    ON CONFLICT (source_file, source_row, ts) DO NOTHING;
  `;
  await pool.query(sqlDet, params);

  if (saveRaw) {
    const v2 = [];
    const p2 = [];
    let k = 1;
    for (const r of rows) {
      v2.push(`($${k++},$${k++},$${k++},$${k++},$${k++}::jsonb)`);
      p2.push(r.ts, r.source_type, r.source_file, r.source_row, JSON.stringify(r.raw));
    }
    const sqlRaw = `
      INSERT INTO detections_raw (ts, source_type, source_file, source_row, raw)
      VALUES ${v2.join(",")};
    `;
    await pool.query(sqlRaw, p2);
  }
}

// Procesa 1 archivo CSV
async function ingestCsvFile(filepath, originalName, { saveRaw = true, batchSize = 5000 } = {}) {
  const source_file = originalName;

  // evitar doble carga por nombre
  const exists = await pool.query("SELECT 1 FROM ingest_files WHERE source_file=$1", [source_file]);
  if (exists.rowCount) {
    return { source_file, skipped: true, reason: "Ya cargado (ingest_files)" };
  }

  // detectar delimiter + headers desde primera línea (más confiable que events)
  const { delimiter, headers } = detectDelimiterSmart(filepath);

    console.log("[CSV]", source_file, "delimiter=", JSON.stringify(delimiter), "headers=", headers.slice(0, 30));

    const source_type = detectType(headers);
    if (source_type === 0) {
    throw new Error(
        `No pude detectar tipo CSV (${source_file}). Delimiter=${delimiter}. Headers: ${headers.slice(0, 50).join(", ")}`
    );
    }


  

  await pool.query(
    "INSERT INTO ingest_files (source_file, source_type, rows_seen, rows_loaded, notes) VALUES ($1,$2,0,0,$3)",
    [source_file, source_type, "pending"]
  );

  let rows_seen = 0;
  let rows_loaded = 0;

  const batch = [];

  const rs = fs.createReadStream(filepath);
  const parser = parse({
    columns: true,
    bom: true,
    delimiter, // 👈 clave para ; o \t
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  });

  for await (const row of rs.pipe(parser)) {
    rows_seen++;
    const source_row = rows_seen;

    let ts, imsi, imei, lat, lon, dist, operator;

    if (source_type === 1) {
      ts = parseTs(pick(row, "dateTime", "datetime", "FECHA", "fecha", "DATE", "date", "Date"));
      imsi = (pick(row, "imsi") || "").trim() || null;
      imei = (pick(row, "imei") || "").trim() || null;
      operator = (pick(row, "operator", "Operator", "provider", "Provider", "OPERADOR", "operador") || "").trim() || null;

      const ue_lat = toFloat(pick(row, "ueLatitude", "uelatitude"));
      const ue_lon = toFloat(pick(row, "ueLongitude", "uelongitude"));

      const gps_lat = toFloat(pick(row, "gps_latitude", "gpsLatitude", "gpslat", "latitude"));
      const gps_lon = toFloat(pick(row, "gps_longitude", "gpsLongitude", "gpslon", "longitude"));

      if (validLatLon(ue_lat, ue_lon)) {
        lat = ue_lat; lon = ue_lon;
      } else if (validLatLon(gps_lat, gps_lon)) {
        lat = gps_lat; lon = gps_lon;
      } else {
        lat = null; lon = null;
      }

      dist = toFloat(pick(row, "relative_ue_distance", "distance", "distancia"));
    } else {
      ts = parseTs(pick(row, "Time", "time", "FECHA", "fecha", "DATE", "date", "Date"));
      imsi = (pick(row, "IMSI", "imsi") || "").trim() || null;
      imei = (pick(row, "IMEI", "imei") || "").trim() || null;
      operator = (pick(row, "operator", "Operator", "provider", "Provider", "OPERADOR", "operador") || "").trim() || null;
      lat = toFloat(pick(row, "Latitude", "lat", "LAT"));
      lon = toFloat(pick(row, "Longitude", "lon", "LONG", "LON"));
      dist = toFloat(pick(row, "DISTANCIA", "distancia", "distance")) ?? null;
    }

    if (!ts) continue;

    if (rows_seen === 1 || rows_seen % 10000 === 0) {
      await ensurePartition(ts);
    }

    batch.push({
      ts,
      imsi,
      imei,
      operator, // ✅ NUEVO
      lat,
      lon,
      distance_m: dist,
      source_type,
      source_file,
      source_row,
      raw: row,
    });

    if (batch.length >= batchSize) {
      await insertBatch({ rows: batch, saveRaw });
      rows_loaded += batch.length;
      batch.length = 0;
    }
  }

  if (batch.length) {
    await insertBatch({ rows: batch, saveRaw });
    rows_loaded += batch.length;
  }

  await pool.query(
    "UPDATE ingest_files SET rows_seen=$1, rows_loaded=$2, loaded_at=now(), notes=$3 WHERE source_file=$4",
    [rows_seen, rows_loaded, "ok", source_file]
  );

  return { source_file, source_type, rows_seen, rows_loaded, skipped: false, delimiter };
}

// ===== Route =====
router.post("/upload", upload.array("files", 20), async (req, res) => {
  const saveRaw = String(req.query.saveRaw ?? "1") === "1";

  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: "No llegaron archivos" });

    const results = [];
    for (const f of files) {
      const r = await ingestCsvFile(f.path, f.originalname, { saveRaw, batchSize: 5000 });
      results.push(r);
    }

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

import sqlite3 from "sqlite3";

// --- helper: promisify sqlite all/get ---
function sqliteOpenReadOnly(filePath) {
  return new sqlite3.Database(filePath, sqlite3.OPEN_READONLY);
}
function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function sqliteGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function sqliteClose(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

const DB3_VIEWS = [
  "DBViewer_LTE_InterrogationResultsView",
  "DBViewer_GSM_InterrogationResultsView",
  "DBViewer_UMTS_InterrogationResultsView",
];

async function ingestDbFile(filepath, originalName, { saveRaw = true, batchSize = 5000 } = {}) {
  const source_file = originalName;

  const exists = await pool.query("SELECT 1 FROM ingest_files WHERE source_file=$1", [source_file]);
  if (exists.rowCount) {
    return { source_file, skipped: true, reason: "Ya cargado (ingest_files)" };
  }

  const db = sqliteOpenReadOnly(filepath);

  try {
    // listar tablas/vistas
    const rowsTbl = await sqliteAll(
      db,
      "SELECT name, type FROM sqlite_master WHERE type IN ('table','view')"
    );
    const names = new Set(rowsTbl.map(r => r.name));

    const hasIdcatcher = names.has("idcatcher");
    const hasDb3Views = DB3_VIEWS.some(v => names.has(v));

    if (!hasIdcatcher && !hasDb3Views) {
      throw new Error(`No se encontraron tablas soportadas en ${source_file}`);
    }

    // source_type: 1 para idcatcher, 3 para db3-vistas
    const source_type = hasDb3Views ? 3 : 1;

    await pool.query(
      "INSERT INTO ingest_files (source_file, source_type, rows_seen, rows_loaded, notes) VALUES ($1,$2,0,0,$3)",
      [source_file, source_type, "pending"]
    );

    let rows_seen = 0;
    let rows_loaded = 0;
    const batch = [];

    // ========= CASO .db (idcatcher) =========
    if (hasIdcatcher) {
      // contar
      const c = await sqliteGet(db, "SELECT COUNT(1) AS n FROM idcatcher");
      const total = Number(c?.n || 0);

      for (let offset = 0; offset < total; offset += batchSize) {
        const rows = await sqliteAll(
          db,
          `
          SELECT
            _id as sid,
            dateTime,
            imsi,
            imei,
            ueLatitude,
            ueLongitude,
            gps_latitude,
            gps_longitude,
            relative_ue_distance,
            operator
          FROM idcatcher
          ORDER BY _id
          LIMIT ? OFFSET ?;
          `,
          [batchSize, offset]
        );

        for (const r of rows) {
          rows_seen++;

          const ts = parseTs(r.dateTime);
          if (!ts) continue;

          const imsi = (r.imsi || "").trim() || null;
          const imei = (r.imei || "").trim() || null;

          const ue_lat = toFloat(r.ueLatitude);
          const ue_lon = toFloat(r.ueLongitude);
          const gps_lat = toFloat(r.gps_latitude);
          const gps_lon = toFloat(r.gps_longitude);

          let lat = null, lon = null;
          if (validLatLon(ue_lat, ue_lon)) { lat = ue_lat; lon = ue_lon; }
          else if (validLatLon(gps_lat, gps_lon)) { lat = gps_lat; lon = gps_lon; }

          const dist = toFloat(r.relative_ue_distance); // puede ser null
          const operator = (r.operator || "").trim() || null;

          if (rows_seen === 1 || rows_seen % 10000 === 0) {
            await ensurePartition(ts);
          }

          batch.push({
            ts,
            imsi,
            imei,
            operator,          // ✅ de idcatcher.operator
            lat,
            lon,
            distance_m: dist,  // ✅ relative_ue_distance (puede ser null)
            source_type: 1,    // ✅ IMPORTANTE: idcatcher es tipo 1
            source_file,
            source_row: r.sid ?? rows_seen,  // ✅ usa _id
            raw: saveRaw ? r : null,
          });



          if (batch.length >= batchSize) {
            await insertBatch({ rows: batch, saveRaw });
            rows_loaded += batch.length;
            batch.length = 0;
          }
        }
      }
    }

    // ========= CASO .db3 (3 vistas DBView_*) =========
    for (const view of DB3_VIEWS) {
      if (!names.has(view)) continue;

      let viewRow = 0;

      const rows = await sqliteAll(db, `
        SELECT
          Time,
          IMSI,
          IMEI,
          Latitude,
          Longitude,
          "Estimated Range (m)" AS est_range_m,
          provider
        FROM "${view}";
      `);

      for (const r of rows) {
        viewRow++;

        rows_seen++;

        const ts =
          parseTs(r.Time) ||
          parseTs(r.Timestamp) ||
          parseTs(r["Time (UTC)"]) ||
          (Number.isFinite(Number(r.Time))
            ? new Date(Number(r.Time) * 1000)
            : null);

        if (!ts) continue;


        const imsi = (r.IMSI || "").trim() || null;
        const imei = (r.IMEI || "").trim() || null;

        const lat = toFloat(r.Latitude);
        const lon = toFloat(r.Longitude);

        // ⚠️ solo descarta si AMBOS son null
        if (lat == null || lon == null) continue;

        const dist = toFloat(r.est_range_m);
        const operator = (r.provider || "").trim() || null;

        if (rows_seen === 1 || rows_seen % 10000 === 0) {
          await ensurePartition(ts);
        }

        batch.push({
          ts,
          imsi,
          imei,
          operator: (r.provider || "").trim() || null,
          lat,
          lon,
          distance_m: toFloat(r.est_range_m),
          source_type: 3,
          source_file,                 // ✅ FALTABA
          source_row: `${view}:${viewRow}`,
          raw: saveRaw ? { ...r, _view: view } : null,
        });

        if (batch.length >= batchSize) {
          await insertBatch({ rows: batch, saveRaw });
          rows_loaded += batch.length;
          batch.length = 0;
        }
      }
    }

    // 🔥 FLUSH FINAL (MUY IMPORTANTE)
    if (batch.length) {
      await insertBatch({ rows: batch, saveRaw });
      rows_loaded += batch.length;
      batch.length = 0;
    }

    await pool.query(
      "UPDATE ingest_files SET rows_seen=$1, rows_loaded=$2, loaded_at=now(), notes=$3 WHERE source_file=$4",
      [rows_seen, rows_loaded, "ok", source_file]
    );

    return { source_file, source_type, rows_seen, rows_loaded, skipped: false };
  } finally {
    await sqliteClose(db);
  }
}

// ✅ Nuevo endpoint: subir DB/DB3
router.post("/upload-db", upload.array("files", 10), async (req, res) => {
  const saveRaw = String(req.query.saveRaw ?? "1") === "1";
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: "No llegaron archivos" });

    const results = [];
    for (const f of files) {
      const r = await ingestDbFile(f.path, f.originalname, { saveRaw, batchSize: 5000 });
      results.push(r);
    }

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

export default router;
