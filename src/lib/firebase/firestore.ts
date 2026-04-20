import { db } from './config';
import {
  Timestamp,
  serverTimestamp,
  collection,
  doc,
} from 'firebase/firestore';

// ================================
// Helpers de fechas
// ================================
export function convertirTimestamp(value: any): Date {
  if (!value) return new Date();

  // Firestore Timestamp
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate();

  // JS Date
  if (value instanceof Date) return value;

  // number/string
  return new Date(value);
}

export function prepararParaFirestore<T extends Record<string, any>>(data: T): T {
  const preparado: any = { ...data };

  for (const key of Object.keys(preparado)) {
    if (preparado[key] instanceof Date) {
      preparado[key] = Timestamp.fromDate(preparado[key]);
    }
  }

  return preparado;
}

// ================================
// Colecciones (tu diseño: independientes)
// ================================
export const COLECCIONES = {
  USUARIOS: 'usuarios',
  MOVIMIENTOS: 'movimientos',
  MERMAS: 'mermas',
  DEVOLUCIONES: 'devoluciones',
  CONFIG: 'configuracion',
  STOCK: 'stock',
  STOCK_ALERTAS: 'stockAlertas',

  BARRAS: 'barras',
  BOLSAS_VACIAS: 'bolsasVacias',
  BOLSAS_ASIGNADAS: 'bolsasAsignadas',
  BOLSAS_LLENAS: 'bolsasLlenas',
} as const;

// ================================
// Normalización de IDs
// ================================

/**
 * Acepta:
 *  - "abc123" => { id: "abc123" }
 *  - "bolsasVacias/abc123" => { id: "abc123" }
 *  - "products/bolsas_vacias/abc123" => { id: "abc123" }
 *
 * Objetivo: SIEMPRE extraer el último segmento como id.
 * (No intentamos adivinar colección.)
 */
export function limpiarIdFirestore(input: string): string {
  if (!input || typeof input !== 'string') return input || '';
  if (!input.includes('/')) return input.trim();

  const partes = input.split('/').filter(Boolean);
  return (partes[partes.length - 1] || '').trim();
}

// ================================
// Refs (colección)
// ================================
export const getBarrasRef = () => collection(db, COLECCIONES.BARRAS);
export const getBolsaVaciaRef = () => collection(db, COLECCIONES.BOLSAS_VACIAS);
export const getBolsaAsignadaRef = () => collection(db, COLECCIONES.BOLSAS_ASIGNADAS);
export const getBolsaLlenaRef = () => collection(db, COLECCIONES.BOLSAS_LLENAS);

export const getMovimientosRef = () => collection(db, COLECCIONES.MOVIMIENTOS);
export const getUsuariosRef = () => collection(db, COLECCIONES.USUARIOS);
export const getMermasRef = () => collection(db, COLECCIONES.MERMAS);
export const getDevolucionesRef = () => collection(db, COLECCIONES.DEVOLUCIONES);
export const getStockAlertasRef = () => collection(db, COLECCIONES.STOCK_ALERTAS);

// Stock general (doc fijo)
export const getStockGeneralDoc = () => doc(db, COLECCIONES.STOCK, 'general');

// ================================
// Docs (documento)
// ================================
export const getBarraDoc = (id: string) =>
  doc(db, COLECCIONES.BARRAS, limpiarIdFirestore(id));

export const getBolsaVaciaDoc = (id: string) =>
  doc(db, COLECCIONES.BOLSAS_VACIAS, limpiarIdFirestore(id));

export const getBolsaAsignadaDoc = (id: string) =>
  doc(db, COLECCIONES.BOLSAS_ASIGNADAS, limpiarIdFirestore(id));

export const getBolsaLlenaDoc = (id: string) =>
  doc(db, COLECCIONES.BOLSAS_LLENAS, limpiarIdFirestore(id));

// ================================
// Helpers genéricos (si los ocupas)
// ================================
export const getCollection = (coleccion: string) => collection(db, coleccion);
export const getDocument = (coleccion: string, docId: string) =>
  doc(db, coleccion, docId);

// Re-export útil
export { serverTimestamp };
