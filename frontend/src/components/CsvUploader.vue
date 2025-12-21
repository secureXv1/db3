<template>
  <div class="uploader">
    <div class="row">
      <input
        ref="fileInput"
        type="file"
        accept=".csv,.db,.db3,application/vnd.sqlite3,application/x-sqlite3"
        multiple
        @change="onPick"
      />

      <button @click="upload" :disabled="!files.length || uploading">
        {{ uploading ? "Cargando..." : buttonLabel }}
      </button>

      <button class="ghost" @click="clear" :disabled="uploading">Limpiar</button>

      <label class="chk">
        <input type="checkbox" v-model="saveRaw" :disabled="uploading" />
        Guardar RAW (jsonb)
      </label>
    </div>

    <div class="small" v-if="files.length">
      {{ files.length }} archivo(s) seleccionados —
      CSV: {{ csvFiles.length }} | DB/DB3: {{ dbFiles.length }}
    </div>

    <div class="bar" v-if="uploading">
      <div class="fill" :style="{ width: progress + '%' }"></div>
    </div>

    <div class="result" v-if="result">
      <div class="summary">
        <div class="kpi">
          <div class="k">Archivos</div>
          <div class="v">{{ flatResults.length }}</div>
        </div>
        <div class="kpi">
          <div class="k">Vistos</div>
          <div class="v">{{ totals.seen.toLocaleString() }}</div>
        </div>
        <div class="kpi ok">
          <div class="k">Cargados</div>
          <div class="v">{{ totals.loaded.toLocaleString() }}</div>
        </div>
        <div class="kpi warn">
          <div class="k">Omitidos</div>
          <div class="v">{{ totals.omitted.toLocaleString() }}</div>
        </div>
      </div>

      <div class="tableWrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Tipo</th>
              <th class="num">Vistos</th>
              <th class="num">Cargados</th>
              <th class="num">Omitidos</th>
              <th class="num">% Omitido</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in flatResults" :key="r.source_file">
              <td class="file">{{ r.source_file }}</td>
              <td>
                <span class="pill">{{ typeLabel(r.source_type) }}</span>
              </td>
              <td class="num">{{ (r.rows_seen ?? 0).toLocaleString() }}</td>
              <td class="num ok">{{ (r.rows_loaded ?? 0).toLocaleString() }}</td>
              <td class="num warn">{{ (r.rows_omitted ?? 0).toLocaleString() }}</td>
              <td class="num">
                {{ pctOmitted(r) }}%
              </td>
              <td>
                <span
                  class="status"
                  :class="statusClass(r)"
                >
                  {{ statusText(r) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <details class="raw">
        <summary>Ver respuesta raw</summary>
        <pre>{{ JSON.stringify(result, null, 2) }}</pre>
      </details>
    </div>

    <div class="error" v-if="error">{{ error }}</div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";

const API = import.meta.env.VITE_API_BASE;

const fileInput = ref(null);
const files = ref([]);
const uploading = ref(false);
const progress = ref(0);
const result = ref(null);
const error = ref("");
const saveRaw = ref(true);

const flatResults = computed(() => {
  // result = { ok, uploads:[ {kind, ok, results:[...]} ] }
  const up = result.value?.uploads || [];
  const out = [];
  for (const u of up) {
    for (const r of (u.results || [])) out.push(r);
  }
  return out;
});

const totals = computed(() => {
  let seen = 0, loaded = 0, omitted = 0;
  for (const r of flatResults.value) {
    seen += Number(r.rows_seen || 0);
    loaded += Number(r.rows_loaded || 0);
    omitted += Number(r.rows_omitted || 0);
  }
  return { seen, loaded, omitted };
});

function typeLabel(t) {
  if (t === 1) return "DB (idcatcher)";
  if (t === 2) return "CSV";
  if (t === 3) return "DB3 (Views)";
  return `Tipo ${t ?? "-"}`;
}

function pctOmitted(r) {
  const seen = Number(r.rows_seen || 0);
  const om = Number(r.rows_omitted || 0);
  if (!seen) return 0;
  return Math.round((om / seen) * 100);
}

function statusClass(r) {
  const loaded = Number(r.rows_loaded || 0);
  const omitted = Number(r.rows_omitted || 0);
  if (loaded > 0) return "ok";
  if (omitted > 0) return "warn";
  return "muted";
}

function statusText(r) {
  const loaded = Number(r.rows_loaded || 0);
  const omitted = Number(r.rows_omitted || 0);
  if (loaded > 0 && omitted > 0) return "Parcial";
  if (loaded > 0) return "Cargado";
  if (omitted > 0) return "Ya existían";
  return "Sin datos";
}

function isDbFile(name) {
  return /\.(db|db3)$/i.test(name || "");
}

const csvFiles = computed(() => files.value.filter(f => !isDbFile(f.name)));
const dbFiles  = computed(() => files.value.filter(f =>  isDbFile(f.name)));

const buttonLabel = computed(() => {
  if (!files.value.length) return "Subir";
  if (dbFiles.value.length && !csvFiles.value.length) return "Subir DB/DB3";
  if (csvFiles.value.length && !dbFiles.value.length) return "Subir CSV";
  return "Subir CSV + DB/DB3";
});

function onPick(e) {
  files.value = Array.from(e.target.files || []);
  result.value = null;
  error.value = "";
  progress.value = 0;
}

function clear() {
  files.value = [];
  result.value = null;
  error.value = "";
  progress.value = 0;
  if (fileInput.value) fileInput.value.value = "";
}

function xhrUpload(url, fd, onProg) {
  const xhr = new XMLHttpRequest();

  const p = new Promise((resolve, reject) => {
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && onProg) onProg(evt.loaded, evt.total);
    };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 400) return reject(new Error(j.error || `HTTP ${xhr.status}`));
        if (!j.ok) return reject(new Error(j.error || "Error al cargar"));
        resolve(j);
      } catch (e) {
        reject(e);
      }
    };

    xhr.onerror = () => reject(new Error("Error de red"));
  });

  xhr.open("POST", url);
  xhr.send(fd);
  return p;
}

async function upload() {
  if (!files.value.length) return;

  uploading.value = true;
  progress.value = 0;
  result.value = null;
  error.value = "";

  try {
    const results = [];

    // Progreso global simple: 0-50% CSV, 50-100% DB
    recognizedExtensionsGuard();

    if (csvFiles.value.length) {
      const fdCsv = new FormData();
      csvFiles.value.forEach(f => fdCsv.append("files", f));

      const urlCsv = `${API}/api/ingest/upload?saveRaw=${saveRaw.value ? "1" : "0"}`;
      const jCsv = await xhrUpload(urlCsv, fdCsv, (loaded, total) => {
        progress.value = Math.round((loaded / total) * 50);
      });

      results.push({ kind: "csv", ...jCsv });
    }

    if (dbFiles.value.length) {
      const fdDb = new FormData();
      dbFiles.value.forEach(f => fdDb.append("files", f));

      const urlDb = `${API}/api/ingest/upload-db?saveRaw=${saveRaw.value ? "1" : "0"}`;
      const jDb = await xhrUpload(urlDb, fdDb, (loaded, total) => {
        progress.value = 50 + Math.round((loaded / total) * 50);
      });

      results.push({ kind: "db", ...jDb });
    }

    progress.value = 100;
    result.value = { ok: true, uploads: results };
  } catch (e) {
    error.value = String(e.message || e);
  } finally {
    uploading.value = false;
  }
}

// Si el usuario mete algo raro, lo avisamos (evita confusiones)
function recognizedExtensionsGuard() {
  const bad = files.value.filter(f => !/\.(csv|db|db3)$/i.test(f.name || ""));
  if (bad.length) {
    throw new Error(`Archivos no soportados: ${bad.map(x => x.name).join(", ")} (solo .csv, .db, .db3)`);
  }
}
</script>

<style scoped>
.uploader { border:1px solid #e7e7e7; background:#fff; border-radius:12px; padding:12px; box-shadow: 0 6px 18px rgba(0,0,0,.05); margin-bottom: 12px; }
.row { display:flex; gap:10px; align-items:center; flex-wrap: wrap; }
button { border:1px solid #111; background:#111; color:#fff; border-radius:10px; padding:8px 12px; cursor:pointer; }
button.ghost { background:transparent; color:#111; }
button:disabled { opacity:.6; cursor:not-allowed; }
.small { margin-top:8px; color:#555; font-size:12px; }
.chk { display:flex; align-items:center; gap:6px; font-size:12px; color:#444; }
.bar { height:10px; background:#f0f0f0; border-radius:999px; margin-top:10px; overflow:hidden; }
.fill { height:100%; background:#111; width:0; }
.result pre { margin-top:10px; padding:10px; background:#fafafa; border:1px solid #eee; border-radius:10px; font-size:12px; overflow:auto; max-height: 180px; }
.error { margin-top:10px; color:#b00020; background:#fff5f5; border:1px solid #ffd0d0; padding:10px; border-radius:10px; }
.result{
  margin-top:10px;
  border:1px solid #eee;
  border-radius:12px;
  padding:12px;
  background:#fff;
}

.summary{
  display:grid;
  grid-template-columns: repeat(4, minmax(0,1fr));
  gap:10px;
  margin-bottom:12px;
}

.kpi{
  border:1px solid #eee;
  border-radius:12px;
  padding:10px;
  background:#fafafa;
}
.kpi .k{ font-size:12px; color:#666; }
.kpi .v{ font-size:18px; font-weight:800; margin-top:4px; }

.kpi.ok{ background:#f3fff6; border-color:#cfead6; }
.kpi.warn{ background:#fff8ef; border-color:#ffe1bf; }

.tableWrap{
  overflow:auto;
  border:1px solid #eee;
  border-radius:12px;
}

.tbl{
  width:100%;
  border-collapse:collapse;
  font-size:13px;
}
.tbl th, .tbl td{
  padding:10px 12px;
  border-bottom:1px solid #eee;
  white-space:nowrap;
}
.tbl th{ text-align:left; background:#fafafa; font-weight:800; color:#333; }
.tbl td.num, .tbl th.num{ text-align:right; font-variant-numeric: tabular-nums; }

.file{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

.pill{
  display:inline-block;
  padding:4px 10px;
  border-radius:999px;
  border:1px solid #e5e5e5;
  background:#fff;
  font-size:12px;
}

.status{
  display:inline-block;
  padding:4px 10px;
  border-radius:999px;
  font-size:12px;
  border:1px solid #e5e5e5;
  background:#f5f5f5;
  color:#444;
}
.status.ok{ background:#eafff1; border-color:#bfe8cd; color:#156b3a; }
.status.warn{ background:#fff1df; border-color:#ffd6a8; color:#7a4b00; }
.status.muted{ background:#f5f5f5; border-color:#e5e5e5; color:#666; }

td.ok{ color:#156b3a; font-weight:700; }
td.warn{ color:#7a4b00; font-weight:700; }

.raw{
  margin-top:10px;
  border-top:1px dashed #ddd;
  padding-top:10px;
}
.raw summary{ cursor:pointer; color:#333; font-weight:700; }
.raw pre{
  margin-top:8px;
  padding:10px;
  background:#fafafa;
  border:1px solid #eee;
  border-radius:10px;
  font-size:12px;
  overflow:auto;
  max-height:220px;
}

</style>
