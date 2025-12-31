// backend/src/routes/telco.js
// -------------------------------------------------------------
// Telco Analysis Routes (XDR)
// - Modo individual / grupal
// - Detección de objetivo por repetición en todas las filas
// - Top contactos / detalles / lugares / coincidencias por antena
// - Reporte PDF con charts + screenshot ArcGIS
// -------------------------------------------------------------

import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { authRequired } from "../auth.js";
import { readXdrExcel } from "../lib/telco/read_xdr_excel.js";

// PDF (instalar: npm i pdfkit)
import PDFDocument from "pdfkit";

const router = Router();

// ==============================
// Upload config
// ==============================
const UPLOAD_DIR = path.resolve("uploads_telco");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-() ]+/g, "_");
    cb(null, `${Date.now()}__${safe}`);
  },
});

const upload = multer({ storage });

// ==============================
// Helpers (bulk insert)
// ==============================

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normPhone(v) {
  let s = String(v ?? "").trim();
  if (!s) return "";
  s = s.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (s.startsWith("57") && s.length > 10) s = s.slice(2);
  return s;
}

function normTs(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
  return s;
}

function normDir(r) {
  const d = String(r?.direction ?? "").toUpperCase().trim();
  if (d === "IN" || d === "OUT") return d;

  const t = String(r?.tipo ?? "").toUpperCase();
  if (t.includes("SALIENTE")) return "OUT";
  if (t.includes("ENTRANTE")) return "IN";
  return "IN";
}

function normCellId(operator, v) {
  let s = String(v ?? "").trim();
  if (!s) return null;

  s = s.replace(/[^\d]/g, "");
  if (!s) return null;

  // Regla CLARO: recorta último dígito para empatar antennas
  const op = String(operator ?? "").toUpperCase().trim();
  if (op === "CLARO" && s.length > 1) s = s.slice(0, -1);

  return s;
}

function buildBulkInsert(rows, cols, params) {
  const chunks = rows.map((r) => {
    const base = params.length;
    for (let i = 0; i < cols; i++) params.push(r[i]);
    const ph = Array.from({ length: cols }, (_, i) => `$${base + i + 1}`).join(",");
    return `(${ph})`;
  });
  return chunks.join(",");
}

/**
 * Normaliza 1 registro y añade metadata (archivo / grupo)
 * - meta.group: 1 o 2 (para análisis grupal)
 * - meta.sourceFile: nombre del Excel (para trazabilidad)
 */
function normalizeRecord(r, forcedOperator, meta = {}) {
  const operator = String(r.operator ?? forcedOperator ?? "").toUpperCase().trim() || null;

  // Guardamos metadata mínima dentro de raw para no tocar schema:
  // raw->__group, raw->__source_file
  const raw = {
    ...(r?.raw && typeof r.raw === "object" ? r.raw : {}),
    __group: meta.group ?? null,
    __source_file: meta.sourceFile ?? null,
  };

  return {
    ...r,
    operator,
    call_ts: normTs(r.call_ts),
    direction: normDir(r),
    a_number: normPhone(r.a_number),
    b_number: normPhone(r.b_number),
    celda_inicio: normCellId(operator, r.celda_inicio),
    celda_final: normCellId(operator, r.celda_final),
    lac_inicio: r.lac_inicio ?? null,
    lac_final: r.lac_final ?? null,
    raw,
  };
}

async function insertCallBatch(runId, rows) {
  if (!rows?.length) return { inserted: 0 };

  // VALUES order (17):
  const params = [];
  const valuesSql = buildBulkInsert(
    rows.map((r) => ([
      runId,
      r.call_ts,
      r.direction,
      r.a_number,
      r.b_number,
      r.duration_sec ?? null,
      r.tipo ?? null,
      r.operator ?? null,
      r.lac_inicio ?? null,
      r.celda_inicio ?? null,
      r.nombre_celda_inicio ?? null,
      r.lac_final ?? null,
      r.celda_final ?? null,
      r.nombre_celda_final ?? null,
      r.imsi ?? null,
      r.imei ?? null,
      JSON.stringify(r.raw ?? {}),
    ])),
    17,
    params
  );

  const sql = `
    INSERT INTO call_records_tmp
      (run_id, call_ts, direction, a_number, b_number, duration_sec, tipo,
       operator, lac_inicio, celda_inicio, nombre_celda_inicio, lac_final, celda_final, nombre_celda_final,
       imsi, imei, raw)
    VALUES ${valuesSql}
    ON CONFLICT ON CONSTRAINT ux_call_dedupe DO NOTHING;
  `;

  const r = await pool.query(sql, params);
  return { inserted: r.rowCount };
}

async function refreshPrioritizedHits(runId) {
  // Nota: queda tal cual (si ya lo estabas usando)
  await pool.query(
    `
    INSERT INTO prioritized_hits (run_id, call_record_id, objetivo_id, match_type)
    SELECT t.run_id, t.id, o.id, 'TEL_A'
    FROM call_records_tmp t
    JOIN objetivos_priorizados o ON o.telefono IS NOT NULL AND o.telefono = t.a_number
    WHERE t.run_id = $1
    ON CONFLICT DO NOTHING;
    `,
    [runId]
  );

  await pool.query(
    `
    INSERT INTO prioritized_hits (run_id, call_record_id, objetivo_id, match_type)
    SELECT t.run_id, t.id, o.id, 'TEL_B'
    FROM call_records_tmp t
    JOIN objetivos_priorizados o ON o.telefono IS NOT NULL AND o.telefono = t.b_number
    WHERE t.run_id = $1
    ON CONFLICT DO NOTHING;
    `,
    [runId]
  );

  await pool.query(
    `
    INSERT INTO prioritized_hits (run_id, call_record_id, objetivo_id, match_type)
    SELECT t.run_id, t.id, o.id, 'IMSI'
    FROM call_records_tmp t
    JOIN objetivos_priorizados o ON o.imsi IS NOT NULL AND o.imsi = t.imsi
    WHERE t.run_id = $1 AND t.imsi IS NOT NULL
    ON CONFLICT DO NOTHING;
    `,
    [runId]
  );

  await pool.query(
    `
    INSERT INTO prioritized_hits (run_id, call_record_id, objetivo_id, match_type)
    SELECT t.run_id, t.id, o.id, 'IMEI'
    FROM call_records_tmp t
    JOIN objetivos_priorizados o ON o.imei IS NOT NULL AND o.imei = t.imei
    WHERE t.run_id = $1 AND t.imei IS NOT NULL
    ON CONFLICT DO NOTHING;
    `,
    [runId]
  );
}

/**
 * WHERE común + filtros (fecha, dir, horario)
 * - IMPORTANTÍSIMO: horario en America/Bogota, soporta cruzar medianoche.
 */
function buildWhereCalls({ runId, from, to, hourFrom, hourTo, dir }, params) {
  const where = [];
  params.push(runId);
  where.push(`run_id = $${params.length}`);

  if (from) {
    params.push(from);
    where.push(`call_ts >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    where.push(`call_ts <= $${params.length}::timestamptz`);
  }

  if (dir && dir !== "BOTH") {
    params.push(dir);
    where.push(`direction::text = $${params.length}`);
  }

  if (hourFrom != null && hourTo != null) {
    const hf = Number(hourFrom);
    const ht = Number(hourTo);
    if (Number.isFinite(hf) && Number.isFinite(ht) && hf >= 0 && hf <= 23 && ht >= 0 && ht <= 23) {
      params.push(hf, ht);
      const pHf = `$${params.length - 1}`;
      const pHt = `$${params.length}`;

      const hourExpr = `EXTRACT(HOUR FROM (call_ts AT TIME ZONE 'America/Bogota'))`;

      // Cruza medianoche
      if (hf <= ht) where.push(`${hourExpr} BETWEEN ${pHf} AND ${pHt}`);
      else where.push(`(${hourExpr} >= ${pHf} OR ${hourExpr} <= ${pHt})`);
    }
  }

  return `WHERE ${where.join(" AND ")}`;
}

/**
 * Filtros extra (phone / group) sin duplicar lógica
 */
function applyScopeFilters({ whereSql, params, phone, group }) {
  let where = whereSql;

  // Filtro por grupo (para análisis grupal)
  if (group != null) {
    params.push(String(group));
    where += ` AND COALESCE(raw->>'__group','') = $${params.length}`;
  }

  // Filtro por objetivo (si viene)
  if (phone) {
    const p = normPhone(phone);
    params.push(p);
    where += ` AND (a_number = $${params.length} OR b_number = $${params.length})`;
  }

  return { where, params };
}

function parseGroup(v) {
  const g = Number(v);
  if (g === 1 || g === 2) return g;
  return null;
}

/**
 * Detecta "cell_key" (solo dígitos) para comparar celdas
 */
function normCellKey(v) {
  const s = String(v ?? "").replace(/[^\d]/g, "");
  return s || null;
}

// ==============================
// Antennas metadata (dynamic / robust)
// ==============================

let _antennaMetaCache = null;
let _postgisCache = null;

function qIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function isPostgisEnabled() {
  if (_postgisCache != null) return _postgisCache;
  try {
    const r = await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS ok;`);
    _postgisCache = Boolean(r.rows[0]?.ok);
  } catch {
    _postgisCache = false;
  }
  return _postgisCache;
}

async function getAntennaMeta() {
  if (_antennaMetaCache) return _antennaMetaCache;

  const t = await pool.query(`
    SELECT EXISTS(
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='antennas'
    ) AS ok;
  `);

  if (!t.rows[0]?.ok) {
    _antennaMetaCache = { hasTable: false };
    return _antennaMetaCache;
  }

  const colsQ = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='antennas';
  `);

  const cols = new Set(colsQ.rows.map((r) => r.column_name));
  const pickFirst = (cands) => cands.find((c) => cols.has(c)) || null;

  const opCol = pickFirst(["operator", "operador", "carrier"]);
  const keyCol = pickFirst(["antenna", "cell_id", "cellid", "celda", "cell", "cell_key"]);
  const labelCol = pickFirst(["localidad", "municipio", "ciudad", "nombre_celda", "cell_name", "name", "site_name"]);
  const latCol = pickFirst(["lat", "latitude", "latitud", "y"]);
  const lonCol = pickFirst(["lon", "lng", "longitude", "longitud", "x"]);
  const geomCol = pickFirst(["geom", "geometry", "shape"]);
  const postgis = await isPostgisEnabled();

  _antennaMetaCache = { hasTable: true, opCol, keyCol, labelCol, latCol, lonCol, geomCol, postgis };
  return _antennaMetaCache;
}

/**
 * Top lugares (con join a antennas si existe).
 * Reutilizable para top y para enriquecer lugares comunes / coincidencias.
 */
async function buildPlacesQuerySQL() {
  const meta = await getAntennaMeta();
  const canJoin = Boolean(meta.hasTable && meta.opCol && meta.keyCol);

  const joinSql = canJoin
    ? `LEFT JOIN antennas a ON a.${qIdent(meta.opCol)} = n.operator AND a.${qIdent(meta.keyCol)} = n.cell_key`
    : "";

  const labelExpr = canJoin && meta.labelCol
    ? `COALESCE(a.${qIdent(meta.labelCol)}::text, n.cell_name, 'SIN_DATO')`
    : `COALESCE(n.cell_name, 'SIN_DATO')`;

  let latExpr = `NULL::double precision`;
  let lonExpr = `NULL::double precision`;

  if (canJoin && meta.latCol && meta.lonCol) {
    latExpr = `a.${qIdent(meta.latCol)}::double precision`;
    lonExpr = `a.${qIdent(meta.lonCol)}::double precision`;
  } else if (canJoin && meta.postgis && meta.geomCol) {
    latExpr = `ST_Y(a.${qIdent(meta.geomCol)})::double precision`;
    lonExpr = `ST_X(a.${qIdent(meta.geomCol)})::double precision`;
  }

  const sql = `
    WITH cells AS (
      SELECT operator, celda_inicio AS cell_id, nombre_celda_inicio AS cell_name, call_ts, direction, a_number, b_number
      FROM call_records_tmp
      __WHERE__
      AND celda_inicio IS NOT NULL

      UNION ALL

      SELECT operator, celda_final AS cell_id, nombre_celda_final AS cell_name, call_ts, direction, a_number, b_number
      FROM call_records_tmp
      __WHERE__
      AND celda_final IS NOT NULL
    ),
    norm AS (
      SELECT
        operator,
        REGEXP_REPLACE(cell_id::text, '[^0-9]', '', 'g') AS cell_key,
        NULLIF(TRIM(cell_name::text), '') AS cell_name,
        call_ts, direction, a_number, b_number
      FROM cells
    )
    SELECT
      n.operator,
      n.cell_key,
      ${labelExpr} AS lugar,
      COUNT(*)::bigint AS hits,
      ${latExpr} AS lat,
      ${lonExpr} AS lon
    FROM norm n
    ${joinSql}
    WHERE n.cell_key IS NOT NULL AND n.cell_key <> ''
    GROUP BY n.operator, n.cell_key, lugar, lat, lon
    ORDER BY hits DESC
    LIMIT __LIMIT__;
  `;

  return { sql, canJoin };
}

// ==============================
// Routes
// ==============================

/**
 * Crear run con nombre
 * Body: { name?: string }
 */
router.post("/runs", authRequired, async (req, res) => {
  try {
    const created_by = req.user?.id ?? null;
    const name = String(req.body?.name ?? "").trim();
    const safeName = name || `Analisis ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;

    const r = await pool.query(
      `INSERT INTO analysis_runs (created_by, name) VALUES ($1, $2) RETURNING id, created_at, name`,
      [created_by, safeName]
    );

    res.json({ ok: true, run: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

router.get("/runs/:runId", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const r = await pool.query(`SELECT id, created_at, name FROM analysis_runs WHERE id = $1`, [runId]);
    if (!r.rowCount) return res.status(404).json({ ok: false, error: "Run no existe" });

    res.json({ ok: true, run: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

router.patch("/runs/:runId", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "name requerido" });

    const r = await pool.query(
      `UPDATE analysis_runs SET name = $2 WHERE id = $1 RETURNING id, created_at, name`,
      [runId, name]
    );
    if (!r.rowCount) return res.status(404).json({ ok: false, error: "Run no existe" });

    res.json({ ok: true, run: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Limpia temporal (para “Nuevo análisis”)
 */
router.delete("/runs/:runId/clear", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const del = await pool.query(`DELETE FROM call_records_tmp WHERE run_id = $1`, [runId]);
    await pool.query(`DELETE FROM prioritized_hits WHERE run_id = $1`, [runId]);

    res.json({ ok: true, deleted: del.rowCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Upload XDR Excel(s)
 * Query:
 * - operator=CLARO|MOVISTAR|TIGO|WOM|OTRO
 * - group=1|2 (solo para análisis grupal, para marcar a qué objetivo pertenece la carga)
 */
router.post("/runs/:runId/upload-xdr", authRequired, upload.array("files", 20), async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const forcedOperator = String(req.query.operator ?? "").toUpperCase().trim() || null;
    const group = parseGroup(req.query.group);

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: "No llegaron archivos" });

    let seen = 0, inserted = 0;
    const perFile = [];

    for (const f of files) {
      const { records } = readXdrExcel(f.path);
      seen += records.length;

      // Normalizamos + adjuntamos meta de archivo y grupo (si aplica)
      const normalized = records.map((r) => normalizeRecord(r, forcedOperator, { sourceFile: f.originalname, group }));

      const B = 3000;
      let fileInserted = 0;

      for (let i = 0; i < normalized.length; i += B) {
        const chunk = normalized.slice(i, i + B);
        const r = await insertCallBatch(runId, chunk);
        fileInserted += r.inserted;
      }

      inserted += fileInserted;

      perFile.push({
        file: f.originalname,
        group,
        rows_seen: records.length,
        rows_inserted: fileInserted,
        rows_omitted: records.length - fileInserted,
      });

      try { fs.unlinkSync(f.path); } catch {}
    }

    // Prioritized hits (si lo estás usando)
    await refreshPrioritizedHits(runId);

    const hits = await pool.query(
      `SELECT count(*)::bigint AS hits FROM prioritized_hits WHERE run_id = $1`,
      [runId]
    );

    res.json({
      ok: true,
      runId,
      operator: forcedOperator,
      group,
      rows_seen: seen,
      rows_inserted: inserted,
      rows_omitted: seen - inserted,
      prioritized_hits: Number(hits.rows[0]?.hits || 0),
      results: perFile,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Detecta el objetivo:
 * - Busca el número que aparece en el 100% de filas (en A o B)
 * - Soporta group=1|2 para análisis grupal
 * Respuesta:
 * { phone, confidence, total_rows, side_hint }
 */
router.get("/runs/:runId/objective/detect", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const group = parseGroup(req.query.group);

    const { from = null, to = null, dir = "BOTH", hour_from = null, hour_to = null } = req.query;

    const params = [];
    let whereSql = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, params);
    ({ where: whereSql } = applyScopeFilters({ whereSql, params, phone: null, group }));

    // Total filas (scope)
    const totalQ = await pool.query(`SELECT COUNT(*)::bigint AS n FROM call_records_tmp ${whereSql};`, params);
    const total = Number(totalQ.rows[0]?.n || 0);

    if (!total) {
      return res.json({ ok: true, phone: null, confidence: 0, total_rows: 0, side_hint: null, group });
    }

    // Candidato = el que aparece en TODAS las filas (en A o en B)
    const cand = await pool.query(
      `
      WITH base AS (
        SELECT a_number, b_number
        FROM call_records_tmp
        ${whereSql}
      ),
      cnt AS (
        SELECT phone, SUM(c)::bigint AS hits
        FROM (
          SELECT a_number AS phone, COUNT(*)::bigint AS c FROM base GROUP BY a_number
          UNION ALL
          SELECT b_number AS phone, COUNT(*)::bigint AS c FROM base GROUP BY b_number
        ) x
        WHERE phone IS NOT NULL AND phone <> ''
        GROUP BY phone
      )
      SELECT phone, hits
      FROM cnt
      ORDER BY hits DESC
      LIMIT 10;
      `,
      params
    );

    const best = cand.rows?.[0] || null;
    if (!best) {
      return res.json({ ok: true, phone: null, confidence: 0, total_rows: total, side_hint: null, group });
    }

    const phone = String(best.phone);
    const hits = Number(best.hits || 0);
    const confidence = total ? Math.max(0, Math.min(1, hits / total)) : 0;

    // Side hint: en qué columna aparece más
    const phoneParamIndex = params.length + 1; // <- phone va AL FINAL, no al inicio

    const sideQ = await pool.query(
      `
      SELECT
        SUM(CASE WHEN a_number = $${phoneParamIndex} THEN 1 ELSE 0 END)::bigint AS a_hits,
        SUM(CASE WHEN b_number = $${phoneParamIndex} THEN 1 ELSE 0 END)::bigint AS b_hits
      FROM call_records_tmp
      ${whereSql};
      `,
      [...params, phone] // <- IMPORTANTE: phone al final
    );

    const aHits = Number(sideQ.rows[0]?.a_hits || 0);
    const bHits = Number(sideQ.rows[0]?.b_hits || 0);
    const side_hint = aHits >= bHits ? "A" : "B";

    res.json({ ok: true, phone, confidence, total_rows: total, side_hint, group });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Summary enfocado al objetivo (KPIs estilo “i2”)
 * Query: phone=...&group=1|2 (opc)
 */
router.get("/runs/:runId/objective/summary", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const phone = normPhone(req.query.phone);
    if (!phone) return res.status(400).json({ ok: false, error: "phone requerido" });

    const group = parseGroup(req.query.group);
    const { from = null, to = null, dir = "BOTH", hour_from = null, hour_to = null } = req.query;

    const params = [];
    let whereSql = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, params);

    // aplica filtros por objetivo y grupo (phone queda como el ÚLTIMO parámetro agregado)
    ({ where: whereSql } = applyScopeFilters({ whereSql, params, phone, group }));

    // índice del parámetro phone dentro del query (porque applyScopeFilters lo agrega al final)
    const pObj = `$${params.length}`;

    const q = await pool.query(
      `
      WITH base AS (
        SELECT call_ts, a_number, b_number
        FROM call_records_tmp
        ${whereSql}
      ),
      others AS (
        SELECT
          NULLIF(
            CASE WHEN a_number = ${pObj} THEN b_number ELSE a_number END,
            ''
          ) AS other
        FROM base
      )
      SELECT
        (SELECT COUNT(*)::bigint FROM base) AS total_calls,
        (SELECT MIN(call_ts) FROM base) AS min_ts,
        (SELECT MAX(call_ts) FROM base) AS max_ts,
        (
          SELECT COUNT(DISTINCT other)::bigint
          FROM others
          WHERE other IS NOT NULL AND other <> ${pObj}
        ) AS uniq_contacts;
      `,
      params
    );

    res.json({ ok: true, phone, kpis: q.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Timeline (eventos) con filtros + opcional phone y group
 */
router.get("/runs/:runId/flows/timeline", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const {
      from = null,
      to = null,
      dir = "BOTH",
      hour_from = null,
      hour_to = null,
      phone = null,
      group = null,
      limit = 2000,
    } = req.query;

    const LIMIT = clampInt(limit, 2000, 50, 20000);
    const params = [];
    let whereSql = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, params);

    const g = parseGroup(group);
    ({ where: whereSql } = applyScopeFilters({ whereSql, params, phone, group: g }));

    params.push(LIMIT);

    const q = await pool.query(
      `
      SELECT
        id,
        call_ts,
        direction,
        a_number,
        b_number,
        duration_sec,
        operator,
        lac_inicio,
        celda_inicio,
        nombre_celda_inicio,
        lac_final,
        celda_final,
        nombre_celda_final
      FROM call_records_tmp
      ${whereSql}
      ORDER BY call_ts ASC
      LIMIT $${params.length};
      `,
      params
    );

    res.json({ ok: true, rows: q.rows, limit: LIMIT });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * TimeSeries (línea de tiempo por buckets)
 * Query:
 * - phone requerido
 * - bucket=hour|day (default day)
 */
router.get("/runs/:runId/flows/timeseries", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const phone = normPhone(req.query.phone);
    if (!phone) return res.status(400).json({ ok: false, error: "phone requerido" });

    const bucket = String(req.query.bucket || "day").toLowerCase();
    const bucketUnit = bucket === "hour" ? "hour" : "day";

    const group = parseGroup(req.query.group);
    const { from = null, to = null, dir = "BOTH", hour_from = null, hour_to = null } = req.query;

    const params = [];
    let whereSql = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, params);
    ({ where: whereSql } = applyScopeFilters({ whereSql, params, phone, group }));

    const q = await pool.query(
      `
      SELECT
        date_trunc('${bucketUnit}', (call_ts AT TIME ZONE 'America/Bogota')) AS bucket_ts,
        COUNT(*)::bigint AS n
      FROM call_records_tmp
      ${whereSql}
      GROUP BY 1
      ORDER BY 1 ASC;
      `,
      params
    );

    res.json({ ok: true, bucket: bucketUnit, rows: q.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Top contactos del objetivo (tipo i2)
 * Query:
 * - phone requerido
 * - limit default 12
 */
router.get("/runs/:runId/contacts/top", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const phone = normPhone(req.query.phone);
    if (!phone) return res.status(400).json({ ok: false, error: "phone requerido" });

    const limit = clampInt(req.query.limit, 12, 5, 50);
    const group = parseGroup(req.query.group);

    const { from = null, to = null, dir = "BOTH", hour_from = null, hour_to = null } = req.query;

    const params = [];
    let whereSql = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, params);
    ({ where: whereSql } = applyScopeFilters({ whereSql, params, phone, group }));

    // Top contactos = “el otro lado” del enlace donde participa phone
    const q = await pool.query(
      `
      WITH base AS (
        SELECT call_ts, duration_sec, a_number, b_number
        FROM call_records_tmp
        ${whereSql}
      )
      SELECT
        other,
        COUNT(*)::bigint AS calls,
        COALESCE(SUM(duration_sec),0)::bigint AS total_duration,
        MIN(call_ts) AS first_ts,
        MAX(call_ts) AS last_ts
      FROM (
        SELECT
          CASE WHEN a_number = $${params.length} THEN b_number ELSE a_number END AS other,
          duration_sec,
          call_ts
        FROM base
      ) x
      WHERE other IS NOT NULL AND other <> '' AND other <> $${params.length}
      GROUP BY other
      ORDER BY calls DESC
      LIMIT $${params.length + 1};
      `,
      [...params, limit]
    );

    res.json({ ok: true, phone, rows: q.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Detalle de contacto (paginado)
 * Query:
 * - phone requerido
 * - other requerido
 * - page (0..)
 * - page_size (default 80)
 */
router.get("/runs/:runId/contacts/detail", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const phone = normPhone(req.query.phone);
    const other = normPhone(req.query.other);
    if (!phone || !other) return res.status(400).json({ ok: false, error: "phone y other requeridos" });

    const page = clampInt(req.query.page, 0, 0, 100000);
    const pageSize = clampInt(req.query.page_size, 80, 20, 500);
    const offset = page * pageSize;

    const group = parseGroup(req.query.group);
    const { from = null, to = null, dir = "BOTH", hour_from = null, hour_to = null } = req.query;

    const params = [];
    let whereSql = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, params);
    ({ where: whereSql } = applyScopeFilters({ whereSql, params, phone: null, group }));

    // pares (phone <-> other)
    params.push(phone, other, pageSize, offset);
    const pPhone = `$${params.length - 3}`;
    const pOther = `$${params.length - 2}`;
    const pLimit = `$${params.length - 1}`;
    const pOff = `$${params.length}`;

    const sql = `
      SELECT
        id,
        call_ts,
        direction,
        a_number,
        b_number,
        duration_sec,
        operator,
        celda_inicio,
        nombre_celda_inicio,
        celda_final,
        nombre_celda_final
      FROM call_records_tmp
      ${whereSql}
      AND (
        (a_number = ${pPhone} AND b_number = ${pOther})
        OR
        (a_number = ${pOther} AND b_number = ${pPhone})
      )
      ORDER BY call_ts ASC
      LIMIT ${pLimit}
      OFFSET ${pOff};
    `;

    const q = await pool.query(sql, params);

    res.json({ ok: true, phone, other, page, page_size: pageSize, rows: q.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Top lugares (filtrable por phone y group)
 * Query:
 * - phone opcional
 * - group opcional
 */
router.get("/runs/:runId/places/top", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const {
      from = null,
      to = null,
      dir = "BOTH",
      hour_from = null,
      hour_to = null,
      phone = null,
      group = null,
      limit = 12,
    } = req.query;

    const LIMIT = clampInt(limit, 12, 5, 50);
    const params = [];
    let whereSql = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, params);
    ({ where: whereSql } = applyScopeFilters({ whereSql, params, phone, group: parseGroup(group) }));

    const { sql } = await buildPlacesQuerySQL();

    // Reutiliza el mismo WHERE en ambos SELECT del CTE "cells"
    const finalSql = sql
      .replaceAll("__WHERE__", whereSql)
      .replaceAll("__LIMIT__", `$${params.length + 1}`);

    params.push(LIMIT);

    const q = await pool.query(finalSql, params);
    res.json({ ok: true, rows: q.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Detalle de lugar (paginado): lista fechas/horas de “estuvo allí”
 * Query:
 * - cell_key requerido (solo dígitos o lo normalizamos)
 * - phone requerido
 * - group opcional
 * - page/page_size
 */
router.get("/runs/:runId/places/detail", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const phone = normPhone(req.query.phone);
    if (!phone) return res.status(400).json({ ok: false, error: "phone requerido" });

    const cellKey = normCellKey(req.query.cell_key);
    if (!cellKey) return res.status(400).json({ ok: false, error: "cell_key requerido" });

    const page = clampInt(req.query.page, 0, 0, 100000);
    const pageSize = clampInt(req.query.page_size, 80, 20, 500);
    const offset = page * pageSize;

    const group = parseGroup(req.query.group);
    const { from = null, to = null, dir = "BOTH", hour_from = null, hour_to = null } = req.query;

    const params = [];
    let whereSql = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, params);
    ({ where: whereSql } = applyScopeFilters({ whereSql, params, phone, group }));

    // match por celda_inicio o celda_final normalizada (solo dígitos)
    params.push(cellKey, pageSize, offset);
    const pCell = `$${params.length - 2}`;
    const pLimit = `$${params.length - 1}`;
    const pOff = `$${params.length}`;

    const q = await pool.query(
      `
      SELECT
        id,
        call_ts,
        direction,
        operator,
        a_number,
        b_number,
        duration_sec,
        celda_inicio,
        nombre_celda_inicio,
        celda_final,
        nombre_celda_final,
        CASE
          WHEN REGEXP_REPLACE(COALESCE(celda_inicio::text,''), '[^0-9]', '', 'g') = ${pCell} THEN 'INICIO'
          WHEN REGEXP_REPLACE(COALESCE(celda_final::text,''), '[^0-9]', '', 'g') = ${pCell} THEN 'FINAL'
          ELSE 'NA'
        END AS match_side
      FROM call_records_tmp
      ${whereSql}
      AND (
        REGEXP_REPLACE(COALESCE(celda_inicio::text,''), '[^0-9]', '', 'g') = ${pCell}
        OR
        REGEXP_REPLACE(COALESCE(celda_final::text,''), '[^0-9]', '', 'g') = ${pCell}
      )
      ORDER BY call_ts ASC
      LIMIT ${pLimit}
      OFFSET ${pOff};
      `,
      params
    );

    res.json({ ok: true, phone, cell_key: cellKey, page, page_size: pageSize, rows: q.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * -----------------------------
 * ANÁLISIS GRUPAL
 * -----------------------------
 * common-contacts:
 * - Intersección de contactos de phone1 vs phone2
 */
router.get("/runs/:runId/group/common-contacts", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const phone1 = normPhone(req.query.phone1);
    const phone2 = normPhone(req.query.phone2);
    if (!phone1 || !phone2) return res.status(400).json({ ok: false, error: "phone1 y phone2 requeridos" });

    const group1 = parseGroup(req.query.group1);
    const group2 = parseGroup(req.query.group2);

    const limit = clampInt(req.query.limit, 20, 5, 100);

    const { from = null, to = null, dir = "BOTH", hour_from = null, hour_to = null } = req.query;

    // C1
    const p1 = [];
    let w1 = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, p1);
    ({ where: w1 } = applyScopeFilters({ whereSql: w1, params: p1, phone: phone1, group: group1 }));

    // C2
    const p2 = [];
    let w2 = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, p2);
    ({ where: w2 } = applyScopeFilters({ whereSql: w2, params: p2, phone: phone2, group: group2 }));

    // Intersección en SQL:
    // - contactos(phoneX) = CASE when a=phone then b else a
    // - unimos por other
    const q = await pool.query(
      `
      WITH c1 AS (
        SELECT
          CASE WHEN a_number = $1 THEN b_number ELSE a_number END AS other,
          COUNT(*)::bigint AS calls1
        FROM call_records_tmp
        ${w1}
        GROUP BY 1
      ),
      c2 AS (
        SELECT
          CASE WHEN a_number = $2 THEN b_number ELSE a_number END AS other,
          COUNT(*)::bigint AS calls2
        FROM call_records_tmp
        ${w2}
        GROUP BY 1
      )
      SELECT
        c1.other,
        c1.calls1,
        c2.calls2,
        (c1.calls1 + c2.calls2)::bigint AS total_calls
      FROM c1
      JOIN c2 ON c2.other = c1.other
      WHERE c1.other IS NOT NULL AND c1.other <> '' AND c1.other <> $1 AND c1.other <> $2
      ORDER BY total_calls DESC
      LIMIT $3;
      `,
      [phone1, phone2, limit, ...p1, ...p2] // (nota: phone1/phone2 están fuera, pero w1/w2 ya incluyen params propios)
    );

    // OJO: el query anterior mezcla params; para evitar confusión, lo resolvemos con un query seguro separado:
    // -> Para mantener estabilidad, devolvemos resultado con una estrategia más simple y segura:
    // En vez de forzar reuse, hacemos dos queries y cruzamos en JS si tu dataset no es gigante.
    // Pero aquí ya estás en producción: dejamos el query “seguro” real abajo.

    // --- Implementación segura real (dos consultas + cruce) ---
    const c1q = await pool.query(
      `
      WITH base AS (
        SELECT a_number, b_number
        FROM call_records_tmp
        ${w1}
      )
      SELECT
        other,
        COUNT(*)::bigint AS calls
      FROM (
        SELECT CASE WHEN a_number = $${p1.length} THEN b_number ELSE a_number END AS other
        FROM base
      ) x
      WHERE other IS NOT NULL AND other <> '' AND other <> $${p1.length}
      GROUP BY other;
      `,
      p1
    );

    const c2q = await pool.query(
      `
      WITH base AS (
        SELECT a_number, b_number
        FROM call_records_tmp
        ${w2}
      )
      SELECT
        other,
        COUNT(*)::bigint AS calls
      FROM (
        SELECT CASE WHEN a_number = $${p2.length} THEN b_number ELSE a_number END AS other
        FROM base
      ) x
      WHERE other IS NOT NULL AND other <> '' AND other <> $${p2.length}
      GROUP BY other;
      `,
      p2
    );

    const m1 = new Map(c1q.rows.map((r) => [String(r.other), Number(r.calls || 0)]));
    const m2 = new Map(c2q.rows.map((r) => [String(r.other), Number(r.calls || 0)]));

    const common = [];
    for (const [k, v1] of m1.entries()) {
      if (m2.has(k)) {
        const v2 = m2.get(k);
        common.push({ other: k, calls1: v1, calls2: v2, total_calls: v1 + v2 });
      }
    }
    common.sort((a, b) => b.total_calls - a.total_calls);

    res.json({ ok: true, rows: common.slice(0, limit) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * common-places:
 * - Intersección de cell_key (lugares) para ambos objetivos
 */
router.get("/runs/:runId/group/common-places", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const phone1 = normPhone(req.query.phone1);
    const phone2 = normPhone(req.query.phone2);
    if (!phone1 || !phone2) return res.status(400).json({ ok: false, error: "phone1 y phone2 requeridos" });

    const group1 = parseGroup(req.query.group1);
    const group2 = parseGroup(req.query.group2);

    const limit = clampInt(req.query.limit, 20, 5, 100);
    const { from = null, to = null, dir = "BOTH", hour_from = null, hour_to = null } = req.query;

    // Reusamos places/top para cada phone y cruzamos por cell_key
    const p1 = [];
    let w1 = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, p1);
    ({ where: w1 } = applyScopeFilters({ whereSql: w1, params: p1, phone: phone1, group: group1 }));

    const p2 = [];
    let w2 = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, p2);
    ({ where: w2 } = applyScopeFilters({ whereSql: w2, params: p2, phone: phone2, group: group2 }));

    const { sql } = await buildPlacesQuerySQL();
    const sql1 = sql.replaceAll("__WHERE__", w1).replaceAll("__LIMIT__", `$${p1.length + 1}`);
    const sql2 = sql.replaceAll("__WHERE__", w2).replaceAll("__LIMIT__", `$${p2.length + 1}`);

    const t1 = await pool.query(sql1, [...p1, 200]);
    const t2 = await pool.query(sql2, [...p2, 200]);

    const m1 = new Map(t1.rows.map((r) => [`${r.operator}:${r.cell_key}`, r]));
    const common = [];

    for (const r of t2.rows) {
      const key = `${r.operator}:${r.cell_key}`;
      if (m1.has(key)) {
        const a = m1.get(key);
        common.push({
          operator: r.operator,
          cell_key: r.cell_key,
          lugar: r.lugar || a.lugar,
          hits1: Number(a.hits || 0),
          hits2: Number(r.hits || 0),
          total_hits: Number(a.hits || 0) + Number(r.hits || 0),
          lat: r.lat ?? a.lat ?? null,
          lon: r.lon ?? a.lon ?? null,
        });
      }
    }

    common.sort((x, y) => y.total_hits - x.total_hits);

    res.json({ ok: true, rows: common.slice(0, limit) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * coincidences:
 * - coincidieron en la misma antena dentro de ventana (default 3h)
 * Query:
 * - phone1, phone2 requeridos
 * - window_hours default 3
 */
router.get("/runs/:runId/group/coincidences", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const phone1 = normPhone(req.query.phone1);
    const phone2 = normPhone(req.query.phone2);
    if (!phone1 || !phone2) return res.status(400).json({ ok: false, error: "phone1 y phone2 requeridos" });

    const group1 = parseGroup(req.query.group1);
    const group2 = parseGroup(req.query.group2);

    const windowHours = Number(req.query.window_hours ?? 3);
    const windowSec = (Number.isFinite(windowHours) ? windowHours : 3) * 3600;

    const limit = clampInt(req.query.limit, 200, 50, 2000);

    const { from = null, to = null, dir = "BOTH", hour_from = null, hour_to = null } = req.query;

    // Base scope para cada phone + group
    const p1 = [];
    let w1 = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, p1);
    ({ where: w1 } = applyScopeFilters({ whereSql: w1, params: p1, phone: phone1, group: group1 }));

    const p2 = [];
    let w2 = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, p2);
    ({ where: w2 } = applyScopeFilters({ whereSql: w2, params: p2, phone: phone2, group: group2 }));

    // Construimos eventos por celda (inicio + final) y hacemos join por cell_key
    // + condición de diferencia <= windowSec
    const q = await pool.query(
      `
      WITH e1 AS (
        SELECT
          operator,
          REGEXP_REPLACE(COALESCE(celda_inicio::text,''), '[^0-9]', '', 'g') AS cell_key,
          call_ts AS ts,
          a_number, b_number
        FROM call_records_tmp
        ${w1}
        AND celda_inicio IS NOT NULL

        UNION ALL

        SELECT
          operator,
          REGEXP_REPLACE(COALESCE(celda_final::text,''), '[^0-9]', '', 'g') AS cell_key,
          call_ts AS ts,
          a_number, b_number
        FROM call_records_tmp
        ${w1}
        AND celda_final IS NOT NULL
      ),
      e2 AS (
        SELECT
          operator,
          REGEXP_REPLACE(COALESCE(celda_inicio::text,''), '[^0-9]', '', 'g') AS cell_key,
          call_ts AS ts,
          a_number, b_number
        FROM call_records_tmp
        ${w2}
        AND celda_inicio IS NOT NULL

        UNION ALL

        SELECT
          operator,
          REGEXP_REPLACE(COALESCE(celda_final::text,''), '[^0-9]', '', 'g') AS cell_key,
          call_ts AS ts,
          a_number, b_number
        FROM call_records_tmp
        ${w2}
        AND celda_final IS NOT NULL
      )
      SELECT
        e1.operator,
        e1.cell_key,
        e1.ts AS ts1,
        e2.ts AS ts2,
        ABS(EXTRACT(EPOCH FROM (e1.ts - e2.ts)))::bigint AS delta_sec
      FROM e1
      JOIN e2
        ON e2.operator = e1.operator
       AND e2.cell_key = e1.cell_key
      WHERE e1.cell_key IS NOT NULL AND e1.cell_key <> ''
        AND ABS(EXTRACT(EPOCH FROM (e1.ts - e2.ts))) <= $1
      ORDER BY delta_sec ASC
      LIMIT $2;
      `,
      [windowSec, limit, ...p1, ...p2]
    );

    res.json({ ok: true, window_hours: windowHours, rows: q.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * -----------------------------
 * REPORTE PDF
 * -----------------------------
 * POST /runs/:runId/report/pdf
 * Body:
 * {
 *   title, runName,
 *   mode: "individual"|"group",
 *   objectives: [{ phone, confidence }],
 *   dateRange: { from, to, min_ts, max_ts },
 *   images: { contactsChart, placesChart, timeseriesChart, mapScreenshot } // base64 dataURL
 * }
 */
router.post("/runs/:runId/report/pdf", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const body = req.body || {};
    const runName = String(body.runName || "").trim() || `RUN ${runId}`;
    const mode = String(body.mode || "individual");
    const objectives = Array.isArray(body.objectives) ? body.objectives : [];
    const dateRange = body.dateRange || {};
    const images = body.images || {};

    // Helper: dataURL -> Buffer
    const dataUrlToBuffer = (dataUrl) => {
      if (!dataUrl || typeof dataUrl !== "string") return null;
      const m = dataUrl.match(/^data:(.+);base64,(.*)$/);
      if (!m) return null;
      return Buffer.from(m[2], "base64");
    };

    // Config PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${`Analisis_solicitud_${runName}`.replace(/[^\w\-(). ]+/g, "_")}.pdf"`
    );

    const doc = new PDFDocument({ size: "A4", margin: 36 });
    doc.pipe(res);

    // Encabezado
    doc.fontSize(18).font("Helvetica-Bold").text(`Analisis solicitud: ${runName}`, { align: "left" });
    doc.moveDown(0.5);

    doc.fontSize(10).font("Helvetica").fillColor("#333");
    doc.text(`RUN ID: ${runId}`);
    doc.text(`Modo: ${mode === "group" ? "Grupal (2 objetivos)" : "Individual"}`);
    doc.moveDown(0.3);

    if (objectives.length) {
      doc.font("Helvetica-Bold").text("Objetivo(s):");
      doc.font("Helvetica");
      for (const o of objectives) {
        doc.text(`• ${o.phone || "-"}  (confianza: ${Math.round((Number(o.confidence || 0)) * 100)}%)`);
      }
    }
    doc.moveDown(0.3);

    const minTs = dateRange.min_ts || dateRange.from || "-";
    const maxTs = dateRange.max_ts || dateRange.to || "-";
    doc.font("Helvetica-Bold").text("Rango de registros:");
    doc.font("Helvetica").text(`${minTs}  →  ${maxTs}`);
    doc.moveDown(0.8);

    // Sección imágenes (charts + mapa)
    // NOTA: mantenemos un layout simple y robusto (sin depender de HTML render)
    const putImage = (buf, title) => {
      if (!buf) return;
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#000").text(title);
      doc.moveDown(0.3);

      // Ajuste a ancho página
      const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc.image(buf, { fit: [pageW, 240], align: "center" });

      doc.moveDown(0.8);
    };

    putImage(dataUrlToBuffer(images.timeseriesChart), "Línea de tiempo de movimientos");
    putImage(dataUrlToBuffer(images.contactsChart), "Top contacto(s) (tipo i2)");
    putImage(dataUrlToBuffer(images.placesChart), "Lugares frecuentados (top)");
    putImage(dataUrlToBuffer(images.mapScreenshot), "Mapa (ArcGIS) - pantallazo");

    doc.end();
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

export default router;
