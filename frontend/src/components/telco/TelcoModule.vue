<!-- frontend/src/components/TelcoModule.vue -->
<template>
  <section class="panel">
    <div class="headRow">
      <div>
        <h2 class="h2">Análisis Telco (XDR)</h2>
        <div class="muted">
          1) Crear Run → 2) (Nuevo análisis = limpiar) → 3) Subir Excel → 4) Generar análisis
        </div>
      </div>

      <div class="right">
        <button class="ghost" @click="loadFromStorage" :disabled="loading">Recargar</button>
      </div>
    </div>

    <div class="tabsRow">
      <button class="ghost" :class="{ active: activeSub==='xdr' }" @click="activeSub='xdr'">
        Analisis RETEL
      </button>
      <button class="ghost" :class="{ active: activeSub==='antennas' }" @click="activeSub='antennas'">
        Antenas
      </button>
    </div>

    <div v-if="activeSub==='xdr'">
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
            <div class="field inline">
              <label>Nombre del run</label>
              <input v-model.trim="runName" placeholder="Ej: Caso Kennedy - 2026-01-01" />
            </div>

            <button class="primary" @click="createRun" :disabled="loading">Crear run</button>
            <button class="ghost" @click="newAnalysis" :disabled="loading || !runId">Nuevo análisis (limpiar)</button>
            <button class="danger" @click="clearRun" :disabled="loading || !runId">Borrar registros</button>
          </div>
        </div>

        <div class="warn" v-if="!runId">
          Crea un run para poder subir archivos.
        </div>

        <div class="ok" v-if="runMeta && runId">
          Run:
          <b>{{ runMeta.name }}</b>
          <span class="muted small"> · creado:</span>
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
              Selecciona operador antes de subir. CLARO: se recorta el último dígito de celda para match con antenas.
            </div>
          </div>

          <div class="actions">
            <div class="field inline">
              <label>Operador</label>
              <select v-model="uploadOperator">
                <option value="CLARO">CLARO</option>
                <option value="MOVISTAR">MOVISTAR</option>
                <option value="TIGO">TIGO</option>
                <option value="WOM">WOM</option>
                <option value="OTRO">OTRO</option>
              </select>
            </div>

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
            <div class="muted small">Filtros aplican a resumen, timeline y lugares.</div>
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

      <!-- Charts reales -->
      <div class="card" v-if="flowsSummary">
        <div class="cardHead">
          <div>
            <div class="title">Gráficas</div>
            <div class="muted small">Contactos (top enlaces) y lugares (cruce con antenas si existe).</div>
          </div>
        </div>

        <div class="charts2">
          <div class="chartBox">
            <div class="muted small" style="margin-bottom:6px">Top enlaces (A→B) por llamadas</div>
            <canvas ref="chartContactsEl" height="140"></canvas>
          </div>

          <div class="chartBox">
            <div class="muted small" style="margin-bottom:6px">Top lugares por presencia (inicio/final)</div>
            <canvas ref="chartPlacesEl" height="140"></canvas>
          </div>
        </div>

        <div class="error" v-if="placesError">{{ placesError }}</div>
      </div>

      <!-- Resumen -->
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

      <!-- Lugares (tabla con lat/lon si existe) -->
      <div class="card" v-if="placesTop?.length">
        <div class="cardHead">
          <div>
            <div class="title">Lugares frecuentados (top)</div>
            <div class="muted small">Incluye lat/lon si la tabla antennas tiene coordenadas.</div>
          </div>
        </div>

        <div class="tableWrap">
          <table style="min-width:820px">
            <thead>
              <tr>
                <th>Operador</th>
                <th>Lugar</th>
                <th>Cell</th>
                <th>Eventos</th>
                <th>Lat</th>
                <th>Lon</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in placesTop" :key="`${r.operator}:${r.cell_key}`">
                <td class="mono">{{ r.operator }}</td>
                <td>{{ r.lugar }}</td>
                <td class="mono">{{ r.cell_key }}</td>
                <td class="mono">{{ r.hits }}</td>
                <td class="mono">{{ r.lat ?? "-" }}</td>
                <td class="mono">{{ r.lon ?? "-" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Top enlaces (tabla) -->
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

      <!-- Timeline -->
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
                <th>Oper</th>
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
                <td class="mono">{{ r.operator ?? "-" }}</td>
                <td class="mono">{{ r.a_number }}</td>
                <td class="mono">{{ r.b_number }}</td>
                <td class="mono">{{ r.duration_sec ?? "-" }}</td>
                <td class="mono">{{ r.nombre_celda_inicio || r.celda_inicio || "-" }}</td>
                <td class="mono">{{ r.nombre_celda_final || r.celda_final || "-" }}</td>
              </tr>

              <tr v-if="filteredTimeline.length === 0">
                <td colspan="8" class="empty">Sin resultados (según búsqueda)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="error" v-if="error">{{ error }}</div>
    </div>

    <div v-else>
      <AntennaSection />
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from "vue";
import Chart from "chart.js/auto";
import AntennaSection from "./AntennaSection.vue";

const API = import.meta.env.VITE_API_BASE || "";

const loading = ref(false);
const error = ref("");

const activeSub = ref("xdr");

const runId = ref(Number(localStorage.getItem("telco_run_id") || 0) || null);
const runMeta = ref(null);
const runName = ref("");

const uploadOperator = ref(localStorage.getItem("telco_upload_operator") || "CLARO");

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
  q: "",
});

const flowsSummary = ref(null);
const flowsTimeline = ref([]);

const placesTop = ref([]);
const placesError = ref("");

const chartContactsEl = ref(null);
const chartPlacesEl = ref(null);
let contactsChart = null;
let placesChart = null;

/**
 * Construye headers con token si existe.
 */
function authHeaders(extra = {}) {
  const t = localStorage.getItem("token");
  return { ...(extra || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

/**
 * Wrapper fetch JSON con manejo de errores.
 */
async function apiFetch(path, opts = {}) {
  const headers = authHeaders(opts.headers || {});
  const final = { ...opts, headers };
  const r = await fetch(`${API}${path}`, final);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/**
 * Recarga runId desde localStorage y trae meta (nombre/fecha).
 */
async function loadFromStorage() {
  const stored = Number(localStorage.getItem("telco_run_id") || 0) || null;
  runId.value = stored;

  if (!runId.value) {
    runMeta.value = null;
    return;
  }

  try {
    const j = await apiFetch(`/api/telco/runs/${runId.value}`, { method: "GET" });
    runMeta.value = j.run;
    runName.value = j.run?.name || "";
  } catch {
    runMeta.value = null;
  }
}

/**
 * Crea un run nuevo con nombre (input).
 */
async function createRun() {
  error.value = "";
  uploadError.value = "";
  loading.value = true;

  try {
    const j = await apiFetch(`/api/telco/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: runName.value || "" }),
    });

    runId.value = j.run.id;
    runMeta.value = j.run;
    localStorage.setItem("telco_run_id", String(runId.value));

    uploadSummary.value = null;
    flowsSummary.value = null;
    flowsTimeline.value = [];
    placesTop.value = [];
    placesError.value = "";
    clearPicked();
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

/**
 * Nuevo análisis:
 * - Limpia call_records_tmp/prioritized_hits del run actual
 * - (opcional) actualiza nombre del run si el usuario cambió el input
 */
async function newAnalysis() {
  if (!runId.value) return;

  error.value = "";
  uploadError.value = "";
  loading.value = true;

  try {
    // 1) limpiar datos temporales (evita acumulación/duplicidad)
    await apiFetch(`/api/telco/runs/${runId.value}/clear`, { method: "DELETE" });

    // 2) actualizar nombre si viene
    const name = String(runName.value || "").trim();
    if (name) {
      const u = await apiFetch(`/api/telco/runs/${runId.value}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      runMeta.value = u.run;
    }

    // 3) reset UI
    uploadSummary.value = null;
    flowsSummary.value = null;
    flowsTimeline.value = [];
    placesTop.value = [];
    placesError.value = "";
    clearPicked();
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

/**
 * Borra registros del run (equivale a limpiar).
 */
async function clearRun() {
  if (!runId.value) return;

  error.value = "";
  uploadError.value = "";
  loading.value = true;

  try {
    await apiFetch(`/api/telco/runs/${runId.value}/clear`, { method: "DELETE" });

    uploadSummary.value = null;
    flowsSummary.value = null;
    flowsTimeline.value = [];
    placesTop.value = [];
    placesError.value = "";
    clearPicked();
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

/**
 * Maneja selección de archivos.
 */
function onPickFiles(e) {
  files.value = Array.from(e.target.files || []);
}

/**
 * Limpia selección de archivos.
 */
function clearPicked() {
  files.value = [];
  if (fileEl.value) fileEl.value.value = "";
}

/**
 * Convierte datetime-local a timestamptz Bogota (-05:00).
 */
function toBogotaTimestamptz(localDT) {
  const s = String(localDT || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s}:00-05:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return `${s}-05:00`;
  return s;
}

/**
 * Construye querystring estándar para endpoints de análisis.
 */
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

/**
 * Sube Excel(s) al backend. Envia operador seleccionado por query.
 */
async function uploadXdr() {
  if (!runId.value || !files.value.length) return;

  uploadError.value = "";
  error.value = "";
  loading.value = true;

  try {
    const op = String(uploadOperator.value || "OTRO").toUpperCase().trim() || "OTRO";
    localStorage.setItem("telco_upload_operator", op);

    const fd = new FormData();
    for (const f of files.value) fd.append("files", f);

    const t = localStorage.getItem("token");
    const r = await fetch(`${API}/api/telco/runs/${runId.value}/upload-xdr?operator=${encodeURIComponent(op)}`, {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: fd,
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

/**
 * Limpia filtros UI.
 */
function resetFilters() {
  filters.value = {
    from: "",
    to: "",
    dir: "BOTH",
    hour_from: 0,
    hour_to: 23,
    limit: 2000,
    q: "",
  };
}

/**
 * Ejecuta análisis: summary + timeline + top lugares.
 */
async function runAnalysis() {
  if (!runId.value) return;

  error.value = "";
  placesError.value = "";
  loading.value = true;

  try {
    const q = buildQs();

    const s = await apiFetch(`/api/telco/runs/${runId.value}/flows/summary?${q}`, { method: "GET" });
    flowsSummary.value = s;

    const t = await apiFetch(`/api/telco/runs/${runId.value}/flows/timeline?${q}`, { method: "GET" });
    flowsTimeline.value = t.rows || [];

    const p = await apiFetch(`/api/telco/runs/${runId.value}/places/top?${q}`, { method: "GET" });
    placesTop.value = p.rows || [];
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

/**
 * Formatea TS para mostrar en tablas.
 */
function fmtTs(ts) {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/**
 * Filtra edges por búsqueda local (no toca backend).
 */
const filteredEdges = computed(() => {
  const q = String(filters.value.q || "").trim();
  const edges = flowsSummary.value?.top_edges || [];
  if (!q) return edges;
  return edges.filter((e) => String(e.src).includes(q) || String(e.dst).includes(q));
});

/**
 * Filtra timeline por búsqueda local (no toca backend).
 */
const filteredTimeline = computed(() => {
  const q = String(filters.value.q || "").trim();
  const rows = flowsTimeline.value || [];
  if (!q) return rows;
  return rows.filter((r) => String(r.a_number).includes(q) || String(r.b_number).includes(q));
});

/**
 * Render Chart.js: Top enlaces por llamadas.
 */
function renderContactsChart() {
  if (!chartContactsEl.value) return;

  const edges = (flowsSummary.value?.top_edges || []).slice(0, 10);
  const labels = edges.map((e) => `${e.src} → ${e.dst}`);
  const data = edges.map((e) => Number(e.calls || 0));

  if (contactsChart) contactsChart.destroy();

  contactsChart = new Chart(chartContactsEl.value, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Llamadas",
          data,
          backgroundColor: "rgba(34,211,238,.55)",
          borderColor: "rgba(34,211,238,.9)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#9aa4b2" } },
        y: { ticks: { color: "#9aa4b2" } },
      },
    },
  });
}

/**
 * Render Chart.js: Top lugares por hits.
 */
function renderPlacesChart() {
  if (!chartPlacesEl.value) return;

  const rows = (placesTop.value || []).slice(0, 10);
  const labels = rows.map((r) => r.lugar);
  const data = rows.map((r) => Number(r.hits || 0));

  if (placesChart) placesChart.destroy();

  placesChart = new Chart(chartPlacesEl.value, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Eventos",
          data,
          backgroundColor: "rgba(96,165,250,.45)",
          borderColor: "rgba(96,165,250,.9)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#9aa4b2" } },
        y: { ticks: { color: "#9aa4b2" } },
      },
    },
  });
}

watch(
  () => flowsSummary.value,
  () => {
    if (flowsSummary.value) renderContactsChart();
  }
);

watch(
  () => placesTop.value,
  () => {
    if (placesTop.value?.length) renderPlacesChart();
  }
);

onBeforeUnmount(() => {
  if (contactsChart) contactsChart.destroy();
  if (placesChart) placesChart.destroy();
});

// init: si hay run guardado, trae meta
loadFromStorage();
</script>

<style scoped>
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
.tiny{ font-size: 11px; opacity:.9; }
.mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
.right{ display:flex; gap: 8px; align-items:center; }

.tabsRow{ margin-top: 10px; display:flex; gap: 8px; flex-wrap: wrap; }
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
.ghost{ background: rgba(255,255,255,.06); }
.ghost.active{
  border-color: rgba(34,211,238,.55);
  background: rgba(34,211,238,.12);
  font-weight: 900;
}
.primary{
  border-color: rgba(34,211,238,.55);
  background: linear-gradient(135deg, rgba(34,211,238,.22), rgba(96,165,250,.18));
  font-weight: 900;
}
.danger{
  border-color: rgba(251,113,133,.55);
  background: rgba(251,113,133,.12);
  font-weight: 900;
}

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
.actions{ display:flex; gap: 8px; align-items:flex-end; flex-wrap: wrap; }

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

.grid{
  margin-top: 10px;
  display:grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 1100px){
  .grid{ grid-template-columns: 1fr; }
}

.grid2{
  margin-top: 10px;
  display:grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 1100px){
  .grid2{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
.field.inline{ min-width: 260px; }
.rowInline{ display:flex; gap:8px; align-items:center; }
.num{ max-width: 170px; }

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
.empty{
  text-align:center;
  padding: 18px 10px;
  color: var(--muted);
}

.charts2{
  margin-top: 12px;
  display:grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 1100px){
  .charts2{ grid-template-columns: 1fr; }
}
.chartBox{
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.03);
  border-radius: 14px;
  padding: 10px;
  height: 220px;
}
</style>
