<template>
  <div class="wrap">
    <!-- overlay suave para que el texto se lea -->
    <div class="bg-overlay"></div>

    <div class="shell">
      <!-- Lado izquierdo (branding) -->
      <div class="brand">
        <div class="logo">GEO</div>
        <div class="brand-text">
          <h2>Portal GEO</h2>
          <p>
            Consulta, carga y visualiza detecciones de forma segura.
          </p>
        </div>       
      </div>

      <!-- Tarjeta login -->
      <div class="card">
        <div class="card-head">
          <h1>Ingresar</h1>
          <p class="sub">Accede con tus credenciales</p>
        </div>

        <div class="field">
          <label>Usuario</label>
          <input
            v-model="username"
            autocomplete="username"
            placeholder="usuario"
            @keydown.enter="login"
          />
        </div>

        <div class="field">
          <label>Contraseña</label>
          <div class="pw">
            <input
              v-model="password"
              :type="show ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="••••••••"
              @keydown.enter="login"
            />
            <button class="eye" type="button" @click="show = !show" :aria-label="show ? 'Ocultar' : 'Mostrar'">
              {{ show ? "🙈" : "👁️" }}
            </button>
          </div>
        </div>

        <button class="primary" @click="login" :disabled="loading || !username || !password">
          <span v-if="!loading">Entrar</span>
          <span v-else>Ingresando…</span>
        </button>

        <p v-if="error" class="err">{{ error }}</p>

        <div class="foot">
          <span class="dot"></span>
          <span>Sesión protegida </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import api from "../lib/api.js";

const emit = defineEmits(["logged"]);

const username = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");
const show = ref(false);

async function login() {
  if (loading.value) return;

  error.value = "";
  loading.value = true;

  try {
    const { data } = await api.post("/api/auth/login", {
      username: username.value,
      password: password.value,
    });

    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    emit("logged", data.user);
  } catch (e) {
    error.value = e?.response?.data?.error || "No se pudo iniciar sesión";
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
  /* ✅ MISMA TIPOGRAFÍA GLOBAL QUE App.vue */
:global(html, body, #app){
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial;
  margin: 0;
  height: 100%;
}
:global(*){ box-sizing: border-box; }

/* Fondo moderno (puedes cambiar la URL por una imagen tuya local o remota) */
.wrap{
  min-height: 100vh;
  width: 100%;
  display:flex;
  align-items:center;
  justify-content:center;
  position:relative;
  overflow:hidden;

  /* 👇 tu fondo ocupa toda la pantalla */
  background-image:
    url("../assets/bg.png");
  
  background-position: center;
  background-repeat: no-repeat;
}


.bg-overlay{
  position:absolute;
  inset:0;
  background: linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.55));
  pointer-events:none;
}

.shell{
  position:relative;
  z-index:1;
  width:min(980px, 96vw);
  display:grid;
  grid-template-columns: 1.05fr .95fr;
  gap:14px;
}

.brand{
  padding:18px;
  color:#fff;
  border-radius:18px;
  border:1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.06);
  /*backdrop-filter: blur(10px);*/
  box-shadow: 0 18px 60px rgba(0,0,0,.35);
  overflow:hidden;
  position:relative;
}

.brand:before{
  content:"";
  position:absolute;
  inset:-120px -120px auto auto;
  width:320px; height:320px;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,.18), transparent 60%);
  transform: rotate(25deg);
  pointer-events:none;
}

.logo{
  width:54px;
  height:54px;
  border-radius:16px;
  display:flex;
  align-items:center;
  justify-content:center;
  font-weight:900;
  letter-spacing:.5px;
  background: rgba(255,255,255,.14);
  border:1px solid rgba(255,255,255,.16);
  margin-bottom:12px;
}

.brand-text h2{
  margin:0;
  font-size:22px;
  letter-spacing:.2px;
}

.brand-text p{
  margin:8px 0 0;
  color: rgba(255,255,255,.78);
  font-size:13px;
  line-height:1.45;
  max-width: 42ch;
}

.brand-badges{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin-top:14px;
}

.badge{
  font-size:12px;
  padding:6px 10px;
  border-radius:999px;
  background: rgba(255,255,255,.12);
  border:1px solid rgba(255,255,255,.16);
  color: rgba(255,255,255,.85);
}

/* Card */
.card{
  border-radius:18px;
  padding:18px;
  background: rgba(255,255,255,.92);
  border:1px solid rgba(255,255,255,.45);
  backdrop-filter: blur(10px);
  box-shadow: 0 18px 60px rgba(0,0,0,.35);
}

.card-head h1{
  margin:0;
  font-size:18px;
  font-weight:900;
  letter-spacing:.2px;
}

.sub{
  margin:6px 0 12px;
  font-size:12px;
  color:#5b5b5b;
}

.field{
  display:flex;
  flex-direction:column;
  gap:6px;
  margin:10px 0;
}

label{
  font-size:12px;
  color:#343434;
}

input{
  border:1px solid #dedede;
  border-radius:12px;
  padding:11px 12px;
  outline:none;
  background:#fff;
  transition: box-shadow .15s ease, border-color .15s ease;
}

input:focus{
  border-color:#b7b7b7;
  box-shadow: 0 0 0 4px rgba(0,0,0,.06);
}

.pw{
  display:flex;
  align-items:center;
  gap:8px;
}

.pw input{
  flex:1;
}

.eye{
  border:1px solid #e1e1e1;
  background:#fff;
  border-radius:12px;
  padding:10px 12px;
  cursor:pointer;
}

.primary{
  width:100%;
  margin-top:10px;
  border:1px solid #111;
  background:#111;
  color:#fff;
  border-radius:12px;
  padding:11px 12px;
  cursor:pointer;
  font-weight:800;
  letter-spacing:.2px;
}

.primary:disabled{
  opacity:.6;
  cursor:not-allowed;
}

.err{
  margin-top:10px;
  color:#b00020;
  font-size:13px;
  background:#fff5f5;
  border:1px solid #ffd0d0;
  padding:10px;
  border-radius:12px;
}

.foot{
  margin-top:12px;
  display:flex;
  align-items:center;
  gap:8px;
  font-size:12px;
  color:#5b5b5b;
}

.dot{
  width:8px;
  height:8px;
  border-radius:999px;
  background:#16a34a;
  box-shadow: 0 0 0 4px rgba(22,163,74,.18);
}

/* Responsive */
@media (max-width: 880px){
  .shell{
    grid-template-columns: 1fr;
  }
  .brand{
    display:none; /* si prefieres, lo dejamos visible arriba */
  }
}
</style>
