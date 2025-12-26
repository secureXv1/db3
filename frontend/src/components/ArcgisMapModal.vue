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
      <div ref="viewEl" class="map"></div>

      <!-- TABLA -->
      <div class="tableWrap" v-if="open && normalized.length">
        <table class="miniTable">
          <thead>
            <tr>
              <th>Fecha</th><th>IMSI</th><th>IMEI</th><th>Operador</th>
              <th>Lat</th><th>Lon</th><th>Dist (m)</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in normalized"
              :key="rowKey(r)"
              @mouseenter="highlightRow(r)"
              @mouseleave="clearHighlight"
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

      <div class="warn" v-if="open && normalized.length === 0">
        No hay puntos con lat/lon válidos en esta página.
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

// ArcGIS (sin API KEY)
import esriConfig from "@arcgis/core/config";
import * as intl from "@arcgis/core/intl.js";

import ArcGISMap from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Circle from "@arcgis/core/geometry/Circle";
import Extent from "@arcgis/core/geometry/Extent";

// Basemaps libres + Gallery (con previews)
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import Expand from "@arcgis/core/widgets/Expand";

// UI widgets
import Compass from "@arcgis/core/widgets/Compass";
import ScaleBar from "@arcgis/core/widgets/ScaleBar";
import Measurement from "@arcgis/core/widgets/Measurement";

const props = defineProps({
  open: { type: Boolean, default: false },
  points: { type: Array, default: () => [] },
  maxPoints: { type: Number, default: 1500 },
  subtitle: { type: String, default: "" },
});
const emit = defineEmits(["close"]);

const viewEl = ref(null);
const modalEl = ref(null);

let view = null;
let gl = null;

let basemapGallery = null;
let basemapExpand = null;
let compass = null;
let scaleBar = null;

let measurement = null;
let measureExpand = null;

let ro = null;

const markerByKey = new Map();
let hoveredKey = null;

function close(){ emit("close"); }

// ---------- helpers ----------
function toNum(v){
  if (v == null) return null;
  const s = String(v).trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function isValidLatLon(lat, lon){
  if (lat == null || lon == null) return false;
  if (Math.abs(lat) < 1e-9 && Math.abs(lon) < 1e-9) return false;
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}
function rowKey(r){
  // estable aunque el archivo no tenga source_row
  return `${r.ts || "?"}::${r.imsi || "-"}::${r.imei || "-"}::${r.lat || "?"}::${r.lon || "?"}`;
}

const normalized = computed(() => {
  const out = [];
  for (const r of props.points || []) {
    const lat = toNum(r.lat);
    const lon = toNum(r.lon);
    const dist = toNum(r.distance_m ?? r.dist_m);
    if (isValidLatLon(lat, lon)) out.push({ ...r, _lat: lat, _lon: lon, _dist: dist });
  }
  return out.slice(0, Math.max(1, props.maxPoints));
});

// ---------- lifecycle ----------
function destroy() {
  markerByKey.clear();
  hoveredKey = null;

  try { ro?.disconnect(); } catch {}
  ro = null;

  try { basemapExpand?.destroy(); } catch {}
  try { basemapGallery?.destroy(); } catch {}
  try { measureExpand?.destroy(); } catch {}
  try { measurement?.destroy(); } catch {}
  try { compass?.destroy(); } catch {}
  try { scaleBar?.destroy(); } catch {}

  basemapExpand = null;
  basemapGallery = null;
  measureExpand = null;
  measurement = null;
  compass = null;
  scaleBar = null;

  try { view?.destroy(); } catch {}
  view = null;
  gl = null;
}

async function init() {
  if (!viewEl.value) return;

  // ✅ evita locale vacío => rompe ScaleBar/Measurement
  const safeLocale =
    (document.documentElement.lang && document.documentElement.lang.trim()) ||
    (navigator.language && navigator.language.trim()) ||
    "es-CO";

  document.documentElement.lang = safeLocale;
  esriConfig.locale = safeLocale;
  try { intl.setLocale(safeLocale); } catch { try { intl.setLocale("es"); } catch {} }

  gl = new GraphicsLayer();

    const map = new ArcGISMap({
    basemap: "hybrid",
    layers: [gl],
    });


  view = new MapView({
    container: viewEl.value,
    map,
    center: [-74.08175, 4.60971],
    zoom: 11,
    constraints: { snapToZoom: false },
    ui: { components: ["zoom"] },
  });

  await view.when();
  await view.whenLayerView(gl);

  // ✅ Resize estable en modal: dispara resize global (sin view.resize/requestRender)
  if (modalEl.value && "ResizeObserver" in window) {
    ro = new ResizeObserver(() => {
      try { window.dispatchEvent(new Event("resize")); } catch {}
    });
    ro.observe(modalEl.value);
  }
  // doble resize “post layout”
  setTimeout(() => { try { window.dispatchEvent(new Event("resize")); } catch {} }, 60);
  setTimeout(() => { try { window.dispatchEvent(new Event("resize")); } catch {} }, 220);

  // 🧭 Compass
  compass = new Compass({ view });
  view.ui.add(compass, "top-left");

  // 📏 ScaleBar
  scaleBar = new ScaleBar({ view, unit: "metric" });
  view.ui.add(scaleBar, "bottom-left");

  // 🗺️ BasemapGallery con previews dentro del mapa
  basemapGallery = new BasemapGallery({ view });

  basemapExpand = new Expand({
    view,
    content: basemapGallery,
    expanded: false,
    group: "top-right",
    mode: "floating",
    expandIconClass: "esri-icon-basemap",
    expandTooltip: "Mapa base",
  });
  view.ui.add(basemapExpand, "top-right");

  // 📐 Medición (distancia/área/limpiar)
  measurement = new Measurement({ view });

  const panel = document.createElement("div");
  panel.className = "esri-widget esri-widget--panel";

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "8px";
  btnRow.style.padding = "8px";

  const btnDist = document.createElement("button");
  btnDist.className = "esri-button";
  btnDist.textContent = "Distancia";

  const btnArea = document.createElement("button");
  btnArea.className = "esri-button";
  btnArea.textContent = "Área";

  const btnClear = document.createElement("button");
  btnClear.className = "esri-button";
  btnClear.textContent = "Limpiar";

  btnRow.append(btnDist, btnArea, btnClear);

  const widgetDiv = document.createElement("div");
  widgetDiv.style.padding = "8px";

  panel.append(btnRow, widgetDiv);
  measurement.container = widgetDiv;

  btnDist.onclick = () => (measurement.activeTool = "distance");
  btnArea.onclick = () => (measurement.activeTool = "area");
  btnClear.onclick = () => measurement.clear();

  measureExpand = new Expand({
    view,
    content: panel,
    expanded: false,
    group: "top-right",
    mode: "floating",
    expandIconClass: "esri-icon-measure-line",
    expandTooltip: "Medir",
  });

  view.ui.add(measureExpand, "top-right");
}

function clearGraphics() {
  if (!gl) return;
  gl.removeAll();
  markerByKey.clear();
  hoveredKey = null;
}

function draw() {
  if (!view || !gl) return;

  clearGraphics();
  const pts = normalized.value;
  if (!pts.length) return;

  const pointSymbol = {
    type: "simple-marker",
    style: "circle",
    size: 7,
    color: [17, 24, 39, 1],
    outline: { color: [255, 255, 255, 0.9], width: 2 },
  };
  const pointSymbolHover = {
    ...pointSymbol,
    size: 11,
    outline: { color: [34, 211, 238, 1], width: 3 },
  };

  const circleSymbol = {
    type: "simple-fill",
    color: [59, 130, 246, 0.10],
    outline: { color: [96, 165, 250, 0.85], width: 2 },
  };
  const circleSymbolHover = {
    type: "simple-fill",
    color: [59, 130, 246, 0.18],
    outline: { color: [147, 197, 253, 1], width: 3 },
  };

  // ✅ extent por puntos (evita zoom lejano)
  let minLon = 999, minLat = 999, maxLon = -999, maxLat = -999;

  for (const r of pts) {
    const key = rowKey(r);

    const pt = new Point({
      longitude: r._lon,
      latitude: r._lat,
      spatialReference: { wkid: 4326 },
    });

    const gPoint = new Graphic({
      geometry: pt,
      symbol: pointSymbol,
      attributes: { _key: key },
    });
    gl.add(gPoint);

    let gCircle = null;
    // ✅ SOLO círculo si distancia existe
    if (r._dist != null && Number(r._dist) > 0) {
      const circle = new Circle({
        center: pt,
        radius: Number(r._dist),
        radiusUnit: "meters",
        geodesic: true,
      });
      gCircle = new Graphic({ geometry: circle, symbol: circleSymbol, attributes: { _key: key } });
      gl.add(gCircle);
    }

    markerByKey.set(key, {
      gPoint, gCircle,
      pointSymbol, pointSymbolHover,
      circleSymbol, circleSymbolHover,
      lon: r._lon, lat: r._lat,
    });

    minLon = Math.min(minLon, r._lon);
    maxLon = Math.max(maxLon, r._lon);
    minLat = Math.min(minLat, r._lat);
    maxLat = Math.max(maxLat, r._lat);
  }

  if (pts.length === 1) {
    const only = pts[0];
    view.goTo({ center: [only._lon, only._lat], zoom: 16 }, { animate: true }).catch(() => {});
  } else {
    const ext = new Extent({
      xmin: minLon, ymin: minLat,
      xmax: maxLon, ymax: maxLat,
      spatialReference: { wkid: 4326 },
    }).expand(1.25);

    view.goTo(ext, { animate: true, duration: 250 }).catch(() => {});
  }

  // “kick” por si el modal terminó de animar
  setTimeout(() => { try { window.dispatchEvent(new Event("resize")); } catch {} }, 120);
}

function highlightRow(r) {
  if (!view) return;
  const key = rowKey(r);

  if (hoveredKey && hoveredKey !== key) {
    const prev = markerByKey.get(hoveredKey);
    if (prev) {
      prev.gPoint.symbol = prev.pointSymbol;
      if (prev.gCircle) prev.gCircle.symbol = prev.circleSymbol;
    }
  }

  hoveredKey = key;
  const cur = markerByKey.get(key);
  if (!cur) return;

  cur.gPoint.symbol = cur.pointSymbolHover;
  if (cur.gCircle) cur.gCircle.symbol = cur.circleSymbolHover;

  view.goTo({ center: [cur.lon, cur.lat] }, { animate: true, duration: 200 }).catch(() => {});
}

function clearHighlight() {
  if (!hoveredKey) return;
  const prev = markerByKey.get(hoveredKey);
  if (prev) {
    prev.gPoint.symbol = prev.pointSymbol;
    if (prev.gCircle) prev.gCircle.symbol = prev.circleSymbol;
  }
  hoveredKey = null;
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) { destroy(); return; }

    await nextTick();
    await new Promise((r) => setTimeout(r, 80));

    destroy();
    await init();

    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    draw();
    setTimeout(draw, 180);
  },
  { immediate: true }
);

watch(normalized, () => {
  if (props.open && view) draw();
}, { deep: true });

onBeforeUnmount(() => destroy());
</script>

<style scoped>
.backdrop, .modal{
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Sans", "Helvetica Neue", sans-serif;
}
.backdrop{
  position:fixed; inset:0;
  background: rgba(0,0,0,.55);
  display:flex; align-items:center; justify-content:center;
  padding:14px; z-index:9999;
}
.modal{
  width:min(1180px, 96vw);
  height:min(860px, 92vh);
  border-radius:18px;
  overflow:hidden;
  background: rgba(12,18,30,.68);
  border:1px solid rgba(255,255,255,.14);
  box-shadow: 0 22px 70px rgba(0,0,0,.55);
  backdrop-filter: blur(14px);
  display:flex; flex-direction:column;
}
.head{
  display:flex; align-items:center; justify-content:space-between;
  padding:12px 14px;
  border-bottom:1px solid rgba(255,255,255,.10);
  color: rgba(255,255,255,.92);
}
.title{ font-weight:900; font-size:16px; }
.sub{ font-size:12px; color: rgba(255,255,255,.68); margin-top:2px; }
button{
  border:1px solid rgba(255,255,255,.16);
  background: rgba(255,255,255,.08);
  color: rgba(255,255,255,.92);
  border-radius:12px;
  padding:8px 12px; cursor:pointer;
}
.map{ flex:1; min-height:420px; width:100%; background:#0b1220; }

.tableWrap{
  border-top:1px solid rgba(255,255,255,.10);
  background: rgba(10,14,24,.55);
  max-height:260px;
  overflow:auto;
}
.miniTable{ width:100%; border-collapse:collapse; font-size:12px; color: rgba(255,255,255,.88); }
.miniTable th, .miniTable td{
  padding:9px 10px;
  border-bottom:1px solid rgba(255,255,255,.08);
  white-space:nowrap;
}
.miniTable thead th{
  position:sticky; top:0; z-index:1;
  background: rgba(10,14,24,.85);
  color: rgba(255,255,255,.80);
  font-weight:800;
}
.miniTable tbody tr:hover{ background: rgba(34,211,238,.10); }
.mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

.warn{
  padding:10px 14px;
  font-size:12px;
  background: rgba(251,191,36,.12);
  border-top:1px solid rgba(255,255,255,.10);
  color: rgba(255,255,255,.86);
}
</style>
