'use client';

// lib/services/mermas.service.ts
// ✅ PRODUCTION READY (Firestore)
// ✅ Resuelve producto por campo `codigo` (NO docId)
// ✅ NO getDocs() dentro de runTransaction()
// ✅ MERMA SIEMPRE afecta stock (sin toggle)
// ✅ BOLSA LLENA resta stockPorHielo[tipo].stockActual (en el doc BVxxx)
// ✅ MERMA BV resta cantidad (en el doc BVxxx)
// ✅ MERMA BARRA resta cuartosDisponibles o cuartosUsados (en doc BRxxx)
// ✅ MOVIMIENTO compatible con Inventario UI:
//    - MERMA_BOLSA: bolsaVaciaCodigo + tipoHielo + deltaPrincipal (-cant) + afectaStock:true
//    - MERMA_BOLSA_VACIA / MERMA_BARRA: cantidad (-cant) + stockAnterior/Nuevo + afectaStock:true
// ⛔ AUTO-REPAIR REMOVIDO (era la causa del doble conteo / “sube o dobla”)
// ⛔ CANCELACIÓN DESHABILITADA (sin devuelta)

import { db } from '@/lib/firebase/config.client';

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  limit as qLimit,
  runTransaction,
  type DocumentReference,
  type QueryConstraint,
} from 'firebase/firestore';

import type { IceType } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO } from '@/lib/utils/types/product.types';

// =====================================================
// TIPOS
// =====================================================
export type MermaTipoProducto = 'BOLSA' | 'BARRA' | 'BOLSA_VACIA';
export type CuartosFuente = 'DISPONIBLES' | 'USADOS';

export interface Merma {
  id?: string;
  codigo: string;

  productoCodigo: string; // ✅ BOLSA: BVxxx | BARRA: BRxxx | BV: BVxxx
  productoNombre: string;

  tipoProducto: MermaTipoProducto;
  tipoHielo?: IceType;

  cantidad: number;
  motivo: string;
  motivoDetallado?: string;

  registradoPorCodigo: string;
  registradoPorNombre: string;

  createdAt: Date;
  updatedAt: Date;
  turno: 'MATUTINO' | 'VESPERTINO' | 'NOCTURNO';

  // ✅ Siempre true (si el producto existe)
  afectaStock: boolean;

  // BV => cantidad
  stockAnterior?: number;
  stockNuevo?: number;

  // Bolsa llena => stockPorHielo[tipo].stockActual
  stockHieloAnterior?: number;
  stockHieloNuevo?: number;

  // Barra
  cuartosAnteriores?: number;
  cuartosNuevos?: number;
  cuartosFuente?: CuartosFuente;
}

export interface MermaRequest {
  productoCodigo: string; // BVxxx o BRxxx (en bolsa llena se usa BVxxx)
  productoNombre: string;
  tipoProducto: MermaTipoProducto;

  // ✅ BOLSA (LLENA)
  tipoHielo?: IceType;

  cantidad: number;
  motivo: string;
  motivoDetallado?: string;

  // ✅ BARRA
  cuartosFuente?: CuartosFuente; // DISPONIBLES o USADOS

  // ✅ Para BOLSA LLENA: BVxxx si tu UI manda otro
  bolsaVaciaCodigo?: string;
}

export interface MermaStats {
  totalMermas: number;
  totalCantidad: number;
  valorEstimadoPerdido: number;

  porMotivo: Array<{ motivo: string; cantidad: number; porcentaje: number }>;
  porTipoProducto: Array<{ tipo: MermaTipoProducto; cantidad: number; porcentaje: number }>;
  porEmpleado: Array<{ empleadoCodigo: string; empleadoNombre: string; cantidad: number }>;
  tendenciaMensual: Array<{ mes: string; cantidad: number }>;

  ultimaActualizacion: Date;
}

// =====================================================
// COLECCIONES
// =====================================================
const MERMAS_COLLECTION = 'mermas';
const PRODUCTOS_COLLECTION = 'productos';
const MOVIMIENTOS_COLLECTION = 'movimientos';

// =====================================================
// HELPERS
// =====================================================
const safeNumber = (v: unknown): number => {
  const n = Number(v as any);
  return Number.isFinite(n) ? n : 0;
};

const convertirTimestamp = (timestamp: any): Date => {
  if (!timestamp) return new Date();
  if (timestamp instanceof Date) return timestamp;
  if (timestamp?.toDate && typeof timestamp.toDate === 'function') return timestamp.toDate();
  if (typeof timestamp?.seconds === 'number') return new Date(timestamp.seconds * 1000);
  const d = new Date(timestamp);
  return Number.isFinite(d.getTime()) ? d : new Date();
};

const obtenerTurnoActual = (): 'MATUTINO' | 'VESPERTINO' | 'NOCTURNO' => {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return 'MATUTINO';
  if (h >= 14 && h < 22) return 'VESPERTINO';
  return 'NOCTURNO';
};

const cleanOptionalText = (v?: string) => {
  const s = String(v ?? '').trim();
  return s ? s : undefined;
};

const normCode = (v: unknown) => String(v ?? '').trim().toUpperCase();

const normalizeIceTypeSoft = (v: unknown): IceType | undefined => {
  const s = String(v ?? '').trim().toUpperCase();
  return s ? (s as IceType) : undefined;
};

const normalizeIceTypeStrict = (v: unknown): IceType => {
  const t = String(v ?? '').trim().toUpperCase();
  if (!(TIPOS_HIELO as readonly string[]).includes(t)) {
    throw new Error(`tipoHielo inválido: "${t}". Usa: ${TIPOS_HIELO.join(', ')}`);
  }
  return t as IceType;
};

const pickBestIceTypeByStock = (stockPorHielo: any): IceType | null => {
  if (!stockPorHielo || typeof stockPorHielo !== 'object') return null;

  const keys = Object.keys(stockPorHielo) as IceType[];
  if (!keys.length) return null;

  let best: IceType | null = null;
  let bestVal = -1;

  for (const t of keys) {
    const val = safeNumber(stockPorHielo?.[t]?.stockActual);
    if (val > bestVal) {
      bestVal = val;
      best = t;
    }
  }

  if (!best || bestVal <= 0) return null;
  return best;
};

// ✅ Firestore NO acepta undefined
const deepCleanForFirestore = (value: any): any => {
  if (value === undefined) return undefined;
  if (value instanceof Date) return Timestamp.fromDate(value);

  if (Array.isArray(value)) {
    const arr = value.map((v) => deepCleanForFirestore(v)).filter((v) => v !== undefined);
    return arr;
  }

  if (value && typeof value === 'object') {
    if (value instanceof Timestamp) return value;

    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = deepCleanForFirestore(v);
      if (cleaned === undefined) continue;
      out[k] = cleaned;
    }
    return out;
  }

  return value;
};

const prepararParaFirestore = (data: any): any => deepCleanForFirestore(data) ?? {};

function extractKgFromNombre(nombre: any): number | null {
  const s = String(nombre ?? '');
  const m = s.match(/(\d+)\s?kg/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function movimientoTipoForMerma(tp: MermaTipoProducto) {
  if (tp === 'BOLSA') return 'MERMA_BOLSA';
  if (tp === 'BOLSA_VACIA') return 'MERMA_BOLSA_VACIA';
  return 'MERMA_BARRA';
}

function isBVCodigo(cod: string) {
  return /^BV/i.test(cod);
}

// =====================================================
// RESOLVERS (FUERA DE TX)
// =====================================================
async function resolverProductoDataPorCodigo(
  codigo: string,
): Promise<{ ref: DocumentReference; data: any } | null> {
  const cod = normCode(codigo);
  if (!cod) return null;

  const snap = await getDocs(query(collection(db, PRODUCTOS_COLLECTION), where('codigo', '==', cod), qLimit(1)));
  if (snap.empty) return null;

  return { ref: snap.docs[0].ref, data: snap.docs[0].data() as any };
}

// =====================================================
// SERVICE
// =====================================================
export class MermasService {
  // =====================================================
  // REGISTRAR MERMA (SIEMPRE RESTA)
  // =====================================================
  static async registrarMerma(
    request: MermaRequest,
    empleadoCodigo: string,
    empleadoNombre: string,
  ): Promise<{ exito: boolean; mensaje: string; codigoMerma: string }> {
    const tipoProducto =
      (String(request?.tipoProducto ?? 'BOLSA').trim().toUpperCase() as MermaTipoProducto) || 'BOLSA';

    const productoCodigoInput = normCode(request?.productoCodigo);
    const productoNombre = String(request?.productoNombre ?? '').trim();

    if (!productoCodigoInput) throw new Error('Código de producto requerido');
    if (!productoNombre) throw new Error('Nombre de producto requerido');
    if (!String(request?.motivo ?? '').trim()) throw new Error('Motivo requerido');

    const cant = Math.floor(safeNumber(request.cantidad));
    if (!cant || cant <= 0) throw new Error('Cantidad debe ser mayor a 0');
    if (!normCode(empleadoCodigo)) throw new Error('empleadoCodigo requerido');

    const codigoMerma = await this.generarSiguienteCodigo();
    const turno = obtenerTurnoActual();

    // ✅ SIEMPRE afecta stock
    const afectaStock = true;
    const motivoDetallado = cleanOptionalText(request.motivoDetallado);

    // ✅ BARRA: define fuente
    const cuartosFuenteFinal: CuartosFuente | undefined =
      tipoProducto === 'BARRA' ? (request.cuartosFuente ?? 'DISPONIBLES') : undefined;

    // ✅ Para BOLSA (LLENA) el doc real SIEMPRE es BVxxx
    const bvCodigoFinal =
      tipoProducto === 'BOLSA'
        ? normCode(request.bolsaVaciaCodigo ?? request.productoCodigo)
        : productoCodigoInput;

    if (tipoProducto === 'BOLSA' && bvCodigoFinal && !isBVCodigo(bvCodigoFinal)) {
      throw new Error(`MERMA BOLSA: productoCodigo/bolsaVaciaCodigo debe ser BVxxx. Recibí: ${bvCodigoFinal}`);
    }

    // ✅ Resolver producto fuera de TX
    const prodResolved = await resolverProductoDataPorCodigo(
      tipoProducto === 'BOLSA' ? bvCodigoFinal : productoCodigoInput,
    );

    // ✅ tipoHielo final (solo BOLSA)
    let tipoHieloFinal: IceType | undefined =
      tipoProducto === 'BOLSA' && request.tipoHielo ? normalizeIceTypeSoft(request.tipoHielo) : undefined;

    // si viene, validarlo estricto
    if (tipoProducto === 'BOLSA' && tipoHieloFinal) {
      tipoHieloFinal = normalizeIceTypeStrict(tipoHieloFinal);
    }

    // =====================================================
    // TX: actualizar producto + guardar merma + movimiento
    // =====================================================
    return await runTransaction(db, async (tx) => {
      let productoExiste = false;

      let stockAnterior = 0;
      let stockNuevo = 0;

      let stockHieloAnterior: number | undefined;
      let stockHieloNuevo: number | undefined;

      let cuartosAnteriores: number | undefined;
      let cuartosNuevos: number | undefined;

      const nowDate = new Date();
      const nowTs = Timestamp.fromDate(nowDate);

      if (prodResolved) {
        const prodRef = prodResolved.ref;
        const prodSnap = await tx.get(prodRef);

        if (prodSnap.exists()) {
          productoExiste = true;
          const p: any = prodSnap.data();

          // ==========================
          // ✅ BARRA
          // ==========================
          if (tipoProducto === 'BARRA') {
            const field = cuartosFuenteFinal === 'USADOS' ? 'cuartosUsados' : 'cuartosDisponibles';
            const prev = Math.max(0, Math.floor(safeNumber(p?.[field])));

            cuartosAnteriores = prev;
            if (prev < cant) {
              const label = field === 'cuartosDisponibles' ? 'disponibles' : 'usados';
              throw new Error(`Cuartos insuficientes (${label}). Disponible: ${prev}, Merma: ${cant}`);
            }

            const next = prev - cant;
            cuartosNuevos = next;

            stockAnterior = prev;
            stockNuevo = next;

            tx.update(prodRef, {
              [field]: next,
              ultimaModificacion: nowTs,
            });
          }
          // ==========================
          // ✅ BOLSA_VACIA (BV)
          // ==========================
          else if (tipoProducto === 'BOLSA_VACIA') {
            const prevQty = Math.max(0, Math.floor(safeNumber(p?.cantidad)));
            stockAnterior = prevQty;

            if (prevQty < cant) throw new Error(`Stock insuficiente (BV). Disponible: ${prevQty}, Merma: ${cant}`);

            const nextQty = prevQty - cant;
            stockNuevo = nextQty;

            tx.update(prodRef, {
              cantidad: nextQty,
              ultimaModificacion: nowTs,
            });
          }
          // ==========================
          // ✅ BOLSA (LLENA) => stockPorHielo[tipo].stockActual
          // ==========================
          else if (tipoProducto === 'BOLSA') {
            const stockPorHielo = { ...(p.stockPorHielo ?? {}) } as Record<string, any>;

            if (!tipoHieloFinal) {
              const best = pickBestIceTypeByStock(stockPorHielo);
              if (!best) throw new Error('No se pudo determinar tipoHielo: no hay stockPorHielo disponible');
              tipoHieloFinal = best;
            }

            const tipo = normalizeIceTypeStrict(tipoHieloFinal);
            const cfg = stockPorHielo[tipo] ?? {};
            const prevGuardado = Math.max(0, Math.floor(safeNumber(cfg.stockActual)));

            // ✅ CLAVE: NO “AUTO-REPAIR” aquí (era el doble conteo)
            const disponibleReal = prevGuardado;

            stockHieloAnterior = disponibleReal;

            if (disponibleReal < cant) {
              throw new Error(
                `Stock insuficiente (BOLSA LLENA ${String(tipo)}). Disponible: ${disponibleReal}, Merma: ${cant}`,
              );
            }

            const nextH = disponibleReal - cant;
            stockHieloNuevo = nextH;

            stockPorHielo[tipo] = {
              ...cfg,
              stockActual: nextH,
              ultimaActualizacion: nowDate,
            };

            stockAnterior = disponibleReal;
            stockNuevo = nextH;

            tx.update(prodRef, {
              stockPorHielo,
              ultimaModificacion: nowTs,
            });
          }
        }
      }

      // =====================================================
      // 1) MERMA doc
      // =====================================================
      const merma: Merma = {
        codigo: codigoMerma,

        productoCodigo: tipoProducto === 'BOLSA' ? bvCodigoFinal : productoCodigoInput,
        productoNombre,

        tipoProducto,
        tipoHielo: tipoHieloFinal,

        cantidad: cant,
        motivo: String(request.motivo ?? '').trim(),
        motivoDetallado,

        registradoPorCodigo: normCode(empleadoCodigo),
        registradoPorNombre: String(empleadoNombre ?? '').trim() || '—',

        createdAt: nowDate,
        updatedAt: nowDate,
        turno,

        afectaStock: Boolean(afectaStock && productoExiste),

        stockAnterior: productoExiste ? stockAnterior : 0,
        stockNuevo: productoExiste ? stockNuevo : 0,

        stockHieloAnterior,
        stockHieloNuevo,

        cuartosAnteriores,
        cuartosNuevos,

        ...(tipoProducto === 'BARRA' ? { cuartosFuente: cuartosFuenteFinal } : {}),
      };

      const mermaRef = doc(collection(db, MERMAS_COLLECTION));
      tx.set(mermaRef, prepararParaFirestore(merma));

      // =====================================================
      // 2) MOVIMIENTO (CLAVE para Inventario UI)
      // =====================================================
      const movTipo = movimientoTipoForMerma(tipoProducto);

      const movimiento: any = {
        tipo: movTipo,
        mermaCodigo: codigoMerma,

        productoCodigo: merma.productoCodigo,
        productoNombre: merma.productoNombre,
        tipoProducto: merma.tipoProducto,
        tipoHielo: merma.tipoHielo ?? null,

        // 🔥 CLAVE: Inventario UI ajusta llenas por bolsaVaciaCodigo+tipoHielo
        bolsaVaciaCodigo: tipoProducto === 'BOLSA' ? bvCodigoFinal : null,

        // ✅ Bolsa llena: UI usa deltaPrincipal negativo
        deltaPrincipal: tipoProducto === 'BOLSA' ? -cant : null,

        // ✅ dejamos cantidad negativa para indicar RESTA (consistente)
        cantidad: -cant,

        empleadoCodigo: merma.registradoPorCodigo,
        empleadoNombre: merma.registradoPorNombre,

        motivo: merma.motivo,
        motivoDetallado: merma.motivoDetallado ?? null,

        // ✅ IMPORTANTÍSIMO: tu Inventario page debe SKIP si afectaStock:true
        afectaStock: true,

        stockAnterior: productoExiste ? stockAnterior : null,
        stockNuevo: productoExiste ? stockNuevo : null,

        stockHieloAnterior: stockHieloAnterior ?? null,
        stockHieloNuevo: stockHieloNuevo ?? null,

        cuartosAnteriores: cuartosAnteriores ?? null,
        cuartosNuevos: cuartosNuevos ?? null,
        cuartosFuente: tipoProducto === 'BARRA' ? (cuartosFuenteFinal ?? null) : null,

        fecha: nowDate,
        createdAt: nowDate,
        turno,
      };

      // opcional: mejorar nombre si no trae kg
      if (tipoProducto === 'BOLSA') {
        const kg = extractKgFromNombre(movimiento.productoNombre);
        if (!kg) {
          movimiento.productoNombre = `Bolsa llena ${String(movimiento.productoNombre ?? '').trim()}`.trim();
        }
      }

      const movRef = doc(collection(db, MOVIMIENTOS_COLLECTION));
      tx.set(movRef, prepararParaFirestore(movimiento));

      return { exito: true, mensaje: 'Merma registrada exitosamente', codigoMerma };
    });
  }

  // =====================================================
  // OBTENER MERMAS
  // =====================================================
  static async obtenerMermas(filtros?: {
    fechaInicio?: Date;
    fechaFin?: Date;
    empleadoCodigo?: string;
    productoCodigo?: string;
    tipoProducto?: MermaTipoProducto;
    motivo?: string;
    limit?: number;
  }): Promise<Merma[]> {
    try {
      const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];

      if (filtros?.empleadoCodigo) constraints.push(where('registradoPorCodigo', '==', normCode(filtros.empleadoCodigo)));
      if (filtros?.productoCodigo) constraints.push(where('productoCodigo', '==', normCode(filtros.productoCodigo)));
      if (filtros?.tipoProducto) constraints.push(where('tipoProducto', '==', filtros.tipoProducto));
      if (filtros?.motivo) constraints.push(where('motivo', '==', filtros.motivo));

      if (filtros?.fechaInicio) constraints.push(where('createdAt', '>=', Timestamp.fromDate(filtros.fechaInicio)));
      if (filtros?.fechaFin) constraints.push(where('createdAt', '<=', Timestamp.fromDate(filtros.fechaFin)));

      if (filtros?.limit) constraints.push(qLimit(filtros.limit));

      const snap = await getDocs(query(collection(db, MERMAS_COLLECTION), ...constraints));
      const out: Merma[] = [];

      snap.forEach((d) => {
        const data: any = d.data();
        out.push({
          id: d.id,

          codigo: data.codigo,
          productoCodigo: data.productoCodigo,
          productoNombre: data.productoNombre,
          tipoProducto: data.tipoProducto,
          tipoHielo: data.tipoHielo ?? undefined,

          cantidad: safeNumber(data.cantidad),
          motivo: data.motivo,
          motivoDetallado: data.motivoDetallado ?? undefined,

          registradoPorCodigo: data.registradoPorCodigo,
          registradoPorNombre: data.registradoPorNombre,

          createdAt: convertirTimestamp(data.createdAt),
          updatedAt: convertirTimestamp(data.updatedAt),
          turno: data.turno,

          afectaStock: true,

          stockAnterior: data.stockAnterior ?? 0,
          stockNuevo: data.stockNuevo ?? 0,

          stockHieloAnterior: data.stockHieloAnterior ?? undefined,
          stockHieloNuevo: data.stockHieloNuevo ?? undefined,

          cuartosAnteriores: data.cuartosAnteriores ?? undefined,
          cuartosNuevos: data.cuartosNuevos ?? undefined,
          cuartosFuente: data.cuartosFuente ?? undefined,
        });
      });

      return out;
    } catch (error) {
      console.error('❌ Error obteniendo mermas:', error);
      return [];
    }
  }

  static async obtenerMermaPorCodigo(codigo: string): Promise<Merma | null> {
    try {
      const cod = normCode(codigo);
      if (!cod) return null;

      const qRef = query(collection(db, MERMAS_COLLECTION), where('codigo', '==', cod), qLimit(1));
      const snap = await getDocs(qRef);
      if (snap.empty) return null;

      const d = snap.docs[0];
      const data: any = d.data();

      return {
        id: d.id,

        codigo: data.codigo,
        productoCodigo: data.productoCodigo,
        productoNombre: data.productoNombre,
        tipoProducto: data.tipoProducto,
        tipoHielo: data.tipoHielo ?? undefined,

        cantidad: safeNumber(data.cantidad),
        motivo: data.motivo,
        motivoDetallado: data.motivoDetallado ?? undefined,

        registradoPorCodigo: data.registradoPorCodigo,
        registradoPorNombre: data.registradoPorNombre,

        createdAt: convertirTimestamp(data.createdAt),
        updatedAt: convertirTimestamp(data.updatedAt),
        turno: data.turno,

        afectaStock: true,

        stockAnterior: data.stockAnterior ?? 0,
        stockNuevo: data.stockNuevo ?? 0,

        stockHieloAnterior: data.stockHieloAnterior ?? undefined,
        stockHieloNuevo: data.stockHieloNuevo ?? undefined,

        cuartosAnteriores: data.cuartosAnteriores ?? undefined,
        cuartosNuevos: data.cuartosNuevos ?? undefined,
        cuartosFuente: data.cuartosFuente ?? undefined,
      };
    } catch (error) {
      console.error('❌ Error obtenerMermaPorCodigo:', error);
      return null;
    }
  }

  static async obtenerMermasRecientes(limiteN: number = 20): Promise<Merma[]> {
    return this.obtenerMermas({ limit: limiteN });
  }

  // =====================================================
  // ESTADÍSTICAS
  // =====================================================
  static async obtenerEstadisticasMermas(fechaInicio?: Date, fechaFin?: Date): Promise<MermaStats> {
    const list = await this.obtenerMermas({
      fechaInicio,
      fechaFin,
      limit: 2500,
    });

    const totalMermas = (list ?? []).length;
    const totalCantidad = (list ?? []).reduce((s, m) => s + safeNumber(m.cantidad), 0);

    const valorEstimadoPerdido = (list ?? []).reduce((sum, m) => {
      const unit = m.tipoProducto === 'BARRA' ? 100 : m.tipoProducto === 'BOLSA' ? 30 : 5;
      return sum + unit * safeNumber(m.cantidad);
    }, 0);

    const byMotivo = new Map<string, number>();
    const byTipo = new Map<MermaTipoProducto, number>();
    const byEmp = new Map<string, { nombre: string; cantidad: number }>();
    const byMes = new Map<string, number>();

    for (const m of list ?? []) {
      const mot = String(m.motivo ?? 'OTRO');
      byMotivo.set(mot, (byMotivo.get(mot) ?? 0) + safeNumber(m.cantidad));

      byTipo.set(m.tipoProducto, (byTipo.get(m.tipoProducto) ?? 0) + safeNumber(m.cantidad));

      const emp = normCode(m.registradoPorCodigo) || 'SIN_CODIGO';
      const empCur = byEmp.get(emp);
      if (empCur) empCur.cantidad += safeNumber(m.cantidad);
      else byEmp.set(emp, { nombre: m.registradoPorNombre || 'SIN_NOMBRE', cantidad: safeNumber(m.cantidad) });

      const d = m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMes.set(mes, (byMes.get(mes) ?? 0) + safeNumber(m.cantidad));
    }

    const porMotivo = Array.from(byMotivo.entries())
      .map(([motivo, cantidad]) => ({
        motivo,
        cantidad,
        porcentaje: totalCantidad > 0 ? (cantidad / totalCantidad) * 100 : 0,
      }))
      .sort((a, b) => b.cantidad - a.cantidad);

    const porTipoProducto = Array.from(byTipo.entries())
      .map(([tipo, cantidad]) => ({
        tipo,
        cantidad,
        porcentaje: totalCantidad > 0 ? (cantidad / totalCantidad) * 100 : 0,
      }))
      .sort((a, b) => b.cantidad - a.cantidad);

    const porEmpleado = Array.from(byEmp.entries())
      .map(([empleadoCodigo, v]) => ({
        empleadoCodigo,
        empleadoNombre: v.nombre,
        cantidad: v.cantidad,
      }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 25);

    const tendenciaMensual = Array.from(byMes.entries())
      .map(([mes, cantidad]) => ({ mes, cantidad }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    return {
      totalMermas,
      totalCantidad,
      valorEstimadoPerdido,
      porMotivo,
      porTipoProducto,
      porEmpleado,
      tendenciaMensual,
      ultimaActualizacion: new Date(),
    };
  }

  // =====================================================
  // ⛔ CANCELAR MERMA — DESHABILITADO
  // =====================================================
  static async cancelarMerma(): Promise<{ exito: boolean; mensaje: string }> {
    throw new Error('Cancelación de merma deshabilitada: la merma NO tiene devuelta.');
  }

  // =====================================================
  // CODIGO SECUENCIAL MER###
  // =====================================================
  private static async generarSiguienteCodigo(): Promise<string> {
    try {
      const qRef = query(collection(db, MERMAS_COLLECTION), orderBy('codigo', 'desc'), qLimit(1));
      const snap = await getDocs(qRef);

      if (snap.empty) return 'MER001';

      const ultimo = String(snap.docs[0].data().codigo ?? 'MER000');
      const n = parseInt(ultimo.replace('MER', ''), 10);
      const next = Number.isFinite(n) ? n + 1 : 1;

      return `MER${String(next).padStart(3, '0')}`;
    } catch {
      const t = Date.now();
      return `MER${String(t % 1000).padStart(3, '0')}`;
    }
  }
}

export default MermasService;