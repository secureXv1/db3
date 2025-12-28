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

  // 1) Si ya es Date
  if (v instanceof Date && !isNaN(v.getTime())) {
    // Formato "YYYY-MM-DD HH:MM:SS" en hora local
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    const hh = String(v.getHours()).padStart(2, "0");
    const mm = String(v.getMinutes()).padStart(2, "0");
    const ss = String(v.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }

  // 2) Si viene como número serial de Excel
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel epoch: 1899-12-30
    const excelEpoch = Date.UTC(1899, 11, 30);
    const ms = excelEpoch + v * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${y}-${m}-${dd} ${hh}:${mm}:${ss}`;
    }
  }

  // 3) Si viene como string
  let s = String(v).trim();
  if (!s) return null;

  // normaliza AM/PM español
  s = s
    .replace(/\s+/g, " ")
    .replace(/a\.?\s?m\.?/i, "AM")
    .replace(/p\.?\s?m\.?/i, "PM");

  // YYYY-MM-DD HH:MM(:SS)?
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\b/);
  if (m) {
    const ss = (m[6] ?? "00").padStart(2, "0");
    return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${ss}`;
  }

  // DD/MM/YYYY HH:MM(:SS)? (acepta 1-2 dígitos hora)
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s?(AM|PM)?\b/i);
  if (m) {
    let hh = parseInt(m[4], 10);
    const mm = m[5];
    const ss = (m[6] ?? "00").padStart(2, "0");
    const ampm = (m[7] || "").toUpperCase();

    if (ampm === "PM" && hh < 12) hh += 12;
    if (ampm === "AM" && hh === 12) hh = 0;

    const DD = String(parseInt(m[1], 10)).padStart(2, "0");
    const MM = String(parseInt(m[2], 10)).padStart(2, "0");
    const YYYY = m[3];
    return `${YYYY}-${MM}-${DD} ${String(hh).padStart(2, "0")}:${mm}:${ss}`;
  }

  return null;
}


export function detectDirectionFromTipo(tipo, fallback = "IN") {
  const t = String(tipo ?? "").toUpperCase();
  if (t.includes("SALIENTE")) return "OUT";
  if (t.includes("ENTRANTE")) return "IN";
  return fallback;
}
