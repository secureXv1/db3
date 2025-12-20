import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// health
router.get("/health", async (_req, res) => {
  try {
    const r = await pool.query("SELECT now() as now");
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * GET /api/detections
 * Query:
 *  - from, to (ISO o "YYYY-MM-DD HH:MM:SS")
 *  - imsi, imei (opcionales)
 *  - page (>=1), limit (<=500)
 *  - lat, lon, radius (metros) (opcionales) -> búsqueda geográfica
 */
router.get("/", async (req, res) => {
  try {
    const {
      from,
      to,
      imsi,
      imei,
      page = "1",
      limit = "200",
      lat,
      lon,
      radius,
    } = req.query;

    const p = Math.max(parseInt(page, 10) || 1, 1);
    const l = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
    const offset = (p - 1) * l;

    const where = [];
    const args = [];
    let i = 1;

    // rango de fechas (recomendado)
    if (from) {
      where.push(`ts >= $${i++}::timestamptz`);
      args.push(from);
    }
    if (to) {
      where.push(`ts < $${i++}::timestamptz`);
      args.push(to);
    }

    if (imsi) {
      where.push(`imsi = $${i++}`);
      args.push(imsi);
    }
    if (imei) {
      where.push(`imei = $${i++}`);
      args.push(imei);
    }

    // geo filtro
    let selectDist = "NULL::double precision AS dist_m";
    if (lat && lon && radius) {
      where.push(`geom IS NOT NULL`);
      where.push(
        `ST_DWithin(geom, ST_MakePoint($${i++}, $${i++})::geography, $${i++}::double precision)`
      );
      // ST_MakePoint(lon,lat)
      args.push(Number(lon));
      args.push(Number(lat));
      args.push(Number(radius));

      // distancia calculada
      selectDist = `ST_Distance(geom, ST_MakePoint($${i++}, $${i++})::geography) AS dist_m`;
      args.push(Number(lon));
      args.push(Number(lat));
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // total
    const qTotal = `SELECT count(*)::bigint AS total FROM detections ${whereSql};`;
    const totalRes = await pool.query(qTotal, args);
    const total = Number(totalRes.rows[0]?.total || 0);

    // data
    const qData = `
      SELECT
        id, ts, imsi, imei, lat, lon, distance_m,
        source_type, source_file, source_row,
        ${selectDist},
        CASE WHEN geom IS NULL THEN NULL ELSE ST_AsText(geom::geometry) END AS geom_wkt
      FROM detections
      ${whereSql}
      ORDER BY ts DESC
      LIMIT ${l} OFFSET ${offset};
    `;
    const dataRes = await pool.query(qData, args);

    res.json({
      ok: true,
      page: p,
      limit: l,
      total,
      items: dataRes.rows,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * GET /api/detections/summary
 * Devuelve agregados para KPIs rápidos
 * Query: from,to, imsi, imei, lat, lon, radius
 */
router.get("/summary", async (req, res) => {
  try {
    const { from, to, imsi, imei, lat, lon, radius } = req.query;

    const where = [];
    const args = [];
    let i = 1;

    if (from) { where.push(`ts >= $${i++}::timestamptz`); args.push(from); }
    if (to)   { where.push(`ts < $${i++}::timestamptz`);  args.push(to); }

    if (imsi) { where.push(`imsi = $${i++}`); args.push(imsi); }
    if (imei) { where.push(`imei = $${i++}`); args.push(imei); }

    if (lat && lon && radius) {
      where.push(`geom IS NOT NULL`);
      where.push(
        `ST_DWithin(geom, ST_MakePoint($${i++}, $${i++})::geography, $${i++}::double precision)`
      );
      args.push(Number(lon));
      args.push(Number(lat));
      args.push(Number(radius));
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const q = `
      SELECT
        count(*)::bigint AS total,
        count(DISTINCT imsi)::bigint AS imsi_unicos,
        count(DISTINCT imei)::bigint AS imei_unicos,
        min(ts) AS min_ts,
        max(ts) AS max_ts
      FROM detections
      ${whereSql};
    `;

    const r = await pool.query(q, args);
    res.json({ ok: true, ...r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

export default router;
