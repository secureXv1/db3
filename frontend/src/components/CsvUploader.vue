<template>
  <div class="uploader">
    <div class="row">
      <input
        ref="fileInput"
        type="file"
        accept=".csv,.db,.db3,application/vnd.sqlite3,application/x-sqlite3"
        multiple
        @change="onPick"
      />

      <button @click="upload" :disabled="!files.length || uploading">
        {{ uploading ? "Cargando..." : buttonLabel }}
      </button>

      <button class="ghost" @click="clear" :disabled="uploading">Limpiar</button>

      <label class="chk">
        <input type="checkbox" v-model="saveRaw" :disabled="uploading" />
        Guardar RAW (jsonb)
      </label>
    </div>

    <div class="small" v-if="files.length">
      {{ files.length }} archivo(s) seleccionados —
      CSV: {{ csvFiles.length }} | DB/DB3: {{ dbFiles.length }}
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
import { computed, ref } from "vue";

const API = import.meta.env.VITE_API_BASE;

const fileInput = ref(null);
const files = ref([]);
const uploading = ref(false);
const progress = ref(0);
const result = ref("");
const error = ref("");
const saveRaw = ref(true);

function isDbFile(name) {
  return /\.(db|db3)$/i.test(name || "");
}

const csvFiles = computed(() => files.value.filter(f => !isDbFile(f.name)));
const dbFiles  = computed(() => files.value.filter(f =>  isDbFile(f.name)));

const buttonLabel = computed(() => {
  if (!files.value.length) return "Subir";
  if (dbFiles.value.length && !csvFiles.value.length) return "Subir DB/DB3";
  if (csvFiles.value.length && !dbFiles.value.length) return "Subir CSV";
  return "Subir CSV + DB/DB3";
});

function onPick(e) {
  files.value = Array.from(e.target.files || []);
  result.value = "";
  error.value = "";
  progress.value = 0;
}

function clear() {
  files.value = [];
  result.value = "";
  error.value = "";
  progress.value = 0;
  if (fileInput.value) fileInput.value.value = "";
}

function xhrUpload(url, fd, onProg) {
  const xhr = new XMLHttpRequest();

  const p = new Promise((resolve, reject) => {
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && onProg) onProg(evt.loaded, evt.total);
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
  return p;
}

async function upload() {
  if (!files.value.length) return;

  uploading.value = true;
  progress.value = 0;
  result.value = "";
  error.value = "";

  try {
    const results = [];

    // Progreso global simple: 0-50% CSV, 50-100% DB
    recognizedExtensionsGuard();

    if (csvFiles.value.length) {
      const fdCsv = new FormData();
      csvFiles.value.forEach(f => fdCsv.append("files", f));

      const urlCsv = `${API}/api/ingest/upload?saveRaw=${saveRaw.value ? "1" : "0"}`;
      const jCsv = await xhrUpload(urlCsv, fdCsv, (loaded, total) => {
        progress.value = Math.round((loaded / total) * 50);
      });

      results.push({ kind: "csv", ...jCsv });
    }

    if (dbFiles.value.length) {
      const fdDb = new FormData();
      dbFiles.value.forEach(f => fdDb.append("files", f));

      const urlDb = `${API}/api/ingest/upload-db?saveRaw=${saveRaw.value ? "1" : "0"}`;
      const jDb = await xhrUpload(urlDb, fdDb, (loaded, total) => {
        progress.value = 50 + Math.round((loaded / total) * 50);
      });

      results.push({ kind: "db", ...jDb });
    }

    progress.value = 100;
    result.value = JSON.stringify({ ok: true, uploads: results }, null, 2);
  } catch (e) {
    error.value = String(e.message || e);
  } finally {
    uploading.value = false;
  }
}

// Si el usuario mete algo raro, lo avisamos (evita confusiones)
function recognizedExtensionsGuard() {
  const bad = files.value.filter(f => !/\.(csv|db|db3)$/i.test(f.name || ""));
  if (bad.length) {
    throw new Error(`Archivos no soportados: ${bad.map(x => x.name).join(", ")} (solo .csv, .db, .db3)`);
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
