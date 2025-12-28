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

// ===== Routes =====

// Crear run
router.post("/runs", authRequired, async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim() || null;
    const created_by = req.user?.id ?? null;

    const r = await pool.query(
      `INSERT INTO analysis_runs (created_by, name) VALUES ($1, $2) RETURNING id, created_at`,
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

export default router;
