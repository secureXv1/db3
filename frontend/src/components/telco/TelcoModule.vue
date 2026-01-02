<!-- frontend/src/components/TelcoModule.vue -->
<template>
  <section class="panel">
    <!-- Header -->
    <div class="headRow">
      <div>
        <h2 class="h2">Análisis Telco (XDR)</h2>
        <div class="muted">
          1) Crear RUN → 2) Elegir tipo de análisis → 3) Subir archivos → 4) Analizar → 5) Reporte
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabsRow">
      <button class="ghost" :class="{ active: activeSub==='xdr' }" @click="activeSub='xdr'">
        Análisis RETEL
      </button>
      <button class="ghost" :class="{ active: activeSub==='antennas' }" @click="activeSub='antennas'">
        Antenas
      </button>
    </div>

    <div v-if="activeSub==='xdr'">
      <!-- RUN -->
      <div class="card">
        <div class="cardHead">
          <div>
            <div class="title">Sesión (RUN)</div>
            <div class="muted small">
              Se guarda en localStorage como <span class="mono">telco_run_id</span>.
            </div>
          </div>

          <div class="actions">
            <div class="field inline">
              <label>Nombre del RUN</label>
              <input v-model.trim="runName" placeholder="Ej: Caso Kennedy - 2026-01-01" />
            </div>

            <button class="primary" @click="createRun" :disabled="loading">Crear RUN</button>
            <button class="ghost" @click="newAnalysis" :disabled="loading || !runId">Nuevo análisis (limpiar)</button>
            <button class="danger" @click="clearRun" :disabled="loading || !runId">Borrar registros</button>
          </div>
        </div>

        <div class="warn" v-if="!runId">
          Crea un RUN para habilitar la selección de tipo de análisis y las cargas.
        </div>

        <div class="ok" v-if="runMeta && runId">
          RUN:
          <b>{{ runMeta.name }}</b>
          <span class="muted small"> · creado:</span>
          <b>{{ fmtTs(runMeta.created_at) }}</b>
          <span class="muted small"> · runId:</span>
          <b class="mono">{{ runId }}</b>
        </div>
      </div>

      <!-- Selección obligatoria de tipo de análisis -->
      <div class="card" v-if="runId">
        <div class="cardHead">
          <div>
            <div class="title">Tipo de análisis</div>
            <div class="muted small">
              Debes seleccionar el tipo de análisis para habilitar la carga y las gráficas.
            </div>
          </div>
        </div>

        <div class="segRow">
          <button
            class="segBtn"
            :class="{ segActive: analysisMode==='individual' }"
            @click="setMode('individual')"
          >
            Individual (1 objetivo)
          </button>
          <button
            class="segBtn"
            :class="{ segActive: analysisMode==='group' }"
            @click="setMode('group')"
          >
            Grupal (2 objetivos)
          </button>
        </div>

        <div class="muted tiny" v-if="analysisMode==='individual'">
          Subes varios archivos del mismo objetivo. El sistema detecta automáticamente el número repetido (objetivo).
        </div>
        <div class="muted tiny" v-else-if="analysisMode==='group'">
          Cargas objetivo 1 (grupo 1) y objetivo 2 (grupo 2). Luego verás comunes + coincidencias + análisis individual por objetivo.
        </div>
      </div>

      <div class="warn" v-if="runId && !analysisMode">
        Selecciona <b>Análisis Individual</b> o <b>Análisis Grupal</b> para continuar.
      </div>

      <!-- =========================
           INDIVIDUAL
           ========================= -->
      <template v-if="analysisMode==='individual'">
        <!-- Upload individual -->
        <div class="card">
          <div class="cardHead">
            <div>
              <div class="title">Cargar registros (Excel) - Individual</div>
              <div class="muted small">
                Selecciona operador antes de subir. CLARO: se recorta el último dígito de celda para match con antenas.
              </div>
            </div>

            <div class="actions">
              <div class="field inline">
                <label>Operador</label>
                <select v-model="uploadOperator">
                  <option value="CLARO">CLARO</option>
                  <option value="MOVISTAR">MOVISTAR</option>
                  <option value="TIGO">TIGO</option>
                  <option value="WOM">WOM</option>
                  <option value="OTRO">OTRO</option>
                </select>
              </div>

              <input ref="fileEl" type="file" multiple accept=".xlsx,.xls" @change="onPickFiles" />
              <button class="primary" @click="uploadXdr({ group: null })" :disabled="loading || !runId || !files.length">
                {{ loading ? "Subiendo..." : "Subir" }}
              </button>
              <button class="ghost" @click="clearPicked" :disabled="loading || !files.length">Quitar</button>
            </div>
          </div>

          <div class="muted small" v-if="files.length">
            Archivos seleccionados: <b>{{ files.length }}</b>
          </div>

          <div class="grid2" v-if="uploadSummary">
            <div class="kpi">
              <div class="kLabel">Vistos</div>
              <div class="kVal">{{ uploadSummary.rows_seen }}</div>
            </div>
            <div class="kpi">
              <div class="kLabel">Insertados</div>
              <div class="kVal">{{ uploadSummary.rows_inserted }}</div>
            </div>
            <div class="kpi">
              <div class="kLabel">Omitidos</div>
              <div class="kVal">{{ uploadSummary.rows_omitted }}</div>
            </div>
            <div class="kpi">
              <div class="kLabel">Hits priorizados</div>
              <div class="kVal">{{ uploadSummary.prioritized_hits }}</div>
            </div>
          </div>

          <div class="ok" v-if="objectiveInfo?.phone">
            Objetivo detectado:
            <b class="mono">{{ objectiveInfo.phone }}</b>
            <span class="muted small"> · confianza:</span>
            <b>{{ Math.round((objectiveInfo.confidence || 0) * 100) }}%</b>
            <span class="muted small"> · filas:</span>
            <b>{{ objectiveInfo.total_rows }}</b>
          </div>
          <div class="rowInline" style="gap:8px; margin-top:10px" v-if="objectiveInfo?.phone || objectiveManual">
            <button class="primary" @click="runIndividualAnalysis()" :disabled="loading || !runId">
              {{ loading ? "Analizando..." : "Generar análisis" }}
            </button>
            <button class="ghost" @click="resetFiltersSmart" :disabled="loading">Rango completo</button>
          </div>


          <!-- Override manual (por si un caso raro falla detección) -->
          <div class="grid" v-if="uploadSummary">
            <div class="field">
              <label>Objetivo (manual opcional)</label>
              <input v-model.trim="objectiveManual" placeholder="Si quieres forzar, escribe aquí (opcional)" />
              <div class="muted tiny">Si está vacío, se usa el objetivo detectado automáticamente.</div>
            </div>
          </div>

          <div class="tableWrap" v-if="uploadSummary?.results?.length">
            <table>
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Vistos</th>
                  <th>Insertados</th>
                  <th>Omitidos</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in uploadSummary.results" :key="r.file">
                  <td class="mono">{{ r.file }}</td>
                  <td class="mono">{{ r.rows_seen }}</td>
                  <td class="mono">{{ r.rows_inserted }}</td>
                  <td class="mono">{{ r.rows_omitted }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="error" v-if="uploadError">{{ uploadError }}</div>
        </div>

        <!-- Paso siguiente: generar análisis (se habilita tras detectar el objetivo) -->
        <div class="card" v-if="uploadSummary && !smartReady">
          <div class="cardHead">
            <div>
              <div class="title">Siguiente paso: Generar análisis</div>
              <div class="muted small">
                Ya cargaste archivos. Ahora genera el análisis para ver rutina diaria, línea de tiempo y grafo tipo i2.
              </div>
            </div>
            <div class="actions">
              <button class="primary" @click="runIndividualAnalysis()" :disabled="loading || !runId">
                {{ loading ? "Analizando..." : "Generar análisis" }}
              </button>
              <button class="ghost" @click="resetFiltersSmart" :disabled="loading">Rango completo</button>
            </div>
          </div>

          <div class="warn" v-if="!objectiveInfo?.phone && !objectiveManual">
            No se pudo detectar el número objetivo. Escribe el objetivo en “Objetivo (manual opcional)” y vuelve a generar.
          </div>

          <div class="muted small" v-else>
            Objetivo: <b class="mono">{{ getObjectivePhoneIndividual() }}</b>
            <span class="muted"> · luego podrás filtrar por fecha/hora dentro del rango real del RUN.</span>
          </div>
        </div>

        <!-- KPIs Objetivo -->
        <div class="card" v-if="objectiveSummary?.kpis">
          <div class="title">Resumen del objetivo</div>
          <div class="grid2">
            <div class="kpi">
              <div class="kLabel">Total interacciones</div>
              <div class="kVal">{{ objectiveSummary.kpis.total_calls }}</div>
            </div>
            <div class="kpi">
              <div class="kLabel">Contactos únicos</div>
              <div class="kVal">{{ objectiveSummary.kpis.uniq_contacts }}</div>
            </div>
            <div class="kpi">
              <div class="kLabel">Inicio</div>
              <div class="kVal kValSmall">{{ fmtTs(objectiveSummary.kpis.min_ts) }}</div>
            </div>
            <div class="kpi">
              <div class="kLabel">Fin</div>
              <div class="kVal kValSmall">{{ fmtTs(objectiveSummary.kpis.max_ts) }}</div>
            </div>
          </div>
        </div>

        
        <!-- =========================
             VISTA INTELIGENTE (i2-style)
             ========================= -->
        <div class="smartGrid" v-if="smartReady">
          <!-- LEFT: filtros + pernocta -->
          <div class="smartCol">
            <div class="card smartCard">
              <div class="cardHead">
                <div>
                  <div class="title">Controles de filtro</div>
                  <div class="muted small">Activos solo dentro del rango del RUN.</div>
                </div>
              </div>

              <div class="field">
                <label>Rango de fecha</label>
                <div class="rowInline" style="gap:8px; align-items:center">
                  <input class="inpDate" type="date" v-model="dateFrom" :min="rangeMinDate" :max="rangeMaxDate" />
                  <span class="muted small">a</span>
                  <input class="inpDate" type="date" v-model="dateTo" :min="rangeMinDate" :max="rangeMaxDate" />
                </div>
                <div class="muted tiny" v-if="rangeMinDate && rangeMaxDate">
                  Disponible: <b>{{ rangeMinDate }}</b> → <b>{{ rangeMaxDate }}</b>
                </div>
              </div>

              <div class="field">
                <label>Búsqueda global</label>
                <input v-model.trim="graphSearch" placeholder="Número o objetivo..." />
                <div class="muted tiny">Resalta en el grafo y en tablas.</div>
              </div>

              <div class="rowInline" style="gap:8px; margin-top:10px; flex-wrap:wrap">
                <button class="primary" @click="runIndividualAnalysis()" :disabled="loading || !runId">
                  {{ loading ? "Analizando..." : "Aplicar filtros" }}
                </button>
                <button class="ghost" @click="resetFiltersSmart" :disabled="loading">Limpiar</button>
                <button class="ghost" @click="downloadReportIndividual" :disabled="loading || !runId || !smartReady">
                  Descargar informe (PDF)
                </button>
              </div>
            </div>

            <div class="card smartCard pernoctaCard" v-if="pernoctaBase">
              <div class="muted small" style="display:flex; gap:8px; align-items:center">
                <span class="pillMoon">🌙</span>
                <b>Base de pernocta</b>
              </div>
              <div class="pernoctaName">{{ pernoctaBase.name }}</div>
              <div class="muted tiny" style="margin-top:6px">
                Identificada por frecuencia horaria <b>23:00–05:00</b>.
              </div>
              <div class="pernoctaMeta">
                <span class="pill">CELL ID: <b class="mono">{{ pernoctaBase.cell || "-" }}</b></span>
                <span class="pill" v-if="pernoctaBase.lac">LAC: <b class="mono">{{ pernoctaBase.lac }}</b></span>
              </div>
            </div>
          </div>

          <!-- MID: rutina diaria -->
          <div class="smartCol">
            <div class="card smartCard">
              <div class="cardHead">
                <div>
                  <div class="title">Patrón de Rutina Diaria (Tendencia)</div>
                  <div class="muted small">Frecuencia de actividad por hora y ubicación (top).</div>
                </div>
              </div>

              <div class="heatWrap" v-if="routineRows.length">
                <div class="heatHead">
                  <div class="heatLeft muted tiny">Ubicación</div>
                  <div class="heatHours">
                    <div v-for="h in 24" :key="h" class="heatHour">
                      <div class="heatIcon">{{ isNightHour(h-1) ? '🌙' : '☁️' }}</div>
                      <div class="muted tiny">{{ (h-1) }}h</div>
                    </div>
                  </div>
                </div>

                <div class="heatRow" v-for="row in routineRows" :key="row.key">
                  <div class="heatLeft">
                    <div class="heatName">{{ row.name }}</div>
                    <div class="muted tiny">
                      <span class="mono">{{ row.cell || '—' }}</span>
                      <span v-if="row.lac"> · LAC <span class="mono">{{ row.lac }}</span></span>
                    </div>
                  </div>

                  <div class="heatHours">
                    <div
                      v-for="h in 24"
                      :key="h"
                      class="heatCell"
                      :class="heatClass(row.hours[h-1])"
                      :title="`${(h-1)}h · ${row.hours[h-1]} eventos`"
                    ></div>
                  </div>
                </div>

                <div class="heatLegend">
                  <span class="dot dotNight"></span>
                  <span class="muted tiny">Actividad nocturna</span>
                  <span class="dot dotDay" style="margin-left:14px"></span>
                  <span class="muted tiny">Actividad diurna</span>
                  <span class="muted tiny" style="margin-left:14px; opacity:.85">
                    La intensidad representa volumen de llamadas/mensajes.
                  </span>
                </div>
              </div>

              <div class="muted small" v-else>
                No hay eventos suficientes para calcular tendencia (aumenta el límite o amplía el rango).
              </div>
            </div>
          </div>

          <!-- RIGHT: grafo i2 -->
          <div class="smartCol">
            <div class="card smartCard">
              <div class="cardHead">
                <div>
                  <div class="title">Mapa de Vínculos de Inteligencia</div>
                  <div class="muted small">Flechas por entrantes/salientes · Grosor por cantidad.</div>
                </div>

                <div class="rowInline" style="gap:6px; flex-wrap:wrap">
                  <button class="ghost" @click="setGraphLayout('cose')">COSE</button>
                  <button class="ghost" @click="setGraphLayout('concentric')">Concentric</button>
                  <button class="ghost" @click="setGraphLayout('grid')">Grid</button>
                  <button class="ghost" @click="fitGraph()">Ajustar</button>
                </div>
              </div>

              <div class="field" style="margin-top:8px">
                <input v-model.trim="graphSearch" placeholder="Buscar número..." @input="highlightGraphSearch" />
              </div>

              <div class="graphBox">
                <div v-if="graphError" class="warn">{{ graphError }}</div>
                <div v-else ref="graphEl" class="graphEl"></div>
              </div>

              <div class="miniDetail" v-if="selectedGraphContact">
                <div class="miniTitle">
                  Detalle: <b class="mono">{{ selectedGraphContact }}</b>
                </div>

                <div class="tableWrap" style="max-height:220px; overflow:auto">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha/hora</th>
                        <th>Tipo</th>
                        <th>Dur</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="r in pagedContactEvents" :key="r.id">
                        <td class="mono">{{ fmtTs(r.call_ts) }}</td>
                        <td class="mono" :class="r.direction==='IN' ? 'tagIn' : 'tagOut'">
                          {{ r.direction==='IN' ? 'ENTRANTE' : 'SALIENTE' }}
                        </td>
                        <td class="mono">{{ r.duration_sec ?? '-' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div class="rowInline" style="justify-content:space-between; margin-top:8px">
                  <button class="ghost" @click="contactEventsPrev" :disabled="contactEventsPage===0">←</button>
                  <div class="muted tiny">Página {{ contactEventsPage+1 }} / {{ contactEventsTotalPages }}</div>
                  <button class="ghost" @click="contactEventsNext" :disabled="contactEventsPage>=contactEventsTotalPages-1">→</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Línea de tiempo amigable (lugares visitados) -->
        <div class="card" v-if="movementDays.length">
          <div class="cardHead">
            <div>
              <div class="title">Línea de Tiempo de Desplazamientos Técnicos</div>
              <div class="muted small">
                Click en un lugar para ver tabla ordenada (fecha/hora) de cuando estuvo allí.
              </div>
            </div>
            <div class="actions">
              <button class="ghost" @click="timelineExpanded = !timelineExpanded">
                {{ timelineExpanded ? 'Contraer' : 'Expandir' }}
              </button>
            </div>
          </div>

          <div class="dayBlock" v-for="day in visibleMovementDays" :key="day.dateKey">
            <div class="dayHead">
              <div class="dayTitle">{{ day.dateLabel }}</div>
              <button class="ghost tinyBtn" @click="toggleDay(day.dateKey)">
                {{ expandedDays.has(day.dateKey) ? 'Ocultar' : 'Ver' }}
              </button>
            </div>

            <div v-if="expandedDays.has(day.dateKey)">
              <div class="stopCard" v-for="stop in day.stops" :key="stop.id">
                <div class="stopIcon">
                  <div class="iconBubble" :class="stop.isNight ? 'night' : 'day'">
                    {{ stop.isNight ? '🌙' : '☁️' }}
                  </div>
                </div>

                <div class="stopMain">
                  <div class="stopTop">
                    <div class="stopName">{{ stop.name }}</div>
                    <div class="stopRight">
                      <div class="mono stopDate">{{ stop.date }}</div>
                      <div class="muted tiny">{{ stop.startLabel }} – {{ stop.endLabel }}</div>
                    </div>
                  </div>

                  <div class="stopMeta">
                    <span class="pill">ANTENA: <b class="mono">{{ stop.antennaNum || '-' }}</b></span>
                    <span class="pill">CELL ID: <b class="mono">{{ stop.cell || '-' }}</b></span>
                    <span class="pill" v-if="stop.lac">LAC: <b class="mono">{{ stop.lac }}</b></span>
                  </div>

                  <div class="stopBottom">
                    <span class="pill">🕒 Permanencia: <b class="mono">{{ stop.durationMin }}</b> min</span>
                    <span class="pill muted"> {{ stop.eventsCount }} eventos</span>

                    <button class="ghost tinyBtn" style="margin-left:auto" @click="toggleStop(stop.id)">
                      {{ openStopId===stop.id ? 'Ocultar detalle' : 'Ver detalle' }}
                    </button>
                  </div>

                  <div class="stopDetail" v-if="openStopId===stop.id">
                    <div class="tableWrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Hora</th>
                            <th>Contacto</th>
                            <th>Tipo</th>
                            <th>Duración</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="r in stopDetailRows" :key="r.id">
                            <td class="mono">{{ fmtHour(r.call_ts) }}</td>
                            <td class="mono">{{ otherOfFlow(r) }}</td>
                            <td class="mono" :class="r.direction==='IN' ? 'tagIn' : 'tagOut'">
                              {{ r.direction==='IN' ? 'ENTRANTE' : 'SALIENTE' }}
                            </td>
                            <td class="mono">{{ r.duration_sec ?? '-' }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div class="rowInline" style="justify-content:space-between; margin-top:8px">
                      <button class="ghost" @click="stopPrev" :disabled="stopPage===0">←</button>
                      <div class="muted tiny">Página {{ stopPage+1 }} / {{ stopTotalPages }}</div>
                      <button class="ghost" @click="stopNext" :disabled="stopPage>=stopTotalPages-1">→</button>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </div>

<!-- Gráficas -->
        <div class="card" v-if="false && readyForCharts">
          <div class="cardHead">
            <div>
              <div class="title">Gráficas</div>
              <div class="muted small">
                Click en barras/puntos para abrir detalles.
              </div>
            </div>
          </div>

          <div class="charts3">
            <div class="chartBox">
              <div class="muted small" style="margin-bottom:6px">Línea de tiempo (movimientos)</div>
              <canvas ref="chartTimeseriesEl" height="140"></canvas>
            </div>

            <div class="chartBox">
              <div class="muted small" style="margin-bottom:6px">Top contactos (tipo i2)</div>
              <canvas ref="chartContactsEl" height="140"></canvas>
            </div>

            <div class="chartBox">
              <div class="muted small" style="margin-bottom:6px">Top lugares (presencia)</div>
              <canvas ref="chartPlacesEl" height="140"></canvas>
            </div>
          </div>
        </div>

        <!-- Mapa ArcGIS -->
        <div class="card" v-if="false && placesTop?.length">
          <div class="cardHead">
            <div>
              <div class="title">Mapa (ArcGIS) - Lugares frecuentes</div>
              <div class="muted small">
                Puntos basados en lat/lon (si existe en antennas). Click en un punto → detalle.
              </div>
            </div>
            <div class="actions">
              <button class="ghost" @click="zoomToPlaces" :disabled="!mapReady">Ajustar vista</button>
            </div>
          </div>

          <div class="mapWrap" ref="mapEl"></div>
        </div>

        <!-- Lugares tabla (click -> detalle) -->
        <div class="card" v-if="false && placesTop?.length">
          <div class="cardHead">
            <div>
              <div class="title">Lugares frecuentados (top)</div>
              <div class="muted small">Click en un lugar para ver fechas/horas (paginado).</div>
            </div>
          </div>

          <div class="tableWrap">
            <table style="min-width:820px">
              <thead>
                <tr>
                  <th>Operador</th>
                  <th>Lugar</th>
                  <th>Cell</th>
                  <th>Eventos</th>
                  <th>Lat</th>
                  <th>Lon</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in placesTop"
                  :key="`${r.operator}:${r.cell_key}`"
                  class="rowClick"
                  @click="openPlaceDetail(r)"
                >
                  <td class="mono">{{ r.operator }}</td>
                  <td>{{ r.lugar }}</td>
                  <td class="mono">{{ r.cell_key }}</td>
                  <td class="mono">{{ r.hits }}</td>
                  <td class="mono">{{ r.lat ?? "-" }}</td>
                  <td class="mono">{{ r.lon ?? "-" }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="error" v-if="placesError">{{ placesError }}</div>
        </div>

        <!-- Contactos tabla (click -> detalle) -->
        <div class="card" v-if="false && contactsTop?.length">
          <div class="cardHead">
            <div>
              <div class="title">Contactos del objetivo (top)</div>
              <div class="muted small">Click en un contacto para ver interacciones (paginado).</div>
            </div>
          </div>

          <div class="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Contacto</th>
                  <th>Llamadas</th>
                  <th>Duración total</th>
                  <th>Primera</th>
                  <th>Última</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(e, idx) in filteredContactsTop"
                  :key="e.other"
                  class="rowClick"
                  @click="openContactDetail(e.other)"
                >
                  <td class="mono">{{ idx + 1 }}</td>
                  <td class="mono">{{ e.other }}</td>
                  <td class="mono">{{ e.calls }}</td>
                  <td class="mono">{{ e.total_duration }}</td>
                  <td class="mono">{{ fmtTs(e.first_ts) }}</td>
                  <td class="mono">{{ fmtTs(e.last_ts) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Timeline (paginación local) -->
        <div class="card" v-if="false && flowsTimeline?.length">
          <div class="cardHead">
            <div>
              <div class="title">Timeline (eventos)</div>
              <div class="muted small">Ordenado por fecha/hora · Paginación local</div>
            </div>
            <div class="actions">
              <button class="ghost" @click="timelinePage = Math.max(0, timelinePage-1)" :disabled="timelinePage===0">←</button>
              <div class="muted small">Página <b>{{ timelinePage + 1 }}</b> / {{ timelineTotalPages }}</div>
              <button class="ghost" @click="timelinePage = Math.min(timelineTotalPages-1, timelinePage+1)" :disabled="timelinePage>=timelineTotalPages-1">→</button>
            </div>
          </div>

          <div class="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>TS</th>
                  <th>Dir</th>
                  <th>Oper</th>
                  <th>A</th>
                  <th>B</th>
                  <th>Dur(s)</th>
                  <th>Celda inicio</th>
                  <th>Celda final</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in pagedTimeline" :key="r.id">
                  <td class="mono">{{ fmtTs(r.call_ts) }}</td>
                  <td class="mono">{{ r.direction }}</td>
                  <td class="mono">{{ r.operator ?? "-" }}</td>
                  <td class="mono">{{ r.a_number }}</td>
                  <td class="mono">{{ r.b_number }}</td>
                  <td class="mono">{{ r.duration_sec ?? "-" }}</td>
                  <td class="mono">{{ r.nombre_celda_inicio || r.celda_inicio || "-" }}</td>
                  <td class="mono">{{ r.nombre_celda_final || r.celda_final || "-" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="error" v-if="error">{{ error }}</div>
      </template>

      <!-- =========================
           GRUPAL
           ========================= -->
      <template v-else-if="analysisMode==='group'">
        <div class="card">
          <div class="cardHead">
            <div>
              <div class="title">Cargas - Grupal (2 objetivos)</div>
              <div class="muted small">
                Carga objetivo 1 (grupo 1) y objetivo 2 (grupo 2). Se detecta automáticamente el número repetido por grupo.
              </div>
            </div>

            <div class="actions">
              <button class="primary" @click="runGroupAnalysis" :disabled="loading || !runId || !groupReady">
                {{ loading ? "Analizando..." : "Generar análisis grupal" }}
              </button>
              <button class="ghost" @click="downloadReportGroup" :disabled="loading || !groupReportReady">
                Descargar informe (PDF)
              </button>
            </div>
          </div>

          <div class="grid2 groupGrid">
            <!-- OBJ 1 -->
            <div class="subCard">
              <div class="title">Objetivo 1 (grupo 1)</div>

              <div class="field" style="margin-top:8px">
                <label>Operador</label>
                <select v-model="group1.operator">
                  <option value="CLARO">CLARO</option>
                  <option value="MOVISTAR">MOVISTAR</option>
                  <option value="TIGO">TIGO</option>
                  <option value="WOM">WOM</option>
                  <option value="OTRO">OTRO</option>
                </select>
              </div>

              <input ref="fileElG1" type="file" multiple accept=".xlsx,.xls" @change="(e)=> onPickFilesGroup(e, 1)" />
              <div class="rowInline" style="margin-top:8px">
                <button class="primary" @click="uploadXdr({ group: 1 })" :disabled="loading || !runId || !group1.files.length">
                  Subir
                </button>
                <button class="ghost" @click="clearPickedGroup(1)" :disabled="loading || !group1.files.length">Quitar</button>
                <div class="muted small" v-if="group1.files.length">({{ group1.files.length }} archivos)</div>
              </div>

              <div class="ok" v-if="group1.objectiveInfo?.phone" style="margin-top:10px">
                Detectado: <b class="mono">{{ group1.objectiveInfo.phone }}</b>
                <span class="muted small"> · {{ Math.round((group1.objectiveInfo.confidence||0)*100) }}%</span>
              </div>

              <div class="field" style="margin-top:10px">
                <label>Objetivo 1 (manual opcional)</label>
                <input v-model.trim="group1.manual" placeholder="Opcional" />
              </div>
            </div>

            <!-- OBJ 2 -->
            <div class="subCard">
              <div class="title">Objetivo 2 (grupo 2)</div>

              <div class="field" style="margin-top:8px">
                <label>Operador</label>
                <select v-model="group2.operator">
                  <option value="CLARO">CLARO</option>
                  <option value="MOVISTAR">MOVISTAR</option>
                  <option value="TIGO">TIGO</option>
                  <option value="WOM">WOM</option>
                  <option value="OTRO">OTRO</option>
                </select>
              </div>

              <input ref="fileElG2" type="file" multiple accept=".xlsx,.xls" @change="(e)=> onPickFilesGroup(e, 2)" />
              <div class="rowInline" style="margin-top:8px">
                <button class="primary" @click="uploadXdr({ group: 2 })" :disabled="loading || !runId || !group2.files.length">
                  Subir
                </button>
                <button class="ghost" @click="clearPickedGroup(2)" :disabled="loading || !group2.files.length">Quitar</button>
                <div class="muted small" v-if="group2.files.length">({{ group2.files.length }} archivos)</div>
              </div>

              <div class="ok" v-if="group2.objectiveInfo?.phone" style="margin-top:10px">
                Detectado: <b class="mono">{{ group2.objectiveInfo.phone }}</b>
                <span class="muted small"> · {{ Math.round((group2.objectiveInfo.confidence||0)*100) }}%</span>
              </div>

              <div class="field" style="margin-top:10px">
                <label>Objetivo 2 (manual opcional)</label>
                <input v-model.trim="group2.manual" placeholder="Opcional" />
              </div>
            </div>
          </div>
        </div>

        <!-- Resultados grupales -->
        <div class="card" v-if="groupResultsReady">
          <div class="cardHead">
            <div>
              <div class="title">Resultados grupales</div>
              <div class="muted small">
                Contactos en común · Lugares en común · Coincidencias por antena (ventana 3h)
              </div>
            </div>
          </div>

          <div class="charts2">
            <div class="chartBox">
              <div class="muted small" style="margin-bottom:6px">Contactos en común (top)</div>
              <canvas ref="chartCommonContactsEl" height="140"></canvas>
            </div>
            <div class="chartBox">
              <div class="muted small" style="margin-bottom:6px">Lugares en común (top)</div>
              <canvas ref="chartCommonPlacesEl" height="140"></canvas>
            </div>
          </div>

          <div class="card" style="margin-top:12px" v-if="groupCoincidences?.length">
            <div class="title">Coincidencias por antena (Δ ≤ 3h)</div>
            <div class="tableWrap">
              <table style="min-width:980px">
                <thead>
                  <tr>
                    <th>Operador</th>
                    <th>Cell</th>
                    <th>TS Obj1</th>
                    <th>TS Obj2</th>
                    <th>Δ (min)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(r, i) in groupCoincidences" :key="i">
                    <td class="mono">{{ r.operator }}</td>
                    <td class="mono">{{ r.cell_key }}</td>
                    <td class="mono">{{ fmtTs(r.ts1) }}</td>
                    <td class="mono">{{ fmtTs(r.ts2) }}</td>
                    <td class="mono">{{ Math.round((Number(r.delta_sec||0) / 60)) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Análisis individual de cada objetivo -->
          <div class="card" style="margin-top:12px" v-if="ind1.ready || ind2.ready">
            <div class="title">Análisis individual por objetivo</div>
            <div class="grid2 groupGrid">
              <div class="subCard">
                <div class="title">Objetivo 1</div>
                <div class="ok" v-if="ind1.phone">
                  <b class="mono">{{ ind1.phone }}</b>
                </div>
                <div class="muted small" v-if="ind1.summary?.kpis">
                  Total: <b>{{ ind1.summary.kpis.total_calls }}</b> · Contactos: <b>{{ ind1.summary.kpis.uniq_contacts }}</b>
                </div>
              </div>
              <div class="subCard">
                <div class="title">Objetivo 2</div>
                <div class="ok" v-if="ind2.phone">
                  <b class="mono">{{ ind2.phone }}</b>
                </div>
                <div class="muted small" v-if="ind2.summary?.kpis">
                  Total: <b>{{ ind2.summary.kpis.total_calls }}</b> · Contactos: <b>{{ ind2.summary.kpis.uniq_contacts }}</b>
                </div>
              </div>
            </div>
          </div>

        </div>

        <div class="error" v-if="error">{{ error }}</div>
      </template>
    </div>

    <div v-else>
      <AntennaSection />
    </div>

    <!-- =========================
         MODAL DETALLES (contacto / lugar)
         ========================= -->
    <teleport to="body">
      <div v-if="detailModal.open" class="modalOverlay" @click.self="closeDetailModal">
        <div class="modal">
          <div class="modalHead">
            <div>
              <div class="title">{{ detailModal.title }}</div>
              <div class="muted small">{{ detailModal.subtitle }}</div>
            </div>
            <button class="ghost" @click="closeDetailModal">Cerrar</button>
          </div>

          <div class="modalBody">
            <div class="rowInline" style="justify-content: space-between; margin-bottom:10px">
              <div class="muted small">
                Página <b>{{ detailModal.page + 1 }}</b>
              </div>
              <div class="rowInline">
                <button class="ghost" @click="detailPrev" :disabled="detailModal.page===0">←</button>
                <button class="ghost" @click="detailNext" :disabled="!detailModal.hasMore">→</button>
              </div>
            </div>

            <div class="tableWrap">
              <table style="min-width:980px">
                <thead>
                  <tr v-if="detailModal.kind==='place'">
                    <th>TS</th>
                    <th>Dir</th>
                    <th>Oper</th>
                    <th>A</th>
                    <th>B</th>
                    <th>Match</th>
                    <th>Celda inicio</th>
                    <th>Celda final</th>
                  </tr>
                  <tr v-else>
                    <th>TS</th>
                    <th>Dir</th>
                    <th>Oper</th>
                    <th>A</th>
                    <th>B</th>
                    <th>Dur(s)</th>
                    <th>Celda inicio</th>
                    <th>Celda final</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in detailModal.rows" :key="r.id">
                    <td class="mono">{{ fmtTs(r.call_ts) }}</td>
                    <td class="mono">{{ r.direction }}</td>
                    <td class="mono">{{ r.operator ?? "-" }}</td>
                    <td class="mono">{{ r.a_number }}</td>
                    <td class="mono">{{ r.b_number }}</td>
                    <td v-if="detailModal.kind==='place'" class="mono">{{ r.match_side }}</td>
                    <td v-else class="mono">{{ r.duration_sec ?? "-" }}</td>
                    <td class="mono">{{ r.nombre_celda_inicio || r.celda_inicio || "-" }}</td>
                    <td class="mono">{{ r.nombre_celda_final || r.celda_final || "-" }}</td>
                  </tr>

                  <tr v-if="!detailModal.rows.length">
                    <td :colspan="detailModal.kind==='place' ? 8 : 8" class="empty">Sin datos</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="error" v-if="detailModal.error">{{ detailModal.error }}</div>
          </div>
        </div>
      </div>
    </teleport>
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import Chart from "chart.js/auto";
import AntennaSection from "./AntennaSection.vue";

const API = import.meta.env.VITE_API_BASE || "";

const loading = ref(false);
const error = ref("");

const activeSub = ref("xdr");

// RUN
const runId = ref(Number(localStorage.getItem("telco_run_id") || 0) || null);
const runMeta = ref(null);
const runName = ref("");

// tipo análisis: obligatorio
const analysisMode = ref(null); // 'individual' | 'group' | null

// Upload individual
const uploadOperator = ref(localStorage.getItem("telco_upload_operator") || "CLARO");
const fileEl = ref(null);
const files = ref([]);
const uploadSummary = ref(null);
const uploadError = ref("");

// objetivo detectado (individual)
const objectiveInfo = ref(null);
const objectiveManual = ref("");

// filtros
const filters = ref({
  from: "",
  to: "",
  dir: "BOTH",
  hour_from: 0,
  hour_to: 23,
  limit: 2000,
  q: "",
});

// resultados individual
const objectiveSummary = ref(null);
const flowsTimeline = ref([]);
const contactsTop = ref([]);
const timeseries = ref([]);
const placesTop = ref([]);
const placesError = ref("");

// =============================
// Vista inteligente (rutina + i2 + timeline amigable)
// =============================
const graphEl = ref(null);
let cy = null;
const graphError = ref("");
const graphLayout = ref("cose");
const graphSearch = ref("");

const selectedGraphContact = ref("");
const contactEventsPage = ref(0);
const contactEventsPageSize = 25;

// timeline amigable
const timelineExpanded = ref(false);
const expandedDays = ref(new Set());
const openStopId = ref("");
const stopPage = ref(0);
const stopPageSize = 15;

// computed rango de fechas del RUN
const rangeMinDate = computed(() => {
  const v = objectiveSummary.value?.kpis?.min_ts;
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return toLocalDateKey(d);
});
const rangeMaxDate = computed(() => {
  const v = objectiveSummary.value?.kpis?.max_ts;
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return toLocalDateKey(d);
});

// v-model date inputs (mantienen filtros.from/to en datetime-local)
const dateFrom = computed({
  get() {
    const v = String(filters.value.from || "");
    return v ? v.slice(0, 10) : "";
  },
  set(d) {
    const dd = String(d || "").trim();
    if (!dd) filters.value.from = "";
    else filters.value.from = `${dd}T00:00`;
  }
});
const dateTo = computed({
  get() {
    const v = String(filters.value.to || "");
    return v ? v.slice(0, 10) : "";
  },
  set(d) {
    const dd = String(d || "").trim();
    if (!dd) filters.value.to = "";
    else filters.value.to = `${dd}T23:59`;
  }
});

function resetFiltersSmart() {
  resetFilters();
  graphSearch.value = "";
  // Si ya sabemos el rango, lo ponemos completo
  if (rangeMinDate.value) filters.value.from = `${rangeMinDate.value}T00:00`;
  if (rangeMaxDate.value) filters.value.to = `${rangeMaxDate.value}T23:59`;
}

// helpers hora / noche
function toLocalDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function isNightHour(h) {
  return (h >= 23 || h <= 5);
}
function fmtHour(ts) {
  if (!ts) return "-";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(ts);
  }
}

// location extraction from flow row
function flowLoc(r) {
  const operator = String(r.operator || "OTRO");
  const cell = String(r.celda_inicio || r.celda_final || "").trim() || "";
  const nameRaw = r.nombre_celda_inicio || r.nombre_celda_final || r.lugar || "";
  const name = String(nameRaw || "").trim() || "Antena no identificada";

  // estos campos pueden variar según tu SELECT; los dejamos tolerantes:
  const lac = r.lac ?? r.lac_inicio ?? r.lac_final ?? r.lac_id ?? null;
  const antennaNum = r.antenna_num ?? r.num_antena ?? r.torre ?? r.tower ?? null;

  const key = `${operator}:${cell || name}`;
  return { key, operator, cell, name, lac, antennaNum };
}

function otherOfFlow(r) {
  const dir = String(r.direction || "").toUpperCase();
  // En tu backend direction ya viene relativo al objetivo
  if (dir === "OUT") return r.b_number;
  if (dir === "IN") return r.a_number;
  // fallback
  return r.b_number || r.a_number || "";
}

// -----------------
// Rutina diaria (heatmap)
// -----------------
const smartReady = computed(() => {
  return Boolean(flowsTimeline.value?.length);
});

const routineRows = computed(() => {
  const rows = flowsTimeline.value || [];
  if (!rows.length) return [];

  // acumula por ubicación y hora
  const byLoc = new Map(); // key -> {meta, hours[24], total}
  for (const r of rows) {
    const ts = r.call_ts;
    if (!ts) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;

    const h = d.getHours();
    const loc = flowLoc(r);

    if (!byLoc.has(loc.key)) {
      byLoc.set(loc.key, {
        key: loc.key,
        name: loc.name,
        cell: loc.cell,
        lac: loc.lac,
        antennaNum: loc.antennaNum,
        hours: Array.from({ length: 24 }, () => 0),
        total: 0,
        nightTotal: 0,
      });
    }

    const obj = byLoc.get(loc.key);
    obj.hours[h] += 1;
    obj.total += 1;
    if (isNightHour(h)) obj.nightTotal += 1;
  }

  // top 5 por total
  const arr = Array.from(byLoc.values()).sort((a, b) => b.total - a.total).slice(0, 5);
  return arr;
});

const routineMax = computed(() => {
  let m = 0;
  for (const r of routineRows.value) {
    for (const v of r.hours) m = Math.max(m, v);
  }
  return m || 1;
});

function heatClass(v) {
  const n = Number(v || 0);
  if (n <= 0) return "h0";
  const ratio = n / routineMax.value;
  if (ratio < 0.25) return "h1";
  if (ratio < 0.5) return "h2";
  if (ratio < 0.75) return "h3";
  return "h4";
}

const pernoctaBase = computed(() => {
  const arr = routineRows.value || [];
  if (!arr.length) return null;
  const best = [...arr].sort((a, b) => (b.nightTotal - a.nightTotal) || (b.total - a.total))[0];
  if (!best || best.nightTotal <= 0) return null;
  return { name: best.name, cell: best.cell, lac: best.lac, key: best.key };
});

// -----------------
// Timeline amigable por días / paradas
// -----------------
function dayKeyFromTs(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "SIN_FECHA";
  return toLocalDateKey(d);
}

function buildStops() {
  const rows = (flowsTimeline.value || []).slice().sort((a, b) => new Date(a.call_ts) - new Date(b.call_ts));
  if (!rows.length) return [];

  const days = new Map(); // dateKey -> {dateKey, dateLabel, stops:[]}
  let prevLocKey = "";
  let cur = null;

  for (const r of rows) {
    const ts = r.call_ts;
    if (!ts) continue;
    const dk = dayKeyFromTs(ts);
    const loc = flowLoc(r);

    if (!days.has(dk)) {
      days.set(dk, {
        dateKey: dk,
        dateLabel: new Date(`${dk}T00:00:00`).toLocaleDateString(),
        stops: [],
      });
    }

    // corta la parada si cambia de ubicación o cambia de día
    if (!cur || cur.dateKey !== dk || prevLocKey !== loc.key) {
      if (cur) days.get(cur.dateKey).stops.push(cur);

      const startD = new Date(ts);
      const h = startD.getHours();
      cur = {
        id: `${dk}:${loc.key}:${days.get(dk).stops.length}`,
        dateKey: dk,
        date: dk,
        startTs: ts,
        endTs: ts,
        startLabel: fmtHour(ts),
        endLabel: fmtHour(ts),
        eventsCount: 0,
        durationMin: 0,
        isNight: isNightHour(h),
        name: loc.name,
        cell: loc.cell,
        lac: loc.lac,
        antennaNum: loc.antennaNum,
        locKey: loc.key,
      };
      prevLocKey = loc.key;
    }

    cur.eventsCount += 1;
    cur.endTs = ts;
    cur.endLabel = fmtHour(ts);

    const a = new Date(cur.startTs);
    const b = new Date(cur.endTs);
    const dur = Math.max(0, Math.round((b - a) / 60000));
    cur.durationMin = dur;
  }

  if (cur) days.get(cur.dateKey).stops.push(cur);

  return Array.from(days.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

const movementDays = computed(() => buildStops());

const visibleMovementDays = computed(() => {
  const arr = movementDays.value || [];
  if (timelineExpanded.value) return arr;
  // por defecto muestra últimos 2 días disponibles
  return arr.slice(Math.max(0, arr.length - 2));
});

function toggleDay(dk) {
  const set = new Set(expandedDays.value);
  if (set.has(dk)) set.delete(dk);
  else set.add(dk);
  expandedDays.value = set;
}

function toggleStop(id) {
  if (openStopId.value === id) {
    openStopId.value = "";
    stopPage.value = 0;
    return;
  }
  openStopId.value = id;
  stopPage.value = 0;
}

// filas del stop abierto
const stopDetailAll = computed(() => {
  const id = openStopId.value;
  if (!id) return [];
  // id = `${dk}:${loc.key}:idx`
  const dk = id.split(":")[0];
  const stop = (movementDays.value || [])
    .find(d => d.dateKey === dk)?.stops
    ?.find(s => s.id === id);

  if (!stop) return [];
  return (flowsTimeline.value || [])
    .filter(r => dayKeyFromTs(r.call_ts) === dk && flowLoc(r).key === stop.locKey)
    .sort((a, b) => new Date(a.call_ts) - new Date(b.call_ts));
});

const stopTotalPages = computed(() => {
  const n = stopDetailAll.value.length;
  return Math.max(1, Math.ceil(n / stopPageSize));
});

const stopDetailRows = computed(() => {
  const start = stopPage.value * stopPageSize;
  return stopDetailAll.value.slice(start, start + stopPageSize);
});

function stopPrev() {
  stopPage.value = Math.max(0, stopPage.value - 1);
}
function stopNext() {
  stopPage.value = Math.min(stopTotalPages.value - 1, stopPage.value + 1);
}

// -----------------
// i2 graph (desde flowsTimeline)
// -----------------
function buildGraphElements() {
  const phone = getObjectivePhoneIndividual();
  const rows = flowsTimeline.value || [];
  if (!phone || !rows.length) return { nodes: [], edges: [] };

  const nodes = new Map();
  const edges = new Map(); // key -> data

  nodes.set(phone, { data: { id: phone, label: phone, type: "target" } });

  for (const r of rows) {
    const dir = String(r.direction || "").toUpperCase();
    const other = String(otherOfFlow(r) || "").trim();
    if (!other) continue;

    nodes.set(other, { data: { id: other, label: other, type: "contact" } });

    const ts = r.call_ts;
    const k = `${dir}:${other}`;
    if (!edges.has(k)) {
      edges.set(k, {
        other,
        dir,
        count: 0,
        first_ts: ts,
        last_ts: ts,
      });
    }
    const e = edges.get(k);
    e.count += 1;
    if (ts && (!e.first_ts || new Date(ts) < new Date(e.first_ts))) e.first_ts = ts;
    if (ts && (!e.last_ts || new Date(ts) > new Date(e.last_ts))) e.last_ts = ts;
  }

  const edgeEls = [];
  for (const e of edges.values()) {
    if (e.dir === "OUT") {
      edgeEls.push({
        data: {
          id: `OUT:${phone}->${e.other}`,
          source: phone,
          target: e.other,
          dir: "OUT",
          count: e.count,
          first_ts: e.first_ts,
          last_ts: e.last_ts,
        },
      });
    } else if (e.dir === "IN") {
      edgeEls.push({
        data: {
          id: `IN:${e.other}->${phone}`,
          source: e.other,
          target: phone,
          dir: "IN",
          count: e.count,
          first_ts: e.first_ts,
          last_ts: e.last_ts,
        },
      });
    }
  }

  return { nodes: Array.from(nodes.values()), edges: edgeEls };
}

function edgeWidth(count) {
  const c = Math.max(1, Number(count || 1));
  return Math.min(10, 1 + Math.log2(c));
}

async function ensureGraph() {
  if (cy || !graphEl.value) return;

  graphError.value = "";
  try {
    // requiere: npm i cytoscape cytoscape-cose-bilkent
    const cytoscape = (await import("cytoscape")).default;
    let cose = null;
    try {
      cose = (await import("cytoscape-cose-bilkent")).default;
      cytoscape.use(cose);
    } catch {
      // si no está el layout, igual funciona con grid/concentric
    }

    cy = cytoscape({
      container: graphEl.value,
      elements: [],
      wheelSensitivity: 0.2,
    });

    cy.style()
      .selector("node")
      .style({
        "label": "data(label)",
        "font-size": 10,
        "text-valign": "center",
        "text-halign": "center",
        "shape": "ellipse",
        "width": 18,
        "height": 18,
        "background-color": "rgba(59,130,246,.92)",
        "color": "rgba(255,255,255,.95)",
        "border-color": "rgba(255,255,255,.35)",
        "border-width": 1,
      })
      .selector('node[type="target"]')
      .style({
        "width": 22,
        "height": 22,
        "background-color": "rgba(239,68,68,.95)",
        "border-width": 2,
        "border-color": "rgba(255,255,255,.55)",
        "font-weight": 900,
      })
      .selector("edge")
      .style({
        "curve-style": "bezier",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        "line-color": "rgba(148,163,184,.55)",
        "target-arrow-color": "rgba(148,163,184,.75)",
        "label": "data(count)",
        "color": "rgba(148,163,184,.85)",
        "font-size": 9,
        "text-rotation": "autorotate",
        "width": (e) => edgeWidth(e.data("count")),
      })
      .selector('edge[dir="IN"]')
      .style({
        "line-color": "rgba(34,197,94,.55)",
        "target-arrow-color": "rgba(34,197,94,.75)",
      })
      .selector('edge[dir="OUT"]')
      .style({
        "line-color": "rgba(59,130,246,.55)",
        "target-arrow-color": "rgba(59,130,246,.75)",
      })
      .selector(".dim")
      .style({ "opacity": 0.12 })
      .selector(".hl")
      .style({
        "opacity": 1,
        "border-color": "rgba(255,255,255,.85)",
        "border-width": 2,
      })
      .update();

    cy.on("tap", "node", (evt) => {
      const id = evt.target.data("id");
      const phone = getObjectivePhoneIndividual();
      if (!id || id === phone) {
        selectedGraphContact.value = "";
        return;
      }
      selectedGraphContact.value = id;
      contactEventsPage.value = 0;
    });

  } catch (e) {
    graphError.value = "Para el grafo i2 debes instalar: npm i cytoscape cytoscape-cose-bilkent";
  }
}

function applyGraphData() {
  if (!cy) return;
  const { nodes, edges } = buildGraphElements();

  cy.elements().remove();
  cy.add([...nodes, ...edges]);

  setGraphLayout(graphLayout.value || "cose");
  fitGraph();
  highlightGraphSearch();
}

function setGraphLayout(kind) {
  graphLayout.value = kind;
  if (!cy) return;

  const phone = getObjectivePhoneIndividual();
  let layout = null;

  if (kind === "grid") layout = { name: "grid", animate: true };
  else if (kind === "concentric") layout = { name: "concentric", animate: true, concentric: (n) => n.degree(), levelWidth: () => 1 };
  else layout = { name: "cose-bilkent", animate: true };

  // fallback si cose-bilkent no está
  try {
    cy.layout(layout).run();
  } catch {
    cy.layout({ name: "grid", animate: true }).run();
  }

  // asegurar el objetivo al centro en layouts simples
  try {
    const n = cy.getElementById(phone);
    if (n) n.lock();
    setTimeout(() => { try { n.unlock(); } catch {} }, 900);
  } catch {}
}

function fitGraph() {
  try { cy?.fit(undefined, 40); } catch {}
}

function highlightGraphSearch() {
  if (!cy) return;
  const q = String(graphSearch.value || "").trim();
  cy.elements().removeClass("hl dim");

  if (!q) return;
  const found = cy.nodes().filter(n => String(n.data("id")).includes(q));
  cy.nodes().addClass("dim");
  cy.edges().addClass("dim");
  found.addClass("hl");
  found.connectedEdges().removeClass("dim").addClass("hl");
  found.connectedNodes().removeClass("dim").addClass("hl");
  if (found.length) cy.center(found);
}

// detalle eventos de contacto seleccionado (desde flowsTimeline local)
const contactEventsAll = computed(() => {
  const other = selectedGraphContact.value;
  if (!other) return [];
  return (flowsTimeline.value || [])
    .filter(r => String(otherOfFlow(r)) === String(other))
    .sort((a, b) => new Date(a.call_ts) - new Date(b.call_ts));
});

const contactEventsTotalPages = computed(() => {
  const n = contactEventsAll.value.length;
  return Math.max(1, Math.ceil(n / contactEventsPageSize));
});

const pagedContactEvents = computed(() => {
  const start = contactEventsPage.value * contactEventsPageSize;
  return contactEventsAll.value.slice(start, start + contactEventsPageSize);
});

function contactEventsPrev() {
  contactEventsPage.value = Math.max(0, contactEventsPage.value - 1);
}
function contactEventsNext() {
  contactEventsPage.value = Math.min(contactEventsTotalPages.value - 1, contactEventsPage.value + 1);
}


// paginación timeline local
const timelinePage = ref(0);
const timelinePageSize = 120;

// charts
const chartTimeseriesEl = ref(null);
const chartContactsEl = ref(null);
const chartPlacesEl = ref(null);

let timeseriesChart = null;
let contactsChart = null;
let placesChart = null;

// ArcGIS map
const mapEl = ref(null);
let mapView = null;
let graphicsLayer = null;
let ArcGraphic = null;
let ArcPoint = null;
const mapReady = ref(false);

// Modal detalles
const detailModal = ref({
  open: false,
  kind: "", // 'place'|'contact'
  title: "",
  subtitle: "",
  page: 0,
  pageSize: 80,
  hasMore: false,
  rows: [],
  error: "",
  // payload para requests
  phone: "",
  group: null,
  cell_key: "",
  other: "",
});

// ===============
// GRUPAL
// ===============
const group1 = ref({ operator: "CLARO", files: [], objectiveInfo: null, manual: "" });
const group2 = ref({ operator: "CLARO", files: [], objectiveInfo: null, manual: "" });
const fileElG1 = ref(null);
const fileElG2 = ref(null);

// resultados grupales
const commonContacts = ref([]);
const commonPlaces = ref([]);
const groupCoincidences = ref([]);

// charts grupales
const chartCommonContactsEl = ref(null);
const chartCommonPlacesEl = ref(null);
let commonContactsChart = null;
let commonPlacesChart = null;

// análisis individual por objetivo dentro de grupal (resumen mínimo)
const ind1 = ref({ ready: false, phone: "", summary: null });
const ind2 = ref({ ready: false, phone: "", summary: null });

// -----------------
// Helpers HTTP
// -----------------
function authHeaders(extra = {}) {
  const t = localStorage.getItem("token");
  return { ...(extra || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

async function apiFetch(path, opts = {}) {
  const headers = authHeaders(opts.headers || {});
  const final = { ...opts, headers };
  const r = await fetch(`${API}${path}`, final);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function toBogotaTimestamptz(localDT) {
  const s = String(localDT || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s}:00-05:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return `${s}-05:00`;
  return s;
}

function buildQs(extra = {}) {
  const p = new URLSearchParams();
  const from = toBogotaTimestamptz(filters.value.from);
  const to = toBogotaTimestamptz(filters.value.to);

  if (from) p.set("from", from);
  if (to) p.set("to", to);

  p.set("dir", filters.value.dir || "BOTH");
  p.set("hour_from", String(filters.value.hour_from ?? 0));
  p.set("hour_to", String(filters.value.hour_to ?? 23));
  p.set("limit", String(filters.value.limit ?? 2000));

  // extras (phone, group, etc.)
  Object.entries(extra || {}).forEach(([k, v]) => {
    if (v == null || v === "") return;
    p.set(k, String(v));
  });

  return p.toString();
}

function fmtTs(ts) {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

// -----------------
// RUN + MODE
// -----------------
async function loadRunMetaIfAny() {
  if (!runId.value) return;
  try {
    const j = await apiFetch(`/api/telco/runs/${runId.value}`, { method: "GET" });
    runMeta.value = j.run;
    runName.value = j.run?.name || "";
  } catch {
    runMeta.value = null;
  }
}

/**
 * Reset TOTAL del módulo (cuando cambias run o modo)
 */
function resetAllAnalysisState() {
  uploadSummary.value = null;
  uploadError.value = "";
  files.value = [];
  objectiveInfo.value = null;
  objectiveManual.value = "";

  objectiveSummary.value = null;
  flowsTimeline.value = [];
  contactsTop.value = [];
  timeseries.value = [];
  placesTop.value = [];
  placesError.value = "";
  timelinePage.value = 0;

  commonContacts.value = [];
  commonPlaces.value = [];
  groupCoincidences.value = [];
  ind1.value = { ready: false, phone: "", summary: null };
  ind2.value = { ready: false, phone: "", summary: null };

  // charts
  destroyCharts();

  // mapa
  clearMapGraphics();
}

/**
 * Obligatorio seleccionar modo luego de crear run
 */
function setMode(m) {
  if (analysisMode.value === m) return;
  analysisMode.value = m;
  resetAllAnalysisState();
}

async function createRun() {
  error.value = "";
  uploadError.value = "";
  loading.value = true;

  try {
    const j = await apiFetch(`/api/telco/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: runName.value || "" }),
    });

    runId.value = j.run.id;
    runMeta.value = j.run;
    localStorage.setItem("telco_run_id", String(runId.value));

    // Luego de crear RUN: obligamos a seleccionar modo
    analysisMode.value = null;
    resetAllAnalysisState();
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

async function newAnalysis() {
  if (!runId.value) return;
  error.value = "";
  uploadError.value = "";
  loading.value = true;

  try {
    await apiFetch(`/api/telco/runs/${runId.value}/clear`, { method: "DELETE" });

    // Actualiza nombre si cambia
    const name = String(runName.value || "").trim();
    if (name) {
      const u = await apiFetch(`/api/telco/runs/${runId.value}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      runMeta.value = u.run;
    }

    // Obligar re-elección de modo si quieres (tú pediste que sea después de crear run)
    // Aquí lo dejamos SIN forzar, pero reseteamos análisis.
    resetAllAnalysisState();
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

async function clearRun() {
  if (!runId.value) return;
  error.value = "";
  uploadError.value = "";
  loading.value = true;

  try {
    await apiFetch(`/api/telco/runs/${runId.value}/clear`, { method: "DELETE" });
    resetAllAnalysisState();
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

// -----------------
// Upload (individual / group)
// -----------------
function onPickFiles(e) {
  files.value = Array.from(e.target.files || []);
}

function clearPicked() {
  files.value = [];
  if (fileEl.value) fileEl.value.value = "";
}

function onPickFilesGroup(e, g) {
  const arr = Array.from(e.target.files || []);
  if (g === 1) group1.value.files = arr;
  if (g === 2) group2.value.files = arr;
}

function clearPickedGroup(g) {
  if (g === 1) {
    group1.value.files = [];
    if (fileElG1.value) fileElG1.value.value = "";
  }
  if (g === 2) {
    group2.value.files = [];
    if (fileElG2.value) fileElG2.value.value = "";
  }
}

/**
 * Upload XDR con soporte de group=1|2 para análisis grupal.
 */
async function uploadXdr({ group }) {
  if (!runId.value) return;

  uploadError.value = "";
  error.value = "";
  loading.value = true;

  try {
    const op = String(
      group === 1 ? group1.value.operator
      : group === 2 ? group2.value.operator
      : uploadOperator.value
    ).toUpperCase().trim() || "OTRO";

    // persist operador individual
    if (!group) localStorage.setItem("telco_upload_operator", op);

    const fd = new FormData();

    const selectedFiles =
      group === 1 ? group1.value.files
      : group === 2 ? group2.value.files
      : files.value;

    for (const f of selectedFiles) fd.append("files", f);

    const t = localStorage.getItem("token");
    const qs = new URLSearchParams();
    qs.set("operator", op);
    if (group === 1 || group === 2) qs.set("group", String(group));

    const r = await fetch(`${API}/api/telco/runs/${runId.value}/upload-xdr?${qs.toString()}`, {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: fd,
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);

    if (!group) {
      uploadSummary.value = j;
      clearPicked();
      await detectObjectiveIndividual();
    } else {
      // Para grupal, solo refrescamos objetivo del grupo correspondiente
      if (group === 1) {
        group1.value.files = [];
        if (fileElG1.value) fileElG1.value.value = "";
        group1.value.objectiveInfo = await detectObjectiveByGroup(1);
      }
      if (group === 2) {
        group2.value.files = [];
        if (fileElG2.value) fileElG2.value.value = "";
        group2.value.objectiveInfo = await detectObjectiveByGroup(2);
      }
    }
  } catch (e) {
    uploadError.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

// -----------------
// Detect objective
// -----------------
function getObjectivePhoneIndividual() {
  // manual gana
  const m = String(objectiveManual.value || "").trim();
  if (m) return m.replace(/[^\d]/g, "");
  // si no, usa detectado
  return objectiveInfo.value?.phone || "";
}

async function detectObjectiveIndividual() {
  objectiveInfo.value = null;
  try {
    const q = buildQs({});
    const j = await apiFetch(`/api/telco/runs/${runId.value}/objective/detect?${q}`, { method: "GET" });
    objectiveInfo.value = j;
  } catch {
    objectiveInfo.value = null;
  }
}

async function detectObjectiveByGroup(g) {
  try {
    const q = buildQs({ group: g });
    const j = await apiFetch(`/api/telco/runs/${runId.value}/objective/detect?${q}`, { method: "GET" });
    return j;
  } catch {
    return null;
  }
}

function getGroupPhone(g) {
  const pack = g === 1 ? group1.value : group2.value;
  const manual = String(pack.manual || "").trim();
  if (manual) return manual.replace(/[^\d]/g, "");
  return pack.objectiveInfo?.phone || "";
}

// -----------------
// Filters
// -----------------
function resetFilters() {
  filters.value = {
    from: "",
    to: "",
    dir: "BOTH",
    hour_from: 0,
    hour_to: 23,
    limit: 2000,
    q: "",
  };
}

// -----------------
// Individual analysis pipeline
// -----------------
const readyForCharts = computed(() => {
  return Boolean(timeseries.value?.length || contactsTop.value?.length || placesTop.value?.length);
});
const readyForReport = computed(() => {
  return Boolean(readyForCharts.value && mapReady.value);
});

async function runIndividualAnalysis(extra = {}) {
  if (!runId.value) return;

  error.value = "";
  placesError.value = "";
  loading.value = true;

  try {
    // Asegura objetivo
    if (!objectiveInfo.value?.phone && !objectiveManual.value) await detectObjectiveIndividual();

    const phone = getObjectivePhoneIndividual();
    if (!phone) throw new Error("No se pudo detectar el objetivo. Usa objetivo manual o revisa archivos.");

    const group = extra.group ?? null;

    // Summary objetivo
    const q1 = buildQs({ phone, group });
    objectiveSummary.value = await apiFetch(`/api/telco/runs/${runId.value}/objective/summary?${q1}`, { method: "GET" });

    // Timeline
    const q2 = buildQs({ phone, group, limit: filters.value.limit });
    const t = await apiFetch(`/api/telco/runs/${runId.value}/flows/timeline?${q2}`, { method: "GET" });
    flowsTimeline.value = t.rows || [];
    timelinePage.value = 0;

    // Contacts top
    const q3 = buildQs({ phone, group, limit: 20 });
    const c = await apiFetch(`/api/telco/runs/${runId.value}/contacts/top?${q3}`, { method: "GET" });
    contactsTop.value = c.rows || [];

    // Places top
    const q4 = buildQs({ phone, group, limit: 20 });
    const p = await apiFetch(`/api/telco/runs/${runId.value}/places/top?${q4}`, { method: "GET" });
    placesTop.value = p.rows || [];

    // Timeseries
    const q5 = buildQs({ phone, group, bucket: "day" });
    const s = await apiFetch(`/api/telco/runs/${runId.value}/flows/timeseries?${q5}`, { method: "GET" });
    timeseries.value = s.rows || [];

    await nextTick();
    renderTimeseriesChart();
    renderContactsChart();
    renderPlacesChart();

    // Mapa
    await nextTick();
    await ensureMap();
    plotPlacesOnMap(placesTop.value);

  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

// -----------------
// Group analysis
// -----------------
const groupReady = computed(() => {
  return Boolean(getGroupPhone(1) && getGroupPhone(2));
});

const groupResultsReady = computed(() => {
  return Boolean(commonContacts.value.length || commonPlaces.value.length || groupCoincidences.value.length);
});

const groupReportReady = computed(() => {
  // aquí no pediste screenshot de mapa grupal, así que lo basamos en charts + coincidencias
  return Boolean(groupResultsReady.value);
});

async function runGroupAnalysis() {
  if (!runId.value) return;

  error.value = "";
  loading.value = true;

  try {
    const phone1 = getGroupPhone(1);
    const phone2 = getGroupPhone(2);
    if (!phone1 || !phone2) throw new Error("Debes tener objetivo 1 y objetivo 2 detectados (o manuales).");

    const qBase = buildQs({});

    // comunes contactos
    const cc = await apiFetch(
      `/api/telco/runs/${runId.value}/group/common-contacts?${qBase}&phone1=${encodeURIComponent(phone1)}&phone2=${encodeURIComponent(phone2)}&group1=1&group2=2&limit=20`,
      { method: "GET" }
    );
    commonContacts.value = cc.rows || [];

    // comunes lugares
    const cp = await apiFetch(
      `/api/telco/runs/${runId.value}/group/common-places?${qBase}&phone1=${encodeURIComponent(phone1)}&phone2=${encodeURIComponent(phone2)}&group1=1&group2=2&limit=20`,
      { method: "GET" }
    );
    commonPlaces.value = cp.rows || [];

    // coincidencias (ventana 3h)
    const co = await apiFetch(
      `/api/telco/runs/${runId.value}/group/coincidences?${qBase}&phone1=${encodeURIComponent(phone1)}&phone2=${encodeURIComponent(phone2)}&group1=1&group2=2&window_hours=3&limit=250`,
      { method: "GET" }
    );
    groupCoincidences.value = co.rows || [];

    await nextTick();
    renderCommonContactsChart();
    renderCommonPlacesChart();

    // análisis individual mínimo de cada objetivo (resumen)
    ind1.value = { ready: true, phone: phone1, summary: await fetchObjectiveSummary(phone1, 1) };
    ind2.value = { ready: true, phone: phone2, summary: await fetchObjectiveSummary(phone2, 2) };

  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

async function fetchObjectiveSummary(phone, group) {
  const q = buildQs({ phone, group });
  return await apiFetch(`/api/telco/runs/${runId.value}/objective/summary?${q}`, { method: "GET" });
}

// -----------------
// Filters / computed for tables
// -----------------
const filteredContactsTop = computed(() => {
  const q = String(filters.value.q || "").trim();
  const rows = contactsTop.value || [];
  if (!q) return rows;
  return rows.filter((r) => String(r.other).includes(q));
});

const filteredTimeline = computed(() => {
  const q = String(filters.value.q || "").trim();
  const rows = flowsTimeline.value || [];
  if (!q) return rows;
  return rows.filter((r) => String(r.a_number).includes(q) || String(r.b_number).includes(q));
});

const timelineTotalPages = computed(() => {
  const n = filteredTimeline.value.length;
  return Math.max(1, Math.ceil(n / timelinePageSize));
});

const pagedTimeline = computed(() => {
  const start = timelinePage.value * timelinePageSize;
  return filteredTimeline.value.slice(start, start + timelinePageSize);
});

// -----------------
// Charts
// -----------------
function destroyCharts() {
  if (timeseriesChart) timeseriesChart.destroy();
  if (contactsChart) contactsChart.destroy();
  if (placesChart) placesChart.destroy();
  if (commonContactsChart) commonContactsChart.destroy();
  if (commonPlacesChart) commonPlacesChart.destroy();

  timeseriesChart = null;
  contactsChart = null;
  placesChart = null;
  commonContactsChart = null;
  commonPlacesChart = null;
}

function renderTimeseriesChart() {
  if (!chartTimeseriesEl.value) return;

  const rows = timeseries.value || [];
  const labels = rows.map((r) => fmtTs(r.bucket_ts));
  const data = rows.map((r) => Number(r.n || 0));

  if (timeseriesChart) timeseriesChart.destroy();

  timeseriesChart = new Chart(chartTimeseriesEl.value, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Eventos",
        data,
        borderColor: "rgba(34,211,238,.9)",
        backgroundColor: "rgba(34,211,238,.2)",
        tension: 0.25,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      onClick: (_evt, elements) => {
        // Click en punto: solo como UX (puedes luego filtrar rango por ese día)
        if (!elements?.length) return;
      },
      scales: {
        x: { ticks: { color: "#9aa4b2" } },
        y: { ticks: { color: "#9aa4b2" } },
      },
    },
  });
}

function renderContactsChart() {
  if (!chartContactsEl.value) return;

  const rows = (contactsTop.value || []).slice(0, 10);
  const labels = rows.map((r) => r.other);
  const data = rows.map((r) => Number(r.calls || 0));

  if (contactsChart) contactsChart.destroy();

  contactsChart = new Chart(chartContactsEl.value, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Llamadas",
        data,
        backgroundColor: "rgba(34,211,238,.55)",
        borderColor: "rgba(34,211,238,.9)",
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      onClick: (_evt, elements) => {
        if (!elements?.length) return;
        const idx = elements[0].index;
        const contact = rows[idx]?.other;
        if (contact) openContactDetail(contact);
      },
      scales: {
        x: { ticks: { color: "#9aa4b2" } },
        y: { ticks: { color: "#9aa4b2" } },
      },
    },
  });
}

function renderPlacesChart() {
  if (!chartPlacesEl.value) return;

  const rows = (placesTop.value || []).slice(0, 10);
  const labels = rows.map((r) => r.lugar);
  const data = rows.map((r) => Number(r.hits || 0));

  if (placesChart) placesChart.destroy();

  placesChart = new Chart(chartPlacesEl.value, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Eventos",
        data,
        backgroundColor: "rgba(96,165,250,.45)",
        borderColor: "rgba(96,165,250,.9)",
        borderWidth: 1,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      onClick: (_evt, elements) => {
        if (!elements?.length) return;
        const idx = elements[0].index;
        const place = rows[idx];
        if (place) openPlaceDetail(place);
      },
      scales: {
        x: { ticks: { color: "#9aa4b2" } },
        y: { ticks: { color: "#9aa4b2" } },
      },
    },
  });
}

function renderCommonContactsChart() {
  if (!chartCommonContactsEl.value) return;

  const rows = (commonContacts.value || []).slice(0, 10);
  const labels = rows.map((r) => r.other);
  const data = rows.map((r) => Number(r.total_calls || 0));

  if (commonContactsChart) commonContactsChart.destroy();

  commonContactsChart = new Chart(chartCommonContactsEl.value, {
    type: "bar",
    data: { labels, datasets: [{ label: "Total", data }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: "#9aa4b2" } }, y: { ticks: { color: "#9aa4b2" } } },
    },
  });
}

function renderCommonPlacesChart() {
  if (!chartCommonPlacesEl.value) return;

  const rows = (commonPlaces.value || []).slice(0, 10);
  const labels = rows.map((r) => r.lugar);
  const data = rows.map((r) => Number(r.total_hits || 0));

  if (commonPlacesChart) commonPlacesChart.destroy();

  commonPlacesChart = new Chart(chartCommonPlacesEl.value, {
    type: "bar",
    data: { labels, datasets: [{ label: "Total", data }] },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: "#9aa4b2" } }, y: { ticks: { color: "#9aa4b2" } } },
    },
  });
}

// -----------------
// ArcGIS map
// -----------------
async function ensureMap() {
  if (mapView || !mapEl.value) return;

  try {
    // IMPORT dinámico (no rompe build si no usas arcgis en otras rutas)
    const { default: ArcMap } = await import("@arcgis/core/Map");
    const { default: MapView } = await import("@arcgis/core/views/MapView");
    const { default: GraphicsLayer } = await import("@arcgis/core/layers/GraphicsLayer");
    const { default: Graphic } = await import("@arcgis/core/Graphic");
    const { default: Point } = await import("@arcgis/core/geometry/Point");

    ArcGraphic = Graphic;
    ArcPoint = Point;

    const map = new ArcMap({ basemap: "dark-gray-vector" });
    graphicsLayer = new GraphicsLayer();
    map.add(graphicsLayer);

    mapView = new MapView({
      container: mapEl.value,
      map,
      center: [-74.08175, 4.60971], // Bogotá por defecto
      zoom: 10,
      ui: { components: ["zoom", "attribution"] },
    });

    mapView.on("click", async (evt) => {
      const hit = await mapView.hitTest(evt);
      const g = hit?.results?.find((x) => x.graphic?.layer === graphicsLayer)?.graphic;
      if (g?.attributes?.cell_key) {
        openPlaceDetail(g.attributes);
      }
    });

    mapReady.value = true;
  } catch (e) {
    // Si no hay arcgis/core instalado, no bloqueamos el módulo
    mapReady.value = false;
  }
}

function clearMapGraphics() {
  try { graphicsLayer?.removeAll(); } catch {}
}

function plotPlacesOnMap(rows) {
  if (!mapView || !graphicsLayer || !ArcGraphic || !ArcPoint) return;
  clearMapGraphics();

  const points = (rows || [])
    .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)))
    .slice(0, 50);

  for (const r of points) {
    const pt = new ArcPoint({ longitude: Number(r.lon), latitude: Number(r.lat) });
    const size = Math.max(8, Math.min(22, 8 + Math.log10(Number(r.hits || 1)) * 10));

    const g = new ArcGraphic({
      geometry: pt,
      attributes: r,
      symbol: {
        type: "simple-marker",
        style: "circle",
        size,
        color: [34, 211, 238, 0.55],
        outline: { color: [255, 255, 255, 0.35], width: 1 },
      },
      popupTemplate: {
        title: "{lugar}",
        content: `Cell: {cell_key}<br/>Eventos: {hits}`,
      },
    });
    graphicsLayer.add(g);
  }

  if (points.length) zoomToPlaces();
}

function zoomToPlaces() {
  if (!mapView || !graphicsLayer) return;
  const gs = graphicsLayer.graphics?.items || [];
  if (!gs.length) return;
  mapView.goTo(gs, { duration: 450 }).catch(() => {});
}

async function takeMapScreenshotDataUrl() {
  if (!mapView) return null;
  try {
    const shot = await mapView.takeScreenshot({ format: "png" });
    // ArcGIS suele devolver dataUrl
    return shot?.dataUrl || null;
  } catch {
    return null;
  }
}

// -----------------
// Details modal (places / contacts)
// -----------------
function closeDetailModal() {
  detailModal.value.open = false;
  detailModal.value.rows = [];
  detailModal.value.error = "";
  detailModal.value.page = 0;
  detailModal.value.hasMore = false;
}

async function openPlaceDetail(placeRow) {
  const phone = getObjectivePhoneIndividual();
  if (!phone) return;

  detailModal.value = {
    open: true,
    kind: "place",
    title: `Lugar: ${placeRow.lugar || "SIN_DATO"}`,
    subtitle: `Cell: ${placeRow.cell_key} · Objetivo: ${phone}`,
    page: 0,
    pageSize: 80,
    hasMore: false,
    rows: [],
    error: "",
    phone,
    group: null,
    cell_key: placeRow.cell_key,
    other: "",
  };

  await loadPlaceDetailPage(0);
}

async function loadPlaceDetailPage(page) {
  try {
    detailModal.value.error = "";
    const q = buildQs({
      phone: detailModal.value.phone,
      cell_key: detailModal.value.cell_key,
      page,
      page_size: detailModal.value.pageSize,
    });

    const j = await apiFetch(`/api/telco/runs/${runId.value}/places/detail?${q}`, { method: "GET" });
    detailModal.value.rows = j.rows || [];
    detailModal.value.page = page;
    detailModal.value.hasMore = (j.rows || []).length >= detailModal.value.pageSize;
  } catch (e) {
    detailModal.value.error = String(e?.message || e);
  }
}

async function openContactDetail(otherPhone) {
  const phone = getObjectivePhoneIndividual();
  if (!phone) return;

  detailModal.value = {
    open: true,
    kind: "contact",
    title: `Contacto: ${otherPhone}`,
    subtitle: `Objetivo: ${phone}`,
    page: 0,
    pageSize: 80,
    hasMore: false,
    rows: [],
    error: "",
    phone,
    group: null,
    cell_key: "",
    other: otherPhone,
  };

  await loadContactDetailPage(0);
}

async function loadContactDetailPage(page) {
  try {
    detailModal.value.error = "";
    const q = buildQs({
      phone: detailModal.value.phone,
      other: detailModal.value.other,
      page,
      page_size: detailModal.value.pageSize,
    });

    const j = await apiFetch(`/api/telco/runs/${runId.value}/contacts/detail?${q}`, { method: "GET" });
    detailModal.value.rows = j.rows || [];
    detailModal.value.page = page;
    detailModal.value.hasMore = (j.rows || []).length >= detailModal.value.pageSize;
  } catch (e) {
    detailModal.value.error = String(e?.message || e);
  }
}

async function detailPrev() {
  const p = Math.max(0, detailModal.value.page - 1);
  if (detailModal.value.kind === "place") await loadPlaceDetailPage(p);
  else await loadContactDetailPage(p);
}

async function detailNext() {
  if (!detailModal.value.hasMore) return;
  const p = detailModal.value.page + 1;
  if (detailModal.value.kind === "place") await loadPlaceDetailPage(p);
  else await loadContactDetailPage(p);
}

// -----------------
// Report PDF
// -----------------
async function downloadReportIndividual() {
  if (!runId.value) return;

  const phone = getObjectivePhoneIndividual();
  if (!phone) return;

  loading.value = true;
  error.value = "";

  try {
    // Genera imágenes de charts
    const images = {
      timeseriesChart: timeseriesChart?.toBase64Image?.() || null,
      contactsChart: contactsChart?.toBase64Image?.() || null,
      placesChart: placesChart?.toBase64Image?.() || null,
      mapScreenshot: await takeMapScreenshotDataUrl(),
    };

    const dateRange = {
      min_ts: objectiveSummary.value?.kpis?.min_ts || null,
      max_ts: objectiveSummary.value?.kpis?.max_ts || null,
      from: filters.value.from || null,
      to: filters.value.to || null,
    };

    const payload = {
      runName: runMeta.value?.name || runName.value || `RUN ${runId.value}`,
      mode: "individual",
      objectives: [{ phone, confidence: objectiveInfo.value?.confidence ?? 0 }],
      dateRange,
      images,
    };

    const r = await fetch(`${API}/api/telco/runs/${runId.value}/report/pdf`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Analisis_solicitud_${(payload.runName || "").replace(/[^\w\-(). ]+/g, "_")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

async function downloadReportGroup() {
  if (!runId.value) return;

  const phone1 = getGroupPhone(1);
  const phone2 = getGroupPhone(2);
  if (!phone1 || !phone2) return;

  loading.value = true;
  error.value = "";

  try {
    const images = {
      // charts grupales
      contactsChart: commonContactsChart?.toBase64Image?.() || null,
      placesChart: commonPlacesChart?.toBase64Image?.() || null,
      timeseriesChart: null,
      mapScreenshot: null,
    };

    const payload = {
      runName: runMeta.value?.name || runName.value || `RUN ${runId.value}`,
      mode: "group",
      objectives: [
        { phone: phone1, confidence: group1.value.objectiveInfo?.confidence ?? 0 },
        { phone: phone2, confidence: group2.value.objectiveInfo?.confidence ?? 0 },
      ],
      dateRange: {
        from: filters.value.from || null,
        to: filters.value.to || null,
      },
      images,
    };

    const r = await fetch(`${API}/api/telco/runs/${runId.value}/report/pdf`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Analisis_solicitud_${(payload.runName || "").replace(/[^\w\-(). ]+/g, "_")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

// -----------------
// watchers / lifecycle

// --- smart view: cuando llega data, prepara rango + expande días + pinta grafo
watch(
  () => objectiveSummary.value?.kpis,
  (k) => {
    if (!k) return;
    // si no hay filtros, aplica el rango completo del RUN
    if (!filters.value.from && rangeMinDate.value) filters.value.from = `${rangeMinDate.value}T00:00`;
    if (!filters.value.to && rangeMaxDate.value) filters.value.to = `${rangeMaxDate.value}T23:59`;
  }
);

watch(
  () => flowsTimeline.value,
  async () => {
    // expand por defecto los días visibles
    const arr = visibleMovementDays.value || [];
    if (arr.length) {
      const set = new Set(expandedDays.value);
      for (const d of arr) set.add(d.dateKey);
      expandedDays.value = set;
    }

    // grafo
    await nextTick();
    await ensureGraph();
    applyGraphData();
  }
);

watch(() => graphSearch.value, () => { try { highlightGraphSearch(); } catch {} });

// -----------------
watch(
  () => analysisMode.value,
  () => {
    destroyCharts();
  }
);

onBeforeUnmount(() => {
  destroyCharts();
  try { mapView?.destroy(); } catch {}
  try { cy?.destroy(); } catch {}
  cy = null;
});

// init
loadRunMetaIfAny();
</script>

<style scoped>
.panel{
  background: var(--glass);
  border: 1px solid var(--stroke);
  border-radius: 16px;
  box-shadow: 0 22px 70px rgba(0,0,0,.35);
  backdrop-filter: blur(14px);
  padding: 14px;
  margin-top: 12px;
  position: relative;
}
.headRow{
  display:flex;
  align-items:flex-start;
  justify-content: space-between;
  gap: 10px;
}
.h2{ margin:0; font-size: 18px; font-weight: 900; }
.muted{ color: var(--muted); }
.small{ font-size: 12px; }
.tiny{ font-size: 11px; opacity:.9; }
.mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

.tabsRow{ margin-top: 10px; display:flex; gap: 8px; flex-wrap: wrap; }
button{
  border: 1px solid var(--stroke);
  background: rgba(255,255,255,.08);
  color: var(--text);
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
}
button:hover{ background: rgba(255,255,255,.12); }
button:disabled{ opacity:.55; cursor:not-allowed; }
.ghost{ background: rgba(255,255,255,.06); }
.ghost.active{
  border-color: rgba(34,211,238,.55);
  background: rgba(34,211,238,.12);
  font-weight: 900;
}
.primary{
  border-color: rgba(34,211,238,.55);
  background: linear-gradient(135deg, rgba(34,211,238,.22), rgba(96,165,250,.18));
  font-weight: 900;
}
.danger{
  border-color: rgba(251,113,133,.55);
  background: rgba(251,113,133,.12);
  font-weight: 900;
}

.card{
  margin-top: 12px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--stroke);
  background: rgba(255,255,255,.06);
}
.subCard{
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.04);
}
.cardHead{
  display:flex;
  align-items:flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.title{ font-weight: 900; }
.actions{ display:flex; gap: 8px; align-items:flex-end; flex-wrap: wrap; }

.warn{
  margin-top: 10px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(251,113,133,.25);
  background: rgba(251,113,133,.08);
}
.ok{
  margin-top: 10px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(34,211,238,.22);
  background: rgba(34,211,238,.06);
}
.error{
  margin-top: 10px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(251,113,133,.35);
  background: rgba(251,113,133,.10);
}

.grid{
  margin-top: 10px;
  display:grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 1100px){
  .grid{ grid-template-columns: 1fr; }
}

.grid2{
  margin-top: 10px;
  display:grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 1100px){
  .grid2{ grid-template-columns: 1fr; }
}

.groupGrid{
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (max-width: 1100px){
  .groupGrid{ grid-template-columns: 1fr; }
}

.field label{
  display:block;
  font-size: 12px;
  color: var(--muted);
  font-weight: 900;
  margin-bottom: 6px;
}
.field input, .field select{
  width: 100%;
  border: 1px solid var(--stroke);
  border-radius: 12px;
  padding: 10px 12px;
  outline: none;
  background: rgba(255,255,255,.06);
  color: var(--text);
}
.field input:focus, .field select:focus{
  border-color: rgba(34,211,238,.55);
  box-shadow: 0 0 0 4px rgba(34,211,238,.12);
}
.field.inline{ min-width: 260px; }

.rowInline{ display:flex; gap:8px; align-items:center; }
.num{ max-width: 170px; }

.kpi{
  border: 1px solid var(--stroke2);
  background: rgba(255,255,255,.04);
  border-radius: 14px;
  padding: 10px;
}
.kLabel{ font-size: 12px; color: var(--muted); }
.kVal{ font-size: 20px; font-weight: 900; margin-top: 4px; }
.kValSmall{ font-size: 12px; font-weight: 900; margin-top: 6px; line-height: 1.2; }

.tableWrap{
  margin-top: 10px;
  overflow:auto;
  border: 1px solid var(--stroke2);
  border-radius: 14px;
}
table{
  width: 100%;
  border-collapse: collapse;
  min-width: 900px;
}
th, td{
  padding: 10px 10px;
  border-bottom: 1px solid rgba(255,255,255,.06);
  text-align: left;
  font-size: 13px;
}
th{ color: var(--muted); font-weight: 900; }
.empty{
  text-align:center;
  padding: 18px 10px;
  color: var(--muted);
}

.rowClick{ cursor: pointer; }
.rowClick:hover{ background: rgba(255,255,255,.05); }

.charts2{
  margin-top: 12px;
  display:grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 1100px){
  .charts2{ grid-template-columns: 1fr; }
}

.charts3{
  margin-top: 12px;
  display:grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}
@media (max-width: 1200px){
  .charts3{ grid-template-columns: 1fr; }
}

.chartBox{
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.03);
  border-radius: 14px;
  padding: 10px;
  height: 220px;
}

.segRow{
  margin-top: 10px;
  display:flex;
  gap: 10px;
  flex-wrap: wrap;
}
.segBtn{
  flex: 1;
  min-width: 220px;
  border-radius: 14px;
  padding: 12px 14px;
  font-weight: 900;
  background: rgba(255,255,255,.06);
}
.segActive{
  border-color: rgba(34,211,238,.65);
  background: linear-gradient(135deg, rgba(34,211,238,.22), rgba(96,165,250,.18));
}

.mapWrap{
  margin-top: 10px;
  height: 420px;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.10);
}

/* Modal */
.modalOverlay{
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.55);
  display:flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 9999;
}
.modal{
  width: min(1100px, 96vw);
  max-height: 88vh;
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(18,20,24,.92);
  backdrop-filter: blur(10px);
  box-shadow: 0 30px 90px rgba(0,0,0,.5);
}
.modalHead{
  padding: 12px;
  display:flex;
  justify-content: space-between;
  align-items:flex-start;
  gap: 10px;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.modalBody{
  padding: 12px;
  overflow:auto;
  max-height: calc(88vh - 60px);
}


/* ======= Vista Inteligente ======= */
.smartGrid{
  display:grid;
  grid-template-columns: 320px 1fr 420px;
  gap: 12px;
  margin-top: 12px;
}
@media (max-width: 1200px){
  .smartGrid{ grid-template-columns: 1fr; }
}
.smartCard{ margin-top: 0; }
.pernoctaCard{
  background: linear-gradient(180deg, rgba(99,102,241,.18), rgba(34,211,238,.06));
  border-color: rgba(99,102,241,.25);
}
.pernoctaName{ font-size: 20px; font-weight: 950; margin-top: 6px; }
.pernoctaMeta{ display:flex; gap:8px; margin-top: 10px; flex-wrap:wrap; }
.pill{
  display:inline-flex;
  gap:6px;
  align-items:center;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.06);
  font-size: 12px;
}
.pillMoon{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: rgba(99,102,241,.22);
  border: 1px solid rgba(99,102,241,.35);
}

.inpDate{
  width: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(0,0,0,.15);
  color: inherit;
}

.heatWrap{ margin-top: 10px; overflow:auto; }
.heatHead, .heatRow{
  display:grid;
  grid-template-columns: 220px 1fr;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
}
.heatLeft{ min-width: 220px; }
.heatName{ font-weight: 900; }
.heatHours{
  display:grid;
  grid-template-columns: repeat(24, 18px);
  gap: 6px;
  min-width: calc(24 * 18px + 23 * 6px);
}
.heatHour{ text-align:center; }
.heatIcon{ font-size: 12px; line-height: 12px; margin-bottom: 2px; opacity: .95; }
.heatCell{
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.03);
}
.h0{ background: rgba(255,255,255,.03); }
.h1{ background: rgba(96,165,250,.18); }
.h2{ background: rgba(96,165,250,.32); }
.h3{ background: rgba(34,211,238,.38); }
.h4{ background: rgba(34,211,238,.58); border-color: rgba(34,211,238,.35); }

.heatLegend{ margin-top: 10px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dot{ width:10px; height:10px; border-radius: 50%; display:inline-block; }
.dotNight{ background: rgba(99,102,241,.75); }
.dotDay{ background: rgba(34,211,238,.75); }

.graphBox{
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 14px;
  background: rgba(0,0,0,.14);
  min-height: 360px;
  overflow:hidden;
}
.graphEl{ width: 100%; height: 360px; }
.miniDetail{ margin-top: 10px; }
.miniTitle{ font-weight: 900; margin-bottom: 6px; }

.tagIn{ color: rgba(34,197,94,1); font-weight: 900; }
.tagOut{ color: rgba(59,130,246,1); font-weight: 900; }

/* Cytoscape highlight */
:deep(.hl){ opacity: 1 !important; }
:deep(.dim){ opacity: .15 !important; }

/* ======= Timeline amigable ======= */
.dayBlock{ margin-top: 10px; }
.dayHead{
  display:flex;
  justify-content: space-between;
  align-items:center;
  margin: 8px 0;
}
.dayTitle{ font-weight: 950; }
.tinyBtn{ padding: 6px 10px; border-radius: 10px; font-size: 12px; }

.stopCard{
  display:grid;
  grid-template-columns: 44px 1fr;
  gap: 10px;
  padding: 10px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.04);
  margin-bottom: 10px;
}
.stopIcon{ display:flex; justify-content:center; }
.iconBubble{
  width: 34px; height: 34px;
  border-radius: 12px;
  display:flex; align-items:center; justify-content:center;
  border: 1px solid rgba(255,255,255,.14);
}
.iconBubble.day{ background: rgba(34,211,238,.12); border-color: rgba(34,211,238,.25); }
.iconBubble.night{ background: rgba(99,102,241,.16); border-color: rgba(99,102,241,.30); }

.stopTop{
  display:flex;
  justify-content: space-between;
  gap: 10px;
  align-items:flex-start;
}
.stopName{ font-weight: 950; }
.stopRight{ text-align:right; }
.stopDate{ font-weight: 900; }
.stopMeta{ display:flex; gap:8px; flex-wrap:wrap; margin-top: 6px; }
.stopBottom{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top: 8px; }
.stopDetail{ margin-top: 10px; }

</style>
