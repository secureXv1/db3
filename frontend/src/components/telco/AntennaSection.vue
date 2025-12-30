
<template>
  <section class="panel">
    <div class="headRow">
      <div>
        <h2 class="h2">Antenas</h2>
        <div class="muted">Carga/actualiza antenas desde Excel y consulta por filtros + mapa.</div>
      </div>

      <div class="actions">
        <input
          ref="fileEl"
          type="file"
          multiple
          accept=".xlsx,.xls"
          class="hiddenInput"
          @change="onPickFiles"
        />
        <button class="primary" @click="pickFiles" :disabled="loadingUpload">
          {{ loadingUpload ? "Actualizando..." : "Actualizar DB Antenas" }}
        </button>
        <button class="ghost" @click="loadList" :disabled="loadingList">Recargar</button>
      </div>
    </div>

    <!-- Upload -->
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

    <!-- Filtros -->
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

    <!-- Resultados -->
    <div class="tableCard">
      <div class="tableTop">
        <div class="titleRow">
          <h2>Resultados</h2>
          <div class="muted">Máx {{ limit }} por página</div>
        </div>

        <div class="pager">
          <button class="ghost" @click="prevPage" :disabled="loadingList || page<=1">←</button>
          <div>Página <b>{{ page }}</b> / {{ maxPage }} · total: <b>{{ total }}</b></div>
          <button class="ghost" @click="nextPage" :disabled="loadingList || page>=maxPage">→</button>
        </div>
      </div>

      <ul class="resultList" v-if="rows.length">
        <li
          v-for="r in rows"
          :key="r.id"
          class="resultItem"
          :class="{ active: expandedId === r.id }"
          @mouseenter="hoverKey = makeKey(r)"
          @mouseleave="hoverKey = null"
          @click="toggleRow(r)"
        >
          <div class="rTop">
            <div class="mono rMain">
              <b>{{ r.operator }}</b> · {{ r.cell_id }}
              <span class="muted" v-if="r.technology">· {{ r.technology }}</span>
            </div>
            <div class="mono rCoords">{{ r.lat ?? "-" }}, {{ r.lon ?? "-" }}</div>
          </div>

          <div class="rMid">
            <span class="mono">{{ r.cell_name || r.site_name || "-" }}</span>
            <span class="muted">· {{ r.departamento || "-" }} / {{ r.municipio || "-" }}</span>
          </div>

          <div class="rBot muted small">{{ r.address || "" }}</div>

          <!-- detalle -->
          <div v-if="expandedId === r.id" class="detailBox" @click.stop>
            <div v-if="detailLoading" class="muted small">Cargando detalle…</div>
            <div v-else-if="detailError" class="error" style="margin:0;">{{ detailError }}</div>

            <div v-else-if="detailRow" class="detailGrid">
              <div class="dItem"><div class="dK">ID</div><div class="dV mono">{{ detailRow.id }}</div></div>
              <div class="dItem"><div class="dK">Operador</div><div class="dV mono">{{ detailRow.operator }}</div></div>
              <div class="dItem"><div class="dK">Cell ID</div><div class="dV mono">{{ detailRow.cell_id }}</div></div>
              <div class="dItem"><div class="dK">Cell Name</div><div class="dV mono">{{ detailRow.cell_name }}</div></div>

              <div class="dItem"><div class="dK">LAC/TAC</div><div class="dV mono">{{ detailRow.lac_tac }}</div></div>
              <div class="dItem"><div class="dK">Site</div><div class="dV mono">{{ detailRow.site_name }}</div></div>
              <div class="dItem"><div class="dK">Dirección</div><div class="dV">{{ detailRow.address }}</div></div>

              <div class="dItem"><div class="dK">Departamento</div><div class="dV mono">{{ detailRow.departamento }}</div></div>
              <div class="dItem"><div class="dK">Municipio</div><div class="dV mono">{{ detailRow.municipio }}</div></div>
              <div class="dItem"><div class="dK">Tecnología</div><div class="dV mono">{{ detailRow.technology }}</div></div>
              <div class="dItem"><div class="dK">Vendor</div><div class="dV mono">{{ detailRow.vendor }}</div></div>

              <div class="dItem"><div class="dK">Azimuth</div><div class="dV mono">{{ detailRow.azimuth }}</div></div>
              <div class="dItem"><div class="dK">Lat</div><div class="dV mono">{{ detailRow.lat }}</div></div>
              <div class="dItem"><div class="dK">Lon</div><div class="dV mono">{{ detailRow.lon }}</div></div>

              <div class="dItem"><div class="dK">Horiz beam</div><div class="dV mono">{{ detailRow.horiz_beam_angle }}</div></div>
              <div class="dItem"><div class="dK">Vert beam</div><div class="dV mono">{{ detailRow.vertical_beam_angle }}</div></div>
              <div class="dItem"><div class="dK">Beam angle</div><div class="dV mono">{{ detailRow.beam_angle }}</div></div>
              <div class="dItem"><div class="dK">Radius</div><div class="dV mono">{{ detailRow.radius }}</div></div>

              <div class="dItem"><div class="dK">Altura</div><div class="dV mono">{{ detailRow.altura }}</div></div>
              <div class="dItem"><div class="dK">Gain</div><div class="dV mono">{{ detailRow.gain }}</div></div>
              <div class="dItem"><div class="dK">Beam</div><div class="dV mono">{{ detailRow.beam }}</div></div>
              <div class="dItem"><div class="dK">Twist</div><div class="dV mono">{{ detailRow.twist }}</div></div>

              <div class="dItem"><div class="dK">Tipo estructura</div><div class="dV mono">{{ detailRow.tipo_estructura }}</div></div>
              <div class="dItem"><div class="dK">Detalle estructura</div><div class="dV mono">{{ detailRow.detalle_estructura }}</div></div>
              <div class="dItem"><div class="dK">Banda</div><div class="dV mono">{{ detailRow.banda }}</div></div>
              <div class="dItem"><div class="dK">Portadora</div><div class="dV mono">{{ detailRow.portadora }}</div></div>

              <div class="dItem"><div class="dK">Activo</div><div class="dV mono">{{ detailRow.is_active }}</div></div>
              <div class="dItem"><div class="dK">Updated</div><div class="dV mono">{{ detailRow.updated_at }}</div></div>

              <div class="dItem full" v-if="detailRow.raw">
                <div class="dK">RAW</div>
                <pre class="rawBox mono">{{ pretty(detailRow.raw) }}</pre>
              </div>
            </div>

            <div v-else class="muted small">Sin detalle.</div>
          </div>
        </li>
      </ul>

      <div class="empty" v-else>
        {{ loadingList ? "Buscando..." : "Sin resultados" }}
      </div>

      <div class="error" v-if="listError">{{ listError }}</div>
    </div>

    <!-- Mapa embebido -->
    <div class="card">
      <div class="cardHead">
        <div>
          <div class="title">Mapa</div>
          <div class="muted small">
            Se muestran puntos del filtro (máx {{ mapMax }}). Puntos visibles: <b>{{ mapPoints.length }}</b>
          </div>
        </div>

        <div class="actions">
          <button class="ghost" @click="openMap" :disabled="!mapPoints.length">Abrir mapa grande</button>
        </div>
      </div>

      <div class="muted small" v-if="mapLoading">Cargando puntos del mapa…</div>
      <div class="error" v-if="mapError">{{ mapError }}</div>

      <div class="mapEmbed" v-if="mapPoints.length">
        <AntennaMapModal
          :embedded="true"
          :open="true"
          :showTable="false"
          :points="mapPoints"
          :subtitle="mapSubtitle"
          :maxPoints="mapMax"
          :hoverKey="hoverKey"
          :panOnHover="false"
          @close="() => {}"
        />
      </div>

      <div class="warn" v-else>
        No hay puntos con lat/lon válidos para mostrar en mapa con los filtros actuales.
      </div>
    </div>

    <!-- Mapa modal -->
    <AntennaMapModal
      v-if="showMapBig"
      :open="showMapBig"
      :points="mapPoints"
      :subtitle="mapSubtitle"
      :maxPoints="mapMax"
      :hoverKey="hoverKey"
      @close="showMapBig=false"
    />
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
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
const limit = ref(7);
const total = ref(0);
const rows = ref([]);

const hoverKey = ref(null);

const mapRows = ref([]);
const mapLoading = ref(false);
const mapError = ref("");

const filters = ref({
  operator: "",
  technology: "",
  departamento: "",
  municipio: "",
  q: "",
});

const showMapBig = ref(false);
const mapMax = 1500;

// detalle
const expandedId = ref(null);
const detailLoading = ref(false);
const detailError = ref("");
const detailRow = ref(null);

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

function pretty(o){
  try { return JSON.stringify(o, null, 2); } catch { return String(o); }
}

async function loadDetail(id){
  detailLoading.value = true;
  detailError.value = "";
  detailRow.value = null;
  try {
    const j = await apiFetch(`/api/antennas/${encodeURIComponent(id)}`, { method: "GET" });
    detailRow.value = j.row || j.data || j;
  } catch (e) {
    detailError.value = String(e?.message || e);
  } finally {
    detailLoading.value = false;
  }
}

function toggleRow(r){
  const id = r?.id;
  if (!id) return;
  if (expandedId.value === id) {
    expandedId.value = null;
    detailRow.value = null;
    detailError.value = "";
    return;
  }
  expandedId.value = id;
  loadDetail(id);
}

function pickFiles() {
  uploadError.value = "";
  uploadSummary.value = null;
  fileEl.value?.click();
}
function onPickFiles(ev) {
  files.value = Array.from(ev.target.files || []);
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

    expandedId.value = null;
    detailRow.value = null;
    detailError.value = "";

    page.value = 1;
    await loadList();
    await loadMapAll();

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
    rows.value = j.rows || j.items || [];
    total.value = Number(j.total || 0);

    expandedId.value = null;
    detailRow.value = null;
    detailError.value = "";
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
  loadMapAll();
}
function resetFilters() {
  filters.value = { operator: "", technology: "", departamento: "", municipio: "", q: "" };
  page.value = 1;
  loadList();
  loadMapAll();
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

function makeKey(r){
  const op = String(r?.operator ?? "-");
  const cell = String(r?.cell_id ?? r?.antenna_id ?? "?");
  const name = String(r?.cell_name ?? r?.bts_name ?? r?.site_name ?? "");
  return `${op}::${cell}::${name}`;
}

const mapPoints = computed(() => (mapRows.value || []).slice(0, mapMax));

function toNum(v){
  if (v == null) return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function isValidLatLon(lat, lon){
  if (lat == null || lon == null) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  if (Math.abs(lat) < 1e-9 && Math.abs(lon) < 1e-9) return false;
  return true;
}

async function loadMapAll(){
  mapError.value = "";
  mapLoading.value = true;
  mapRows.value = [];

  try {
    const per = 25;
    let p = 1;
    let pages = 1;
    let validCount = 0;
    const maxRequests = 80;

    while (p <= pages && validCount < mapMax && p <= maxRequests) {
      const q = qs({
        operator: filters.value.operator,
        technology: filters.value.technology,
        departamento: filters.value.departamento,
        municipio: filters.value.municipio,
        q: filters.value.q,
        page: String(p),
        limit: String(per),
        active: "1",
      });

      const j = await apiFetch(`/api/antennas?${q}`, { method: "GET" });
      const batch = j.rows || j.items || [];

      if (p === 1) {
        const tt = Number(j.total || 0);
        pages = Math.max(1, Math.ceil(tt / per));
      }

      for (const r of batch) {
        const lat = toNum(r.lat);
        const lon = toNum(r.lon);
        if (!isValidLatLon(lat, lon)) continue;
        mapRows.value.push({ ...r, lat, lon });
        validCount++;
        if (validCount >= mapMax) break;
      }

      p++;
      if (!batch.length) break;
    }
  } catch (e) {
    mapError.value = String(e?.message || e);
    mapRows.value = [];
  } finally {
    mapLoading.value = false;
  }
}

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

onMounted(() => {
  loadList();
  loadMapAll();
});
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

.empty{ padding: 16px; text-align:center; color: var(--muted); }

.error{
  margin: 12px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(251,113,133,.35);
  background: rgba(251,113,133,.10);
}

.resultList{
  list-style: none;
  margin: 0;
  padding: 0;
}
.resultItem{
  padding: 12px;
  border-bottom: 1px solid rgba(255,255,255,.06);
  cursor: pointer;
}
.resultItem:hover{ background: rgba(255,255,255,.06); }

.rTop{ display:flex; justify-content: space-between; gap: 10px; }
.rMain{ font-weight: 900; }
.rCoords{ opacity:.9; }
.rMid{ margin-top: 6px; display:flex; gap: 8px; flex-wrap: wrap; }
.rBot{ margin-top: 4px; }

.mapEmbed{
  margin-top: 10px;
  border-radius: 14px;
  overflow:hidden;
  border: 1px solid rgba(255,255,255,.10);
  height: 420px;
}
.mapEmbed :deep(.embedWrap){ height: 100%; }
.mapEmbed :deep(.map){ height: 100%; }

/* detalle */
.resultItem.active{ background: rgba(255,255,255,.07); }

.detailBox{
  margin-top: 10px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(0,0,0,.18);
}
.detailGrid{
  display:grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.dItem{
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.04);
  border-radius: 12px;
  padding: 10px;
}
.dItem.full{ grid-column: 1 / -1; }
.dK{
  font-size: 11px;
  color: var(--muted);
  font-weight: 900;
  margin-bottom: 6px;
}
.dV{
  font-size: 13px;
  color: var(--text);
  word-break: break-word;
}
.rawBox{
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.35;
  padding: 10px;
  border-radius: 10px;
  background: rgba(0,0,0,.22);
  border: 1px solid rgba(255,255,255,.10);
  overflow:auto;
  max-height: 260px;
}

@media (max-width: 980px){
  .grid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid2{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .detailGrid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
