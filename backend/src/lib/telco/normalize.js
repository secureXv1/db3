export function normalizePhone(v) {
  let s = String(v ?? "").trim();
  if (!s) return "";

  // quita espacios/guiones/paréntesis, deja solo dígitos y +
  s = s.replace(/[^\d+]/g, "");
  // quita +
  s = s.replace(/^\+/, "");

  // quita 57 si queda más largo que 10 dígitos
  if (s.startsWith("57") && s.length > 10) s = s.slice(2);

  return s;
}

export function parseDurationSec(v) {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

export function parseTsToIso(v) {
  if (v == null) return null;

  // 1) Si viene Date
  if (v instanceof Date && !isNaN(v.getTime())) {
    // devolvemos ISO sin Z para PG (igual puede recibir ISO completo)
    return v.toISOString();
  }

  // 2) Si viene número (serial de Excel)
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel epoch: 1899-12-30
    const excelEpoch = Date.UTC(1899, 11, 30);
    const ms = excelEpoch + v * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  let s = String(v).trim();
  if (!s) return null;

  // normaliza AM/PM español
  s = s
    .replace(/\s+/g, " ")
    .replace(/a\.?\s?m\.?/i, "AM")
    .replace(/p\.?\s?m\.?/i, "PM");

  // YYYY-MM-DD HH:MM(:SS)?
  let m = s.match(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?\b/);
  if (m) return m[0].replace("T", " ");

  // DD/MM/YYYY HH:MM(:SS)? (con o sin AM/PM)
  m = s.match(/\b\d{2}\/\d{2}\/\d{4}[ T]\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)?\b/i);
  if (m) return m[0];

  // DD/MM/YYYY (solo fecha)
  m = s.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
  if (m) return `${m[0]} 00:00:00`;

  return null;
}


export function detectDirectionFromTipo(tipo, fallback = "IN") {
  const t = String(tipo ?? "").toUpperCase();
  if (t.includes("SALIENTE")) return "OUT";
  if (t.includes("ENTRANTE")) return "IN";
  return fallback;
}
