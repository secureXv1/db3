<template>
  <section class="panel">
    <div class="headRow">
      <div>
        <h2 class="h2">Antenas</h2>
        <div class="muted">Carga/actualiza antenas desde Excel y consulta por filtros + mapa.</div>
      </div>

      <div class="right actions">
        <!-- ✅ input oculto -->
        <input
          ref="fileEl"
          type="file"
          multiple
          accept=".xlsx,.xls"
          class="hiddenInput"
          @change="onPickFiles"
        />

        <!-- ✅ botón único -->
        <button class="primary" @click="pickFiles" :disabled="loadingUpload">
          {{ loadingUpload ? "Actualizando..." : "Actualizar DB Antenas" }}
        </button>

        <button class="ghost" @click="loadList" :disabled="loadingList">Recargar</button>
      </div>
    </div>

    <!-- ✅ Resumen de archivos elegidos -->
    <div class="card" v-if="files.length">
      <div class="cardHead">
        <div>
          <div class="title">Archivos seleccionados</div>
          <div class="muted small mono">{{ fileNames }}</div>
          <div class="muted tiny">Modo: <b>{{ uploadModeLabel }}</b></div>
        </div>

        <div class="actions">
          <select v-model="uploadMode" class="input">
            <option value="replace_operator">Actualizar (reemplazar por operador)</option>
            <option value="merge">Merge (agrega/actualiza sin inactivar)</option>
          </select>

          <button class="primary" @click="upload" :disabled="loadingUpload">
            Subir ahora
          </button>
          <button class="ghost" @click="clearPicked" :disabled="loadingUpload">Quitar</button>
        </div>
      </div>

      <div class="grid2" v-if="uploadSummary">
        <div class="kpi">
          <div class="kLabel">Vistos</div>
          <div class="kVal">{{ uploadSummary.rows_seen ?? 0 }}</div>
        </div>
        <div class="kpi">
          <div class="kLabel">Insertados</div>
          <div class="kVal">{{ uploadSummary.rows_inserted ?? 0 }}</div>
        </div>
        <div class="kpi">
          <div class="kLabel">Actualizados</div>
          <div class="kVal">{{ uploadSummary.rows_updated ?? 0 }}</div>
        </div>
        <div class="kpi">
          <div class="kLabel">Omitidos</div>
          <div class="kVal">{{ uploadSummary.rows_skipped ?? uploadSummary.rows_invalid ?? 0 }}</div>
        </div>
      </div>

      <div class="error" v-if="uploadError">{{ uploadError }}</div>
    </div>

    <!-- ✅ FILTROS -->
    <div class="card">
      <div class="cardHead">
        <div>
          <div class="title">Filtros</div>
          <div class="muted small">Busca por cell_id, cell_name, sitio, dirección, LAC_TAC, etc.</div>
        </div>

        <div class="actions">
          <button class="primary" @click="applyFilters" :disabled="loadingList">
            {{ loadingList ? "Buscando..." : "Buscar" }}
          </button>
          <button class="ghost" @click="resetFilters" :disabled="loadingList">Limpiar</button>
          <button class="ghost" @click="openMap" :disabled="!mapPoints.length">Ver mapa</button>
        </div>
      </div>

      <div class="grid">
        <!-- ✅ Operador dropdown -->
        <div class="field">
          <label>Operador</label>
          <select v-model="filters.operator" class="input">
            <option value="">Todos</option>
            <option value="CLARO">CLARO</option>
            <option value="MOVISTAR">MOVISTAR</option>
            <option value="TIGO">TIGO</option>
            <option value="WOM">WOM</option>
          </select>
        </div>

        <div class="field">
          <label>Tecnología</label>
          <input v-model.trim="filters.technology" class="input" placeholder="LTE / 4G / 3G / GSM..." />
        </div>

        <div class="field">
          <label>Departamento</label>
          <input v-model.trim="filters.departamento" class="input" placeholder="ANTIOQUIA..." />
        </div>

        <div class="field">
          <label>Municipio</label>
          <input v-model.trim="filters.municipio" class="input" placeholder="ENVIGADO..." />
        </div>

        <div class="field" style="grid-column:1/-1">
          <label>Búsqueda general</label>
          <input v-model.trim="filters.q" class="input" placeholder="CellId / LAC_TAC / dirección / nombre..." />
        </div>
      </div>
    </div>

    <!-- ✅ MAPA (antes del listado) -->
    <div class="card">
      <div class="cardHead">
        <div>
          <div class="title">Mapa</div>
          <div class="muted small">
            Se muestran solo puntos con lat/lon válidos (máx {{ mapMax }}).
          </div>
        </div>

        <div class="actions">
          <button class="ghost" @click="openMap" :disabled="!mapPoints.length">Abrir mapa grande</button>
        </div>
      </div>

      <!-- Mini resumen -->
      <div class="muted small" v-if="rows.length">
        Página {{ page }} / {{ maxPage }} · resultados en página: <b>{{ rows.length }}</b> · puntos en mapa: <b>{{ mapPoints.length }}</b>
      </div>

      <!-- preview simple: si no quieres preview, quita esto y deja solo el botón -->
      <div class="mapPreview" v-if="mapPoints.length">
        <AntennaMapModal
          :open="true"
          :points="mapPoints"
          :subtitle="mapSubtitle"
          :maxPoints="mapMax"
          @close="() => {}"
        />
        <div class="hintMini">
          *Este es un “mapa embebido” (no se cierra). Usa “Abrir mapa grande” para tener el modal normal.
        </div>
      </div>

      <div class="warn" v-else>
        No hay puntos con lat/lon válidos para mostrar en mapa con los filtros actuales.
      </div>
    </div>

    <!-- ✅ LISTADO (después del mapa) -->
    <div class="tableCard">
      <div class="tableTop">
        <div class="titleRow">
          <h2>Listado</h2>
          <div class="muted">Máx 25 por página</div>
        </div>

        <div class="pager">
          <button class="ghost" @click="prevPage" :disabled="loadingList || page<=1">←</button>
          <div>Página <b>{{ page }}</b> / {{ maxPage }}</div>
          <button class="ghost" @click="nextPage" :disabled="loadingList || page>=maxPage">→</button>
        </div>
      </div>

      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Operador</th>
              <th>CellId</th>
              <th>Lat</th>
              <th>Lon</th>
              <th>Address</th>
              <th>Municipio</th>
              <th>LAC_TAC</th>
              <th>Cell name</th>
              <th>Site name</th>
              <th>Departamento</th>
              <th>Tecnología</th>
              <th>Vendor</th>
              <th>Azimuth</th>
              <th>HBA</th>
              <th>VBA</th>
              <th>BA</th>
              <th>Radius</th>
              <th>Altura</th>
              <th>Gain</th>
              <th>Beam</th>
              <th>Twist</th>
              <th>Tipo estructura</th>
              <th>Detalle estructura</th>
              <th>Banda</th>
              <th>Portadora</th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td class="mono">{{ r.operator || "-" }}</td>
              <td class="mono">{{ r.cell_id || "-" }}</td>
              <td class="mono">{{ r.lat ?? "-" }}</td>
              <td class="mono">{{ r.lon ?? "-" }}</td>
              <td>{{ r.address || "-" }}</td>
              <td class="mono">{{ r.municipio || "-" }}</td>
              <td class="mono">{{ r.lac_tac || "-" }}</td>
              <td class="mono">{{ r.cell_name || "-" }}</td>
              <td class="mono">{{ r.site_name || "-" }}</td>
              <td class="mono">{{ r.departamento || "-" }}</td>
              <td class="mono">{{ r.technology || "-" }}</td>
              <td class="mono">{{ r.vendor ?? "-" }}</td>
              <td class="mono">{{ r.azimuth ?? "-" }}</td>
              <td class="mono">{{ r.horiz_beam_angle ?? "-" }}</td>
              <td class="mono">{{ r.vertical_beam_angle ?? "-" }}</td>
              <td class="mono">{{ r.beam_angle ?? "-" }}</td>
              <td class="mono">{{ r.radius ?? "-" }}</td>
              <td class="mono">{{ r.altura ?? "-" }}</td>
              <td class="mono">{{ r.gain ?? "-" }}</td>
              <td class="mono">{{ r.beam ?? "-" }}</td>
              <td class="mono">{{ r.twist ?? "-" }}</td>
              <td class="mono">{{ r.tipo_estructura ?? "-" }}</td>
              <td class="mono">{{ r.detalle_estructura ?? "-" }}</td>
              <td class="mono">{{ r.banda ?? "-" }}</td>
              <td class="mono">{{ r.portadora ?? "-" }}</td>
            </tr>

            <tr v-if="rows.length===0">
              <td colspan="25" class="empty">Sin resultados</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="error" v-if="listError">{{ listError }}</div>
    </div>

    <!-- Modal grande -->
    <AntennaMapModal
      v-if="showMapBig"
      :open="showMapBig"
      :points="mapPoints"
      :subtitle="mapSubtitle"
      :maxPoints="mapMax"
      @close="showMapBig=false"
    />
  </section>
</template>

<script setup>
import { computed, ref } from "vue";
import AntennaMapModal from "./AntennaMapModal.vue";

const API = import.meta.env.VITE_API_BASE || "";

const fileEl = ref(null);
const files = ref([]);
const uploadMode = ref("replace_operator");
const loadingUpload = ref(false);
const uploadError = ref("");
const uploadSummary = ref(null);

const loadingList = ref(false);
const listError = ref("");

const page = ref(1);
const limit = ref(25); // ✅ max 25 por página
const total = ref(0);
const rows = ref([]);

const filters = ref({
  operator: "",
  technology: "",
  departamento: "",
  municipio: "",
  q: "",
});

const showMapBig = ref(false);
const mapMax = 1500;

function authHeaders(extra = {}) {
  const t = localStorage.getItem("token");
  return { ...(extra || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}
async function apiFetch(path, opts = {}) {
  const headers = authHeaders(opts.headers || {});
  const final = { ...opts, headers };
  const r = await fetch(`${API}${path}`, final);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function pickFiles() {
  uploadError.value = "";
  uploadSummary.value = null;
  fileEl.value?.click();
}
function onPickFiles(ev) {
  files.value = Array.from(ev.target.files || []);
  // UX: si el usuario selecciona archivos, puede subir de una vez si quieres
  // upload();
}
function clearPicked() {
  files.value = [];
  if (fileEl.value) fileEl.value.value = "";
}

const fileNames = computed(() => files.value.map(f => f.name).join(" · "));
const uploadModeLabel = computed(() =>
  uploadMode.value === "replace_operator" ? "Actualizar (reemplazar por operador)" : "Merge"
);

async function upload() {
  if (!files.value.length) return;

  loadingUpload.value = true;
  uploadError.value = "";
  uploadSummary.value = null;

  try {
    const fd = new FormData();
    for (const f of files.value) fd.append("files", f);

    const t = localStorage.getItem("token");
    const r = await fetch(`${API}/api/antennas/upload?mode=${encodeURIComponent(uploadMode.value)}`, {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: fd,
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);

    uploadSummary.value = j;

    // refrescar listado
    page.value = 1;
    await loadList();

    // limpiar selector
    clearPicked();
  } catch (e) {
    uploadError.value = String(e?.message || e);
  } finally {
    loadingUpload.value = false;
  }
}

function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    p.set(k, s);
  }
  return p.toString();
}

async function loadList() {
  listError.value = "";
  loadingList.value = true;

  try {
    const q = qs({
      operator: filters.value.operator,
      technology: filters.value.technology,
      departamento: filters.value.departamento,
      municipio: filters.value.municipio,
      q: filters.value.q,
      page: String(page.value),
      limit: String(limit.value),
    });

    const j = await apiFetch(`/api/antennas?${q}`, { method: "GET" });

    // backend puede devolver {rows,total} o {items,total}
    rows.value = j.rows || j.items || [];
    total.value = Number(j.total || 0);
  } catch (e) {
    listError.value = String(e?.message || e);
    rows.value = [];
    total.value = 0;
  } finally {
    loadingList.value = false;
  }
}

function applyFilters() {
  page.value = 1;
  loadList();
}
function resetFilters() {
  filters.value = { operator: "", technology: "", departamento: "", municipio: "", q: "" };
  page.value = 1;
  loadList();
}

const maxPage = computed(() => Math.max(1, Math.ceil((total.value || 0) / limit.value)));

function prevPage() {
  page.value = Math.max(1, page.value - 1);
  loadList();
}
function nextPage() {
  page.value = Math.min(maxPage.value, page.value + 1);
  loadList();
}

/** Mapa: solo puntos válidos (lat/lon num) */
function toNum(v){
  if (v == null) return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
const mapPoints = computed(() => {
  const pts = [];
  for (const r of rows.value || []) {
    const lat = toNum(r.lat);
    const lon = toNum(r.lon);
    if (lat == null || lon == null) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    pts.push({ ...r, lat, lon });
  }
  return pts.slice(0, mapMax);
});

const mapSubtitle = computed(() => {
  const f = filters.value;
  const parts = [];
  if (f.operator) parts.push(`Operador: ${f.operator}`);
  if (f.technology) parts.push(`Tec: ${f.technology}`);
  if (f.departamento) parts.push(`Depto: ${f.departamento}`);
  if (f.municipio) parts.push(`Mun: ${f.municipio}`);
  if (f.q) parts.push(`Q: ${f.q}`);
  return parts.join(" | ");
});

function openMap() {
  showMapBig.value = true;
}
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
.tiny{ font-size: 11px; opacity:.9; }
.mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

.hiddenInput{ display:none; }

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

.input{
  border: 1px solid var(--stroke);
  border-radius: 12px;
  padding: 10px 12px;
  outline: none;
  background: rgba(255,255,255,.06);
  color: var(--text);
}
.input:focus{
  border-color: rgba(34,211,238,.55);
  box-shadow: 0 0 0 4px rgba(34,211,238,.12);
}

.grid{
  margin-top: 10px;
  display:grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.field label{
  display:block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
  font-weight: 800;
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

.mapPreview{
  margin-top: 10px;
  border-radius: 14px;
  overflow:hidden;
  border: 1px solid rgba(255,255,255,.10);
}
.hintMini{
  padding: 10px 12px;
  font-size: 12px;
  color: var(--muted);
  border-top: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.04);
}
.warn{
  margin-top: 10px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(251,191,36,.25);
  background: rgba(251,191,36,.08);
}

.tableCard{
  margin-top: 12px;
  border: 1px solid var(--stroke);
  border-radius: 16px;
  background: rgba(255,255,255,.05);
  overflow:hidden;
}
.tableTop{
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.titleRow{ display:flex; align-items:baseline; gap: 10px; }
.pager{ display:flex; align-items:center; gap: 10px; }

.tableWrap{ overflow:auto; }
table{
  width: 100%;
  border-collapse: collapse;
  min-width: 1600px;
}
th, td{
  padding: 10px 10px;
  border-bottom: 1px solid rgba(255,255,255,.06);
  text-align: left;
  font-size: 13px;
}
th{ color: var(--muted); font-weight: 900; }
.empty{ padding: 16px; text-align:center; color: var(--muted); }

.error{
  margin: 12px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(251,113,133,.35);
  background: rgba(251,113,133,.10);
}
@media (max-width: 980px){
  .grid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid2{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
