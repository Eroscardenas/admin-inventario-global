// lib/services/asignacion.service.ts  ✅ PRODUCTION READY
// - ✅ COSECHA + UPSERT (suma en vez de duplicar)
// - ✅ Stock opcional: descuenta BV.cantidad en productos
// - ✅ Admin editar: ajusta stock BV.cantidad por delta (si stockAjustado=true)
// - ✅ Admin cancelar: regresa stock BV.cantidad (si stockAjustado=true)
// - ✅ Blindado: Firestore "all reads before all writes" (en 1 tx)

'use client';

import { db } from '@/lib/firebase/config.client';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  runTransaction,
  Timestamp,
  increment,
} from 'firebase/firestore';

export type TurnoType = 'MATUTINO' | 'VESPERTINO' | 'NOCTURNO';
export type AsignacionEstado = 'PENDIENTE' | 'COMPLETADA' | 'CANCELADA';
export type CosechaEstado = 'ABIERTA' | 'CERRADA' | 'CANCELADA';

export interface CrearAsignacionOpts {
  productoCodigo: string;
  productoNombre?: string;
  tipoHielo?: string;

  empleadoCodigo: string;
  empleadoNombre: string;

  turno: TurnoType;
  cantidad: number;

  observaciones?: string;
  cuartosAsignados?: number;
  pesoKg?: number;

  creadoPor: string;
  estado?: AsignacionEstado;
  fechaAsignacion?: Date;

  cosecha?: {
    modo: 'NUEVA' | 'EXISTENTE';
    cosechaId?: string;
    force?: boolean;
  };

  // si quieres que el service descuente/ajuste BV.cantidad dentro de la transacción
  stock?: {
    ajustarStock?: boolean;
    productoDocId?: string; // docId real en `productos`
  };
}

export class AsignacionService {
  static readonly COLECCION_ASIGNACIONES = 'asignaciones';
  static readonly COLECCION_COSECHAS = 'cosechas';
  static readonly COLECCION_PRODUCTOS = 'productos';

  /* ---------------------------
     Utils
  ---------------------------- */
  private static startOfDay(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }

  private static safeNum(v: any, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  private static genAsignacionCodigo() {
    return `ASG-${Date.now()}`;
  }

  private static genCosechaCodigo() {
    return `COS-${Date.now()}`;
  }

  private static itemId(cosechaId: string, empleadoCodigo: string, productoCodigo: string) {
    return `${cosechaId}__${empleadoCodigo}__${productoCodigo}`;
  }

  /* ============================================================
     Legacy API (compat)
============================================================ */
  static async crearAsignacion(opts: {
    productoCodigo: string;
    productoNombre?: string;
    tipoHielo?: string;
    empleadoCodigo: string;
    empleadoNombre: string;
    turno: TurnoType;
    cantidad: number;
    observaciones?: string;
    cuartosAsignados?: number;
    pesoKg?: number;
    creadoPor: string;
    estado?: AsignacionEstado;
    fechaAsignacion?: Date;
  }) {
    const now = new Date();

    const payload = {
      codigo: AsignacionService.genAsignacionCodigo(),

      productoCodigo: opts.productoCodigo,
      productoNombre: opts.productoNombre ?? '',
      tipoHielo: opts.tipoHielo ?? null,

      empleadoCodigo: opts.empleadoCodigo,
      empleadoNombre: opts.empleadoNombre,

      turno: opts.turno,
      cantidad: Number(opts.cantidad ?? 0),
      observaciones: opts.observaciones ?? '',
      cuartosAsignados: opts.cuartosAsignados ?? null,
      pesoKg: opts.pesoKg ?? null,

      creadoPor: opts.creadoPor,
      estado: opts.estado ?? 'PENDIENTE',

      fechaAsignacion: Timestamp.fromDate(opts.fechaAsignacion ?? now),
      createdAt: Timestamp.fromDate(now),

      updatedAt: null,
      updatedBy: null,

      // compat cosecha
      cosechaId: null,
      cosechaCodigo: null,
      cosechaEstado: null,

      // ✅ stock metadata (legacy: no ajusta stock aquí)
      stockAjustado: false,
      stockProductoDocId: null,
      stockUltimoAjuste: null,
      stockRevertido: false,
      stockRevertidoAt: null,
      stockRevertidoBy: null,
    };

    await addDoc(collection(db, AsignacionService.COLECCION_ASIGNACIONES), payload);
  }

  /* ============================================================
     PRO: COSECHA + UPSERT (suma en vez de duplicar)
     + ✅ descuento stock (opcional)
============================================================ */
  static async crearOActualizarAsignacionPorCosecha(opts: CrearAsignacionOpts) {
    const now = new Date();
    const fechaAsign = opts.fechaAsignacion ?? now;

    const cantidad = Number(opts.cantidad ?? 0);
    if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error('cantidad debe ser > 0');
    if (!opts.productoCodigo) throw new Error('productoCodigo requerido');
    if (!opts.empleadoCodigo) throw new Error('empleadoCodigo requerido');

    const modo = opts.cosecha?.modo ?? 'NUEVA';
    const cosechaIdElegida = opts.cosecha?.cosechaId;
    const force = !!opts.cosecha?.force;

    const ajustarStock = !!opts.stock?.ajustarStock;
    const productoDocId = String(opts.stock?.productoDocId ?? '').trim();

    if (ajustarStock && !productoDocId) {
      throw new Error('stock.productoDocId requerido si stock.ajustarStock=true');
    }

    await runTransaction(db, async (tx) => {
      // =========================================================
      // ✅ 1) READS FIRST (todas las lecturas antes de escribir)
      // =========================================================

      // (a) leer producto si vamos a ajustar stock
      const prodRef = ajustarStock ? doc(db, AsignacionService.COLECCION_PRODUCTOS, productoDocId) : null;
      let prodData: any = null;

      if (ajustarStock && prodRef) {
        const prodSnap = await tx.get(prodRef);
        if (!prodSnap.exists()) throw new Error('Producto no encontrado');
        prodData = prodSnap.data();
        const disponibles = AsignacionService.safeNum(prodData?.cantidad, 0);
        if (disponibles < cantidad) throw new Error(`Stock insuficiente. Disponibles: ${disponibles}`);
      }

      // (b) cosecha ref + lectura si EXISTENTE
      let cosechaId = '';
      let cosechaCodigo = '';
      let cosRef: any = null;

      if (modo === 'EXISTENTE') {
        if (!cosechaIdElegida) throw new Error('Selecciona una cosecha existente');
        cosRef = doc(db, AsignacionService.COLECCION_COSECHAS, cosechaIdElegida);

        const cs = await tx.get(cosRef);
        if (!cs.exists()) throw new Error('Cosecha no encontrada');

        const c = cs.data() as any;
        const estado = String(c.estado ?? 'ABIERTA') as CosechaEstado;

        if (estado !== 'ABIERTA' && !force) {
          throw new Error(`Cosecha no editable (estado=${estado}). Usa force para override admin.`);
        }

        cosechaId = cosRef.id;
        cosechaCodigo = String(c.codigo ?? cosRef.id);
      } else {
        cosRef = doc(collection(db, AsignacionService.COLECCION_COSECHAS));
        cosechaId = cosRef.id;
        cosechaCodigo = AsignacionService.genCosechaCodigo();
      }

      // (c) item ref + lectura para upsert
      const itemId = AsignacionService.itemId(cosechaId, opts.empleadoCodigo, opts.productoCodigo);
      const itemRef = doc(db, AsignacionService.COLECCION_ASIGNACIONES, itemId);
      const itemSnap = await tx.get(itemRef);
      const itemExists = itemSnap.exists();
      const itemPrev = itemExists ? (itemSnap.data() as any) : null;

      // =========================================================
      // ✅ 2) WRITES
      // =========================================================

      // (a) descontar stock BV.cantidad si procede
      if (ajustarStock && prodRef) {
        tx.update(prodRef, {
          cantidad: increment(-cantidad),
          ultimaModificacion: Timestamp.now(),
        });
      }

      // (b) crear/actualizar cosecha
      if (modo === 'EXISTENTE') {
        tx.update(cosRef, { updatedAt: Timestamp.now(), updatedBy: opts.creadoPor });
      } else {
        tx.set(cosRef, {
          codigo: cosechaCodigo,
          empleadoCodigo: opts.empleadoCodigo,
          empleadoNombre: opts.empleadoNombre,
          turno: opts.turno,

          fecha: Timestamp.fromDate(AsignacionService.startOfDay(fechaAsign)),
          estado: 'ABIERTA',
          creadoPor: opts.creadoPor,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          updatedBy: opts.creadoPor,

          totalItems: 0,
          totalBolsas: 0,
        });
      }

      // (c) upsert item (sumar cantidad)
      if (itemExists) {
        tx.update(itemRef, {
          cantidad: increment(cantidad),
          observaciones: opts.observaciones ?? itemPrev?.observaciones ?? '',
          turno: opts.turno,

          empleadoNombre: opts.empleadoNombre,
          productoNombre: opts.productoNombre ?? itemPrev?.productoNombre ?? '',

          updatedAt: Timestamp.now(),
          updatedBy: opts.creadoPor,

          estado: 'PENDIENTE',
          cosechaCodigo,
          cosechaEstado: 'ABIERTA',

          // ✅ stock metadata (si estás ajustando stock, queda marcado)
          ...(ajustarStock
            ? {
                stockAjustado: true,
                stockProductoDocId: productoDocId,
                stockUltimoAjuste: Timestamp.now(),
                stockRevertido: false,
                stockRevertidoAt: null,
                stockRevertidoBy: null,
              }
            : {}),
        });
      } else {
        tx.set(itemRef, {
          codigo: AsignacionService.genAsignacionCodigo(),
          productoCodigo: opts.productoCodigo,
          productoNombre: opts.productoNombre ?? '',
          tipoHielo: opts.tipoHielo ?? null,

          empleadoCodigo: opts.empleadoCodigo,
          empleadoNombre: opts.empleadoNombre,

          turno: opts.turno,
          cantidad,
          observaciones: opts.observaciones ?? '',
          cuartosAsignados: opts.cuartosAsignados ?? null,
          pesoKg: opts.pesoKg ?? null,

          creadoPor: opts.creadoPor,
          estado: opts.estado ?? 'PENDIENTE',

          fechaAsignacion: Timestamp.fromDate(fechaAsign),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          updatedBy: opts.creadoPor,

          cosechaId,
          cosechaCodigo,
          cosechaEstado: 'ABIERTA',

          // ✅ stock metadata
          stockAjustado: ajustarStock,
          stockProductoDocId: ajustarStock ? productoDocId : null,
          stockUltimoAjuste: ajustarStock ? Timestamp.now() : null,
          stockRevertido: false,
          stockRevertidoAt: null,
          stockRevertidoBy: null,
        });

        tx.update(cosRef, { totalItems: increment(1) });
      }

      // (d) totals cosecha
      tx.update(cosRef, {
        totalBolsas: increment(cantidad),
        updatedAt: Timestamp.now(),
        updatedBy: opts.creadoPor,
      });
    });
  }

  /* ============================================================
     ADMIN: editar item agrupado
     ✅ Ajusta stock BV.cantidad por delta si stockAjustado=true
============================================================ */
  static async adminEditarItem(opts: {
    asignacionId: string;
    actor: string;
    nuevaCantidad: number;
    nuevasObservaciones?: string;
    nuevoTurno?: TurnoType;
    force?: boolean;
  }) {
    const nuevaCantidad = Number(opts.nuevaCantidad ?? 0);
    if (!Number.isFinite(nuevaCantidad) || nuevaCantidad <= 0) throw new Error('nuevaCantidad debe ser > 0');

    const asgRef = doc(db, AsignacionService.COLECCION_ASIGNACIONES, opts.asignacionId);

    await runTransaction(db, async (tx) => {
      // ✅ READS FIRST
      const snap = await tx.get(asgRef);
      if (!snap.exists()) throw new Error('Asignación no encontrada');

      const a = snap.data() as any;
      const oldCant = AsignacionService.safeNum(a.cantidad, 0);

      const cosechaId = String(a.cosechaId ?? '').trim();
      const stockAjustado = !!a.stockAjustado;
      const stockProductoDocId = String(a.stockProductoDocId ?? '').trim();

      const delta = nuevaCantidad - oldCant; // si + => aumenta asignación; si - => baja asignación

      // (1) leer cosecha si aplica (para validar estado)
      let cosRef: any = null;
      if (cosechaId) {
        cosRef = doc(db, AsignacionService.COLECCION_COSECHAS, cosechaId);
        const cs = await tx.get(cosRef);
        if (cs.exists()) {
          const c = cs.data() as any;
          const estado = String(c.estado ?? 'ABIERTA') as CosechaEstado;
          if (estado !== 'ABIERTA' && !opts.force) {
            throw new Error(`Cosecha no editable (estado=${estado}). Usa force para override.`);
          }
        }
      }

      // (2) si stockAjustado, leer producto para validar si delta>0 (necesita stock)
      let prodRef: any = null;
      if (stockAjustado) {
        if (!stockProductoDocId) {
          throw new Error('Asignación marcada como stockAjustado pero falta stockProductoDocId.');
        }
        prodRef = doc(db, AsignacionService.COLECCION_PRODUCTOS, stockProductoDocId);
        const prodSnap = await tx.get(prodRef);
        if (!prodSnap.exists()) throw new Error('Producto (stock) no encontrado');
        const prod = prodSnap.data() as any;

        if (delta > 0) {
          const disponibles = AsignacionService.safeNum(prod?.cantidad, 0);
          if (disponibles < delta) {
            throw new Error(
              `Stock insuficiente para aumentar asignación. Disponibles: ${disponibles}, necesitas: ${delta}`
            );
          }
        }
      }

      // ✅ WRITES
      // (A) ajustar totalBolsas en cosecha
      if (cosRef && delta !== 0) {
        tx.update(cosRef, { totalBolsas: increment(delta), updatedAt: Timestamp.now(), updatedBy: opts.actor });
      }

      // (B) ajustar stock BV.cantidad
      // regla: stock ya estaba descontado por oldCant, entonces aplicamos -delta
      // - si delta>0 => increment(-delta) (descuenta más)
      // - si delta<0 => increment(-delta) (regresa porque -delta es +)
      if (stockAjustado && prodRef && delta !== 0) {
        tx.update(prodRef, {
          cantidad: increment(-delta),
          ultimaModificacion: Timestamp.now(),
        });
      }

      // (C) update asignación
      tx.update(asgRef, {
        cantidad: nuevaCantidad,
        observaciones: opts.nuevasObservaciones ?? a.observaciones ?? '',
        turno: opts.nuevoTurno ?? a.turno,
        updatedAt: Timestamp.now(),
        updatedBy: opts.actor,

        ...(stockAjustado
          ? {
              stockUltimoAjuste: Timestamp.now(),
              stockRevertido: false,
              stockRevertidoAt: null,
              stockRevertidoBy: null,
            }
          : {}),
      });
    });
  }

  /* ============================================================
     ADMIN: cancelar item agrupado
     ✅ Regresa stock BV.cantidad si stockAjustado=true
============================================================ */
  static async adminCancelarItem(opts: {
    asignacionId: string;
    actor: string;
    motivo?: string;
    force?: boolean;
  }) {
    const asgRef = doc(db, AsignacionService.COLECCION_ASIGNACIONES, opts.asignacionId);

    await runTransaction(db, async (tx) => {
      // ✅ READS FIRST
      const snap = await tx.get(asgRef);
      if (!snap.exists()) throw new Error('Asignación no encontrada');

      const a = snap.data() as any;
      const oldCant = AsignacionService.safeNum(a.cantidad, 0);

      const cosechaId = String(a.cosechaId ?? '').trim();
      const stockAjustado = !!a.stockAjustado;
      const stockProductoDocId = String(a.stockProductoDocId ?? '').trim();
      const yaCancelada = String(a.estado ?? 'PENDIENTE') === 'CANCELADA';

      // idempotente básico
      if (yaCancelada) return;

      // (1) leer cosecha si aplica (validar estado)
      let cosRef: any = null;
      if (cosechaId) {
        cosRef = doc(db, AsignacionService.COLECCION_COSECHAS, cosechaId);
        const cs = await tx.get(cosRef);
        if (cs.exists()) {
          const c = cs.data() as any;
          const estado = String(c.estado ?? 'ABIERTA') as CosechaEstado;
          if (estado !== 'ABIERTA' && !opts.force) {
            throw new Error(`Cosecha no cancelable (estado=${estado}). Usa force para override.`);
          }
        }
      }

      // (2) si stockAjustado, leer producto
      let prodRef: any = null;
      if (stockAjustado) {
        if (!stockProductoDocId) {
          throw new Error('Asignación marcada como stockAjustado pero falta stockProductoDocId.');
        }
        prodRef = doc(db, AsignacionService.COLECCION_PRODUCTOS, stockProductoDocId);
        const ps = await tx.get(prodRef);
        if (!ps.exists()) throw new Error('Producto (stock) no encontrado');
      }

      // ✅ WRITES
      // (A) cosecha totals
      if (cosRef && oldCant !== 0) {
        tx.update(cosRef, { totalBolsas: increment(-oldCant), updatedAt: Timestamp.now(), updatedBy: opts.actor });
      }

      // (B) regresar stock BV.cantidad
      if (stockAjustado && prodRef && oldCant !== 0) {
        tx.update(prodRef, {
          cantidad: increment(+oldCant),
          ultimaModificacion: Timestamp.now(),
        });
      }

      // (C) cancelar asignación
      tx.update(asgRef, {
        estado: 'CANCELADA',
        cancelReason: opts.motivo ?? '',
        updatedAt: Timestamp.now(),
        updatedBy: opts.actor,

        ...(stockAjustado
          ? {
              stockRevertido: true,
              stockRevertidoAt: Timestamp.now(),
              stockRevertidoBy: opts.actor,
            }
          : {}),
      });
    });
  }

  /* ============================================================
     Debug helper
============================================================ */
  static async getAsignacionById(asignacionId: string) {
    const ref = doc(db, AsignacionService.COLECCION_ASIGNACIONES, asignacionId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as any) };
  }
}
