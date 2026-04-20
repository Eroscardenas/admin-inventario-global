// lib/services/transaction.service.ts  ✅ FINAL (PROD READY + Cache + Limpieza 30 días) — HARDENED
// - ✅ Cache in-memory con TTL
// - ✅ Paginación con startAfterDoc
// - ✅ Limpieza real Firestore por batches (30 días)
// - ✅ HARDENED: fecha se guarda SIEMPRE como Timestamp (consistencia en queries)
// - ✅ HARDENED: safeNumber tolerante a objetos corruptos (increment-like)
// - ✅ HARDENED: filtros fechaInicio/fechaFin se convierten a Timestamp

'use client';

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as qLimit,
  startAfter,
  Timestamp,
  type QueryConstraint,
  type DocumentData,
  type QueryDocumentSnapshot,
  writeBatch,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/config.client';

import type { ProductType, IceType, FireDate } from '@/lib/utils/types/product.types';
import type { TurnoType } from '@/lib/utils/types/turno.types';
import {
  type Movimiento,
  type TipoMovimiento,
  type ImpactoMovimiento,
  TIPOS_MOVIMIENTO_UI,
  getMovimientoMeta,
} from '@/lib/utils/types/transaction.types';

// =====================================================
// CONFIG
// =====================================================

const COLECCION_MOVIMIENTOS = 'movimientos';
const movimientosCol = collection(db, COLECCION_MOVIMIENTOS);

// =====================================================
// HELPERS
// =====================================================

function isTimestamp(v: any): v is Timestamp {
  return v && typeof v === 'object' && typeof v.toDate === 'function';
}

function toDate(v: any): Date {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (isTimestamp(v)) return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** FireDate friendly (Date | Timestamp | any) -> Date */
function normalizeFireDate(v: FireDate): Date {
  return toDate(v as any);
}

const isIncrementLike = (v: any) => {
  if (!v || typeof v !== 'object') return false;
  const m = String((v as any)._methodName ?? '');
  return m.toLowerCase() === 'increment';
};

function safeNumber(n: any, fallback = 0) {
  // ✅ si alguna vez llega corrupto como { _methodName: "increment", ... }
  if (isIncrementLike(n)) return fallback;

  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function toTimestampSafe(v: any): Timestamp {
  if (!v) return Timestamp.fromDate(new Date());
  if (isTimestamp(v)) return v;
  if (v instanceof Date) return Timestamp.fromDate(v);
  // intenta parsear
  const d = new Date(v);
  return Timestamp.fromDate(Number.isNaN(d.getTime()) ? new Date() : d);
}

function withId<T extends DocumentData>(snap: QueryDocumentSnapshot<T>) {
  return { id: snap.id, ...(snap.data() as any) } as any;
}

function normalizeMovimiento(raw: any): Movimiento {
  return {
    ...raw,
    id: raw.id,
    codigo: String(raw.codigo ?? ''),
    tipo: raw.tipo as TipoMovimiento,

    productoCodigo: String(raw.productoCodigo ?? ''),
    productoNombre: String(raw.productoNombre ?? ''),
    tipoProducto: (raw.tipoProducto ?? 'BOLSA') as ProductType,

    deltaPrincipal: safeNumber(raw.deltaPrincipal),
    principalAnterior: safeNumber(raw.principalAnterior),
    principalNuevo: safeNumber(raw.principalNuevo),

    tipoHielo: raw.tipoHielo as IceType | undefined,
    status: raw.status,

    usuarioCodigo: String(raw.usuarioCodigo ?? ''),
    usuarioNombre: String(raw.usuarioNombre ?? ''),

    empleadoAsignadoCodigo: raw.empleadoAsignadoCodigo,
    empleadoAsignadoNombre: raw.empleadoAsignadoNombre,

    clienteNombre: raw.clienteNombre,

    recibidoPor: raw.recibidoPor,
    motivo: raw.motivo,
    motivoRechazo: raw.motivoRechazo,
    accionesTomadas: raw.accionesTomadas,

    // ✅ runtime Date para UI (aunque en Firestore sea Timestamp)
    fecha: normalizeFireDate(raw.fecha as FireDate) as any,
    turno: (raw.turno ?? 'MATUTINO') as TurnoType,

    observaciones: raw.observaciones,

    precioUnitario: raw.precioUnitario,
    valorTotal: raw.valorTotal,
    unidadMedida: raw.unidadMedida,

    impactos: Array.isArray(raw.impactos) ? (raw.impactos as ImpactoMovimiento[]) : [],
  };
}

/** Código único barato (prod suficiente) */
async function generarCodigoMovimiento(): Promise<string> {
  const now = Date.now();
  const rnd = Math.floor(Math.random() * 1000);
  return `MOV-${now}-${rnd}`;
}

// =====================================================
// CACHE (in-memory)
// =====================================================

type CacheEntry = { at: number; data: Movimiento[] };
const memCache = new Map<string, CacheEntry>();

function makeKey(params: ObtenerMovimientosParams) {
  // No cacheamos si hay cursor/paginación
  const o = {
    ...params,
    startAfterDoc: undefined,
    fechaInicio: params.fechaInicio ? params.fechaInicio.toISOString() : undefined,
    fechaFin: params.fechaFin ? params.fechaFin.toISOString() : undefined,
  };
  return JSON.stringify(o);
}

// =====================================================
// TIPOS DE CONSULTA
// =====================================================

export interface ObtenerMovimientosParams {
  tipo?: TipoMovimiento;
  tipoProducto?: ProductType;
  tipoHielo?: IceType;

  usuarioCodigo?: string;
  empleadoAsignadoCodigo?: string;

  productoCodigo?: string;
  productoNombreContains?: string;

  fechaInicio?: Date;
  fechaFin?: Date;

  limit?: number;

  // paginación opcional
  startAfterDoc?: QueryDocumentSnapshot<DocumentData>;

  // ✅ cache opcional (por defecto 20s)
  cacheTtlMs?: number;
}

export interface ResumenDia {
  fecha: Date;
  totalMovimientos: number;
  porTipo: Record<string, number>;
  entradas: number;
  salidas: number;
  valorTotal?: number;
}

export interface EstadisticasMermas {
  totalMermas: number;
  totalCantidad: number;
  porTipoProducto: { barras: number; bolsas: number };
}

// =====================================================
// SERVICE
// =====================================================

export class TransactionService {
  // -----------------------------
  // UI helpers
  // -----------------------------
  static obtenerUIInfo = TIPOS_MOVIMIENTO_UI;

  static getMovimientoMeta(tipo: TipoMovimiento) {
    return getMovimientoMeta(tipo);
  }

  /** Entrada/salida según meta (si no existe, fallback: deltaPrincipal >= 0) */
  static esEntrada(tipo: TipoMovimiento, fallbackDelta?: number) {
    const meta = TIPOS_MOVIMIENTO_UI[tipo];
    if (meta) return !!meta.esEntrada;
    return (fallbackDelta ?? 0) >= 0;
  }

  // -----------------------------
  // CRUD básico
  // -----------------------------
  static async registrarMovimiento(
    mov: Omit<Movimiento, 'codigo' | 'fecha' | 'turno'> & Partial<Pick<Movimiento, 'codigo' | 'fecha' | 'turno'>>
  ): Promise<string> {
    const codigo = mov.codigo && mov.codigo.trim() ? mov.codigo : await generarCodigoMovimiento();

    // ✅ SIEMPRE guardamos Timestamp en Firestore
    const fechaTs = toTimestampSafe(mov.fecha ?? new Date());

    const payload: any = {
      ...(mov as any),
      codigo,
      fecha: fechaTs,
      turno: (mov.turno ?? (mov as any).turno ?? 'MATUTINO') as TurnoType,
      impactos: Array.isArray((mov as any).impactos) ? (mov as any).impactos : [],
    };

    const ref = await addDoc(movimientosCol, payload);

    // invalidar cache local
    memCache.clear();

    return ref.id;
  }

  // -----------------------------
  // Consultas
  // -----------------------------
  static async obtenerMovimientos(params: ObtenerMovimientosParams = {}) {
    const ttl = params.cacheTtlMs ?? 20_000;

    const canCache = !params.startAfterDoc && ttl > 0;
    const key = canCache ? makeKey(params) : '';

    if (canCache) {
      const hit = memCache.get(key);
      if (hit && Date.now() - hit.at <= ttl) return hit.data;
    }

    const constraints: QueryConstraint[] = [];

    // filtros exactos (Firestore friendly)
    if (params.tipo) constraints.push(where('tipo', '==', params.tipo));
    if (params.tipoProducto) constraints.push(where('tipoProducto', '==', params.tipoProducto));
    if (params.tipoHielo) constraints.push(where('tipoHielo', '==', params.tipoHielo));
    if (params.usuarioCodigo) constraints.push(where('usuarioCodigo', '==', params.usuarioCodigo));
    if (params.empleadoAsignadoCodigo)
      constraints.push(where('empleadoAsignadoCodigo', '==', params.empleadoAsignadoCodigo));
    if (params.productoCodigo) constraints.push(where('productoCodigo', '==', params.productoCodigo));

    // ✅ rango fechas: convertir a Timestamp para consistencia
    if (params.fechaInicio) constraints.push(where('fecha', '>=', Timestamp.fromDate(params.fechaInicio)));
    if (params.fechaFin) constraints.push(where('fecha', '<=', Timestamp.fromDate(params.fechaFin)));

    // orden (requiere índices si combinas con where)
    constraints.push(orderBy('fecha', 'desc'));

    // paginación
    if (params.startAfterDoc) constraints.push(startAfter(params.startAfterDoc));

    // limit
    constraints.push(qLimit(params.limit ?? 200));

    const qy = query(movimientosCol, ...constraints);
    const snap = await getDocs(qy);

    let data = snap.docs.map((d) => normalizeMovimiento(withId(d)));

    // filtro por contains (client)
    if (params.productoNombreContains && params.productoNombreContains.trim()) {
      const t = params.productoNombreContains.toLowerCase();
      data = data.filter((m) => (m.productoNombre ?? '').toLowerCase().includes(t));
    }

    if (canCache) memCache.set(key, { at: Date.now(), data });
    return data;
  }

  // -----------------------------
  // Limpieza (borrado real Firestore)
  // -----------------------------
  static async limpiarMovimientosAntiguos(dias = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - dias);
    const cutoffTs = Timestamp.fromDate(cutoff);

    // borra en batches de 450
    while (true) {
      const qy = query(
        movimientosCol,
        where('fecha', '<', cutoffTs),
        orderBy('fecha', 'asc'),
        qLimit(450)
      );

      const snap = await getDocs(qy);
      if (snap.empty) break;

      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      if (snap.size < 450) break;
    }

    memCache.clear();
    return { ok: true, cutoff };
  }

  // -----------------------------
  // Resúmenes
  // -----------------------------
  static async obtenerResumenDia(fecha: Date = new Date()): Promise<ResumenDia> {
    const start = new Date(fecha);
    start.setHours(0, 0, 0, 0);
    const end = new Date(fecha);
    end.setHours(23, 59, 59, 999);

    const movimientos = await this.obtenerMovimientos({
      fechaInicio: start,
      fechaFin: end,
      limit: 2000,
      cacheTtlMs: 0,
    });

    const porTipo: Record<string, number> = {};
    let entradas = 0;
    let salidas = 0;
    let valorTotal = 0;

    for (const m of movimientos) {
      porTipo[m.tipo] = (porTipo[m.tipo] ?? 0) + 1;

      const esEntrada = this.esEntrada(m.tipo, m.deltaPrincipal);
      if (esEntrada) entradas += Math.abs(m.deltaPrincipal ?? 0);
      else salidas += Math.abs(m.deltaPrincipal ?? 0);

      valorTotal += safeNumber(m.valorTotal, 0);
    }

    return {
      fecha: start,
      totalMovimientos: movimientos.length,
      porTipo,
      entradas,
      salidas,
      valorTotal,
    };
  }

  static async obtenerEstadisticasMermas(fechaDesde?: Date, fechaHasta?: Date): Promise<EstadisticasMermas> {
    const movs = await this.obtenerMovimientos({
      fechaInicio: fechaDesde,
      fechaFin: fechaHasta,
      limit: 5000,
    });

    const only = movs.filter((m) => m.tipo === 'MERMA_BOLSA' || m.tipo === 'MERMA_BARRA');

    const porTipoProducto = {
      barras: only.filter((m) => m.tipo === 'MERMA_BARRA').length,
      bolsas: only.filter((m) => m.tipo === 'MERMA_BOLSA').length,
    };

    const totalCantidad = only.reduce((acc, m) => acc + Math.abs(m.deltaPrincipal ?? 0), 0);

    return {
      totalMermas: only.length,
      totalCantidad,
      porTipoProducto,
    };
  }

  // -----------------------------
  // Export CSV
  // -----------------------------
  static exportarACSV(movs: Movimiento[]) {
    const headers = [
      'codigo',
      'tipo',
      'fecha',
      'turno',
      'productoCodigo',
      'productoNombre',
      'tipoProducto',
      'deltaPrincipal',
      'principalAnterior',
      'principalNuevo',
      'tipoHielo',
      'usuarioCodigo',
      'usuarioNombre',
      'empleadoAsignadoCodigo',
      'empleadoAsignadoNombre',
      'clienteNombre',
      'motivo',
      'valorTotal',
      'impactos_json',
    ];

    const rows = movs.map((m) => [
      m.codigo,
      m.tipo,
      toDate(m.fecha).toISOString(),
      m.turno,
      m.productoCodigo,
      JSON.stringify(m.productoNombre ?? ''),
      m.tipoProducto,
      String(m.deltaPrincipal ?? 0),
      String(m.principalAnterior ?? 0),
      String(m.principalNuevo ?? 0),
      m.tipoHielo ?? '',
      m.usuarioCodigo,
      JSON.stringify(m.usuarioNombre ?? ''),
      m.empleadoAsignadoCodigo ?? '',
      JSON.stringify(m.empleadoAsignadoNombre ?? ''),
      JSON.stringify(m.clienteNombre ?? ''),
      JSON.stringify(m.motivo ?? ''),
      String(m.valorTotal ?? ''),
      JSON.stringify(m.impactos ?? []),
    ]);

    return (
      headers.join(',') +
      '\n' +
      rows
        .map((r) =>
          r
            .map((cell) => {
              const s = String(cell ?? '');
              if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
              return s;
            })
            .join(',')
        )
        .join('\n')
    );
  }
}

export default TransactionService;
