<template>
  <LoginCard v-if="!authed" @logged="onLogged" />

  <div v-else class="appbg">
    <div class="bg-overlay"></div>

    <!-- Topbar (glass) -->
    <div class="topbar">
      <div class="who">
        <div class="avatar">{{ (user?.username || "U").slice(0, 1).toUpperCase() }}</div>
        <div class="whoText">
          <b class="whoName">{{ user?.username || "Usuario" }}</b>
          <span class="role">{{ user?.role || "-" }}</span>
        </div>
      </div>

      <button class="ghost" @click="logout">Cerrar sesión</button>
    </div>

    <main class="container">
      <header class="top">
        <h1>GEO Portal (IMSI / IMEI)</h1>
        <div class="sub">Consultas por fecha, IMSI/IMEI</div>
      </header>

      <!-- Tabs -->
      <div class="tabs">
        <button class="ghost" :class="{ active: activeTab==='imsi' }" @click="activeTab='imsi'">
          IMSI/IMEI
        </button>
        <button class="ghost" :class="{ active: activeTab==='telco' }" @click="activeTab='telco'">
          TELCO XDR
        </button>
      </div>

      <!-- ====== MODULO ACTUAL (IMSI/IMEI) ====== -->
      <div v-if="activeTab === 'imsi'">

        <CsvUploader />

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
            <button class="primary" @click="loadSummaryAndData" :disabled="loading">
              {{ loading ? "Cargando..." : "Buscar" }}
            </button>

            <button class="ghost" @click="clearAll" :disabled="loading">Limpiar</button>

            <div class="hint">Tip: si filtras IMSI/IMEI verás “Ver mapa” en la tabla.</div>
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
                  <th>OPERADOR</th>
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
                  <td class="mono">{{ r.operator || "-" }}</td>
                  <td class="mono">{{ r.lat ?? "-" }}</td>
                  <td class="mono">{{ r.lon ?? "-" }}</td>
                  <td class="mono">{{ r.dist_m != null ? Math.round(r.dist_m) : (r.distance_m ?? "-") }}</td>

                  <td>
                    <button
                      v-if="hasImsiOrImei && rows.length"
                      class="ghost smallBtn"
                      @click="openMap"
                      :disabled="loading"
                    >
                      Ver mapa
                    </button>
                  </td>
                </tr>

                <tr v-if="rows.length===0">
                  <td colspan="8" class="empty">Sin resultados</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="error" v-if="error">{{ error }}</div>
        </div>

        <ArcgisMapModal
          v-if="showMap"
          :open="showMap"
          :points="rows"
          :maxPoints="1500"
          :subtitle="hasImsiOrImei ? `Filtro: ${filters.imsi ? 'IMSI ' + filters.imsi : ''}${filters.imei ? ' IMEI ' + filters.imei : ''}` : ''"
          @close="closeMap"
        />
      </div>

      <!-- ====== MODULO NUEVO (TELCO) ====== -->
      <div v-else>
        <TelcoModule />
      </div>

    </main>
  </div>
</template>


<script setup>
import { reactive, ref, computed } from "vue";
import CsvUploader from "./components/CsvUploader.vue";
import ArcgisMapModal from "./components/ArcgisMapModal.vue";
import LoginCard from "./components/LoginCard.vue";
import TelcoModule from "./components/telco/TelcoModule.vue";

const API = import.meta.env.VITE_API_BASE;

const activeTab = ref("imsi"); // "imsi" | "telco"

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

const user = ref(null);

function loadUser() {
  try {
    const u = localStorage.getItem("user");
    user.value = u ? JSON.parse(u) : null;
  } catch {
    user.value = null;
  }
}

function isLogged() {
  return !!localStorage.getItem("token");
}

const authed = ref(isLogged());
loadUser();

function onLogged(u) {
  user.value = u;
  authed.value = true;
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  user.value = null;
  authed.value = false;
}
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
/* =============== Reset global (sin style.css) =============== */
:global(html, body, #app){
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
}
:global(body){
  overflow-x: hidden;
  background: #050a14;
}

/* =============== Theme vars =============== */
:global(:root){
  --bg0: #050a14;
  --glass: rgba(12, 18, 30, 0.62);
  --glass2: rgba(12, 18, 30, 0.42);
  --stroke: rgba(255,255,255,0.12);
  --stroke2: rgba(255,255,255,0.08);
  --text: rgba(255,255,255,0.92);
  --muted: rgba(255,255,255,0.68);
  --muted2: rgba(255,255,255,0.52);
  --accent: #22d3ee;     /* cyan */
  --accent2: #60a5fa;    /* blue */
  --danger: #fb7185;     /* rose */
}

/* =============== Background full-screen =============== */
.appbg{
  min-height: 100vh;
  width: 100%;
  position: relative;
  overflow: hidden;

  background-image:
    radial-gradient(1000px 520px at 12% 8%, rgba(34,211,238,.18), transparent 60%),
    radial-gradient(900px 520px at 85% 12%, rgba(96,165,250,.16), transparent 60%),
    linear-gradient(180deg, rgba(0,0,0,.78), rgba(0,0,0,.50)),
    url("../assets/bg.jpg");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

/* overlay extra suave para dar “depth” */
.bg-overlay{
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 20% 10%, rgba(255,255,255,.08), transparent 55%),
    linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.35));
}

/* =============== Layout =============== */
.container{
  position: relative;
  z-index: 1;
  max-width: 95%;
  margin: 0 auto;
  padding: 18px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial;
  color: var(--text);
}

/* Topbar glass */
.topbar{
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;

  background: rgba(8, 12, 20, .55);
  border-bottom: 1px solid var(--stroke2);
  backdrop-filter: blur(14px);
  color: var(--text);
}

.who{ display:flex; align-items:center; gap:10px; }
.avatar{
  width:34px; height:34px;
  border-radius: 12px;
  display:flex; align-items:center; justify-content:center;
  font-weight: 900;

  background: rgba(255,255,255,.10);
  border: 1px solid var(--stroke);
  box-shadow: 0 8px 30px rgba(0,0,0,.35);
}
.whoText{ display:flex; flex-direction:column; line-height: 1.05; }
.whoName{ color: var(--text); }
.role{ font-size: 12px; color: var(--muted); }

/* Header */
.top{ padding: 14px 0 10px; }
.top h1{
  margin:0;
  font-size: 22px;
  letter-spacing: .2px;
  font-weight: 900;
}
.sub{ color: var(--muted); font-size: 13px; margin-top: 4px; }

/* =============== Cards / Panels =============== */
.panel, .tableCard{
  background: var(--glass);
  border: 1px solid var(--stroke);
  border-radius: 16px;
  box-shadow: 0 22px 70px rgba(0,0,0,.35);
  backdrop-filter: blur(14px);
}

.panel{
  padding: 14px;
  margin-top: 12px;
  position: relative;
}

/* línea superior tipo “neón” */
.panel::before, .tableCard::before{
  content:"";
  position:absolute;
  left: 14px;
  right: 14px;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(34,211,238,.8), rgba(96,165,250,.7), transparent);
  opacity: .9;
}

/* grid filtros */
.grid{
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.field{ display:flex; flex-direction:column; gap:6px; }
label{ font-size: 12px; color: var(--muted); }

input{
  border: 1px solid var(--stroke);
  border-radius: 12px;
  padding: 10px 12px;
  outline: none;
  background: rgba(255,255,255,.06);
  color: var(--text);
}
input::placeholder{ color: rgba(255,255,255,.45); }
input:focus{
  border-color: rgba(34,211,238,.55);
  box-shadow: 0 0 0 4px rgba(34,211,238,.12);
}

/* =============== Buttons =============== */
button{
  border: 1px solid var(--stroke);
  background: rgba(255,255,255,.08);
  color: var(--text);
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
  transition: transform .08s ease, background .12s ease, border-color .12s ease;
}
button:hover{ background: rgba(255,255,255,.12); }
button:active{ transform: translateY(1px); }
button:disabled{ opacity:.55; cursor:not-allowed; }

.primary{
  border-color: rgba(34,211,238,.55);
  background: linear-gradient(135deg, rgba(34,211,238,.22), rgba(96,165,250,.18));
  box-shadow: 0 10px 28px rgba(34,211,238,.10);
  font-weight: 900;
  letter-spacing: .2px;
}
button.ghost{
  background: rgba(255,255,255,.06);
}
.smallBtn{
  padding: 7px 10px;
  border-radius: 10px;
  font-size: 12px;
}

/* actions */
.actions{
  margin-top: 12px;
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap: wrap;
}
.hint{
  margin-left: auto;
  color: var(--muted2);
  font-size:12px;
}

/* =============== KPIs =============== */
.kpis{
  display:grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}
.kpi{
  border: 1px solid var(--stroke);
  border-radius: 14px;
  padding: 12px;
  background: rgba(255,255,255,.06);
  position: relative;
  overflow: hidden;
}
.kpi::after{
  content:"";
  position:absolute;
  inset:-40px -40px auto auto;
  width:200px; height:200px;
  background: radial-gradient(circle at 30% 30%, rgba(34,211,238,.18), transparent 60%);
  transform: rotate(18deg);
  pointer-events:none;
}
.kpi-label{ font-size: 12px; color: var(--muted); }
.kpi-value{
  font-size: 20px;
  font-weight: 900;
  margin-top: 6px;
  letter-spacing: .2px;
}
.kpi-value.small{
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
  display:grid;
  gap:2px;
}

/* =============== Table =============== */
.tableCard{
  margin-top: 14px;
  overflow:hidden;
  position: relative;
}

.tableTop{
  padding: 10px 12px;
  border-bottom: 1px solid var(--stroke2);
  display:flex;
  justify-content:space-between;
  align-items:center;
}
.titleRow{ display:flex; align-items:baseline; gap:10px; }
h2{ margin:0; font-size:16px; font-weight: 900; }
.muted{ color: var(--muted2); font-size:12px; }
.pager{ display:flex; align-items:center; gap:8px; }

.tableWrap{
  max-height: 520px;
  overflow: auto;
}
table{ width: 100%; border-collapse: collapse; }
th, td{
  padding: 10px 12px;
  border-bottom: 1px solid var(--stroke2);
  text-align:left;
  font-size: 12px;
  white-space: nowrap;
  color: var(--text);
}

thead th{
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgba(10, 14, 24, .92);
  border-bottom: 1px solid var(--stroke);
  color: rgba(255,255,255,.86);
  font-weight: 800;
  letter-spacing: .2px;
}

tbody tr:nth-child(2n){
  background: rgba(255,255,255,.03);
}
tbody tr:hover{
  background: rgba(34,211,238,.10);
}

.mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.empty{ text-align:center; color: var(--muted2); padding:18px; }

.error{
  padding: 10px 12px;
  color: #fecdd3;
  border-top: 1px solid var(--stroke2);
  background: rgba(251,113,133,.12);
}

/* =============== CsvUploader: override para que combine =============== */
:deep(.uploader){
  border: 1px solid var(--stroke);
  background: var(--glass2);
  border-radius: 16px;
  padding: 12px;
  box-shadow: 0 18px 60px rgba(0,0,0,.25);
  backdrop-filter: blur(14px);
}

:deep(.uploader .small){
  color: var(--muted);
}

:deep(.uploader button){
  border: 1px solid var(--stroke);
  background: rgba(255,255,255,.08);
  color: var(--text);
  border-radius: 12px;
  padding: 9px 12px;
}
:deep(.uploader button:hover){
  background: rgba(255,255,255,.12);
}
:deep(.uploader button.ghost){
  background: rgba(255,255,255,.06);
}

:deep(.uploader .bar){
  background: rgba(255,255,255,.08);
}
:deep(.uploader .fill){
  background: linear-gradient(90deg, rgba(34,211,238,.85), rgba(96,165,250,.85));
}

:deep(.uploader .result pre){
  background: rgba(10, 14, 24, .75);
  color: rgba(255,255,255,.85);
  border: 1px solid var(--stroke2);
}

:deep(.uploader .error){
  background: rgba(251,113,133,.12);
  border: 1px solid rgba(251,113,133,.25);
  color: #fecdd3;
}

/* Responsive */
@media (max-width: 980px){
  .grid{ grid-template-columns: repeat(2, minmax(0,1fr)); }
  .kpis{ grid-template-columns: repeat(2, minmax(0,1fr)); }
  .hint{ margin-left: 0; width: 100%; }
}

.tabs{
  margin: 10px 0 12px;
  display:flex;
  gap:10px;
  flex-wrap: wrap;
}
.tabs .active{
  border-color: rgba(34,211,238,.55);
  box-shadow: 0 0 0 4px rgba(34,211,238,.10);
  background: rgba(255,255,255,.10);
  font-weight: 900;
}


</style>



