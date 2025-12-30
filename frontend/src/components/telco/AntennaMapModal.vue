<!-- AntennaMapModal.vue -->
<template>
  <div v-if="!embedded" class="backdrop" @click.self="close">
    <div ref="modalEl" class="modal">
      <div class="head">
        <div>
          <div class="title">Mapa de antenas</div>
          <div class="sub">{{ subtitle }}</div>
        </div>
        <button class="ghost" @click="close">Cerrar ✕</button>
      </div>

      <div ref="viewEl" class="map"></div>

      <div class="tableWrap" v-if="open && showTable && normalized.length">
        <table class="miniTable">
          <thead>
            <tr>
              <th>Operador</th>
              <th>Tec</th>
              <th>CellId</th>
              <th>LAC_TAC</th>
              <th>Cell/BTS</th>
              <th>Depto</th>
              <th>Mun</th>
              <th>Lat</th>
              <th>Lon</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in normalized"
              :key="rowKey(r)"
              @mouseenter="highlightRow(r)"
              @mouseleave="clearHighlight"
            >
              <td class="mono">{{ r.operator || "-" }}</td>
              <td class="mono">{{ r.technology || "-" }}</td>
              <td class="mono">{{ r.cell_id || "-" }}</td>
              <td class="mono">{{ r.lac_tac || "-" }}</td>
              <td class="mono">{{ r.cell_name || r.bts_name || r.site_name || "-" }}</td>
              <td class="mono">{{ r.departamento || "-" }}</td>
              <td class="mono">{{ r.municipio || "-" }}</td>
              <td class="mono">{{ r._lat }}</td>
              <td class="mono">{{ r._lon }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="warn" v-if="open && showTable && normalized.length === 0">
        No hay antenas con lat/lon válidos en este resultado.
      </div>
    </div>
  </div>

  <div v-else ref="modalEl" class="embedWrap">
    <div class="embedHead">
      <div>
        <div class="title">Mapa</div>
        <div class="sub">{{ subtitle }}</div>
      </div>
      <div class="pill">{{ normalized.length }} pts</div>
    </div>
    <div ref="viewEl" class="map embedMap"></div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import esriConfig from "@arcgis/core/config";
import * as intl from "@arcgis/core/intl.js";

import ArcGISMap from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Extent from "@arcgis/core/geometry/Extent";

import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import Compass from "@arcgis/core/widgets/Compass";
import ScaleBar from "@arcgis/core/widgets/ScaleBar";

const props = defineProps({
  open: { type: Boolean, default: false },
  points: { type: Array, default: () => [] },
  maxPoints: { type: Number, default: 1500 },
  subtitle: { type: String, default: "" },
  embedded: { type: Boolean, default: false },
  showTable: { type: Boolean, default: true },
  hoverKey: { type: String, default: null },
  panOnHover: { type: Boolean, default: true },
});
const emit = defineEmits(["close"]);

const viewEl = ref(null);
const modalEl = ref(null);

let view = null;
let gl = null;

let basemapGallery = null;
let basemapBtn = null;
let basemapPanel = null;
let onViewClickHandle = null;
let compass = null;
let scaleBar = null;
let ro = null;

const markerByKey = new Map();
let hoveredKey = null;

function close(){ emit("close"); }

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
  return `${r.operator || "-"}::${r.cell_id || r.antenna_id || "?"}::${r.cell_name || r.bts_name || r.site_name || ""}`;
}

const normalized = computed(() => {
  const out = [];
  for (const r of props.points || []) {
    const lat = toNum(r.lat);
    const lon = toNum(r.lon);
    if (isValidLatLon(lat, lon)) out.push({ ...r, _lat: lat, _lon: lon });
  }
  return out.slice(0, Math.max(1, props.maxPoints));
});

function destroy() {
  markerByKey.clear();
  hoveredKey = null;

  try { ro?.disconnect(); } catch {}
  ro = null;

  try { basemapGallery?.destroy(); } catch {}
  try { compass?.destroy(); } catch {}
  try { scaleBar?.destroy(); } catch {}

  basemapGallery = null;
  compass = null;
  scaleBar = null;

  try { onViewClickHandle?.remove?.(); } catch {}
  onViewClickHandle = null;

  try { if (view && basemapBtn) view.ui.remove(basemapBtn); } catch {}
  try { if (view && basemapPanel) view.ui.remove(basemapPanel); } catch {}
  basemapBtn = null;
  basemapPanel = null;

  try { view?.destroy(); } catch {}
  view = null;
  gl = null;
}

async function init() {
  if (!viewEl.value) return;

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
    zoom: 6,
    constraints: { snapToZoom: false },
    ui: { components: ["zoom"] },
  });

  await view.when();
  await view.whenLayerView(gl);

  if (modalEl.value && "ResizeObserver" in window) {
    ro = new ResizeObserver(() => {
      try { window.dispatchEvent(new Event("resize")); } catch {}
    });
    ro.observe(modalEl.value);
  }
  setTimeout(() => { try { window.dispatchEvent(new Event("resize")); } catch {} }, 60);
  setTimeout(() => { try { window.dispatchEvent(new Event("resize")); } catch {} }, 220);

  compass = new Compass({ view });
  view.ui.add(compass, "top-left");

  scaleBar = new ScaleBar({ view, unit: "metric" });
  view.ui.add(scaleBar, "bottom-left");

  basemapPanel = document.createElement("div");
  basemapPanel.className = "esri-widget";
  basemapPanel.style.padding = "8px";
  basemapPanel.style.background = "rgba(10,14,24,.85)";
  basemapPanel.style.color = "white";
  basemapPanel.style.borderRadius = "12px";
  basemapPanel.style.border = "1px solid rgba(255,255,255,.14)";
  basemapPanel.style.display = "none";
  basemapPanel.style.maxHeight = "320px";
  basemapPanel.style.overflow = "auto";

  basemapBtn = document.createElement("button");
  basemapBtn.className = "esri-widget--button esri-icon-basemap";
  basemapBtn.title = "Mapa base";
  basemapBtn.type = "button";
  basemapBtn.onclick = () => {
    if (!basemapPanel) return;
    basemapPanel.style.display = basemapPanel.style.display === "none" ? "block" : "none";
  };

  view.ui.add(basemapBtn, "top-right");
  view.ui.add(basemapPanel, "top-right");

  basemapGallery = new BasemapGallery({ view, container: basemapPanel });

  onViewClickHandle = view.on("click", () => {
    if (basemapPanel) basemapPanel.style.display = "none";
  });
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
    size: 8,
    color: [17, 24, 39, 1],
    outline: { color: [255, 255, 255, 0.9], width: 2 },
  };
  const pointSymbolHover = {
    ...pointSymbol,
    size: 12,
    outline: { color: [34, 211, 238, 1], width: 3 },
  };

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
      popupTemplate: {
        title: `${r.operator || "-"} | ${r.cell_id || "-"}`,
        content: `
          <div><b>Tec:</b> ${r.technology || "-"}</div>
          <div><b>LAC_TAC:</b> ${r.lac_tac || "-"}</div>
          <div><b>Nombre:</b> ${(r.cell_name || r.bts_name || r.site_name || "-")}</div>
          <div><b>Depto/Mun:</b> ${(r.departamento || "-")} / ${(r.municipio || "-")}</div>
          <div><b>Lat/Lon:</b> ${r._lat}, ${r._lon}</div>
        `
      }
    });

    gl.add(gPoint);

    markerByKey.set(key, {
      gPoint,
      pointSymbol,
      pointSymbolHover,
      lon: r._lon,
      lat: r._lat,
    });

    minLon = Math.min(minLon, r._lon);
    maxLon = Math.max(maxLon, r._lon);
    minLat = Math.min(minLat, r._lat);
    maxLat = Math.max(maxLat, r._lat);
  }

  if (pts.length === 1) {
    const only = pts[0];
    view.goTo({ center: [only._lon, only._lat], zoom: 15 }, { animate: true }).catch(() => {});
  } else {
    const ext = new Extent({
      xmin: minLon, ymin: minLat,
      xmax: maxLon, ymax: maxLat,
      spatialReference: { wkid: 4326 },
    }).expand(1.25);

    view.goTo(ext, { animate: true, duration: 250 }).catch(() => {});
  }

  setTimeout(() => { try { window.dispatchEvent(new Event("resize")); } catch {} }, 120);
}

function highlightRow(r) {
  if (!view) return;
  highlightKey(rowKey(r));
}

function highlightKey(key) {
  if (!view || !key) return;

  if (hoveredKey && hoveredKey !== key) {
    const prev = markerByKey.get(hoveredKey);
    if (prev) prev.gPoint.symbol = prev.pointSymbol;
  }

  hoveredKey = key;
  const cur = markerByKey.get(key);
  if (!cur) return;

  cur.gPoint.symbol = cur.pointSymbolHover;
  if (props.panOnHover) {
    view.goTo({ center: [cur.lon, cur.lat] }, { animate: true, duration: 200 }).catch(() => {});
  }
}

function clearHighlight() {
  if (!hoveredKey) return;
  const prev = markerByKey.get(hoveredKey);
  if (prev) prev.gPoint.symbol = prev.pointSymbol;
  hoveredKey = null;
}

watch(
  () => props.open,
  async (isOpen) => {
    const shouldOpen = props.embedded ? true : isOpen;
    if (!shouldOpen) { destroy(); return; }

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
  const shouldOpen = props.embedded ? true : props.open;
  if (shouldOpen && view) draw();
}, { deep: true });

watch(
  () => props.hoverKey,
  (k) => {
    if (!view) return;
    if (!k) clearHighlight();
    else highlightKey(k);
  }
);

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
