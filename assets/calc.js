// ---------------------------------------------------------------------------
// calc.js — Replica exacta de las fórmulas de "Horas 2026.xlsx"
// ---------------------------------------------------------------------------
// Excel:  A=fecha | B=jornada base | C=horas totales | D=C-B (trabajadas)
//         E=D-umbral (horas extra auto) | F=extras manuales
//         C2=SUM(D)  C3=SUM(E)  C4=SUM(F)
//         E3=C3*tarifa*24   F4=C4*tarifa2*24   C6=SUM(F3:F4)
//         E6=sueldo_fijo+C6   D40=E6*IRPF   F40=E6-D40
// Todos los cálculos se hacen en HORAS DECIMALES (no fracciones de día), por
// lo que el resultado es idéntico sin el ruido de coma flotante de Excel.
// ---------------------------------------------------------------------------

export const AJUSTES_POR_DEFECTO = Object.freeze({
  version: 3,
  sueldoFijo: 1655.7,
  tarifaExtras: 9.45,              // €/h de las horas extra por encima del umbral
  tarifaExtrasManuales: 10.74,     // €/h de domingos y festivos
  irpf: 20,
  permitirExtrasNegativos: false,
  pasoFichaje: 15,          // minutos entre marcas de fichaje (15 por defecto)
  reglaFichaje: 'abajo',    // 'abajo' | 'arriba' | 'cercano' | 'sin'
  tiposDia: {
    // base    = jornada del día
    // umbral  = horas a partir de las cuales se generan horas extra
    // descanso = parada para comer (se resta antes de comparar con el umbral)
    laborable: { etiqueta: 'Laborable', base: 8, umbral: 8, descanso: 1.5 },
    sabado: { etiqueta: 'Sábado', base: 7, umbral: 0, descanso: 0.5 },
    domingo: { etiqueta: 'Domingo', base: 0, umbral: 0, descanso: 0.5 },
    festivo: { etiqueta: 'Festivo', base: 0, umbral: 0, descanso: 0.5 },
    vacaciones: { etiqueta: 'Vacaciones', base: 0, umbral: 0, descanso: 0 }
  }
});

/** Domingos y festivos se pagan a la tarifa especial (10,74 €/h). */
export function esTipoFestivo(tipo) {
  return tipo === 'domingo' || tipo === 'festivo';
}

/** Días de vacaciones: no se trabaja y no generan nada de dinero. */
export function esTipoVacaciones(tipo) {
  return tipo === 'vacaciones';
}

export const PASOS_FICHAJE = [5, 10, 15, 20, 30, 60];
export const REGLAS_FICHAJE = {
  abajo: 'Al anterior (18:07 → 18:00)',
  arriba: 'Al siguiente (18:07 → 18:15)',
  cercano: 'Al más cercano',
  sin: 'Sin redondear'
};

export const DIAS_SEMANA = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
export const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/** Convierte "YYYY-MM" en un id de mes. */
export function mesId(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Devuelve el número de días del mes "YYYY-MM". */
export function diasEnMes(id) {
  const [y, m] = id.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Tipo de día por defecto según el día de la semana. */
export function tipoPorDiaSemana(fechaISO) {
  const dow = new Date(fechaISO + 'T12:00:00').getDay(); // 0 = domingo
  if (dow === 0) return 'domingo';
  if (dow === 6) return 'sabado';
  return 'laborable';
}

/** Día vacío con los valores por defecto del tipo. */
export function diaPorDefecto(fechaISO, ajustes = AJUSTES_POR_DEFECTO) {
  const tipo = tipoPorDiaSemana(fechaISO);
  const conf = ajustes.tiposDia[tipo] || ajustes.tiposDia.laborable;
  return {
    fecha: fechaISO,
    tipo,
    base: conf.base,
    umbral: conf.umbral,
    descanso: conf.descanso !== undefined ? conf.descanso : 0,
    trabajadas: 0,
    entrada: '',
    salida: '',
    nota: '',
    baseManual: false,
    umbralManual: false,
    descansoManual: false
  };
}

/** Normaliza un número: '' -> 0, '8,5' -> 8.5, '8:30' -> 8.5. */
export function num(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (valor === null || valor === undefined) return 0;
  let s = String(valor).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(':')) {
    // "8:30" -> 8.5 ; "1:30:00" -> 1.5
    const partes = s.split(':').map((p) => parseFloat(p.replace(',', '.')) || 0);
    let h = partes[0] || 0;
    let m = partes[1] || 0;
    let seg = partes[2] || 0;
    if (partes.length === 2 && m > 59) { h += Math.floor(m / 60); m = m % 60; }
    return h + m / 60 + seg / 3600;
  }
  s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Redondeo "de dinero" que evita el 0,0049999999 de coma flotante. */
export function redondear(n, decimales = 2) {
  const f = Math.pow(10, decimales);
  return Math.round((n + Number.EPSILON * Math.sign(n) * Math.abs(n)) * f) / f;
}

// ---------------------------------------------------------------------------
// Fichajes (entrada / salida)
// ---------------------------------------------------------------------------
// El fichaje va en una rejilla de 15 minutos (configurable). Regla "arriba":
//   07:44 -> 07:45     07:45 -> 07:45     07:46 -> 08:00
// Es decir, la marca se guarda en el primer múltiplo de la rejilla que es
// igual o posterior a la hora leída del reloj.

/** "07:45" -> 465 (minutos desde medianoche). */
export function minutos(hora) {
  if (hora === null || hora === undefined || hora === '') return null;
  const m = /^\s*(\d{1,2})\s*[:.]?\s*(\d{2})?\s*$/.exec(String(hora));
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutos -> "07:45". */
export function aHora(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Aplica la regla de redondeo de la rejilla a una hora "HH:MM".
 *   'abajo'   (por defecto): 18:07 -> 18:00, 18:22 -> 18:15, 18:44 -> 18:30
 *   'arriba'                : 18:07 -> 18:15, 18:22 -> 18:30, 18:44 -> 18:45
 *   'cercano'               : al múltiplo de la rejilla más próximo
 *   'sin'                   : se guarda tal cual
 */
export function redondearCuadricula(hora, pasoMin = 15, regla = 'abajo') {
  const total = minutos(hora);
  if (total === null) return hora === null || hora === undefined ? '' : String(hora);
  const paso = pasoMin > 0 ? pasoMin : 15;
  let nuevo;
  if (regla === 'sin') nuevo = total;
  else if (regla === 'arriba') nuevo = Math.ceil(total / paso) * paso;
  else if (regla === 'cercano') nuevo = Math.round(total / paso) * paso;
  else nuevo = Math.floor(total / paso) * paso;   // 'abajo' (por defecto)
  return aHora(nuevo);
}

/** La hora actual, ya redondeada a la rejilla. */
export function ahoraRedondeado(pasoMin = 15, regla = 'arriba', fecha = new Date()) {
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mm = String(fecha.getMinutes()).padStart(2, '0');
  return redondearCuadricula(`${hh}:${mm}`, pasoMin, regla);
}

/**
 * Horas entre el fichaje de entrada y el de salida (brutas, sin restar
 * el descanso: el descanso va aparte).
 */
export function horasDeFichaje(entrada, salida) {
  const em = minutos(entrada);
  const sm = minutos(salida);
  if (em === null || sm === null) return null;
  let dif = sm - em;
  if (dif < 0) dif += 1440;          // turno que cruza la medianoche
  return dif / 60;
}

/** Texto "07:45" a partir de un valor de <input type="time">. */
export function normalizarHora(entrada) {
  const m = minutos(entrada);
  return m === null ? '' : aHora(m);
}

/**
 * Calcula un día.
 *   netas    = horas del día − descanso (la parada para comer)
 *   Laborables y sábados:
 *       extra = MAX(0, netas − umbral)              -> tarifa 9,45 €/h
 *   Domingos y festivos: todas las horas netas son extra -> 10,74 €/h
 */
export function calcularDia(dia, ajustes = AJUSTES_POR_DEFECTO) {
  const trabajadas = num(dia.trabajadas);
  const umbral = num(dia.umbral);
  const base = num(dia.base);
  const descanso = num(dia.descanso);
  const entrada = normalizarHora(dia.entrada);
  const salida = normalizarHora(dia.salida);
  const horasFichaje = horasDeFichaje(entrada, salida);
  const festivo = esTipoFestivo(dia.tipo);
  const vacaciones = esTipoVacaciones(dia.tipo);

  const netas = Math.max(0, trabajadas - descanso);

  // En vacaciones no se genera nada de dinero.
  let extraAuto = (festivo || vacaciones) ? 0 : netas - umbral;
  if (!ajustes.permitirExtrasNegativos && extraAuto < 0) extraAuto = 0;
  const extraFestivo = festivo ? netas : 0;

  return {
    ...dia,
    base,
    umbral,
    trabajadas,
    descanso,
    netas,
    entrada,
    salida,
    festivo,
    vacaciones,
    // Horas que salen del fichaje (null si no hay entrada o salida).
    horasFichaje,
    // true si las horas escritas NO coinciden con las del fichaje.
    descuadre: horasFichaje !== null && Math.abs(horasFichaje - trabajadas) > 0.001,
    extraAuto,
    extraFestivo,
    // Total de horas extra del día (a cualquier tarifa).
    totalExtras: extraAuto + extraFestivo
  };
}

/**
 * Calcula el mes completo.
 *  totalHoras         = SUM(D)
 *  horasExtraAuto     = SUM(E)          -> tarifa extras (9,45 €/h)
 *  horasExtraFestivo  = domingos/festivos -> tarifa especial (10,74 €/h)
 *  bruto              = sueldoFijo + euros de extras
 *  neto               = bruto - bruto*IRPF
 */
export function calcular(dias, ajustes = AJUSTES_POR_DEFECTO) {
  const lista = (dias || []).map((d) => calcularDia(d, ajustes));
  const suma = (fn) => lista.reduce((acc, d) => acc + fn(d), 0);

  const totalHoras = suma((d) => d.trabajadas);
  const horasDescanso = suma((d) => d.descanso);
  const horasEfectivas = Math.max(0, totalHoras - horasDescanso);
  const horasExtraAuto = suma((d) => d.extraAuto);
  const horasExtraFestivo = suma((d) => d.extraFestivo);
  const horasExtraTotal = horasExtraAuto + horasExtraFestivo;

  const eurosExtraAuto = horasExtraAuto * ajustes.tarifaExtras;
  const eurosExtraFestivo = horasExtraFestivo * ajustes.tarifaExtrasManuales;
  const eurosHoras = eurosExtraAuto + eurosExtraFestivo;

  const bruto = ajustes.sueldoFijo + eurosHoras;
  const irpfEuros = bruto * (ajustes.irpf / 100);
  const neto = bruto - irpfEuros;

  const conFichaje = lista.filter((d) => d.horasFichaje !== null);
  const deVacaciones = lista.filter((d) => d.vacaciones);

  return {
    dias: lista,
    totalHoras,
    horasDescanso,
    horasEfectivas,
    diasVacaciones: deVacaciones.length,
    horasExtraAuto,
    horasExtraFestivo,
    horasExtraTotal,
    eurosExtraAuto,
    eurosExtraFestivo,
    eurosHoras,
    sueldoFijo: ajustes.sueldoFijo,
    bruto,
    irpfEuros,
    irpfPct: ajustes.irpf,
    neto,
    diasConFichaje: conFichaje.length,
    horasFichaje: conFichaje.reduce((a, d) => a + d.horasFichaje, 0),
    diasDescuadrados: conFichaje.filter((d) => d.descuadre).length
  };
}

/** Agrupa los días por semana (lunes a domingo). */
export function porSemanas(dias) {
  const semanas = new Map();
  for (const d of dias) {
    const fecha = new Date(d.fecha + 'T12:00:00');
    const dow = (fecha.getDay() + 6) % 7; // 0 = lunes
    const lunes = new Date(fecha);
    lunes.setDate(fecha.getDate() - dow);
    const clave = `${lunes.getFullYear()}-${String(lunes.getMonth() + 1).padStart(2, '0')}-${String(lunes.getDate()).padStart(2, '0')}`;
    if (!semanas.has(clave)) semanas.set(clave, []);
    semanas.get(clave).push(d);
  }
  return [...semanas.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([clave, diasSemana]) => ({
      clave,
      dias: diasSemana,
      horas: diasSemana.reduce((a, d) => a + d.trabajadas, 0),
      extras: diasSemana.reduce((a, d) => a + d.extraAuto, 0),
      extrasFestivo: diasSemana.reduce((a, d) => a + d.extraFestivo, 0)
    }));
}

/** Nombre legible del mes: "julio 2026". */
export function nombreMes(id) {
  const [y, m] = id.split('-').map(Number);
  return `${MESES_ES[m - 1]} ${y}`;
}
