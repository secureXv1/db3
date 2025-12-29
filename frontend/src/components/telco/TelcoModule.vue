<template>
  <section class="panel">
    <div class="headRow">
      <div>
        <h2 class="h2">Análisis Telco (XDR)</h2>
        <div class="muted">
          1) Crear Analisis → 2) Subir Excel → 3) Generar analisis
        </div>
      </div>

      <div class="right">
        <button class="ghost" @click="loadFromStorage" :disabled="loading">Recargar</button>
      </div>
    </div>

    <!-- Run -->
    <div class="card">
      <div class="cardHead">
        <div>
          <div class="title">Sesión (Run)</div>
          <div class="muted small">
            Se guarda en localStorage como <span class="mono">telco_run_id</span>.
          </div>
        </div>

        <div class="actions">
          <button class="primary" @click="createRun" :disabled="loading">Crear analisis</button>
          <button class="danger" @click="clearRun" :disabled="loading || !runId">Borrar registros</button>
        </div>
      </div>

      <div class="warn" v-if="!runId">
        Crea un run para poder subir archivos.
      </div>

      <div class="ok" v-if="runMeta && runId">
        Creado:
        <b>{{ fmtTs(runMeta.created_at) }}</b>
        <span class="muted small"> · runId:</span>
        <b class="mono">{{ runId }}</b>
      </div>
    </div>

    <!-- Upload -->
    <div class="card">
      <div class="cardHead">
        <div>
          <div class="title">Cargar registros (Excel)</div>
          <div class="muted small">
            Soporta múltiples archivos. Duplicados (fecha+hora+contactos) se omiten en DB por el unique (ON CONFLICT DO NOTHING).
          </div>
        </div>

        <div class="actions">
          <input ref="fileEl" type="file" multiple accept=".xlsx,.xls" @change="onPickFiles" />
          <button class="primary" @click="uploadXdr" :disabled="loading || !runId || !files.length">
            {{ loading ? "Subiendo..." : "Subir" }}
          </button>
          <button class="ghost" @click="clearPicked" :disabled="loading || !files.length">Quitar</button>
        </div>
      </div>

      <div class="muted small" v-if="files.length">
        Archivos seleccionados: <b>{{ files.length }}</b>
      </div>

      <div class="grid2" v-if="uploadSummary">
        <div class="kpi">
          <div class="kLabel">Vistos</div>
          <div class="kVal">{{ uploadSummary.rows_seen }}</div>
        </div>
        <div class="kpi">
          <div class="kLabel">Insertados</div>
          <div class="kVal">{{ uploadSummary.rows_inserted }}</div>
        </div>
        <div class="kpi">
          <div class="kLabel">Omitidos</div>
          <div class="kVal">{{ uploadSummary.rows_omitted }}</div>
        </div>
        <div class="kpi">
          <div class="kLabel">Hits priorizados</div>
          <div class="kVal">{{ uploadSummary.prioritized_hits }}</div>
        </div>
      </div>

      <div class="tableWrap" v-if="uploadSummary?.results?.length">
        <table>
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Vistos</th>
              <th>Insertados</th>
              <th>Omitidos</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in uploadSummary.results" :key="r.file">
              <td class="mono">{{ r.file }}</td>
              <td class="mono">{{ r.rows_seen }}</td>
              <td class="mono">{{ r.rows_inserted }}</td>
              <td class="mono">{{ r.rows_omitted }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="error" v-if="uploadError">{{ uploadError }}</div>
    </div>

    <!-- Análisis -->
    <div class="card">
      <div class="cardHead">
        <div>
          <div class="title">Análisis (flujos)</div>
          <div class="muted small">Filtros aplican a resumen y timeline.</div>
        </div>

        <div class="actions">
          <button class="primary" @click="runAnalysis" :disabled="loading || !runId">
            {{ loading ? "Analizando..." : "Generar análisis" }}
          </button>
          <button class="ghost" @click="resetFilters" :disabled="loading">Limpiar filtros</button>
        </div>
      </div>

      <div class="grid">
        <div class="field">
          <label>Desde</label>
          <input v-model="filters.from" type="datetime-local" />
        </div>

        <div class="field">
          <label>Hasta</label>
          <input v-model="filters.to" type="datetime-local" />
        </div>

        <div class="field">
          <label>Dirección</label>
          <select v-model="filters.dir">
            <option value="BOTH">Ambas</option>
            <option value="IN">Entrantes</option>
            <option value="OUT">Salientes</option>
          </select>
        </div>

        <div class="field">
          <label>Horario (hora)</label>
          <div class="rowInline">
            <input v-model.number="filters.hour_from" type="number" min="0" max="23" class="num" />
            <span class="muted small">a</span>
            <input v-model.number="filters.hour_to" type="number" min="0" max="23" class="num" />
          </div>
          <div class="muted tiny">Ej: 22 a 6 cruza medianoche.</div>
        </div>

        <div class="field">
          <label>Buscar número</label>
          <input v-model.trim="filters.q" placeholder="310..., 300..." />
          <div class="muted tiny">Filtra tablas en pantalla.</div>
        </div>

        <div class="field">
          <label>Límite timeline</label>
          <input v-model.number="filters.limit" type="number" min="50" max="20000" class="num" />
        </div>
      </div>
    </div>

    <div class="card" v-if="flowsSummary">
      <div class="title">Resumen</div>

      <div class="grid2">
        <div class="kpi">
          <div class="kLabel">Total llamadas</div>
          <div class="kVal">{{ flowsSummary.kpis.total_calls }}</div>
        </div>
        <div class="kpi">
          <div class="kLabel">A únicos</div>
          <div class="kVal">{{ flowsSummary.kpis.uniq_callers }}</div>
        </div>
        <div class="kpi">
          <div class="kLabel">B únicos</div>
          <div class="kVal">{{ flowsSummary.kpis.uniq_receivers }}</div>
        </div>
        <div class="kpi">
          <div class="kLabel">Enlaces únicos (A→B)</div>
          <div class="kVal">{{ flowsSummary.kpis.uniq_edges }}</div>
        </div>
      </div>

      <div class="muted small" style="margin-top:8px">
        Rango: <b>{{ fmtTs(flowsSummary.kpis.min_ts) }}</b> → <b>{{ fmtTs(flowsSummary.kpis.max_ts) }}</b>
      </div>
    </div>

    <div class="card" v-if="flowsSummary?.top_edges?.length">
      <div class="cardHead">
        <div>
          <div class="title">Top enlaces (A → B)</div>
          <div class="muted small">Ordenado por cantidad de llamadas</div>
        </div>
      </div>

      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>A (origen)</th>
              <th>B (destino)</th>
              <th>Llamadas</th>
              <th>Duración total</th>
              <th>Primera</th>
              <th>Última</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, idx) in filteredEdges" :key="e.src + '->' + e.dst">
              <td class="mono">{{ idx + 1 }}</td>
              <td class="mono">{{ e.src }}</td>
              <td class="mono">{{ e.dst }}</td>
              <td class="mono">{{ e.calls }}</td>
              <td class="mono">{{ e.total_duration }}</td>
              <td class="mono">{{ fmtTs(e.first_ts) }}</td>
              <td class="mono">{{ fmtTs(e.last_ts) }}</td>
            </tr>

            <tr v-if="filteredEdges.length === 0">
              <td colspan="7" class="empty">Sin resultados (según búsqueda)</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" v-if="flowsTimeline?.length">
      <div class="cardHead">
        <div>
          <div class="title">Timeline (eventos)</div>
          <div class="muted small">Ordenado por fecha/hora</div>
        </div>
      </div>

      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th>TS</th>
              <th>Dir</th>
              <th>A</th>
              <th>B</th>
              <th>Dur(s)</th>
              <th>Celda inicio</th>
              <th>Celda final</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filteredTimeline" :key="r.id">
              <td class="mono">{{ fmtTs(r.call_ts) }}</td>
              <td class="mono">{{ r.direction }}</td>
              <td class="mono">{{ r.a_number }}</td>
              <td class="mono">{{ r.b_number }}</td>
              <td class="mono">{{ r.duration_sec ?? "-" }}</td>
              <td class="mono">{{ r.nombre_celda_inicio || r.celda_inicio || "-" }}</td>
              <td class="mono">{{ r.nombre_celda_final || r.celda_final || "-" }}</td>
            </tr>

            <tr v-if="filteredTimeline.length === 0">
              <td colspan="7" class="empty">Sin resultados (según búsqueda)</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="error" v-if="error">{{ error }}</div>

    <div class="muted small legal">
      Úsalo solo con autorización y conforme a la ley/política de tu entidad (datos sensibles).
    </div>
  </section>
</template>

<script setup>
import { ref, computed } from "vue";

const API = import.meta.env.VITE_API_BASE || "";

const loading = ref(false);
const error = ref("");

const runId = ref(Number(localStorage.getItem("telco_run_id") || 0) || null);
const runMeta = ref(null);
const runName = ref("");

const fileEl = ref(null);
const files = ref([]);

const uploadSummary = ref(null);
const uploadError = ref("");

const filters = ref({
  from: "",
  to: "",
  dir: "BOTH",
  hour_from: 0,
  hour_to: 23,
  limit: 2000,
  q: ""
});

const flowsSummary = ref(null);
const flowsTimeline = ref([]);

function authHeaders(extra = {}) {
  const t = localStorage.getItem("token");
  return {
    ...(extra || {}),
    ...(t ? { Authorization: `Bearer ${t}` } : {})
  };
}

async function apiFetch(path, opts = {}) {
  const headers = authHeaders(opts.headers || {});
  const final = { ...opts, headers };
  const r = await fetch(`${API}${path}`, final);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) {
    throw new Error(j.error || `HTTP ${r.status}`);
  }
  return j;
}

function loadFromStorage() {
  runId.value = Number(localStorage.getItem("telco_run_id") || 0) || null;
}

async function createRun() {
  error.value = "";
  uploadError.value = "";

  loading.value = true;
  try {
    const j = await apiFetch(`/api/telco/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    runId.value = j.run.id;
    runMeta.value = j.run;
    localStorage.setItem("telco_run_id", String(runId.value));

    // reset ui
    uploadSummary.value = null;
    files.value = [];
    if (fileEl.value) fileEl.value.value = "";
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

function onPickFiles(e) {
  files.value = Array.from(e.target.files || []);
}

function clearPicked() {
  files.value = [];
  if (fileEl.value) fileEl.value.value = "";
}

async function uploadXdr() {
  if (!runId.value || !files.value.length) return;

  uploadError.value = "";
  error.value = "";
  loading.value = true;

  try {
    const fd = new FormData();
    for (const f of files.value) fd.append("files", f);

    const t = localStorage.getItem("token");
    const r = await fetch(`${API}/api/telco/runs/${runId.value}/upload-xdr`, {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: fd
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);

    uploadSummary.value = j;
  } catch (e) {
    uploadError.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

async function clearRun() {
  if (!runId.value) {
    throw new Error("No hay runId. Crea un run primero.");
  }
  const ok = confirm("Esto borrará lo cargado en este run (análisis temporal). ¿Continuar?");
  if (!ok) return;

  error.value = "";
  uploadError.value = "";
  loading.value = true;

  try {
    const j = await apiFetch(`/api/telco/runs/${runId.value}/clear`, { method: "DELETE" });

    uploadSummary.value = null;
    flowsSummary.value = null;
    flowsTimeline.value = [];
    files.value = [];
    if (fileEl.value) fileEl.value.value = "";

    alert(`Listo. Eliminados: ${j.deleted}`);
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

function toBogotaTimestamptz(localDT) {
  const s = String(localDT || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s}:00-05:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return `${s}-05:00`;
  return s;
}

function buildQs() {
  const p = new URLSearchParams();

  const from = toBogotaTimestamptz(filters.value.from);
  const to = toBogotaTimestamptz(filters.value.to);
  if (from) p.set("from", from);
  if (to) p.set("to", to);

  p.set("dir", filters.value.dir || "BOTH");
  p.set("hour_from", String(filters.value.hour_from ?? 0));
  p.set("hour_to", String(filters.value.hour_to ?? 23));
  p.set("limit", String(filters.value.limit ?? 2000));

  return p.toString();
}

async function runAnalysis() {
  if (!runId.value) {
    error.value = "No hay runId. Crea un análisis primero.";
    return;
  }
  error.value = "";
  loading.value = true;
  try {
    const q = buildQs();
    const s = await apiFetch(`/api/telco/runs/${runId.value}/flows/summary?${q}`, { method: "GET" });
    flowsSummary.value = s;

    const t = await apiFetch(`/api/telco/runs/${runId.value}/flows/timeline?${q}`, { method: "GET" });
    flowsTimeline.value = t.rows || [];
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  filters.value = {
    from: "",
    to: "",
    dir: "BOTH",
    hour_from: 0,
    hour_to: 23,
    limit: 2000,
    q: ""
  };
}

const filteredEdges = computed(() => {
  const q = String(filters.value.q || "").trim();
  const edges = flowsSummary.value?.top_edges || [];
  if (!q) return edges;
  return edges.filter(e => String(e.src).includes(q) || String(e.dst).includes(q));
});

const filteredTimeline = computed(() => {
  const q = String(filters.value.q || "").trim();
  const rows = flowsTimeline.value || [];
  if (!q) return rows;
  return rows.filter(r => String(r.a_number).includes(q) || String(r.b_number).includes(q));
});

function fmtTs(ts) {
  if (!ts) return "-";
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}
</script>

<style scoped>
/* Reusa tus variables globales (las que ya defines en App.vue (:global(:root){...}) */

.panel{
  background: var(--glass);
  border: 1px solid var(--stroke);
  border-radius: 16px;
  box-shadow: 0 22px 70px rgba(0,0,0,.35);
  backdrop-filter: blur(14px);
  padding: 14px;
  margin-top: 12px;
  position: relative;
}
.headRow{
  display:flex;
  align-items:flex-start;
  justify-content: space-between;
  gap: 10px;
}
.h2{ margin:0; font-size: 18px; font-weight: 900; }
.muted{ color: var(--muted); }
.small{ font-size: 12px; }
.tiny{ font-size: 11px; opacity: .9; }
.mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

.card{
  margin-top: 12px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--stroke);
  background: rgba(255,255,255,.06);
}
.cardHead{
  display:flex;
  align-items:flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.title{ font-weight: 900; }

.actions{
  display:flex;
  gap: 8px;
  align-items:center;
  flex-wrap: wrap;
}

button{
  border: 1px solid var(--stroke);
  background: rgba(255,255,255,.08);
  color: var(--text);
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
}
button:hover{ background: rgba(255,255,255,.12); }
button:disabled{ opacity:.55; cursor:not-allowed; }

.primary{
  border-color: rgba(34,211,238,.55);
  background: linear-gradient(135deg, rgba(34,211,238,.22), rgba(96,165,250,.18));
  font-weight: 900;
}
.ghost{ background: rgba(255,255,255,.06); }
.danger{
  border-color: rgba(251,113,133,.55);
  background: rgba(251,113,133,.12);
  font-weight: 900;
}

.grid2{
  margin-top: 10px;
  display:grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.kpi{
  border: 1px solid var(--stroke2);
  background: rgba(255,255,255,.04);
  border-radius: 14px;
  padding: 10px;
}
.kLabel{ font-size: 12px; color: var(--muted); }
.kVal{ font-size: 20px; font-weight: 900; margin-top: 4px; }

.tableWrap{
  margin-top: 10px;
  overflow:auto;
  border: 1px solid var(--stroke2);
  border-radius: 14px;
}
table{
  width: 100%;
  border-collapse: collapse;
  min-width: 900px;
}
th, td{
  padding: 10px 10px;
  border-bottom: 1px solid rgba(255,255,255,.06);
  text-align: left;
  font-size: 13px;
}
th{ color: var(--muted); font-weight: 900; }

.warn{
  margin-top: 10px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(251,113,133,.25);
  background: rgba(251,113,133,.08);
}
.ok{
  margin-top: 10px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(34,211,238,.22);
  background: rgba(34,211,238,.06);
}
.error{
  margin-top: 10px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(251,113,133,.35);
  background: rgba(251,113,133,.10);
}
.hintRow{ margin-top: 10px; display:flex; gap: 10px; }
.legal{ margin-top: 10px; opacity: .85; }

/* --- Filtros análisis --- */
.grid{
  margin-top: 10px;
  display:grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.field label{
  display:block;
  font-size: 12px;
  color: var(--muted);
  font-weight: 900;
  margin-bottom: 6px;
}
.field input, .field select{
  width: 100%;
  border: 1px solid var(--stroke);
  border-radius: 12px;
  padding: 10px 12px;
  outline: none;
  background: rgba(255,255,255,.06);
  color: var(--text);
}
.field input:focus, .field select:focus{
  border-color: rgba(34,211,238,.55);
  box-shadow: 0 0 0 4px rgba(34,211,238,.12);
}
.rowInline{ display:flex; gap:8px; align-items:center; }
.num{ max-width: 170px; }
.empty{
  text-align:center;
  padding: 18px 10px;
  color: var(--muted);
}
</style>
