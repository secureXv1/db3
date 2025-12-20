<template>
  <div class="uploader">
    <div class="row">
      <input ref="fileInput" type="file" accept=".csv,text/csv" multiple @change="onPick" />
      <button @click="upload" :disabled="!files.length || uploading">
        {{ uploading ? "Cargando..." : "Subir CSV" }}
      </button>
      <button class="ghost" @click="clear" :disabled="uploading">Limpiar</button>
      <label class="chk">
        <input type="checkbox" v-model="saveRaw" :disabled="uploading" />
        Guardar RAW (jsonb)
      </label>
    </div>

    <div class="small" v-if="files.length">
      {{ files.length }} archivo(s) seleccionados
    </div>

    <div class="bar" v-if="uploading">
      <div class="fill" :style="{ width: progress + '%' }"></div>
    </div>

    <div class="result" v-if="result">
      <pre>{{ result }}</pre>
    </div>

    <div class="error" v-if="error">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref } from "vue";

const API = import.meta.env.VITE_API_BASE;

const fileInput = ref(null);
const files = ref([]);
const uploading = ref(false);
const progress = ref(0);
const result = ref("");
const error = ref("");
const saveRaw = ref(true);

function onPick(e) {
  files.value = Array.from(e.target.files || []);
  result.value = "";
  error.value = "";
}

function clear() {
  files.value = [];
  result.value = "";
  error.value = "";
  progress.value = 0;
  if (fileInput.value) fileInput.value.value = "";
}

async function upload() {
  if (!files.value.length) return;

  uploading.value = true;
  progress.value = 0;
  result.value = "";
  error.value = "";

  try {
    const fd = new FormData();
    for (const f of files.value) fd.append("files", f);

    // XMLHttpRequest para progreso real
    const xhr = new XMLHttpRequest();
    const url = `${API}/api/ingest/upload?saveRaw=${saveRaw.value ? "1" : "0"}`;

    const p = new Promise((resolve, reject) => {
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          progress.value = Math.round((evt.loaded / evt.total) * 100);
        }
      };
      xhr.onload = () => {
        try {
          const j = JSON.parse(xhr.responseText || "{}");
          if (!j.ok) reject(new Error(j.error || "Error al cargar"));
          else resolve(j);
        } catch (e) {
          reject(e);
        }
      };
      xhr.onerror = () => reject(new Error("Error de red"));
    });

    xhr.open("POST", url);
    xhr.send(fd);

    const j = await p;
    result.value = JSON.stringify(j, null, 2);
    progress.value = 100;
  } catch (e) {
    error.value = String(e.message || e);
  } finally {
    uploading.value = false;
  }
}
</script>

<style scoped>
.uploader { border:1px solid #e7e7e7; background:#fff; border-radius:12px; padding:12px; box-shadow: 0 6px 18px rgba(0,0,0,.05); margin-bottom: 12px; }
.row { display:flex; gap:10px; align-items:center; flex-wrap: wrap; }
button { border:1px solid #111; background:#111; color:#fff; border-radius:10px; padding:8px 12px; cursor:pointer; }
button.ghost { background:transparent; color:#111; }
button:disabled { opacity:.6; cursor:not-allowed; }
.small { margin-top:8px; color:#555; font-size:12px; }
.chk { display:flex; align-items:center; gap:6px; font-size:12px; color:#444; }
.bar { height:10px; background:#f0f0f0; border-radius:999px; margin-top:10px; overflow:hidden; }
.fill { height:100%; background:#111; width:0; }
.result pre { margin-top:10px; padding:10px; background:#fafafa; border:1px solid #eee; border-radius:10px; font-size:12px; overflow:auto; max-height: 180px; }
.error { margin-top:10px; color:#b00020; background:#fff5f5; border:1px solid #ffd0d0; padding:10px; border-radius:10px; }
</style>
