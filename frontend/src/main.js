import esriConfig from "@arcgis/core/config";
import * as intl from "@arcgis/core/intl.js";

// ✅ evita locale vacío (rompe ScaleBar/Measurement)
const LOCALE = "es-CO";
document.documentElement.lang = LOCALE;
esriConfig.locale = LOCALE;
try { intl.setLocale(LOCALE); } catch {}

import { createApp } from "vue";
import App from "./App.vue";

import "leaflet/dist/leaflet.css";
import "./global.css";
import "@arcgis/core/assets/esri/themes/dark/main.css";

import L from "leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
});

// ✅ FIX: ArcGIS NO soporta lang vacío
if (!document.documentElement.lang || !document.documentElement.lang.trim()) {
  document.documentElement.lang = "es-CO";
}

createApp(App).mount("#app");
