import { createApp } from "vue";
import App from "./App.vue";
import "leaflet/dist/leaflet.css"; // ✅ IMPORTANTE
import "./global.css";


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

createApp(App).mount("#app");
