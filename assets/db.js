// ---------------------------------------------------------------------------
// db.js — Base de datos local (IndexedDB). Los datos NUNCA salen del iPhone.
// ---------------------------------------------------------------------------
// BD:  "control-horas"  v1
//   - meses   : { id: "2026-07", dias: { "2026-07-01": {...} }, actualizado }
//   - ajustes : { clave: "global", datos: { ... } }
// ---------------------------------------------------------------------------

import { AJUSTES_POR_DEFECTO } from './calc.js';

const NOMBRE_BD = 'control-horas';
const VERSION = 1;

let promesaDB = null;

export function abrirDB() {
  if (promesaDB) return promesaDB;
  promesaDB = new Promise((resolve, reject) => {
    const req = indexedDB.open(NOMBRE_BD, VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meses')) {
        db.createObjectStore('meses', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('ajustes')) {
        db.createObjectStore('ajustes', { keyPath: 'clave' });
      }
      void ev;
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base de datos bloqueada por otra pestaña'));
  });
  return promesaDB;
}

function tx(db, store, modo) {
  return db.transaction(store, modo).objectStore(store);
}

function pedir(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- Meses ------------------------------------------------------------------

export async function obtenerMes(id) {
  const db = await abrirDB();
  const res = await pedir(tx(db, 'meses', 'readonly').get(id));
  return res || null;
}

export async function guardarMes(id, dias, extra = {}) {
  const db = await abrirDB();
  // Un mes sin días no se guarda: así la base de datos queda limpia.
  if (!dias || Object.keys(dias).length === 0) {
    await pedir(tx(db, 'meses', 'readwrite').delete(id));
    return null;
  }
  const registro = {
    id,
    dias,
    actualizado: new Date().toISOString(),
    ...extra
  };
  await pedir(tx(db, 'meses', 'readwrite').put(registro));
  return registro;
}

export async function borrarMes(id) {
  const db = await abrirDB();
  await pedir(tx(db, 'meses', 'readwrite').delete(id));
}

export async function listarMeses() {
  const db = await abrirDB();
  const res = await pedir(tx(db, 'meses', 'readonly').getAll());
  return (res || []).sort((a, b) => a.id.localeCompare(b.id));
}

// --- Ajustes ----------------------------------------------------------------

export async function obtenerAjustes() {
  const db = await abrirDB();
  const res = await pedir(tx(db, 'ajustes', 'readonly').get('global'));
  if (!res || !res.datos) {
    // Primera ejecución: se guardan los valores por defecto.
    const porDefecto = structuredCopy(AJUSTES_POR_DEFECTO);
    await pedir(tx(db, 'ajustes', 'readwrite').put({ clave: 'global', datos: porDefecto }));
    return porDefecto;
  }
  const guardados = res.datos;
  const versionGuardada = guardados.version || 1;
  // La tabla de tipos de dia se rehace siempre a partir de la de por defecto:
  // asi se conservan los valores que hayas cambiado, pero se eliminan los
  // tipos que ya no existen (p.ej. "Jornada corta") y se anaden los nuevos.
  const tipos = {};
  for (const [clave, conf] of Object.entries(AJUSTES_POR_DEFECTO.tiposDia)) {
    tipos[clave] = { ...conf, ...((guardados.tiposDia || {})[clave] || {}) };
  }
  const datos = {
    ...structuredCopy(AJUSTES_POR_DEFECTO),
    ...guardados,
    version: AJUSTES_POR_DEFECTO.version,
    tiposDia: tipos
  };
  // La regla de redondeo del fichaje cambio a "hacia abajo" en la v3.
  if (versionGuardada < 3) {
    datos.reglaFichaje = AJUSTES_POR_DEFECTO.reglaFichaje;
  }
  return datos;
}

export async function guardarAjustes(datos) {
  const db = await abrirDB();
  await pedir(tx(db, 'ajustes', 'readwrite').put({ clave: 'global', datos }));
}

// --- Semilla (datos de ejemplo del Excel) ---------------------------------

export async function semillaHecha() {
  const db = await abrirDB();
  const res = await pedir(tx(db, 'ajustes', 'readonly').get('semilla'));
  return !!(res && res.datos && res.datos.hecha);
}

export async function marcarSemilla() {
  const db = await abrirDB();
  await pedir(tx(db, 'ajustes', 'readwrite').put({ clave: 'semilla', datos: { hecha: true } }));
}

// --- Copias de seguridad ----------------------------------------------------

export async function ultimaCopia() {
  const db = await abrirDB();
  const res = await pedir(tx(db, 'ajustes', 'readonly').get('backup'));
  return res && res.datos ? res.datos.fecha : null;
}

export async function marcarCopia() {
  const db = await abrirDB();
  const fecha = new Date().toISOString();
  await pedir(tx(db, 'ajustes', 'readwrite').put({ clave: 'backup', datos: { fecha } }));
  return fecha;
}

export async function exportarTodo() {
  const db = await abrirDB();
  const meses = await pedir(tx(db, 'meses', 'readonly').getAll());
  const ajustes = await pedir(tx(db, 'ajustes', 'readonly').get('global'));
  return {
    app: 'control-horas',
    version: 1,
    exportado: new Date().toISOString(),
    meses,
    ajustes: ajustes ? ajustes.datos : structuredCopy(AJUSTES_POR_DEFECTO)
  };
}

export async function importarTodo(copia) {
  if (!copia || !Array.isArray(copia.meses)) {
    throw new Error('El archivo no tiene el formato esperado');
  }
  const db = await abrirDB();
  const store = tx(db, 'meses', 'readwrite');
  for (const mes of copia.meses) {
    // Se fusiona: si el mes ya existe aquí, gana el más reciente de los dos.
    const actual = await pedir(store.get(mes.id));
    const delArchivo = {
      id: mes.id,
      dias: mes.dias || {},
      actualizado: mes.actualizado || new Date().toISOString()
    };
    if (!actual || (delArchivo.actualizado > (actual.actualizado || ''))) {
      store.put(delArchivo);
    }
  }
  if (copia.ajustes) {
    tx(db, 'ajustes', 'readwrite').put({ clave: 'global', datos: copia.ajustes });
  }
  return copia.meses.length;
}

export async function borrarTodo() {
  const db = await abrirDB();
  await pedir(tx(db, 'meses', 'readwrite').clear());
  await pedir(tx(db, 'ajustes', 'readwrite').clear());
  // La marca de semilla se conserva: si no, la app volvería a meter julio 2026.
  await marcarSemilla();
}

function structuredCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}
