// backend/src/routes/telco.js
import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { authRequired } from "../auth.js";
import { readXdrExcel } from "../lib/telco/read_xdr_excel.js";

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

/**
 * Construye VALUES ($1,$2...),($n...) para inserciones masivas.
 * @param {Array<Array<any>>} rows - Filas ya en el orden exacto de columnas
 * @param {number} cols - Cantidad de columnas por fila
 * @param {Array<any>} params - Acumulador de parámetros (se modifica)
 */
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
 * Inserta un batch en call_records_tmp con dedupe por constraint ux_call_dedupe.
 * IMPORTANTE: los registros deben venir normalizados.
 */
async function insertCallBatch(runId, rows) {
  if (!rows?.length) return { inserted: 0, ids: [] };

  // VALUES order (17):
  // run_id, call_ts, direction, a_number, b_number, duration_sec, tipo,
  // operator, lac_inicio, celda_inicio, nombre_celda_inicio, lac_final, celda_final, nombre_celda_final,
  // imsi, imei, raw
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
    ON CONFLICT ON CONSTRAINT ux_call_dedupe DO NOTHING
    RETURNING id;
  `;

  const r = await pool.query(sql, params);
  return { inserted: r.rowCount, ids: r.rows.map((x) => x.id) };
}

/**
 * Recalcula hits priorizados para un run (objetivos_priorizados contra tel/imsi/imei).
 */
async function refreshPrioritizedHits(runId) {
  // TEL A
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

  // TEL B
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

  // IMSI
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

  // IMEI
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
 * Construye WHERE y params para filtros comunes en call_records_tmp.
 * - Soporta rango hora (Bogotá) cruzando medianoche.
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

  // Dirección (IN/OUT/BOTH)
  if (dir && dir !== "BOTH") {
    params.push(dir);
    where.push(`direction = $${params.length}::call_direction`);
  }

  // Horario (America/Bogota), cruza medianoche si hf > ht
  if (hourFrom != null && hourTo != null) {
    const hf = Number(hourFrom);
    const ht = Number(hourTo);
    if (Number.isFinite(hf) && Number.isFinite(ht) && hf >= 0 && hf <= 23 && ht >= 0 && ht <= 23) {
      params.push(hf, ht);
      const pHf = `$${params.length - 1}`;
      const pHt = `$${params.length}`;

      const hourExpr = `EXTRACT(HOUR FROM (call_ts AT TIME ZONE 'America/Bogota'))`;

      if (hf <= ht) {
        where.push(`${hourExpr} BETWEEN ${pHf} AND ${pHt}`);
      } else {
        where.push(`(${hourExpr} >= ${pHf} OR ${hourExpr} <= ${pHt})`);
      }
    }
  }

  return where.length ? `WHERE ${where.join(" AND ")}` : "";
}

/**
 * Clamp entero para queries.
 */
function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

// ==============================
// Normalización (evita duplicados y permite join con antenas)
// ==============================

/**
 * Normaliza teléfono:
 * - deja solo dígitos
 * - quita prefijo 57 si queda > 10
 */
function normPhone(v) {
  let s = String(v ?? "").trim();
  if (!s) return "";
  s = s.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (s.startsWith("57") && s.length > 10) s = s.slice(2);
  return s;
}

/**
 * Normaliza timestamp a "YYYY-MM-DD HH:MM:SS" (string).
 * readXdrExcel normalmente ya lo entrega así; esto solo asegura segundos.
 */
function normTs(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
  return s;
}

/**
 * Normaliza dirección:
 * - acepta IN/OUT
 * - si no existe, la infiere desde tipo
 */
function normDir(r) {
  const d = String(r?.direction ?? "").toUpperCase().trim();
  if (d === "IN" || d === "OUT") return d;

  const t = String(r?.tipo ?? "").toUpperCase();
  if (t.includes("SALIENTE")) return "OUT";
  if (t.includes("ENTRANTE")) return "IN";
  return "IN";
}

/**
 * Normaliza cell id (solo dígitos).
 * Regla CLARO:
 * - quita el último dígito para permitir match con tabla antennas.
 */
function normCellId(operator, v) {
  let s = String(v ?? "").trim();
  if (!s) return null;

  s = s.replace(/[^\d]/g, "");
  if (!s) return null;

  const op = String(operator ?? "").toUpperCase().trim();
  if (op === "CLARO" && s.length > 1) {
    s = s.slice(0, -1);
  }
  return s;
}

/**
 * Normaliza 1 registro del Excel a la forma correcta para DB (y dedupe).
 * forcedOperator se aplica si el Excel no trae operador o si quieres forzarlo desde el UI.
 */
function normalizeRecord(r, forcedOperator) {
  const operator = String(r.operator ?? forcedOperator ?? "").toUpperCase().trim() || null;

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
  };
}

// ==============================
// Antennas metadata (dynamic / robust)
// ==============================

let _antennaMetaCache = null;
let _postgisCache = null;

/**
 * Escapa identificadores SQL ("col") de manera segura.
 */
function qIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Detecta si PostGIS está instalado (para extraer lon/lat desde geom si existe).
 */
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

/**
 * Lee columnas disponibles en tabla antennas para armar un JOIN sin romper si cambian nombres.
 */
async function getAntennaMeta() {
  if (_antennaMetaCache) return _antennaMetaCache;

  // Verifica existencia tabla
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

  _antennaMetaCache = {
    hasTable: true,
    opCol,
    keyCol,
    labelCol,
    latCol,
    lonCol,
    geomCol,
    postgis,
  };

  return _antennaMetaCache;
}

/**
 * Construye SELECT/LEFT JOIN para top lugares usando metadata de antennas.
 * Devuelve { sql, needsJoin } listo para pool.query.
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

  // Lat/Lon: prefer columnas, si no existen intenta geom (solo si PostGIS está)
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
      SELECT operator, celda_inicio AS cell_id, nombre_celda_inicio AS cell_name
      FROM call_records_tmp
      __WHERE__
      AND celda_inicio IS NOT NULL

      UNION ALL

      SELECT operator, celda_final AS cell_id, nombre_celda_final AS cell_name
      FROM call_records_tmp
      __WHERE__
      AND celda_final IS NOT NULL
    ),
    norm AS (
      SELECT
        operator,
        REGEXP_REPLACE(cell_id::text, '[^0-9]', '', 'g') AS cell_key,
        NULLIF(TRIM(cell_name::text), '') AS cell_name
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
 * Crear run con nombre (requerido por UI).
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

/**
 * Obtener run (para recargar UI).
 */
router.get("/runs/:runId", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const r = await pool.query(
      `SELECT id, created_at, name FROM analysis_runs WHERE id = $1`,
      [runId]
    );

    if (!r.rowCount) return res.status(404).json({ ok: false, error: "Run no existe" });
    res.json({ ok: true, run: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Cambiar nombre de un run (para "Nuevo análisis" sin perder runId).
 * Body: { name: string }
 */
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
 * Nuevo análisis: borra lo temporal del run (call_records_tmp + prioritized_hits).
 * (Esta es la lógica que evita que se acumulen y "dupliquen" llamadas entre cargas.)
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
 * Query: ?operator=CLARO|MOVISTAR|TIGO|WOM|OTRO
 * - Normaliza todo antes de insertar (evita duplicados falsos).
 * - Regla CLARO aplicada sobre celdas (quita último dígito) antes de guardar.
 */
router.post("/runs/:runId/upload-xdr", authRequired, upload.array("files", 20), async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const forcedOperator = String(req.query.operator ?? "").toUpperCase().trim() || null;

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: "No llegaron archivos" });

    let seen = 0, inserted = 0;
    const perFile = [];

    for (const f of files) {
      const { records } = readXdrExcel(f.path);
      seen += records.length;

      const normalized = records.map((r) => normalizeRecord(r, forcedOperator));

      // batch insert
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
        rows_seen: records.length,
        rows_inserted: fileInserted,
        rows_omitted: records.length - fileInserted,
      });

      try { fs.unlinkSync(f.path); } catch {}
    }

    // alertas priorizados
    await refreshPrioritizedHits(runId);

    const hits = await pool.query(
      `SELECT count(*)::bigint AS hits FROM prioritized_hits WHERE run_id = $1`,
      [runId]
    );

    res.json({
      ok: true,
      runId,
      operator: forcedOperator,
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
 * Summary: KPIs + top enlaces (A->B) según filtros.
 */
router.get("/runs/:runId/flows/summary", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const { from = null, to = null, dir = "BOTH", hour_from = null, hour_to = null } = req.query;

    const params = [];
    const where = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, params);

    const kpi = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS total_calls,
        COUNT(DISTINCT a_number)::bigint AS uniq_callers,
        COUNT(DISTINCT b_number)::bigint AS uniq_receivers,
        COUNT(DISTINCT (a_number || '->' || b_number))::bigint AS uniq_edges,
        MIN(call_ts) AS min_ts,
        MAX(call_ts) AS max_ts
      FROM call_records_tmp
      ${where};
      `,
      params
    );

    const topEdges = await pool.query(
      `
      SELECT
        a_number AS src,
        b_number AS dst,
        COUNT(*)::bigint AS calls,
        COALESCE(SUM(duration_sec),0)::bigint AS total_duration,
        MIN(call_ts) AS first_ts,
        MAX(call_ts) AS last_ts
      FROM call_records_tmp
      ${where}
      GROUP BY a_number, b_number
      ORDER BY calls DESC
      LIMIT 50;
      `,
      params
    );

    res.json({
      ok: true,
      filters: { from, to, dir, hour_from, hour_to },
      kpis: kpi.rows[0],
      top_edges: topEdges.rows,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Timeline: lista eventos según filtros.
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
      limit = 2000,
    } = req.query;

    const LIMIT = clampInt(limit, 2000, 50, 20000);

    const params = [];
    const where = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, params);

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
      ${where}
      ORDER BY call_ts ASC
      LIMIT $${params.length};
      `,
      params
    );

    res.json({
      ok: true,
      filters: { from, to, dir, hour_from, hour_to, limit: LIMIT },
      rows: q.rows,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Top lugares: cruza celdas con antennas (si existe) y devuelve hits + lat/lon.
 * Query:
 * - phone (opcional) filtra por objetivo (a_number o b_number)
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
      limit = 12,
    } = req.query;

    const LIMIT = clampInt(limit, 12, 5, 50);

    const params = [];
    let where = buildWhereCalls({ runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to }, params);

    // Filtro por objetivo (si viene)
    if (phone) {
      const p = normPhone(phone);
      params.push(p);
      const cond = `(a_number = $${params.length} OR b_number = $${params.length})`;
      where = where ? `${where} AND ${cond}` : `WHERE run_id = $1 AND ${cond}`;
    }

    const { sql } = await buildPlacesQuerySQL();

    // Reutiliza el mismo WHERE en ambos SELECT del CTE "cells"
    const finalSql = sql
      .replaceAll("__WHERE__", where || "WHERE run_id = $1")
      .replaceAll("__LIMIT__", `$${params.length + 1}`);

    params.push(LIMIT);

    const q = await pool.query(finalSql, params);
    res.json({ ok: true, rows: q.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

export default router;
