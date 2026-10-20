// ---------------------------------------------------------------------------
// app.js — Interfaz y flujo de la aplicación
// ---------------------------------------------------------------------------
import {
  AJUSTES_POR_DEFECTO, DIAS_SEMANA, MESES_ES, PASOS_FICHAJE, REGLAS_FICHAJE, calcular,
  calcularDia, diaPorDefecto, diasEnMes, horasDeFichaje, mesId, minutos, nombreMes, num,
  normalizarHora, porSemanas, redondear, redondearCuadricula, tipoPorDiaSemana
} from './calc.js';
import {
  abrirDB, borrarMes, borrarTodo, exportarTodo, guardarAjustes, guardarMes,
  importarTodo, marcarCopia, marcarSemilla, obtenerAjustes, obtenerMes,
  semillaHecha, ultimaCopia
} from './db.js';
import { diasSemillaJulio2026 } from './seed.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

/** Versión de la app. Se sube al publicarla una versión nueva. */
export const VERSION_APP = '1.6.0';

const estado = {
  mes: mesId(new Date()),
  dias: {},          // { 'YYYY-MM-DD': dia }
  ajustes: { ...AJUSTES_POR_DEFECTO },
  vista: 'mes',
  diaAbierto: null,
  guardarPendiente: null,
  recargando: false
};

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

const nfHoras = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const nfHoras4 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const nfEuros = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfEuros4 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const fmtHoras = (n, exactas = false) => (exactas ? nfHoras4 : nfHoras).format(redondear(n, exactas ? 4 : 2));
const fmtEuros = (n, exactas = false) => (exactas ? nfEuros4 : nfEuros).format(redondear(n, exactas ? 4 : 2));
const fmtEurosRedondos = (n) => nfEuros.format(redondear(n, 2));

/** Normaliza lo que escribe el usuario: "10", "10,5", "8:30" -> "10", "10,5", "8,5". */
function normalizarEntrada(texto) {
  const bruto = String(texto ?? '').trim();
  if (!bruto) return '';
  const valor = num(bruto);
  if (!Number.isFinite(valor)) return bruto;
  const limpio = redondear(valor, 4);
  return String(limpio).replace('.', ',');
}

// ---------------------------------------------------------------------------
// Fichaje
// ---------------------------------------------------------------------------

/** Aplica la regla de redondeo configurada a una hora de fichaje. */
function marcarFichaje(hora) {
  if (!hora) return '';
  return redondearCuadricula(
    hora,
    estado.ajustes.pasoFichaje || 15,
    estado.ajustes.reglaFichaje || 'abajo'
  );
}

/** Hora actual ya redondeada a la rejilla. */
function ahoraMarcado() {
  return marcarFichaje(ahora());
}

function ahora() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function iniciar() {
  // Hasta que la base de datos esté lista no se acepta ninguna pulsación,
  // para que no se pierda lo que el usuario toque al abrir la app.
  document.body.classList.add('cargando');

  try {
    estado.ajustes = await obtenerAjustes();
  } catch (e) {
    console.error('Ajustes:', e);
    estado.ajustes = { ...AJUSTES_POR_DEFECTO };
  }

  // Semilla: julio 2026 con los datos reales del Excel (solo la primera vez).
  try {
    if (!(await semillaHecha())) {
      const existente = await obtenerMes('2026-07');
      if (!existente) {
        await guardarMes('2026-07', diasSemillaJulio2026());
      }
      await marcarSemilla();
    }
  } catch (e) {
    console.error('Semilla:', e);
  }

  await cargarMes(estado.mes);

  conectarEventos();
  pintarTodo();
  registrarServiceWorker();
  mostrarInfoDispositivo();
  mostrarAvisoInstalacion();
  mostrarUltimaCopia();
  mostrarAvisoCopia();
  document.body.classList.remove('cargando');
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

async function cargarMes(id) {
  const registro = await obtenerMes(id);
  if (registro && registro.dias) {
    estado.dias = registro.dias;
    return true;
  }
  estado.dias = {};
  return false;
}

function diasDelMes() {
  const total = diasEnMes(estado.mes);
  const lista = [];
  for (let i = 1; i <= total; i++) {
    const fecha = `${estado.mes}-${String(i).padStart(2, '0')}`;
    const guardado = estado.dias[fecha];
    lista.push(guardado ? { ...guardado } : diaPorDefecto(fecha, estado.ajustes));
  }
  return lista;
}

function guardarMesActual(inmediato = false) {
  clearTimeout(estado.guardarPendiente);
  const escribir = () => {
    guardarMes(estado.mes, estado.dias).catch((e) => {
      console.error('No se pudo guardar:', e);
      avisar('No se ha podido guardar. Revisa el espacio del dispositivo.');
    });
  };
  if (inmediato) escribir();
  else estado.guardarPendiente = setTimeout(escribir, 400);
}

// ---------------------------------------------------------------------------
// Pintado
// ---------------------------------------------------------------------------

function pintarTodo() {
  $('#mes-etiqueta').textContent = nombreMes(estado.mes);
  $('#mes-input').value = estado.mes;
  $('#mes-aplicar').textContent = nombreMes(estado.mes);
  pintarResumenFijo();
  pintarListaDias();
  pintarResumen();
  pintarAjustes();
  pintarFichajeHoy();
}

/** Tarjeta de fichaje rápido: solo aparece si el mes visible es el actual. */
function pintarFichajeHoy() {
  const hoy = new Date();
  const idHoy = mesId(hoy);
  const card = $('#card-fichaje');
  if (idHoy !== estado.mes) { card.hidden = true; return; }
  card.hidden = false;

  const fechaISO = `${idHoy}-${String(hoy.getDate()).padStart(2, '0')}`;
  const dia = estado.dias[fechaISO] || diaPorDefecto(fechaISO, estado.ajustes);

  $('#fichaje-hoy-label').textContent =
    `Fichaje de hoy · ${DIAS_SEMANA[(hoy.getDay() + 6) % 7]} ${hoy.getDate()}`;
  $('#fichaje-regla').textContent =
    estado.ajustes.reglaFichaje === 'sin'
      ? 'sin redondeo'
      : `marcas de ${estado.ajustes.pasoFichaje} min · ${
          estado.ajustes.reglaFichaje === 'arriba' ? 'al siguiente'
          : estado.ajustes.reglaFichaje === 'cercano' ? 'al más cercano' : 'al anterior'}`;

  $('#hora-entrada').textContent = dia.entrada || '—';
  $('#hora-salida').textContent = dia.salida || '—';

  const horas = horasDeFichaje(dia.entrada, dia.salida, dia.descanso);
  const nota = $('#fichaje-nota');
  if (horas !== null) {
    nota.textContent = `Hoy: ${fmtHoras(horas)} h fichadas`;
  } else if (dia.entrada || dia.salida) {
    nota.textContent = 'Falta la entrada o la salida';
  } else {
    nota.textContent = `Ahora son las ${ahoraMarcado()}`;
  }
}

/** Escribe una marca (entrada/salida) en el día indicado. */
function ponerMarca(fechaISO, tipo, hora) {
  if (!estado.dias[fechaISO]) estado.dias[fechaISO] = diaPorDefecto(fechaISO, estado.ajustes);
  const dia = estado.dias[fechaISO];
  const marca = hora !== undefined ? hora : ahoraMarcado();
  dia[tipo] = marca;
  recalcularHorasDesdeFichaje(dia);
  guardarMesActual();
  pintarListaDias();
  pintarResumenFijo();
  pintarResumen();
  pintarFichajeHoy();
  return dia;
}

/** Recalcula las horas del día a partir del fichaje (brutas, sin descanso). */
function recalcularHorasDesdeFichaje(dia) {
  const horas = horasDeFichaje(dia.entrada, dia.salida);
  if (horas !== null && horas >= 0) dia.trabajadas = redondear(horas, 4);
  return dia;
}

function pintarResumenFijo() {
  const r = calcular(diasDelMes(), estado.ajustes);
  const t1 = estado.ajustes.tarifaExtras;
  const t2 = estado.ajustes.tarifaExtrasManuales;
  $('#t-total').textContent = fmtHoras(r.totalHoras);
  $('#t-extras').textContent = fmtHoras(r.horasExtraTotal);
  $('#t-bruto').textContent = fmtEurosRedondos(r.bruto);
  $('#t-neto').textContent = fmtEurosRedondos(r.neto);

  const partes = [];
  if (r.horasExtraAuto > 0) {
    partes.push(`${fmtHoras(r.horasExtraAuto)} h × ${fmtEurosRedondos(t1)} €/h = ${fmtEurosRedondos(r.eurosExtraAuto)} €`);
  }
  if (r.horasExtraFestivo > 0) {
    partes.push(`${fmtHoras(r.horasExtraFestivo)} h de festivos/domingos × ${fmtEurosRedondos(t2)} €/h = ${fmtEurosRedondos(r.eurosExtraFestivo)} €`);
  }
  if (r.diasVacaciones > 0) {
    partes.push(`${r.diasVacaciones} día(s) de vacaciones (sueldo fijo sin cambios)`);
  }
  $('#t-linea').textContent =
    (partes.length ? partes.join('  ·  ') : 'Sin horas extra este mes') +
    `  ·  IRPF ${fmtHoras(r.irpfPct, true)} % = −${fmtEurosRedondos(r.irpfEuros)} €`;
}

/** Texto del badge de extras de un día, con la tarifa a la que se pagan. */
function textoExtras(c) {
  if (c.totalExtras <= 0) return { texto: '—', clase: 'dia-extra sin' };
  const t1 = estado.ajustes.tarifaExtras;
  const t2 = estado.ajustes.tarifaExtrasManuales;
  if (c.extraFestivo > 0 && c.extraAuto > 0) {
    return {
      texto: `+${fmtHoras(c.totalExtras)}`,
      clase: 'dia-extra mixto',
      titulo: `${fmtHoras(c.extraAuto)} h a ${fmtEurosRedondos(t1)} €/h + ${fmtHoras(c.extraFestivo)} h a ${fmtEurosRedondos(t2)} €/h`
    };
  }
  if (c.extraFestivo > 0) {
    return {
      texto: `+${fmtHoras(c.extraFestivo)}`,
      clase: 'dia-extra man',
      titulo: `${fmtHoras(c.extraFestivo)} h a ${fmtEurosRedondos(t2)} €/h (festivo/domingo)`
    };
  }
  return {
    texto: `+${fmtHoras(c.extraAuto)}`,
    clase: 'dia-extra',
    titulo: `${fmtHoras(c.extraAuto)} h a ${fmtEurosRedondos(t1)} €/h`
  };
}

function pintarListaDias() {
  const lista = diasDelMes();
  const cont = $('#lista-dias');
  const frag = document.createDocumentFragment();

  for (const dia of lista) {
    const fecha = new Date(dia.fecha + 'T12:00:00');
    const dow = fecha.getDay();
    const finde = dow === 0 || dow === 6;
    const calculo = calcularDia(dia, estado.ajustes);
    const extras = textoExtras(calculo);

    const fila = document.createElement('div');
    fila.className = 'dia' + (calculo.trabajadas === 0 ? ' vacio' : '') +
      (finde ? ' finde' : '') + (calculo.vacaciones ? ' de-vacaciones' : '');
    fila.dataset.fecha = dia.fecha;

    const btnFecha = document.createElement('button');
    btnFecha.className = 'dia-fecha';
    btnFecha.type = 'button';
    const marcas = [dia.entrada, dia.salida].filter(Boolean).join('–');
    btnFecha.innerHTML =
      `<span class="dia-dow">${DIAS_SEMANA[(dow + 6) % 7]}</span>` +
      `<span class="dia-num">${String(fecha.getDate()).padStart(2, '0')}</span>` +
      (marcas ? `<span class="dia-fichaje">${marcas}</span>` : '');
    if (calculo.festivo && calculo.trabajadas > 0) {
      const etiqueta = document.createElement('span');
      etiqueta.className = 'dia-festivo';
      etiqueta.textContent = dia.tipo === 'festivo' ? 'FEST' : 'DOM';
      btnFecha.appendChild(etiqueta);
    }
    if (calculo.vacaciones) {
      const etiqueta = document.createElement('span');
      etiqueta.className = 'dia-vacaciones';
      etiqueta.textContent = 'VAC';
      btnFecha.appendChild(etiqueta);
    }
    btnFecha.addEventListener('click', () => abrirFicha(dia.fecha));

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inp-horas';
    input.inputMode = 'decimal';
    input.value = dia.trabajadas ? normalizarEntrada(dia.trabajadas) : '';
    input.placeholder = calculo.vacaciones ? 'vacaciones' : '0';
    input.disabled = calculo.vacaciones;
    input.setAttribute('aria-label', `Horas trabajadas el ${dia.fecha}`);
    input.dataset.fecha = dia.fecha;

    const extra = document.createElement('span');
    extra.className = extras.clase;
    extra.textContent = extras.texto;
    if (extras.titulo) extra.title = extras.titulo;

    const btnInfo = document.createElement('button');
    btnInfo.className = 'dia-info';
    btnInfo.type = 'button';
    btnInfo.innerHTML = '<span aria-hidden="true">›</span>';
    btnInfo.setAttribute('aria-label', `Detalles del ${dia.fecha}`);
    btnInfo.addEventListener('click', () => abrirFicha(dia.fecha));

    fila.append(btnFecha, input, extra, btnInfo);
    frag.appendChild(fila);
  }

  cont.replaceChildren(frag);
}

function pintarResumen() {
  const exactas = $('#chk-exactos').checked;
  const r = calcular(diasDelMes(), estado.ajustes);

  $('#r-total').textContent = `${fmtHoras(r.totalHoras, exactas)} h`;
  $('#r-total-e').textContent = '—';
  $('#r-descanso').textContent = `−${fmtHoras(r.horasDescanso, exactas)} h`;
  $('#r-efectivas').textContent = `${fmtHoras(r.horasEfectivas, exactas)} h`;
  $('#r-vacaciones').textContent = r.diasVacaciones > 0
    ? `${r.diasVacaciones} día(s)`
    : '—';
  $('#r-tarifa1').textContent = `(${fmtEurosRedondos(estado.ajustes.tarifaExtras)} €/h)`;
  $('#r-tarifa2').textContent = `(${fmtEurosRedondos(estado.ajustes.tarifaExtrasManuales)} €/h)`;
  $('#r-extras').textContent = `${fmtHoras(r.horasExtraAuto, exactas)} h`;
  $('#r-extras-e').textContent = fmtEuros(r.eurosExtraAuto, exactas);
  $('#r-festivos').textContent = `${fmtHoras(r.horasExtraFestivo, exactas)} h`;
  $('#r-festivos-e').textContent = fmtEuros(r.eurosExtraFestivo, exactas);
  $('#r-sueldo').textContent = fmtEuros(r.sueldoFijo, exactas);
  $('#r-bruto').textContent = fmtEuros(r.bruto, exactas);
  $('#r-irpf-pct').textContent = `(${fmtHoras(r.irpfPct, true)} %)`;
  $('#r-irpf').textContent = '−' + fmtEuros(r.irpfEuros, exactas);
  $('#r-neto').textContent = fmtEuros(r.neto, exactas);

  // Semanas
  const semanas = porSemanas(r.dias);
  $('#r-semanas').replaceChildren(...semanas.map((s) => {
    const tr = document.createElement('tr');
    const [y, m, d] = s.clave.split('-').map(Number);
    const nombre = `${d} ${MESES_ES[m - 1].slice(0, 3)}`;
    // Si la semana llega a 40 h de jornada, los sábados de esa semana son
    // todo extra (de ahí el umbral 0 del sábado).
    const completa = s.horas >= 40;
    if (completa) tr.className = 'semana-40';
    tr.innerHTML =
      `<th>${nombre}${completa ? ' <span class="etiqueta-40">40 h ✓</span>' : ''}</th>` +
      `<td>${fmtHoras(s.horas)}</td>` +
      `<td>${fmtHoras(s.extras + s.extrasFestivo)}</td>` +
      `<td class="hoja-euros">${fmtEuros(s.extras * estado.ajustes.tarifaExtras + s.extrasFestivo * estado.ajustes.tarifaExtrasManuales)}</td>`;
    return tr;
  }));

  // Días con más extras
  const top = [...r.dias].filter((d) => d.totalExtras > 0)
    .sort((a, b) => b.totalExtras - a.totalExtras)
    .slice(0, 8);
  $('#r-top').replaceChildren(...top.map((d) => {
    const tr = document.createElement('tr');
    const f = new Date(d.fecha + 'T12:00:00');
    const tarifa = d.extraFestivo > 0 ? estado.ajustes.tarifaExtrasManuales : estado.ajustes.tarifaExtras;
    tr.innerHTML =
      `<th>${DIAS_SEMANA[(f.getDay() + 6) % 7]} ${String(f.getDate()).padStart(2, '0')}</th>` +
      `<td>${fmtHoras(d.trabajadas)}</td>` +
      `<td class="hoja-euros">+${fmtHoras(d.totalExtras)}</td>` +
      `<td class="hoja-euros muted">${fmtEurosRedondos(tarifa)} €/h</td>`;
    return tr;
  }));
  if (!top.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<th colspan="3" class="muted">Sin horas extra registradas</th>';
    $('#r-top').replaceChildren(tr);
  }
}

function pintarAjustes() {
  $('#a-sueldo').value = normalizarEntrada(estado.ajustes.sueldoFijo);
  $('#a-tarifa').value = normalizarEntrada(estado.ajustes.tarifaExtras);
  $('#a-tarifa-manual').value = normalizarEntrada(estado.ajustes.tarifaExtrasManuales);
  $('#a-irpf').value = normalizarEntrada(estado.ajustes.irpf);
  $('#a-negativos').checked = !!estado.ajustes.permitirExtrasNegativos;
  $('#a-paso').value = String(estado.ajustes.pasoFichaje || 15);

  const selRegla = $('#a-regla');
  if (!selRegla.options.length) {
    for (const [clave, texto] of Object.entries(REGLAS_FICHAJE)) {
      const op = document.createElement('option');
      op.value = clave;
      op.textContent = texto;
      selRegla.appendChild(op);
    }
  }
  selRegla.value = estado.ajustes.reglaFichaje || 'arriba';

  const cuerpo = $('#a-tipos');
  cuerpo.replaceChildren(...Object.entries(estado.ajustes.tiposDia).map(([clave, conf]) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = conf.etiqueta || clave;
    const celda = (campo, valor) => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = normalizarEntrada(valor);
      input.dataset.tipo = clave;
      input.dataset.campo = campo;
      td.appendChild(input);
      return td;
    };
    tr.append(th, celda('base', conf.base), celda('umbral', conf.umbral), celda('descanso', conf.descanso || 0));
    return tr;
  }));
}

// ---------------------------------------------------------------------------
// Ficha de día
// ---------------------------------------------------------------------------

function abrirFicha(fecha) {
  estado.diaAbierto = fecha;
  const dia = estado.dias[fecha] || diaPorDefecto(fecha, estado.ajustes);
  const f = new Date(fecha + 'T12:00:00');

  $('#ficha-titulo').textContent =
    `${DIAS_SEMANA[(f.getDay() + 6) % 7]} ${f.getDate()} · ${MESES_ES[f.getMonth()]} ${f.getFullYear()}`;

  const tipos = $('#ficha-tipos');
  tipos.replaceChildren(...Object.entries(estado.ajustes.tiposDia).map(([clave, conf]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = conf.etiqueta || clave;
    b.dataset.tipo = clave;
    if (clave === dia.tipo) b.classList.add('activo');
    b.addEventListener('click', () => cambiarTipo(clave));
    return b;
  }));

  $('#ficha-horas').value = dia.trabajadas ? normalizarEntrada(dia.trabajadas) : '';
  $('#ficha-base').value = normalizarEntrada(dia.base);
  $('#ficha-umbral').value = normalizarEntrada(dia.umbral);
  $('#ficha-descanso').value = dia.descanso ? normalizarEntrada(dia.descanso) : '';
  $('#ficha-entrada').value = dia.entrada || '';
  $('#ficha-salida').value = dia.salida || '';
  $('#ficha-nota').value = dia.nota || '';

  actualizarEstadoVacaciones();
  actualizarExtraFicha();
  $('#ficha').hidden = false;
  $('#ficha-fondo').hidden = false;
}

function cerrarFicha() {
  $('#ficha').hidden = true;
  $('#ficha-fondo').hidden = true;
  estado.diaAbierto = null;
}

function diaEnCurso() {
  const fecha = estado.diaAbierto;
  if (!fecha) return null;
  if (!estado.dias[fecha]) estado.dias[fecha] = diaPorDefecto(fecha, estado.ajustes);
  return estado.dias[fecha];
}

function cambiarTipo(tipo) {
  const dia = diaEnCurso();
  if (!dia) return;
  const conf = estado.ajustes.tiposDia[tipo];
  dia.tipo = tipo;
  if (conf) {
    dia.base = conf.base;
    dia.umbral = conf.umbral;
    dia.descanso = conf.descanso !== undefined ? conf.descanso : 0;
    dia.baseManual = false;
    dia.umbralManual = false;
    dia.descansoManual = false;
  }
  if (tipo === 'vacaciones') {
    // De vacaciones no se trabaja: se limpian las horas y las marcas.
    dia.trabajadas = 0;
    dia.entrada = '';
    dia.salida = '';
    dia.descanso = 0;
  }
  $('#ficha-horas').value = dia.trabajadas ? normalizarEntrada(dia.trabajadas) : '';
  $('#ficha-base').value = normalizarEntrada(dia.base);
  $('#ficha-umbral').value = normalizarEntrada(dia.umbral);
  $('#ficha-descanso').value = normalizarEntrada(dia.descanso);
  $('#ficha-entrada').value = dia.entrada || '';
  $('#ficha-salida').value = dia.salida || '';
  $$('#ficha-tipos button').forEach((b) => b.classList.toggle('activo', b.dataset.tipo === tipo));
  actualizarEstadoVacaciones();
  actualizarExtraFicha();
  guardarMesActual();
  pintarListaDias();
  pintarResumenFijo();
  pintarFichajeHoy();
}

/** Al marcar un día como vacaciones se bloquean las horas y el fichaje. */
function actualizarEstadoVacaciones() {
  const dia = diaEnCurso();
  if (!dia) return;
  const vacaciones = dia.tipo === 'vacaciones';
  $('#ficha-horas').disabled = vacaciones;
  $('#ficha-entrada').disabled = vacaciones;
  $('#ficha-salida').disabled = vacaciones;
  $('#ficha-descanso').disabled = vacaciones;
  const aviso = $('#ficha-vacaciones');
  aviso.hidden = !vacaciones;
}

function actualizarExtraFicha() {
  const dia = diaEnCurso();
  if (!dia) return;
  const c = calcularDia(dia, estado.ajustes);
  const t1 = estado.ajustes.tarifaExtras;
  const t2 = estado.ajustes.tarifaExtrasManuales;

  // Desglose de las horas extra del día, con su tarifa.
  const lineas = [];
  if (c.descanso > 0) {
    lineas.push(`${fmtHoras(c.trabajadas)} h − ${fmtHoras(c.descanso)} h de descanso = ${fmtHoras(c.netas)} h`);
  }
  if (c.extraAuto > 0) {
    lineas.push(`${fmtHoras(c.netas)} h − ${fmtHoras(c.umbral)} h de umbral = ${fmtHoras(c.extraAuto)} h a ${fmtEurosRedondos(t1)} €/h = ${fmtEurosRedondos(c.extraAuto * t1)} €`);
  }
  if (c.extraFestivo > 0) {
    lineas.push(`${fmtHoras(c.extraFestivo)} h a ${fmtEurosRedondos(t2)} €/h (${c.tipo === 'festivo' ? 'festivo' : 'domingo'}) = ${fmtEurosRedondos(c.extraFestivo * t2)} €`);
  }
  if (!lineas.length && c.trabajadas > 0) {
    lineas.push(`${fmtHoras(c.netas)} h sin horas extra`);
  }
  $('#ficha-extra').textContent = c.totalExtras > 0
    ? `+${fmtHoras(c.totalExtras)} h · ${fmtEurosRedondos(c.extraAuto * t1 + c.extraFestivo * t2)} €`
    : '0 h';
  $('#ficha-extra-detalle').textContent = lineas.join('  ·  ');

  // Explica la regla de redondeo que se está aplicando, con ejemplos.
  const paso = estado.ajustes.pasoFichaje || 15;
  const regla = estado.ajustes.reglaFichaje || 'abajo';
  const ejemplo = (m) => redondearCuadricula(`18:${String(m).padStart(2, '0')}`, paso, regla);
  const textos = {
    abajo: `18:07 → ${ejemplo(7)} · 18:22 → ${ejemplo(22)} · 18:44 → ${ejemplo(44)} · 18:58 → ${ejemplo(58)}`,
    arriba: `18:07 → ${ejemplo(7)} · 18:22 → ${ejemplo(22)} · 18:44 → ${ejemplo(44)} · 18:58 → ${ejemplo(58)}`,
    cercano: `18:07 → ${ejemplo(7)} · 18:22 → ${ejemplo(22)} · 18:44 → ${ejemplo(44)} · 18:58 → ${ejemplo(58)}`,
    sin: 'Las marcas se guardan tal cual.'
  };
  $('#ficha-regla').textContent = textos[regla] || textos.abajo;

  // Aviso si las horas escritas no cuadran con el fichaje.
  const aviso = $('#ficha-descuadre');
  if (c.horasFichaje !== null && c.descuadre) {
    aviso.hidden = false;
    aviso.classList.add('alerta');
    aviso.textContent =
      `Ojo: el fichaje (${c.entrada}–${c.salida}) son ${fmtHoras(c.horasFichaje)} h, ` +
      `pero has puesto ${fmtHoras(c.trabajadas)} h.`;
  } else if (c.horasFichaje !== null) {
    aviso.hidden = false;
    aviso.classList.remove('alerta');
    aviso.textContent = `Fichaje ${c.entrada}–${c.salida} = ${fmtHoras(c.horasFichaje)} h`;
  } else {
    aviso.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function conectarEventos() {
  // --- Navegación de mes
  $('#mes-anterior').addEventListener('click', () => cambiarMes(-1));
  $('#mes-siguiente').addEventListener('click', () => cambiarMes(1));
  $('#mes-input').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    const [y, m] = v.split('-').map(Number);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      e.target.value = estado.mes;
      return;
    }
    if (v !== estado.mes) irAMes(v);
  });

  // --- Pestañas
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => cambiarVista(tab.dataset.vista));
  });

  // --- Entrada de horas en la lista
  const lista = $('#lista-dias');
  lista.addEventListener('input', (e) => {
    const input = e.target.closest('.inp-horas');
    if (!input) return;
    const fecha = input.dataset.fecha;
    if (!estado.dias[fecha]) estado.dias[fecha] = diaPorDefecto(fecha, estado.ajustes);
    estado.dias[fecha].trabajadas = num(input.value);
    const fila = input.closest('.dia');
    const c = calcularDia(estado.dias[fecha], estado.ajustes);
    const badge = fila.querySelector('.dia-extra');
    const extras = textoExtras(c);
    badge.className = extras.clase;
    badge.textContent = extras.texto;
    if (extras.titulo) badge.title = extras.titulo;
    fila.classList.toggle('vacio', c.trabajadas === 0);
    pintarResumenFijo();
    guardarMesActual();
  });

  lista.addEventListener('focusout', (e) => {
    const input = e.target.closest('.inp-horas');
    if (!input) return;
    input.value = normalizarEntrada(input.value);
    pintarResumenFijo();
    guardarMesActual();
  });

  // --- Ficha
  $('#ficha-cerrar').addEventListener('click', cerrarFicha);
  $('#ficha-fondo').addEventListener('click', cerrarFicha);

  // --- Ficha: fichajes
  const aplicarMarca = (sel, tipo) => {
    const dia = diaEnCurso();
    if (!dia) return;
    const input = $(sel);
    const bruto = input.value;
    // Si el navegador ha rechazado lo tecleado, se conserva la marca anterior.
    if (!bruto && input.validity && input.validity.badInput) return;
    if (!bruto) {
      dia[tipo] = '';
    } else {
      const marca = marcarFichaje(bruto);
      dia[tipo] = marca;
      input.value = marca;
    }
    recalcularHorasDesdeFichaje(dia);
    $('#ficha-horas').value = dia.trabajadas ? normalizarEntrada(dia.trabajadas) : '';
    actualizarExtraFicha();
    pintarListaDias(); pintarResumenFijo(); pintarResumen(); pintarFichajeHoy();
    guardarMesActual();
  };

  $('#ficha-entrada').addEventListener('change', () => aplicarMarca('#ficha-entrada', 'entrada'));
  $('#ficha-salida').addEventListener('change', () => aplicarMarca('#ficha-salida', 'salida'));
  $('#ficha-entrada').addEventListener('blur', () => aplicarMarca('#ficha-entrada', 'entrada'));
  $('#ficha-salida').addEventListener('blur', () => aplicarMarca('#ficha-salida', 'salida'));

  $('#btn-ahora-entrada').addEventListener('click', () => {
    const dia = diaEnCurso(); if (!dia) return;
    dia.entrada = ahoraMarcado();
    $('#ficha-entrada').value = dia.entrada;
    recalcularHorasDesdeFichaje(dia);
    $('#ficha-horas').value = dia.trabajadas ? normalizarEntrada(dia.trabajadas) : '';
    actualizarExtraFicha(); pintarListaDias(); pintarResumenFijo(); pintarResumen(); pintarFichajeHoy();
    guardarMesActual();
  });

  $('#btn-ahora-salida').addEventListener('click', () => {
    const dia = diaEnCurso(); if (!dia) return;
    dia.salida = ahoraMarcado();
    $('#ficha-salida').value = dia.salida;
    recalcularHorasDesdeFichaje(dia);
    $('#ficha-horas').value = dia.trabajadas ? normalizarEntrada(dia.trabajadas) : '';
    actualizarExtraFicha(); pintarListaDias(); pintarResumenFijo(); pintarResumen(); pintarFichajeHoy();
    guardarMesActual();
  });

  $('#ficha-descanso').addEventListener('input', (e) => {
    const dia = diaEnCurso(); if (!dia) return;
    dia.descanso = num(e.target.value);
    dia.descansoManual = true;
    actualizarExtraFicha(); pintarResumenFijo(); pintarFichajeHoy();
    guardarMesActual();
  });

  // --- Ficha: horas trabajadas
  $('#ficha-horas').addEventListener('input', (e) => {
    const dia = diaEnCurso(); if (!dia) return;
    dia.trabajadas = num(e.target.value);
    actualizarExtraFicha(); pintarResumenFijo(); pintarFichajeHoy(); guardarMesActual();
  });

  $('#ficha-base').addEventListener('input', (e) => {
    const dia = diaEnCurso(); if (!dia) return;
    dia.base = num(e.target.value);
    dia.baseManual = true;
    actualizarExtraFicha(); pintarResumenFijo(); guardarMesActual();
  });
  $('#ficha-umbral').addEventListener('input', (e) => {
    const dia = diaEnCurso(); if (!dia) return;
    dia.umbral = num(e.target.value);
    dia.umbralManual = true;
    actualizarExtraFicha(); pintarResumenFijo(); guardarMesActual();
  });
  $('#ficha-nota').addEventListener('input', (e) => {
    const dia = diaEnCurso(); if (!dia) return;
    dia.nota = e.target.value;
    guardarMesActual();
  });

  ['#ficha-horas', '#ficha-base', '#ficha-umbral', '#ficha-descanso'].forEach((sel) => {
    $(sel).addEventListener('focusout', (e) => { e.target.value = normalizarEntrada(e.target.value); });
  });

  // --- Resumen
  $('#chk-exactos').addEventListener('change', pintarResumen);

  // --- Ajustes
  const ajustesCampos = [
    ['#a-sueldo', 'sueldoFijo'], ['#a-tarifa', 'tarifaExtras'],
    ['#a-tarifa-manual', 'tarifaExtrasManuales'], ['#a-irpf', 'irpf']
  ];
  for (const [sel, clave] of ajustesCampos) {
    $(sel).addEventListener('input', (e) => {
      estado.ajustes[clave] = num(e.target.value);
      guardarAjustes(estado.ajustes);
      pintarResumenFijo(); pintarResumen();
    });
    $(sel).addEventListener('focusout', (e) => {
      e.target.value = normalizarEntrada(e.target.value);
      estado.ajustes[clave] = num(e.target.value);
      guardarAjustes(estado.ajustes);
      pintarResumenFijo(); pintarResumen();
    });
  }

  $('#a-negativos').addEventListener('change', (e) => {
    estado.ajustes.permitirExtrasNegativos = e.target.checked;
    guardarAjustes(estado.ajustes);
    pintarResumenFijo(); pintarResumen(); pintarListaDias();
  });

  // --- Ajustes de fichaje
  $('#a-paso').addEventListener('change', (e) => {
    const paso = Math.max(1, Math.min(120, Math.round(num(e.target.value)) || 15));
    estado.ajustes.pasoFichaje = paso;
    e.target.value = String(paso);
    guardarAjustes(estado.ajustes);
    pintarFichajeHoy();
    avisar(`Marcas cada ${paso} minutos`);
  });

  $('#a-regla').addEventListener('change', (e) => {
    estado.ajustes.reglaFichaje = e.target.value;
    guardarAjustes(estado.ajustes);
    pintarFichajeHoy();
    avisar('Regla de redondeo guardada');
  });

  $('#a-tipos').addEventListener('input', (e) => {
    const input = e.target.closest('input[data-tipo]');
    if (!input) return;
    const conf = estado.ajustes.tiposDia[input.dataset.tipo];
    if (!conf) return;
    conf[input.dataset.campo] = num(input.value);
    guardarAjustes(estado.ajustes);
    pintarResumenFijo(); pintarResumen();
  });

  $('#btn-aplicar-tipos').addEventListener('click', aplicarTiposAlMes);

  // --- Acciones
  $('#btn-rellenar').addEventListener('click', rellenarMes);
  $('#btn-rellenar-horas').addEventListener('click', rellenarHorasVacias);
  $('#btn-borrar-mes').addEventListener('click', borrarMesActual);
  $('#btn-exportar').addEventListener('click', exportarCopia);
  $('#btn-importar').addEventListener('click', () => $('#input-importar').click());
  $('#input-importar').addEventListener('change', importarCopia);
  $('#btn-csv').addEventListener('click', exportarCSV);
  $('#btn-borrar-todo').addEventListener('click', borrarTodoElDispositivo);

  // --- Estado de la instalación
  mostrarEstadoInstalacion();

  // --- Actualizaciones
  $('#btn-actualizar').addEventListener('click', buscarActualizaciones);

  // --- Recordatorio de copia de seguridad
  $('#btn-copia-ya').addEventListener('click', exportarCopia);

  // --- Ficha: copiar horas
  $('#btn-copiar-anterior').addEventListener('click', copiarDiaAnterior);
  $('#btn-copiar-dia').addEventListener('click', copiarAMeses);

  // --- Fichaje rápido de hoy
  $('#btn-entrada-hoy').addEventListener('click', () => {
    const dia = ponerMarca(fechaDeHoy(), 'entrada');
    avisar(`Entrada: ${dia.entrada}`);
  });
  $('#btn-salida-hoy').addEventListener('click', () => {
    const dia = ponerMarca(fechaDeHoy(), 'salida');
    avisar(`Salida: ${dia.salida}`);
  });
}

/** Fecha de hoy en formato "YYYY-MM-DD". */
function fechaDeHoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function cambiarMes(delta) {
  const [y, m] = estado.mes.split('-').map(Number);
  const fecha = new Date(y, m - 1 + delta, 1);
  await irAMes(mesId(fecha));
}

async function irAMes(id) {
  if (id === estado.mes) return;
  guardarMesActual(true);
  estado.mes = id;
  await cargarMes(id);
  pintarTodo();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cambiarVista(vista) {
  estado.vista = vista;
  $$('.tab').forEach((t) => t.classList.toggle('activa', t.dataset.vista === vista));
  $('#vista-mes').hidden = vista !== 'mes';
  $('#vista-resumen').hidden = vista !== 'resumen';
  $('#vista-ajustes').hidden = vista !== 'ajustes';
  if (vista === 'resumen') pintarResumen();
  if (vista === 'ajustes') pintarAjustes();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

/** Fuerza la jornada base, el umbral y el descanso de todos los días según su tipo. */
function rellenarMes() {
  if (!confirm(`¿Restablecer la jornada base, el umbral y el descanso de todos los días de ${nombreMes(estado.mes)} según su tipo de día?\n\nNo se tocan las horas que has escrito.`)) return;
  const dias = diasDelMes();
  for (const dia of dias) {
    const conf = estado.ajustes.tiposDia[dia.tipo] || estado.ajustes.tiposDia.laborable;
    dia.base = conf.base;
    dia.umbral = conf.umbral;
    dia.descanso = conf.descanso !== undefined ? conf.descanso : 0;
    dia.baseManual = false;
    dia.umbralManual = false;
    dia.descansoManual = false;
  }
  estado.dias = Object.fromEntries(dias.map((d) => [d.fecha, d]));
  guardarMesActual(true);
  pintarListaDias(); pintarResumenFijo(); pintarResumen();
  avisar('Base, umbral y descanso restaurados en todo el mes');
}

/** Rellena con las mismas horas los días que todavía no tienen nada. */
function rellenarHorasVacias() {
  const respuesta = prompt('¿Cuántas horas poner en los días vacíos?', '10');
  if (respuesta === null) return;
  const horas = num(respuesta);
  if (!horas) { avisar('No se ha introducido ninguna cantidad'); return; }
  const dias = diasDelMes();
  let n = 0;
  for (const dia of dias) {
    if (dia.tipo === 'domingo' || dia.tipo === 'vacaciones') continue;
    if (dia.trabajadas === 0) { dia.trabajadas = horas; n++; }
  }
  estado.dias = Object.fromEntries(dias.map((d) => [d.fecha, d]));
  guardarMesActual(true);
  pintarListaDias(); pintarResumenFijo(); pintarResumen();
  avisar(n ? `${n} días con ${fmtHoras(horas)} h` : 'No había días vacíos');
}

/** Copia las horas del día anterior (solo horas, no base ni umbral). */
function copiarDiaAnterior() {
  const dia = diaEnCurso();
  if (!dia) return;
  const anterior = new Date(dia.fecha + 'T12:00:00');
  anterior.setDate(anterior.getDate() - 1);
  const fechaAnterior = `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, '0')}-${String(anterior.getDate()).padStart(2, '0')}`;
  const previo = estado.dias[fechaAnterior];
  if (!previo || !previo.trabajadas) { avisar('El día anterior no tiene horas'); return; }
  dia.trabajadas = previo.trabajadas;
  $('#ficha-horas').value = normalizarEntrada(dia.trabajadas);
  actualizarExtraFicha();
  pintarListaDias(); pintarResumenFijo();
  guardarMesActual(true);
  avisar(`Copiado: ${fmtHoras(previo.trabajadas)} h`);
}

/** Copia las horas de este día a todos los días vacíos del mes. */
function copiarAMeses() {
  const dia = diaEnCurso();
  if (!dia) return;
  if (!dia.trabajadas) { avisar('Este día no tiene horas que copiar'); return; }
  if (!confirm(`¿Poner ${fmtHoras(dia.trabajadas)} h en todos los días que estén vacíos de ${nombreMes(estado.mes)}?`)) return;
  const dias = diasDelMes();
  let n = 0;
  for (const d of dias) {
    if (d.tipo === 'domingo' || d.tipo === 'vacaciones') continue;
    if (d.trabajadas === 0) { d.trabajadas = dia.trabajadas; n++; }
  }
  estado.dias = Object.fromEntries(dias.map((d) => [d.fecha, d]));
  guardarMesActual(true);
  pintarListaDias(); pintarResumenFijo(); pintarResumen();
  avisar(n ? `${n} días actualizados` : 'No había días vacíos');
}

function aplicarTiposAlMes() {
  const dias = diasDelMes();
  let cambios = 0;
  for (const dia of dias) {
    const conf = estado.ajustes.tiposDia[dia.tipo] || estado.ajustes.tiposDia.laborable;
    const descansoTipo = conf.descanso !== undefined ? conf.descanso : 0;
    if (!dia.baseManual && dia.base !== conf.base) { dia.base = conf.base; cambios++; }
    if (!dia.umbralManual && dia.umbral !== conf.umbral) { dia.umbral = conf.umbral; cambios++; }
    if (!dia.descansoManual && dia.descanso !== descansoTipo) { dia.descanso = descansoTipo; cambios++; }
  }
  estado.dias = Object.fromEntries(dias.map((d) => [d.fecha, d]));
  guardarMesActual(true);
  pintarListaDias(); pintarResumenFijo(); pintarResumen();
  avisar(cambios ? `${cambios} valores actualizados` : 'No había nada que actualizar');
}

async function borrarMesActual() {
  if (!confirm(`¿Vaciar los datos de ${nombreMes(estado.mes)}?`)) return;
  estado.dias = {};
  await borrarMes(estado.mes);
  pintarTodo();
  avisar('Mes vaciado');
}

function descargar(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportarCopia() {
  const copia = await exportarTodo();
  const contenido = JSON.stringify(copia, null, 2);
  const nombre = `control-horas-copia-${new Date().toISOString().slice(0, 10)}.json`;
  await marcarCopia();
  mostrarUltimaCopia();
  mostrarAvisoCopia();
  // En el iPhone lo mejor es el menú de compartir nativo: ahí aparecen
  // Google Drive, Archivos, iCloud, WhatsApp, correo...
  if (navigator.canShare && navigator.canShare({ files: [new File([contenido], nombre, { type: 'application/json' })] })) {
    try {
      await navigator.share({
        files: [new File([contenido], nombre, { type: 'application/json' })],
        title: 'Copia de seguridad de Horas'
      });
      avisar('Copia compartida');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // el usuario lo canceló
      console.warn('Compartir falló, se descarga:', e);
    }
  }
  descargar(nombre, contenido, 'application/json');
  avisar('Copia descargada');
}

async function mostrarUltimaCopia() {
  const el = $('#info-copia');
  if (!el) return;
  const fecha = await ultimaCopia();
  if (!fecha) {
    el.textContent = 'Todavía no has hecho ninguna copia.';
    el.classList.remove('si');
    return;
  }
  const d = new Date(fecha);
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  el.textContent = dias === 0
    ? `Última copia: hoy a las ${d.toTimeString().slice(0, 5)}`
    : `Última copia: hace ${dias} ${dias === 1 ? 'día' : 'días'} (${d.toLocaleDateString('es-ES')})`;
  el.classList.toggle('si', dias < 15);
}

/**
 * Recordatorio: si hace mucho que no se hace una copia, se avisa en la
 * pantalla principal (los datos solo están en el móvil).
 */
async function mostrarAvisoCopia() {
  const banner = $('#recordatorio');
  if (!banner) return;
  const fecha = await ultimaCopia();
  const dias = fecha ? Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000) : null;
  if (dias !== null && dias < 15) { banner.hidden = true; return; }
  banner.hidden = false;
  $('#recordatorio-texto').textContent = dias === null
    ? 'Todavía no has guardado ninguna copia de seguridad.'
    : `Llevas ${dias} días sin guardar una copia de seguridad.`;
}

async function importarCopia(evento) {
  const archivo = evento.target.files && evento.target.files[0];
  evento.target.value = '';
  if (!archivo) return;
  try {
    const texto = await archivo.text();
    const copia = JSON.parse(texto);
    if (!copia || !Array.isArray(copia.meses)) throw new Error('formato');
    const n = await importarTodo(copia);
    estado.ajustes = await obtenerAjustes();
    await cargarMes(estado.mes);
    pintarTodo();
    await mostrarUltimaCopia();
    await mostrarAvisoCopia();
    avisar(`${n} mes(es) restaurados`);
  } catch (e) {
    console.error(e);
    avisar('Ese archivo no es una copia de la app');
  }
}

function exportarCSV() {
  const r = calcular(diasDelMes(), estado.ajustes);
  const filas = ['Fecha;Dia;Tipo;Jornada base;Horas trabajadas;Umbral;Extra 9,45;Extra 10,74;Euros extras;Nota'];
  for (const d of r.dias) {
    const f = new Date(d.fecha + 'T12:00:00');
    filas.push([
      d.fecha,
      DIAS_SEMANA[(f.getDay() + 6) % 7],
      (estado.ajustes.tiposDia[d.tipo] || {}).etiqueta || d.tipo,
      normalizarEntrada(d.base).replace(',', '.'),
      normalizarEntrada(d.trabajadas).replace(',', '.'),
      normalizarEntrada(d.umbral).replace(',', '.'),
      normalizarEntrada(d.extraAuto).replace(',', '.'),
      normalizarEntrada(d.extraFestivo).replace(',', '.'),
      redondear(d.extraAuto * estado.ajustes.tarifaExtras + d.extraFestivo * estado.ajustes.tarifaExtrasManuales, 4).toFixed(4).replace('.', ','),
      `"${(d.nota || '').replace(/"/g, '""')}"`
    ].join(';'));
  }
  filas.push('');
  filas.push(`;;TOTAL HORAS;;;${redondear(r.totalHoras, 4)};;;;`);
  filas.push(`;;TOTAL EXTRA 9,45;;;${redondear(r.horasExtraAuto, 4)};;;;`);
  filas.push(`;;TOTAL EXTRA 10,74 (FESTIVOS Y DOMINGOS);;;${redondear(r.horasExtraFestivo, 4)};;;;`);
  filas.push(`;;;;;;BRUTO;;;;${redondear(r.bruto, 4)}`);
  filas.push(`;;;;;;NETO;;;;${redondear(r.neto, 4)}`);
  descargar(`horas-${estado.mes}.csv`, '﻿' + filas.join('\n'), 'text/csv;charset=utf-8');
  avisar('CSV descargado');
}

async function borrarTodoElDispositivo() {
  if (!confirm('Se borrarán TODOS los meses y ajustes de este dispositivo. ¿Continuar?')) return;
  await borrarTodo();
  estado.dias = {};
  estado.ajustes = { ...AJUSTES_POR_DEFECTO };
  pintarTodo();
  avisar('Datos borrados');
}

async function mostrarInfoDispositivo() {
  const el = $('#info-dispositivo');
  let extra = '';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (est.usage !== undefined) {
        extra = `Espacio usado: ${(est.usage / 1048576).toFixed(2)} MB de ${(est.quota / 1073741824).toFixed(1)} GB disponibles.`;
      }
    }
  } catch { /* sin datos de espacio */ }
  try {
    const db = await abrirDB();
    el.textContent = `Base de datos local "${db.name}" · v${db.version}. ${extra} Los datos no salen de este dispositivo.`;
  } catch {
    el.textContent = `Base de datos local. ${extra} Los datos no salen de este dispositivo.`;
  }
}

/** Estado de la instalación: https, modo sin conexión, standalone y espacio. */
async function mostrarEstadoInstalacion() {
  const ok = (v) => { const el = $(v); if (el) { el.textContent = 'Sí'; el.className = 'si'; } };
  const no = (v) => { const el = $(v); if (el) { el.textContent = 'No'; el.className = 'no'; } };

  if (window.isSecureContext) ok('#st-seguro'); else no('#st-seguro');

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && reg.active) ok('#st-sw'); else no('#st-sw');
  } catch { no('#st-sw'); }

  const standalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (standalone) ok('#st-standalone'); else no('#st-standalone');

  try {
    const est = await navigator.storage.estimate();
    const el = $('#st-espacio');
    if (el && est.usage !== undefined) el.textContent = `${(est.usage / 1024).toFixed(0)} KB`;
  } catch { /* sin datos */ }

  const v = $('#st-version');
  if (v) v.textContent = VERSION_APP;
  const c = $('#st-comprobacion');
  if (c) c.textContent = 'Al abrir la app';
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

let temporizadorAviso = null;
function avisar(texto) {
  const el = $('#aviso');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.hidden = true; }, 2600);
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  // Si la pagina ya estaba controlada, es una actualizacion real y hay que
  // recargar. En la primera visita no, para no recargar sin motivo.
  const controladoAlAbrir = !!navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then(() => {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!controladoAlAbrir || estado.recargando) return;
        estado.recargando = true;
        avisar('Hay una version nueva. Recargando…');
        setTimeout(() => location.reload(), 900);
      });
    })
    .catch((e) => console.warn('SW:', e));
}

/**
 * Busca una version nueva de la app y la activa.
 * Los datos no se tocan: viven en IndexedDB, aparte de los archivos.
 */
async function buscarActualizaciones() {
  if (!('serviceWorker' in navigator)) {
    avisar('Este navegador no admite actualizaciones automaticas');
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    avisar('La app aun no esta preparada para actualizarse sola');
    return;
  }
  if (!navigator.onLine) {
    avisar('Sin conexion: se usara la version guardada');
    return;
  }
  try {
    await reg.update();
  } catch (e) {
    avisar('No se ha podido comprobar si hay novedades');
    return;
  }
  const hayNueva = await esperarVersionNueva(reg, 4000);
  const c = $('#st-comprobacion');
  if (c) c.textContent = new Date().toTimeString().slice(0, 5);
  if (hayNueva) {
    avisar('Version nueva instalada. Recargando…');
    setTimeout(() => location.reload(), 800);
  } else {
    avisar('Estás al día (version ' + VERSION_APP + ')');
  }
}

/** Espera a que se instale un service worker nuevo (si lo hay). */
function esperarVersionNueva(reg, ms) {
  return new Promise((resolver) => {
    let terminado = false;
    const fin = (valor) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      resolver(valor);
    };
    const temporizador = setTimeout(() => fin(false), ms);

    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      fin(true);
      return;
    }
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      if (!nuevo) return;
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
          nuevo.postMessage({ type: 'SKIP_WAITING' });
          fin(true);
        }
      });
    });
  });
}

/**
 * En iOS, abierto desde Safari (no como app instalada), se muestra un aviso
 * explicando cómo instalarla. En modo standalone no aparece.
 */
function mostrarAvisoInstalacion() {
  const banner = $('#instalar');
  if (!banner) return;
  const instalado = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
  const esSeguro = window.isSecureContext;
  let cerrar = null;
  try { cerrar = localStorage.getItem('aviso-instalacion-cerrado'); } catch { /* sin storage */ }
  if (instalado || !esIOS || cerrar === '1') { banner.hidden = true; return; }
  banner.hidden = false;
  if (!esSeguro) {
    banner.querySelector('.instalar-texto span').textContent =
      'Abre la app con una dirección https:// para poder instalarla en la pantalla de inicio.';
  }
  $('#instalar-cerrar').addEventListener('click', () => {
    banner.hidden = true;
    try { localStorage.setItem('aviso-instalacion-cerrado', '1'); } catch { /* sin storage */ }
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#ficha').hidden) cerrarFicha();
});

iniciar().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('afterbegin',
    '<p style="padding:20px;color:#d92d20">No se ha podido iniciar la aplicación: ' + e.message + '</p>');
});
