import XLSX from "xlsx";

function nk(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w_]/g, "");
}

function pick(o, keys) {
  for (const k of keys) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s !== "" && s.toUpperCase() !== "UNKNOWN" && s.toUpperCase() !== "NA") return v;
  }
  return null;
}

function normOp(s) {
  const t = String(s ?? "").trim().toUpperCase();
  if (t.includes("CLARO")) return "CLARO";
  if (t.includes("MOV")) return "MOVISTAR";
  if (t.includes("TIGO")) return "TIGO";
  if (t.includes("WOM") || t.includes("WON")) return "WOM";
  return t || "UNKNOWN";
}

function toFloat(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toNum(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function guessFormat(headers) {
  const set = new Set(headers.map(nk));
  // Claro
  if (
    set.has("cellid") &&
    set.has("lac") &&
    (set.has("latitud") || set.has("longitud")) &&
    (set.has("bts_name") || set.has("btsname"))
  ) return "CLARO";

  // Movistar/WOM
  if (
    set.has("cellid_full") &&
    set.has("dec_latitude") &&
    set.has("dec_longitud") &&
    set.has("operator")
  ) return "MV_WOM";

  // Tigo
  if (
    set.has("celda") &&
    (set.has("latitud_") || set.has("latitud")) &&
    (set.has("longitud_") || set.has("longitud")) &&
    set.has("operador")
  ) return "TIGO";

  return "UNKNOWN";
}

function rowToObj(headers, row) {
  const o = {};
  for (let i = 0; i < headers.length; i++) o[nk(headers[i])] = row[i];
  return o;
}

export function readAntennasExcel(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sh = wb.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "", raw: true });

  // busca header en primeras 250 filas
  let hIdx = -1;
  for (let i = 0; i < Math.min(250, rows.length); i++) {
    const r = rows[i] || [];
    const set = new Set(r.map(nk));
    if (set.has("operador") || set.has("operator")) { hIdx = i; break; }
  }
  if (hIdx < 0) return { operatorGuess: null, rows: [], skipped: rows.length };

  const headers = rows[hIdx];
  const fmt = guessFormat(headers);

  const out = [];
  let skipped = 0;
  let operatorGuess = null;

  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(x => String(x ?? "").trim() === "")) continue;

    const o = rowToObj(headers, r);

    const operatorRaw = pick(o, ["operador", "operator"]) || operatorGuess || "UNKNOWN";
    const OP = normOp(operatorRaw);

    // ====== MAPEOS EN ORDEN EXACTO ======
    let cell_id = null, lat = null, lon = null, address = null, municipio = null, lac_tac = null;
    let cell_name = null, site_name = null, departamento = null, technology = null, vendor = null, azimuth = null;

    let horiz_beam_angle = null, vertical_beam_angle = null, beam_angle = null, radius = null;
    let altura = null, gain = null, beam = null, twist = null;
    let tipo_estructura = null, detalle_estructura = null, banda = null, portadora = null;

    if (OP === "TIGO") {
      cell_id = pick(o, ["celda"]);
      lat = toFloat(pick(o, ["latitud_"]));
      lon = toFloat(pick(o, ["longitud_"]));
      address = pick(o, ["sit_direccion"]);
      municipio = pick(o, ["mun_description"]);
      lac_tac = null;
      cell_name = pick(o, ["sector"]);
      site_name = pick(o, ["description"]);
      departamento = pick(o, ["depto_description"]);
      technology = pick(o, ["tecnologia"]);
      vendor = pick(o, ["vendor"]);
      azimuth = toNum(pick(o, ["azimut"]));
    } else if (OP === "MOVISTAR" || OP === "WOM") {
      cell_id = pick(o, ["cellid_full"]);
      lat = toFloat(pick(o, ["dec_latitude"]));
      lon = toFloat(pick(o, ["dec_longitud"]));
      address = pick(o, ["address"]);
      municipio = pick(o, ["municipio"]);
      lac_tac = pick(o, ["lac_tac"]);
      cell_name = pick(o, ["cell_name"]);
      site_name = pick(o, ["sitename"]);
      departamento = pick(o, ["departamento"]);
      technology = pick(o, ["technology"]);
      vendor = null;
      azimuth = toNum(pick(o, ["azimuth"]));

      horiz_beam_angle = toNum(pick(o, ["horiz_beam_angle"]));
      vertical_beam_angle = toNum(pick(o, ["vertical_beam_angle"]));
      beam_angle = toNum(pick(o, ["beam_angle"]));
      radius = toNum(pick(o, ["radius"]));
    } else if (OP === "CLARO") {
      cell_id = pick(o, ["cellid", "cellid_"]);
      lat = toFloat(pick(o, ["latitud"]));
      lon = toFloat(pick(o, ["longitud"]));
      address = pick(o, ["ubicacion"]);
      municipio = pick(o, ["municipio"]);
      lac_tac = pick(o, ["lac"]);
      cell_name = pick(o, ["bts_name", "btsname"]);
      site_name = null;
      departamento = pick(o, ["depto"]);
      technology = pick(o, ["tecnologia"]);
      vendor = pick(o, ["tipoantena"]);
      azimuth = toNum(pick(o, ["azimuth"]));

      altura = toNum(pick(o, ["altura_antena", "alturaantena", "altura"]));
      gain = toNum(pick(o, ["gain"]));
      beam = toNum(pick(o, ["beam"]));
      twist = toNum(pick(o, ["twist"]));
      tipo_estructura = pick(o, ["tipoestructura"]);
      detalle_estructura = pick(o, ["detalleestructura"]);
      banda = String(pick(o, ["banda"]) ?? "").trim() || null;
      portadora = String(pick(o, ["portadora"]) ?? "").trim() || null;
    } else {
      // fallback
      cell_id = pick(o, ["cellid_full", "cellid", "celda"]);
      lat = toFloat(pick(o, ["dec_latitude", "latitud_", "latitud"]));
      lon = toFloat(pick(o, ["dec_longitud", "longitud_", "longitud"]));
      address = pick(o, ["address", "ubicacion", "sit_direccion"]);
      municipio = pick(o, ["municipio", "mun_description"]);
      lac_tac = pick(o, ["lac_tac", "lac"]);
      cell_name = pick(o, ["cell_name", "sector", "bts_name", "description"]);
      site_name = pick(o, ["sitename", "description"]);
      departamento = pick(o, ["departamento", "depto", "depto_description"]);
      technology = pick(o, ["technology", "tecnologia"]);
      vendor = pick(o, ["vendor", "tipoantena"]);
      azimuth = toNum(pick(o, ["azimuth", "azimut"]));
    }

    if (!cell_id) { skipped++; continue; }

    // operadorGuess
    const op = o.operador || o.operator || null;
    if (!operatorGuess && op) operatorGuess = String(op);

    out.push({
      operator: operatorRaw,
      cell_id: String(cell_id).trim(),
      lac_tac: lac_tac != null && String(lac_tac).trim() !== "" ? String(lac_tac).trim() : null,
      cell_name: cell_name != null && String(cell_name).trim() !== "" ? String(cell_name).trim() : null,
      site_name: site_name != null && String(site_name).trim() !== "" ? String(site_name).trim() : null,
      address: address != null && String(address).trim() !== "" ? String(address).trim() : null,
      departamento: departamento != null && String(departamento).trim() !== "" ? String(departamento).trim() : null,
      municipio: municipio != null && String(municipio).trim() !== "" ? String(municipio).trim() : null,
      technology: technology != null && String(technology).trim() !== "" ? String(technology).trim() : null,
      vendor: vendor != null && String(vendor).trim() !== "" ? String(vendor).trim() : null,
      azimuth,
      lat,
      lon,

      horiz_beam_angle,
      vertical_beam_angle,
      beam_angle,
      radius,
      altura,
      gain,
      beam,
      twist,
      tipo_estructura,
      detalle_estructura,
      banda,
      portadora,

      raw: { fmt, op_detected: OP, ...o },
    });
  }



  const norm = (v) => String(v ?? "").trim().toUpperCase();

    const seen = new Set();
    const uniqueRows = [];
    let exactDupCount = 0;

    for (const row of out) {
    const key = [
        norm(row.operator),
        norm(row.cell_id),
        norm(row.lac_tac),     // si viene null -> ""
        norm(row.cell_name),
    ].join("|");

    if (seen.has(key)) {
        exactDupCount++;
        continue; // duplicado exacto (cell_id + lac + cell_name)
    }
    seen.add(key);
    uniqueRows.push(row);
    }

return { operatorGuess, rows: uniqueRows, skipped, exactDupCount };
}
