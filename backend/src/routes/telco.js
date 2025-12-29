import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { authRequired } from "../auth.js";
import { readXdrExcel } from "../lib/telco/read_xdr_excel.js";

const router = Router();

// ===== Upload config =====
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

// ===== Helpers SQL =====
function buildBulkInsert(rows, cols, params) {
  const chunks = rows.map((r) => {
    const base = params.length;
    for (let i = 0; i < cols; i++) params.push(r[i]);
    const ph = Array.from({ length: cols }, (_, i) => `$${base + i + 1}`).join(",");
    return `(${ph})`;
  });
  return chunks.join(",");
}

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
      r.call_ts,                 // ideal: string "YYYY-MM-DD HH:MM:SS" o ISO
      r.direction,               // 'IN' | 'OUT'
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
      JSON.stringify(r.raw ?? {})
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

async function getPrimaryTarget(runId) {
  const r = await pool.query(
    `
    SELECT t.target
    FROM (
      SELECT
        CASE WHEN direction='IN' THEN b_number ELSE a_number END AS target,
        COUNT(*) AS cnt
      FROM call_records_tmp
      WHERE run_id = $1
      GROUP BY 1
    ) t
    WHERE t.target IS NOT NULL AND t.target <> ''
    ORDER BY t.cnt DESC
    LIMIT 1;
    `,
    [runId]
  );
  return r.rows[0]?.target || null;
}

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

  // Filtro por dirección (IN/OUT/BOTH)
  if (dir && dir !== "BOTH") {
    params.push(dir);
    where.push(`direction = $${params.length}::call_direction`);
  }

  // Filtro horario (America/Bogota), soporta rangos que cruzan medianoche
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
        // Ej: 22 -> 6 (cruza medianoche)
        where.push(`(${hourExpr} >= ${pHf} OR ${hourExpr} <= ${pHt})`);
      }
    }
  }

  return where.length ? `WHERE ${where.join(" AND ")}` : "";
}

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}




// ===== Routes =====

// Crear run
router.post("/runs", authRequired, async (req, res) => {
  try {
    const created_by = req.user?.id ?? null;

    // ✅ nombre automático: username + fecha/hora
    const uname = String(req.user?.username ?? "usuario").trim() || "usuario";
    const name = `${uname} - ${new Date().toISOString().slice(0,19).replace("T"," ")}`;

    const r = await pool.query(
      `INSERT INTO analysis_runs (created_by, name) VALUES ($1, $2) RETURNING id, created_at, name`,
      [created_by, name]
    );

    res.json({ ok: true, run: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Nuevo análisis: borra lo temporal del run
router.delete("/runs/:runId/clear", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    // OJO: prioritized_hits se borra solo por cascade al borrar call_records_tmp
    const del = await pool.query(`DELETE FROM call_records_tmp WHERE run_id = $1`, [runId]);

    // (opcional de seguridad)
    await pool.query(`DELETE FROM prioritized_hits WHERE run_id = $1`, [runId]);

    res.json({ ok: true, deleted: del.rowCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Upload XDR Excel(s)
router.post("/runs/:runId/upload-xdr", authRequired, upload.array("files", 20), async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: "No llegaron archivos" });

    let seen = 0, inserted = 0;
    const perFile = [];

    for (const f of files) {
      const { records } = readXdrExcel(f.path);
      seen += records.length;

      // batch insert
      const B = 3000;
      let fileInserted = 0;

      for (let i = 0; i < records.length; i += B) {
        const chunk = records.slice(i, i + B);
        const r = await insertCallBatch(runId, chunk);
        fileInserted += r.inserted;
      }

      inserted += fileInserted;

      perFile.push({
        file: f.originalname,
        rows_seen: records.length,
        rows_inserted: fileInserted,
        rows_omitted: records.length - fileInserted
      });

      // limpia archivo del disco (para que no se acumulen)
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
      rows_seen: seen,
      rows_inserted: inserted,
      rows_omitted: seen - inserted,
      prioritized_hits: Number(hits.rows[0]?.hits || 0),
      results: perFile
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Objetivo automático (top 10 y principal)
router.get("/runs/:runId/target", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const top = await pool.query(
      `
      SELECT t.target, t.cnt
      FROM (
        SELECT
          CASE WHEN direction='IN' THEN b_number ELSE a_number END AS target,
          COUNT(*) AS cnt
        FROM call_records_tmp
        WHERE run_id = $1
        GROUP BY 1
      ) t
      WHERE t.target IS NOT NULL AND t.target <> ''
      ORDER BY t.cnt DESC
      LIMIT 10;
      `,
      [runId]
    );

    const primary = top.rows[0] || null;

    res.json({
      ok: true,
      primaryTarget: primary?.target || null,
      primaryCount: primary?.cnt || 0,
      topTargets: top.rows
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

router.get("/runs/:runId/flows/summary", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const { from = null, to = null, dir = "BOTH", hour_from = null, hour_to = null } = req.query;

    const params = [];
    const where = buildWhereCalls(
      { runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to },
      params
    );

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

    // Top enlaces dirigidos (A->B)
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
      top_edges: topEdges.rows
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

router.get("/runs/:runId/flows/graph", authRequired, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return res.status(400).json({ ok: false, error: "runId inválido" });

    const {
      from = null,
      to = null,
      dir = "BOTH",
      hour_from = null,
      hour_to = null,
      min_calls = 2,
      max_edges = 600,
      max_nodes = 250
    } = req.query;

    const MIN_CALLS = clampInt(min_calls, 2, 1, 999999);
    const MAX_EDGES = clampInt(max_edges, 600, 50, 5000);
    const MAX_NODES = clampInt(max_nodes, 250, 20, 2000);

    const params = [];
    const where = buildWhereCalls(
      { runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to },
      params
    );

    // 1) Edges agregados (dirigidos)
    params.push(MIN_CALLS, MAX_EDGES);
    const edgesQ = await pool.query(
      `
      WITH e AS (
        SELECT
          a_number AS source,
          b_number AS target,
          COUNT(*)::bigint AS calls,
          COALESCE(SUM(duration_sec),0)::bigint AS total_duration,
          MIN(call_ts) AS first_ts,
          MAX(call_ts) AS last_ts
        FROM call_records_tmp
        ${where}
        GROUP BY a_number, b_number
        HAVING COUNT(*) >= $${params.length - 1}
        ORDER BY calls DESC
        LIMIT $${params.length}
      )
      SELECT * FROM e;
      `,
      params
    );

    const edges = edgesQ.rows;

    // 2) Nodes: los que aparecen en edges (limit)
    const nodeSet = new Set();
    for (const e of edges) {
      nodeSet.add(e.source);
      nodeSet.add(e.target);
      if (nodeSet.size >= MAX_NODES) break;
    }
    const nodes = Array.from(nodeSet).map((id) => ({ id, label: id }));

    res.json({
      ok: true,
      filters: { from, to, dir, hour_from, hour_to, min_calls: MIN_CALLS },
      nodes,
      edges
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

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
      limit = 2000
    } = req.query;

    const LIMIT = clampInt(limit, 2000, 50, 20000);

    const params = [];
    const where = buildWhereCalls(
      { runId, from, to, dir, hourFrom: hour_from, hourTo: hour_to },
      params
    );

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
      rows: q.rows
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

export default router;
