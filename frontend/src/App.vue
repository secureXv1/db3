<template>
  <div class="wrap">
    <header class="top">
      <h1>GEO Portal (IMSI / IMEI)</h1>
      <div class="sub">Consultas por fecha, IMSI/IMEI y radio en mapa (PostGIS)</div>
    </header>
    <div class="wrap">
    <CsvUploader />
    <!-- tu panel de filtros y tabla -->
  </div>
    <section class="panel">
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
          <label>IMSI</label>
          <input v-model.trim="filters.imsi" placeholder="732..." />
        </div>
        <div class="field">
          <label>IMEI</label>
          <input v-model.trim="filters.imei" placeholder="35..." />
        </div>        
      </div>

      <div class="actions">
        <button @click="loadSummaryAndData" :disabled="loading">
          {{ loading ? "Cargando..." : "Buscar" }}
        </button>
        <button class="ghost" @click="clearAll" :disabled="loading">Limpiar</button>
        <div class="hint">
          Tip: haz click en el mapa para setear Lat/Lon automáticamente.
        </div>
      </div>

      <div class="kpis" v-if="summary">
        <div class="kpi">
          <div class="kpi-label">Total</div>
          <div class="kpi-value">{{ summary.total }}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">IMSI únicos</div>
          <div class="kpi-value">{{ summary.imsi_unicos }}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">IMEI únicos</div>
          <div class="kpi-value">{{ summary.imei_unicos }}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Rango</div>
          <div class="kpi-value small">
            <div>{{ summary.min_ts || "-" }}</div>
            <div>{{ summary.max_ts || "-" }}</div>
          </div>
        </div>
      </div>
    </section>
      <div class="tableCard">
        <div class="tableTop">
          <div class="titleRow">
            <h2>Resultados</h2>
            <div class="muted">{{ total }} total</div>
          </div>

          <div class="pager">
            <button class="ghost" @click="prevPage" :disabled="loading || page<=1">←</button>
            <div>Página <b>{{ page }}</b></div>
            <button class="ghost" @click="nextPage" :disabled="loading || page>=maxPage">→</button>
          </div>
        </div>

        <div class="tableWrap">
          <table>
            <thead>
              <tr>
                <th>TS</th>
                <th>IMSI</th>
                <th>IMEI</th>
                <th>LAT</th>
                <th>LON</th>
                <th>Dist(m)</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id + '-' + r.ts">
                <td class="mono">{{ fmtTs(r.ts) }}</td>
                <td class="mono">{{ r.imsi || "-" }}</td>
                <td class="mono">{{ r.imei || "-" }}</td>
                <td class="mono">{{ r.lat ?? "-" }}</td>
                <td class="mono">{{ r.lon ?? "-" }}</td>
                <td class="mono">{{ r.dist_m != null ? Math.round(r.dist_m) : (r.distance_m ?? "-") }}</td>
                <button class="ghost"
                        v-if="hasImsiOrImei && rows.length"
                        @click="openMap"
                        :disabled="loading">
                  Ver mapa
                </button>

              </tr>
              <tr v-if="rows.length===0">
                <td colspan="7" class="empty">Sin resultados</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="error" v-if="error">
          {{ error }}
        </div>
      </div>
    
  </div>

  <MapModal
    v-if="showMap"
    :open="showMap"
    :points="rows"
    :defaultRadius="1000"
    :maxPoints="1500"
    :subtitle="hasImsiOrImei ? `Filtro: ${filters.imsi ? 'IMSI ' + filters.imsi : ''}${filters.imei ? ' IMEI ' + filters.imei : ''}` : ''"
    @close="closeMap"
  />

</template>

<script setup>
import { reactive, ref, computed } from "vue";
import CsvUploader from "./components/CsvUploader.vue";
import MapModal from "./components/MapModal.vue";

const API = import.meta.env.VITE_API_BASE;

const filters = reactive({
  from: "",
  to: "",
  imsi: "",
  imei: "",
  limit: 200,
});

const page = ref(1);
const total = ref(0);
const rows = ref([]);
const loading = ref(false);
const error = ref("");
const summary = ref(null);

const showMap = ref(false);

const hasImsiOrImei = computed(() => {
  return Boolean((filters.imsi && filters.imsi.trim()) || (filters.imei && filters.imei.trim()));
});

function openMap() { showMap.value = true; }
function closeMap() { showMap.value = false; }

const maxPage = computed(() => {
  const l = Number(filters.limit || 200);
  if (!l) return 1;
  return Math.max(1, Math.ceil(Number(total.value || 0) / l));
});

const selectedPoint = ref(null);

function openMapForRow(r) {
  selectedPoint.value = r;
  showMap.value = true;
}

function toApiTs(dtLocal) {
  return dtLocal ? dtLocal.replace("T", " ") + ":00" : "";
}

function buildQuery(pageNum) {
  const q = new URLSearchParams();
  if (filters.from) q.set("from", toApiTs(filters.from));
  if (filters.to) q.set("to", toApiTs(filters.to));
  if (filters.imsi) q.set("imsi", filters.imsi);
  if (filters.imei) q.set("imei", filters.imei);
  q.set("page", String(pageNum));
  q.set("limit", String(filters.limit));
  return q.toString();
}

async function loadSummaryAndData() {
  error.value = "";
  loading.value = true;
  try {
    page.value = 1;
    await Promise.all([loadSummary(), loadData(1)]);
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

async function loadSummary() {
  const q = buildQuery(1);
  const r = await fetch(`${API}/api/detections/summary?${q}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "Error summary");
  summary.value = j;
  total.value = Number(j.total || 0);
}

async function loadData(p) {
  const q = buildQuery(p);
  const r = await fetch(`${API}/api/detections?${q}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "Error data");
  rows.value = j.items || [];
  total.value = Number(j.total || 0);
  page.value = Number(j.page || p);
}

function prevPage() {
  if (page.value <= 1) return;
  goPage(page.value - 1);
}
function nextPage() {
  if (page.value >= maxPage.value) return;
  goPage(page.value + 1);
}
async function goPage(p) {
  error.value = "";
  loading.value = true;
  try {
    await loadData(p);
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

function clearAll() {
  filters.from = "";
  filters.to = "";
  filters.imsi = "";
  filters.imei = "";
  summary.value = null;
  rows.value = [];
  total.value = 0;
  page.value = 1;
  error.value = "";
}

function fmtTs(ts) {
  if (!ts) return "-";
  try { return new Date(ts).toLocaleString(); }
  catch { return String(ts); }
}
</script>


<style scoped>
.wrap { max-width: 95%; margin: 0 auto; padding: 18px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; color: #111; }
.top { padding: 12px 0 16px; }
.top h1 { margin: 0; font-size: 22px; }
.sub { color: #555; font-size: 13px; margin-top: 4px; }

.panel { background: #fff; border: 1px solid #e7e7e7; border-radius: 12px; padding: 14px; box-shadow: 0 6px 18px rgba(0,0,0,.05); }
.grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 10px; }
.field { display: flex; flex-direction: column; gap: 6px; }
label { font-size: 12px; color: #444; }
input, select { border: 1px solid #d9d9d9; border-radius: 10px; padding: 8px 10px; outline: none; }
input:focus, select:focus { border-color: #7aa7ff; box-shadow: 0 0 0 3px rgba(122,167,255,.25); }

.actions { margin-top: 12px; display: flex; align-items: center; gap: 10px; }
button { border: 1px solid #111; background: #111; color: #fff; border-radius: 10px; padding: 9px 12px; cursor: pointer; }
button:disabled { opacity: .6; cursor: not-allowed; }
button.ghost { background: transparent; color: #111; }
.hint { color: #666; font-size: 12px; margin-left: auto; }

.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
.kpi { border: 1px solid #eee; border-radius: 12px; padding: 10px; background: #fafafa; }
.kpi-label { font-size: 12px; color: #555; }
.kpi-value { font-size: 18px; font-weight: 700; margin-top: 4px; }
.kpi-value.small { font-size: 12px; font-weight: 600; color: #333; display: grid; gap: 2px; }

.content { margin-top: 14px; display: grid; grid-template-columns: 520px 1fr; gap: 14px; align-items: start; }
.mapCard, .tableCard { background: #fff; border: 1px solid #e7e7e7; border-radius: 12px; box-shadow: 0 6px 18px rgba(0,0,0,.05); overflow: hidden; }
.map { height: 520px; }
.mapFooter { display: flex; justify-content: space-between; padding: 10px 12px; border-top: 1px solid #eee; font-size: 12px; color: #444; }

.tableTop { padding: 10px 12px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
.titleRow { display: flex; align-items: baseline; gap: 10px; }
h2 { margin: 0; font-size: 16px; }
.muted { color: #666; font-size: 12px; }
.pager { display: flex; align-items: center; gap: 8px; }

.tableWrap { max-height: 520px; overflow: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 12px; }
thead th { position: sticky; top: 0; background: #fafafa; z-index: 1; }
tbody tr:hover { background: #f6f8ff; cursor: pointer; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.small { font-size: 11px; color: #444; }
.empty { text-align: center; color: #666; padding: 18px; }
.error { padding: 10px 12px; color: #b00020; border-top: 1px solid #eee; background: #fff5f5; }

@media (max-width: 1100px) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .content { grid-template-columns: 1fr; }
  .map { height: 360px; }
  .tableWrap { max-height: 360px; }
}
</style>
