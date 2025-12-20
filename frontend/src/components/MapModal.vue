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

      <!-- MAPA -->
      <div ref="mapEl" class="map" style="height:520px"></div>

      <!-- TABLA ABAJO -->
      <div class="tableWrap" v-if="open && normalized.length">
        <table class="miniTable">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>IMSI</th>
              <th>IMEI</th>
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
              <td>{{ r.imsi || "-" }}</td>
              <td>{{ r.imei || "-" }}</td>
              <td>{{ r._lat }}</td>
              <td>{{ r._lon }}</td>
              <td>{{ r._dist != null ? r._dist : "-" }}</td>
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
  defaultRadius: { type: Number, default: 1000 },
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

const localDefaultRadius = ref(props.defaultRadius);
const localMaxPoints = ref(props.maxPoints);

watch(() => props.defaultRadius, (v) => (localDefaultRadius.value = v));
watch(() => props.maxPoints, (v) => (localMaxPoints.value = v));

function close() {
  emit("close");
}

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

const totalWithLatLon = computed(() => (props.points || []).filter((p) => p.lat != null && p.lon != null).length);
const validCount = computed(() => normalized.value.length);

// ====== estilos círculo ======
const circleStyle = {
  color: "#2563eb",
  weight: 2,
  opacity: 0.9,
  fillColor: "#3b82f6",
  fillOpacity: 0.16, // 👈 más transparente
};
const circleStyleHover = {
  color: "#1d4ed8",
  weight: 3,
  opacity: 1,
  fillColor: "#2563eb",
  fillOpacity: 0.26,
};

// “punto” real (dot) con divIcon
function makeDotIcon(active = false) {
  const size = active ? 12 : 8;
  const anchor = active ? 6 : 4;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:999px;
      background:#111827;
      border:2px solid #ffffff;
      box-shadow:0 2px ${active ? 14 : 10}px rgba(0,0,0,.35);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
  });
}

// referencias para hover
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

  map = L.map(mapEl.value, { zoomControl: true });

  const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  });

  tiles.on("tileerror", (e) => {
    console.error("[Leaflet tileerror]", e);
  });

  tiles.addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  circlesLayer = L.layerGroup().addTo(map);

  map.setView([4.60971, -74.08175], 11);

  if (modalEl.value && "ResizeObserver" in window) {
    ro = new ResizeObserver(() => {
      if (map) map.invalidateSize(true);
    });
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

    // punto (dot)
    const mk = L.marker([lat, lon], { icon: makeDotIcon(false), keyboard: false }).addTo(markersLayer);

    // ✅ SOLO dibuja círculo si la distancia existe (no usar default aquí)
    const radius = r._dist; // puede ser null
    let cir = null;

    if (radius != null && Number(radius) > 0) {
      cir = L.circle([lat, lon], { radius: Number(radius), ...circleStyle }).addTo(circlesLayer);
    }


    markerByKey.set(key, { mk, lat, lon });
    if (cir) circleByKey.set(key, cir);
  }

  if (bounds.length === 1) {
    map.setView(bounds[0], 16);
  } else {
    map.fitBounds(bounds, { padding: [20, 20] });
  }
}

// Hover desde tabla
function highlightRow(r) {
  if (!map) return;
  const key = rowKey(r);

  // limpiar anterior
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
    // opcional: centrar suave
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
    await new Promise((r) => setTimeout(r, 150));

    destroyMap();
    initMap();

    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    map?.invalidateSize(true);
    draw();
  },
  { immediate: true }
);

watch([normalized, localDefaultRadius, localMaxPoints], () => {
  if (props.open && map) {
    map.invalidateSize(true);
    draw();
  }
}, { deep: true });

onBeforeUnmount(() => destroyMap());
</script>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  z-index: 9999;
}
.modal {
  width: min(1100px, 96vw);
  height: min(820px, 92vh); /* un poco más alto para tabla */
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 18px 60px rgba(0,0,0,.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #eee;
}
.title { font-weight: 800; font-size: 16px; }
.sub { font-size: 12px; color: #666; margin-top: 2px; }

button {
  border: 1px solid #111;
  background: #111;
  color: #fff;
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
}
button.ghost { background: transparent; color: #111; }

.map {
  width: 100%;
}

/* TABLA */
.tableWrap{
  border-top: 1px solid #eee;
  background: #fff;
  max-height: 240px;
  overflow: auto;
}
.miniTable{
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.miniTable th, .miniTable td{
  padding: 8px 10px;
  border-bottom: 1px solid #f0f0f0;
  white-space: nowrap;
}
.miniTable tbody tr:hover{
  background: #f5f7ff;
}

.warn {
  padding: 10px 14px;
  font-size: 12px;
  background: #fff7e6;
  border-top: 1px solid #eee;
  color: #6b4e00;
}
</style>
