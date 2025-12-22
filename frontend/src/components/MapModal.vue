<template>
  <div class="backdrop" @click.self="close">
    <div ref="modalEl" class="modal">
      <div class="head">
        <div>
          <div class="title">Mapa de resultados</div>
          <div class="sub">{{ subtitle }}</div>
        </div>
        <button class="ghost" @click="close">Cerrar ✕</button>
      </div>

      <!-- MAPA: ocupa espacio real -->
      <div ref="mapEl" class="map"></div>

      <!-- TABLA ABAJO -->
      <div class="tableWrap" v-if="open && normalized.length">
        <table class="miniTable">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>IMSI</th>
              <th>IMEI</th>
              <th>Operador</th>
              <th>Lat</th>
              <th>Lon</th>
              <th>Dist (m)</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in normalized"
              :key="rowKey(r)"
              @mouseenter="highlightRow(r)"
              @mouseleave="clearHighlight()"
            >
              <td>{{ r.ts ? new Date(r.ts).toLocaleString() : "-" }}</td>
              <td class="mono">{{ r.imsi || "-" }}</td>
              <td class="mono">{{ r.imei || "-" }}</td>
              <td class="mono">{{ r.operator || "-" }}</td>
              <td class="mono">{{ r._lat }}</td>
              <td class="mono">{{ r._lon }}</td>
              <td class="mono">{{ r._dist != null ? r._dist : "-" }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="warn" v-if="open && validCount === 0">
        No hay puntos con lat/lon válidos en esta página.
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import L from "leaflet";

const props = defineProps({
  open: { type: Boolean, default: false },
  points: { type: Array, default: () => [] },
  defaultRadius: { type: Number, default: 1000 }, // (lo dejamos por si luego lo quieres usar)
  maxPoints: { type: Number, default: 1500 },
  subtitle: { type: String, default: "" },
});

const emit = defineEmits(["close"]);

const mapEl = ref(null);
const modalEl = ref(null);

let map = null;
let markersLayer = null;
let circlesLayer = null;
let ro = null;

const localMaxPoints = ref(props.maxPoints);
watch(() => props.maxPoints, (v) => (localMaxPoints.value = v));

function close() { emit("close"); }

function toNum(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function isValidLatLon(lat, lon) {
  if (lat == null || lon == null) return false;
  if (Math.abs(lat) < 1e-9 && Math.abs(lon) < 1e-9) return false;
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function rowKey(r) {
  return `${r.source_file || "?"}::${r.source_row || "?"}::${r.ts || "?"}`;
}

const normalized = computed(() => {
  const out = [];
  for (const r of props.points || []) {
    const lat = toNum(r.lat);
    const lon = toNum(r.lon);
    const dist = toNum(r.distance_m ?? r.dist_m);
    if (isValidLatLon(lat, lon)) out.push({ ...r, _lat: lat, _lon: lon, _dist: dist });
  }
  return out.slice(0, Math.max(1, localMaxPoints.value));
});

const validCount = computed(() => normalized.value.length);

// ====== estilos círculo ======
const circleStyle = {
  color: "#60a5fa",
  weight: 2,
  opacity: 0.9,
  fillColor: "#22d3ee",
  fillOpacity: 0.12, // ✅ transparente
};
const circleStyleHover = {
  color: "#93c5fd",
  weight: 3,
  opacity: 1,
  fillColor: "#60a5fa",
  fillOpacity: 0.20,
};

// “punto” real con divIcon (dot)
function makeDotIcon(active = false) {
  const size = active ? 12 : 8;
  const anchor = active ? 6 : 4;
  const ring = active ? 3 : 2;
  const glow = active ? 18 : 12;

  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:999px;
      background:#e5e7eb;
      border:${ring}px solid rgba(34,211,238,.95);
      box-shadow:0 0 ${glow}px rgba(34,211,238,.45), 0 8px 26px rgba(0,0,0,.35);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
  });
}

// referencias hover
let markerByKey = new Map();
let circleByKey = new Map();
let hoveredKey = null;

function destroyMap() {
  try { ro?.disconnect(); } catch {}
  ro = null;

  try { map?.remove(); } catch {}
  map = null;
  markersLayer = null;
  circlesLayer = null;

  markerByKey.clear();
  circleByKey.clear();
  hoveredKey = null;
}

function initMap() {
  if (!mapEl.value) return;

  map = L.map(mapEl.value, {
    zoomControl: true,
    preferCanvas: true,
  });

  const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  });

  tiles.on("tileerror", (e) => console.error("[Leaflet tileerror]", e));
  tiles.addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  circlesLayer = L.layerGroup().addTo(map);

  map.setView([4.60971, -74.08175], 11);

  if (modalEl.value && "ResizeObserver" in window) {
    ro = new ResizeObserver(() => map?.invalidateSize(true));
    ro.observe(modalEl.value);
  }
}

function clearLayers() {
  markersLayer?.clearLayers();
  circlesLayer?.clearLayers();
  markerByKey.clear();
  circleByKey.clear();
  hoveredKey = null;
}

function draw() {
  if (!map) return;

  clearLayers();

  const pts = normalized.value;
  if (!pts.length) {
    map.invalidateSize(true);
    return;
  }

  const bounds = [];

  for (const r of pts) {
    const lat = r._lat;
    const lon = r._lon;
    const key = rowKey(r);

    bounds.push([lat, lon]);

    // punto
    const mk = L.marker([lat, lon], { icon: makeDotIcon(false), keyboard: false })
      .addTo(markersLayer);

    // ✅ SOLO círculo si dist existe
    const radius = r._dist;
    let cir = null;

    if (radius != null && Number(radius) > 0) {
      cir = L.circle([lat, lon], { radius: Number(radius), ...circleStyle }).addTo(circlesLayer);
    }

    markerByKey.set(key, { mk, lat, lon });
    if (cir) circleByKey.set(key, cir);
  }

  if (bounds.length === 1) map.setView(bounds[0], 16);
  else map.fitBounds(bounds, { padding: [24, 24] });
}

// Hover desde tabla
function highlightRow(r) {
  if (!map) return;
  const key = rowKey(r);

  if (hoveredKey && hoveredKey !== key) {
    const prev = markerByKey.get(hoveredKey);
    if (prev) prev.mk.setIcon(makeDotIcon(false));
    const prevCir = circleByKey.get(hoveredKey);
    if (prevCir) prevCir.setStyle(circleStyle);
  }

  hoveredKey = key;

  const cur = markerByKey.get(key);
  if (cur) {
    cur.mk.setIcon(makeDotIcon(true));
    map.panTo([cur.lat, cur.lon], { animate: true });
  }

  const cir = circleByKey.get(key);
  if (cir) cir.setStyle(circleStyleHover);
}

function clearHighlight() {
  if (!hoveredKey) return;
  const prev = markerByKey.get(hoveredKey);
  if (prev) prev.mk.setIcon(makeDotIcon(false));
  const prevCir = circleByKey.get(hoveredKey);
  if (prevCir) prevCir.setStyle(circleStyle);
  hoveredKey = null;
}

// abrir/cerrar
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      destroyMap();
      return;
    }

    await nextTick();
    // esperamos layout real
    await new Promise((r) => setTimeout(r, 120));

    destroyMap();
    initMap();

    // doble frame para que Leaflet calcule tamaños
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    map?.invalidateSize(true);
    draw();

    // un invalidate extra (modales + blur)
    setTimeout(() => { map?.invalidateSize(true); }, 150);
  },
  { immediate: true }
);

watch(normalized, () => {
  if (props.open && map) {
    map.invalidateSize(true);
    draw();
  }
}, { deep: true });

onBeforeUnmount(() => destroyMap());
</script>

<style scoped>
/* theme glass similar al portal */
.backdrop{
  position:fixed; inset:0;
  background: rgba(0,0,0,.55);
  display:flex; align-items:center; justify-content:center;
  padding: 14px;
  z-index: 9999;
}

.modal{
  width: min(1180px, 96vw);
  height: min(860px, 92vh);
  border-radius: 18px;
  overflow:hidden;

  background: rgba(12, 18, 30, 0.68);
  border: 1px solid rgba(255,255,255,0.14);
  box-shadow: 0 22px 70px rgba(0,0,0,.55);
  backdrop-filter: blur(14px);

  display:flex;
  flex-direction:column;
}

/* top line glow */
.modal::before{
  content:"";
  position:absolute;
  left: 14px;
  right: 14px;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(34,211,238,.85), rgba(96,165,250,.8), transparent);
  opacity: .9;
}

.head{
  position: relative;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.10);
  color: rgba(255,255,255,.92);
}

.title{ font-weight: 900; font-size: 16px; }
.sub{ font-size: 12px; color: rgba(255,255,255,.68); margin-top: 2px; }

button{
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,.92);
  border-radius: 12px;
  padding: 8px 12px;
  cursor:pointer;
}
button.ghost:hover{ background: rgba(255,255,255,0.12); }

/* ✅ el mapa ocupa el “flex” disponible */
.map{
  flex: 1;
  width: 100%;
  min-height: 420px;
}

/* tabla inferior */
.tableWrap{
  border-top: 1px solid rgba(255,255,255,0.10);
  background: rgba(10, 14, 24, 0.55);
  max-height: 260px;
  overflow:auto;
}

.miniTable{
  width:100%;
  border-collapse: collapse;
  font-size: 12px;
  color: rgba(255,255,255,.88);
}

.miniTable th, .miniTable td{
  padding: 9px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  white-space: nowrap;
}

.miniTable thead th{
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgba(10, 14, 24, 0.85);
  color: rgba(255,255,255,.80);
  font-weight: 800;
  letter-spacing: .2px;
}

.miniTable tbody tr:hover{
  background: rgba(34,211,238,.10);
}

.mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

.warn{
  padding: 10px 14px;
  font-size: 12px;
  background: rgba(251, 191, 36, 0.12);
  border-top: 1px solid rgba(255,255,255,0.10);
  color: rgba(255,255,255,.86);
}

/* Leaflet: quita el borde blanco y mejora controles en dark */
:global(.leaflet-container){
  background: #0b1020;
}
:global(.leaflet-control-zoom a){
  background: rgba(10,14,24,.85) !important;
  color: rgba(255,255,255,.9) !important;
  border: 1px solid rgba(255,255,255,.14) !important;
}
:global(.leaflet-control-attribution){
  background: rgba(10,14,24,.65) !important;
  color: rgba(255,255,255,.72) !important;
  border-radius: 10px !important;
  border: 1px solid rgba(255,255,255,.10) !important;
  margin: 8px !important;
  padding: 4px 8px !important;
}
</style>
