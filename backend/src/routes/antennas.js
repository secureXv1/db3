import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { authRequired } from "../auth.js";
import { readAntennasExcel } from "../lib/telco/read_antennas_excel.js";

const router = Router();

const UPLOAD_DIR = path.resolve("uploads_antennas");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-() ]+/g, "_");
    cb(null, `${Date.now()}__${safe}`);
  },
});
const upload = multer({ storage });

function normOp(s) {
  const t = String(s ?? "").trim().toUpperCase();
  if (t.includes("CLARO")) return "CLARO";
  if (t.includes("MOV")) return "MOVISTAR";
  if (t.includes("TIGO")) return "TIGO";
  if (t.includes("WOM") || t.includes("WON")) return "WOM";
  return t || null;
}

async function upsertBatch(rows) {
  if (!rows.length) return { inserted: 0, updated: 0 };

// dentro de upsertBatch(rows) ...

    const params = [];
    const values = rows.map((r) => {
    const base = params.length;
    params.push(
        r.operator,
        r.cell_id,
        r.lac_tac,
        r.cell_name,
        r.site_name,
        r.address,
        r.departamento,
        r.municipio,
        r.technology,
        r.vendor,
        r.azimuth,
        r.lat,
        r.lon,

        r.horiz_beam_angle,
        r.vertical_beam_angle,
        r.beam_angle,
        r.radius,

        r.altura,
        r.gain,
        r.beam,
        r.twist,
        r.tipo_estructura,
        r.detalle_estructura,
        r.banda,
        r.portadora,

        r.is_active,
        r.last_import_id,
        r.updated_by,
        JSON.stringify(r.raw || {})
    );

    // 29 columnas antes de raw
    const ph = Array.from({ length: 29 }, (_, i) => `$${base + i + 1}`).join(",");
    return `(${ph})`;
    }).join(",");

        const sql = `
        INSERT INTO antennas
        (operator, cell_id, lac_tac, cell_name, site_name, address,
        departamento, municipio, technology, vendor, azimuth, lat, lon,
        horiz_beam_angle, vertical_beam_angle, beam_angle, radius,
        altura, gain, beam, twist, tipo_estructura, detalle_estructura, banda, portadora,
        is_active, last_import_id, updated_by, raw)
        VALUES ${values}
        ON CONFLICT ON CONSTRAINT ux_antennas_operator_cellid_cellname
        DO UPDATE SET
        site_name = EXCLUDED.site_name,
        address = EXCLUDED.address,
        departamento = EXCLUDED.departamento,
        municipio = EXCLUDED.municipio,
        technology = EXCLUDED.technology,
        vendor = EXCLUDED.vendor,
        azimuth = EXCLUDED.azimuth,
        lat = EXCLUDED.lat,
        lon = EXCLUDED.lon,
        horiz_beam_angle = EXCLUDED.horiz_beam_angle,
        vertical_beam_angle = EXCLUDED.vertical_beam_angle,
        beam_angle = EXCLUDED.beam_angle,
        radius = EXCLUDED.radius,
        altura = EXCLUDED.altura,
        gain = EXCLUDED.gain,
        beam = EXCLUDED.beam,
        twist = EXCLUDED.twist,
        tipo_estructura = EXCLUDED.tipo_estructura,
        detalle_estructura = EXCLUDED.detalle_estructura,
        banda = EXCLUDED.banda,
        portadora = EXCLUDED.portadora,
        is_active = EXCLUDED.is_active,
        last_import_id = EXCLUDED.last_import_id,
        updated_by = EXCLUDED.updated_by,
        updated_at = now(),
        raw = EXCLUDED.raw
        RETURNING xmax = 0 AS inserted_flag;
        `;


    const r = await pool.query(sql, params);
  let inserted = 0, updated = 0;
  for (const row of r.rows) row.inserted_flag ? inserted++ : updated++;
  return { inserted, updated };
}

/**
 * POST /api/antennas/upload
 * form-data: files[]
 * query: mode=merge|replace_operator
 * (si mode=replace_operator, se inactivan antenas del operador antes de upsert)
 */
router.post("/upload", authRequired, upload.array("files", 20), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: "No llegaron archivos" });

    const mode = String(req.query.mode || "merge");
    const created_by = req.user?.id ?? null;

    let totals = { seen: 0, inserted: 0, updated: 0, skipped: 0 };
    const perFile = [];

    for (const f of files) {
      const parsed = readAntennasExcel(f.path); // { operatorGuess, rows, skipped }
      const operatorGuess = normOp(parsed.operatorGuess);
      const importRow = await pool.query(
        `INSERT INTO antenna_imports (created_by, operator, file_name, mode) VALUES ($1,$2,$3,$4) RETURNING id`,
        [created_by, operatorGuess, f.originalname, mode]
      );
      const importId = importRow.rows[0].id;

      // replace_operator (sin borrar físico): inactivar las del operador
      if (mode === "replace_operator" && operatorGuess) {
        await pool.query(
          `UPDATE antennas SET is_active=false, updated_at=now(), updated_by=$1 WHERE operator=$2`,
          [created_by, operatorGuess]
        );
      }

      const rows = (parsed.rows || []).map(r => ({
        ...r,
        operator: normOp(r.operator || operatorGuess || "UNKNOWN"),
        lac_tac: String(r.lac_tac ?? "").trim(),     // ✅ evita NULL
        cell_name: String(r.cell_name ?? "").trim(), // ✅ buena práctica también
        is_active: true,
        last_import_id: importId,
        updated_by: created_by
      }));

      totals.seen += rows.length;
      totals.skipped += Number(parsed.skipped || 0);

        function dedupeExact(rows){
        const seen = new Set();
        const out = [];
        for (const r of rows) {
            const key = [
            normOp(r.operator),
            String(r.cell_id ?? "").trim(),
            String(r.cell_name ?? "").trim(),
            ].join("|");

            if (seen.has(key)) continue; // duplicado exacto
            seen.add(key);
            out.push(r);
        }
        return out;
        }


        

      // batch
      const B = 2000;
      let ins = 0, upd = 0;
      const cleanRows = dedupeExact(rows);

        for (let i = 0; i < cleanRows.length; i += B) {
        const chunk = cleanRows.slice(i, i + B);
        const r = await upsertBatch(chunk);
        ins += r.inserted;
        upd += r.updated;
        }

      totals.inserted += ins;
      totals.updated += upd;

      await pool.query(
        `UPDATE antenna_imports
         SET rows_seen=$1, rows_inserted=$2, rows_updated=$3, rows_skipped=$4
         WHERE id=$5`,
        [rows.length, ins, upd, Number(parsed.skipped || 0), importId]
      );

      perFile.push({ file: f.originalname, operator: operatorGuess, rows_seen: rows.length, rows_inserted: ins, rows_updated: upd, rows_skipped: Number(parsed.skipped || 0) });

      try { fs.unlinkSync(f.path); } catch {}
    }

    res.json({
      ok: true,
      mode,
      rows_seen: totals.seen,
      rows_inserted: totals.inserted,
      rows_updated: totals.updated,
      rows_skipped: totals.skipped,
      results: perFile
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/antennas?operator=&depto=&mpio=&tech=&q=&active=1&limit=2000
router.get("/", authRequired, async (req, res) => {
  try {
    const operator = normOp(req.query.operator);

    // ✅ usar nombres amigables desde el front
    const departamento = String(req.query.departamento || req.query.depto || "").trim() || null;
    const municipio = String(req.query.municipio || req.query.mpio || "").trim() || null;
    const technology = String(req.query.technology || req.query.tech || "").trim() || null;

    const q = String(req.query.q || "").trim() || null;
    const active = String(req.query.active ?? "1") === "1";

    // ✅ paginación: máximo 25 por página
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(25, Number(req.query.limit || 25)));
    const offset = (page - 1) * limit;

    const params = [];
    const where = [];

    if (operator) { params.push(operator); where.push(`operator=$${params.length}`); }
    if (departamento) { params.push(departamento); where.push(`departamento ILIKE '%'||$${params.length}||'%'`); }
    if (municipio) { params.push(municipio); where.push(`municipio ILIKE '%'||$${params.length}||'%'`); }
    if (technology) { params.push(technology); where.push(`technology ILIKE '%'||$${params.length}||'%'`); }

    if (q) {
      params.push(q);
      const p = params.length;
      where.push(`(
        cell_id ILIKE '%'||$${p}||'%'
        OR cell_name ILIKE '%'||$${p}||'%'
        OR site_name ILIKE '%'||$${p}||'%'
        OR address ILIKE '%'||$${p}||'%'
        OR municipio ILIKE '%'||$${p}||'%'
        OR departamento ILIKE '%'||$${p}||'%'
        OR lac_tac ILIKE '%'||$${p}||'%'
      )`);
    }

    if (active) where.push(`is_active=true`);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // ✅ total (para paginación)
    const totalSql = `SELECT COUNT(*)::bigint AS total FROM antennas ${whereSql};`;
    const totalRes = await pool.query(totalSql, params);
    const total = Number(totalRes.rows[0]?.total || 0);

    // ✅ data con limit/offset
    const dataParams = params.slice();
    dataParams.push(limit, offset);

    const sql = `
      SELECT id, operator, cell_id, lac_tac, cell_name, site_name, address,
             departamento, municipio, technology, vendor, azimuth, lat, lon,
             horiz_beam_angle, vertical_beam_angle, beam_angle, radius,
             altura, gain, beam, twist, tipo_estructura, detalle_estructura, banda, portadora,
             is_active, updated_at
      FROM antennas
      ${whereSql}
      ORDER BY updated_at DESC
      LIMIT $${dataParams.length - 1}
      OFFSET $${dataParams.length};
    `;

    const r = await pool.query(sql, dataParams);

    res.json({
      ok: true,
      page,
      limit,
      total,
      rows: r.rows
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

export default router;
