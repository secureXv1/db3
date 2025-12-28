import XLSX from "xlsx";
import { normalizePhone, parseTsToIso, parseDurationSec, detectDirectionFromTipo } from "./normalize.js";

const REQUIRED = ["originador", "receptor", "fecha_hora"];


function normKey(x) {
  return String(x ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w_]/g, "");
}


function rowHasHeaders(row) {
  const set = new Set((row || []).map(normKey));
  return set.has("originador") && set.has("receptor") && (set.has("fecha_hora") || set.has("fechahora") || set.has("fecha"));
}


function headerIndexMap(headerRow) {
  const map = new Map();
  (headerRow || []).forEach((h, idx) => {
    const key = normKey(h);
    if (key) map.set(key, idx);
  });
  return map;
}

function getCell(row, hmap, name) {
  const idx = hmap.get(name);
  return idx == null ? null : row[idx];
}

function scanForHeader(rows, maxScan = 250) {
  const lim = Math.min(rows.length, maxScan);
  for (let i = 0; i < lim; i++) {
    if (rowHasHeaders(rows[i])) return i;
  }
  return -1;
}

// Parse hoja tipo DT: bloque con separador ß (si existe)
function parseDtSheetAsBlock(sheet) {
  if (!sheet) return new Map();

  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  const found = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const v = sheet[addr]?.v;
      if (typeof v === "string" && v.includes("ß") && (v.includes("DN_NUM") || v.includes("IMEI") || v.includes("IMSI"))) {
        found.push(v);
      }
    }
  }

  // buscamos patrón: 1 bloque header + 1 bloque data
  // si hay varios, intentamos con pares consecutivos
  const out = new Map(); // phone -> { imsi, imei, raw }
  for (let i = 0; i < found.length - 1; i++) {
    const head = found[i].split("ß").map(s => s.trim());
    const data = found[i + 1].split("ß").map(s => s.trim());

    const idxDN = head.findIndex(x => x.toUpperCase() === "DN_NUM");
    const idxIMSI = head.findIndex(x => x.toUpperCase() === "IMSI");
    const idxIMEI = head.findIndex(x => x.toUpperCase() === "IMEI");

    if (idxDN >= 0 && (idxIMSI >= 0 || idxIMEI >= 0) && data.length >= head.length) {
      const phone = normalizePhone(data[idxDN]);
      if (!phone) continue;

      out.set(phone, {
        imsi: idxIMSI >= 0 ? (data[idxIMSI] || null) : null,
        imei: idxIMEI >= 0 ? (data[idxIMEI] || null) : null,
        raw: { head, data }
      });
    }
  }

  return out;
}

export function readXdrExcel(filePath, { fallbackDirection = "IN" } = {}) {
  const wb = XLSX.readFile(filePath, { cellDates: false });

  const allRecords = [];
  let techByPhone = new Map();

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];

    // 1) intenta DT (técnico)
    if (String(name).trim().toUpperCase() === "DT") {
      const dt = parseDtSheetAsBlock(sheet);
      if (dt.size) techByPhone = dt;
      continue;
    }

    // 2) convierte a matriz para detectar header real (saltando biográfico)
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    if (!rows?.length) continue;

    const headerRowIdx = scanForHeader(rows);
    if (headerRowIdx < 0) continue;

    const header = rows[headerRowIdx];
    const hmap = headerIndexMap(header);

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(x => String(x ?? "").trim() === "")) continue;

      const originador = normalizePhone(getCell(row, hmap, "originador"));
      const receptor = normalizePhone(getCell(row, hmap, "receptor"));
      const fecha_hora = parseTsToIso(getCell(row, hmap, "fecha_hora"));
      if (!originador || !receptor || !fecha_hora) continue;

      const tipo = getCell(row, hmap, "tipo");
      const direction = detectDirectionFromTipo(tipo, fallbackDirection);

      const rec = {
        call_ts: fecha_hora,
        direction,
        a_number: originador,
        b_number: receptor,
        duration_sec: parseDurationSec(getCell(row, hmap, "duracion")),
        tipo: String(tipo ?? "").trim() || null,
        lac_inicio: String(getCell(row, hmap, "lac_inicio_llamada") ?? "").trim() || null,
        celda_inicio: String(getCell(row, hmap, "celda_inicio_llamada") ?? "").trim() || null,
        nombre_celda_inicio: String(getCell(row, hmap, "nombre_celda_inicio") ?? "").trim() || null,
        lac_final: String(getCell(row, hmap, "lac_final_llamada") ?? "").trim() || null,
        celda_final: String(getCell(row, hmap, "celda_final_llamada") ?? "").trim() || null,
        nombre_celda_final: String(getCell(row, hmap, "nombre_celda_final") ?? "").trim() || null,
        raw: { sheet: name, rowIndex: r + 1, headerRow: headerRowIdx + 1, row }
      };

      // si hay hoja DT: mapea IMSI/IMEI por número
      // aplica al originador o receptor si coincide
      const techA = techByPhone.get(originador);
      const techB = techByPhone.get(receptor);
      rec.imsi = techA?.imsi || techB?.imsi || null;
      rec.imei = techA?.imei || techB?.imei || null;

      allRecords.push(rec);
    }
  }

  return { records: allRecords, techByPhone };
}
