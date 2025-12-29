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
          <div class="title">Registros temporales (RUN)</div>
       
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
        Creado: <b>{{ fmtTs(runMeta.created_at) }}</b>
        <span v-if="runMeta.name"> | Nombre: <b>{{ runMeta.name }}</b></span>
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
          <button class="primary" @click="upload" :disabled="loading || !runId || !files.length">
            {{ loading ? "Subiendo..." : "Subir" }}
          </button>
          <button class="ghost" @click="clearPicked" :disabled="loading || !files.length">
            Quitar
          </button>
        </div>
      </div>

      <div class="muted small" v-if="files.length">
        Archivos: <b>{{ files.length }}</b> —
        <span class="mono">{{ files.map(f => f.name).slice(0,3).join(", ") }}</span>
        <span v-if="files.length>3"> …</span>
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

    <!-- Target -->


    <div class="error" v-if="error">{{ error }}</div>

    <div class="muted small legal">
      Úsalo solo con autorización y conforme a la ley/política de tu entidad (datos sensibles).
    </div>
  </section>
</template>

<script setup>
import { ref } from "vue";

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



function authHeaders(extra = {}) {
  const t = localStorage.getItem("token");
  return {
    ...(extra || {}),
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
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
  const v = Number(localStorage.getItem("telco_run_id") || 0) || null;
  runId.value = v;
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
    files.value = [];
    if (fileEl.value) fileEl.value.value = "";

    alert(`Listo. Eliminados: ${j.deleted}`);
  } finally {
    loading.value = false;
  }
}


function onPickFiles(ev) {
  const list = Array.from(ev.target.files || []);
  files.value = list;
}

function clearPicked() {
  files.value = [];
  if (fileEl.value) fileEl.value.value = "";
}

async function upload() {
  if (!runId.value || !files.value.length) return;

  error.value = "";
  uploadError.value = "";
  loading.value = true;

  try {
    const fd = new FormData();
    for (const f of files.value) fd.append("files", f);

    const t = localStorage.getItem("token");
    const r = await fetch(`${API}/api/telco/runs/${runId.value}/upload-xdr`, {
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


function fmtTs(ts) {
  if (!ts) return "-";
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}
</script>

<style scoped>
/* Re-usa variables globales que ya defines en App.vue (:global(:root){...}) */

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
.panel::before{
  content:"";
  position:absolute;
  left: 14px; right:14px; top:0;
  height:2px;
  background: linear-gradient(90deg, transparent, rgba(34,211,238,.8), rgba(96,165,250,.7), transparent);
  opacity:.9;
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

.input{
  border: 1px solid var(--stroke);
  border-radius: 12px;
  padding: 10px 12px;
  outline: none;
  background: rgba(255,255,255,.06);
  color: var(--text);
  min-width: 240px;
}
.input:focus{
  border-color: rgba(34,211,238,.55);
  box-shadow: 0 0 0 4px rgba(34,211,238,.12);
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
  min-width: 700px;
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
</style>
