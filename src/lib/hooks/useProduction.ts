// lib/services/production.service.ts  ✅ FINAL FIX + BATCH SALIDAS (1 MOVIMIENTO / N ITEMS) — PRODUCTION READY
// - ✅ FIX CRÍTICO: NO serializa FieldValue.increment() (evita _methodName increment en Firestore)
// - ✅ AUTO-REPAIR: si bv.cantidad o stockPorHielo.*.stockActual vienen CORRUPTOS (map increment), los repara en la misma transacción
// - ✅ Llenado desde asignación: increment + update anidado SIN prepararParaFirestore
// - ✅ Llenado directo: actualiza stockPorHielo sin borrar otros tipos
// - ✅ Disminuye BV.cantidad (bolsas vacías físicas)
// - ✅ NO se borran las llenas por tipo (stockPorHielo.* se mantiene)
// - ✅ Movimientos guardan fecha como Timestamp
// - ✅ productoNombre en movimientos = "Bolsa llena Xkg" (NO usa bv.nombre)
// - ✅ NUEVO: registrarSalidaStockBatch(): 1 salida con N items (1 movimiento + 1 tx)

'use client';

import { db } from '@/lib/firebase/config.client';
import type { IceType, MaquinaId, UbicacionId } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO } from '@/lib/utils/types/product.types';

import {
  collection,
  getDocs,
  query,
  where,
  doc,
  Timestamp,
  runTransaction,
  increment,
  FieldValue,
} from 'firebase/firestore';

const UBICACION_DEFAULT: UbicacionId = 'CAMARA_FRIA';

/** Timestamp helpers */
const toTs = (d: Date) => Timestamp.fromDate(d);

/** number safe */
const safeNum = (n: any, f = 0) => (Number.isFinite(Number(n)) ? Number(n) : f);

/** int safe */
const safeInt = (n: any, f = 0) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return f;
  const i = Math.floor(v);
  return i < 0 ? f : i;
};

const isFiniteNumber = (v: any) => typeof v === 'number' && Number.isFinite(v);

/**
 * ✅ Preparador SOLO para tipos simples/Date/Timestamp.
 * ❌ NO se usa para updates que traen FieldValue.increment().
 */
const prepararParaFirestorePlain = (value: any): any => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return toTs(value);
  if (value instanceof Timestamp) return value;
  if (Array.isArray(value)) return value.map(prepararParaFirestorePlain);
  if (typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) {
      const v = prepararParaFirestorePlain((value as any)[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return value;
};

/**
 * ✅ Si el payload trae FieldValue (increment/serverTimestamp/etc),
 * lo dejamos intacto y solo convertimos Date -> Timestamp.
 *
 * IMPORTANTE:
 * - En el SDK modular, FieldValue NO siempre es "instanceof FieldValue" de forma confiable.
 * - Por eso usamos un guard robusto por forma interna (_methodName) cuando aplique.
 */
const isFirestoreFieldValueLike = (v: any) => {
  if (!v) return false;
  // En increment() típicamente existe _methodName="increment"
  if (typeof v === 'object' && typeof v._methodName === 'string') return true;
  // fallback: SDK puede exponer isEqual
  if (typeof v === 'object' && typeof v.isEqual === 'function') return true;
  return false;
};

const prepararParaFirestoreAllowFieldValue = (value: any): any => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  // FieldValue (increment, serverTimestamp, deleteField, arrayUnion, etc.)
  // (NO serializar)
  if (isFirestoreFieldValueLike(value)) return value;

  if (value instanceof Date) return toTs(value);
  if (value instanceof Timestamp) return value;
  if (Array.isArray(value)) return value.map(prepararParaFirestoreAllowFieldValue);
  if (typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) {
      const v = prepararParaFirestoreAllowFieldValue((value as any)[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return value;
};

// ============================================================
// ✅ AUTO-REPAIR helpers (para docs ya corrompidos por increment serializado)
// ============================================================

function readCantidadRobustaFromBV(bv: any): number {
  const raw = bv?.cantidad;

  if (isFiniteNumber(raw)) return Math.floor(raw);
  if (typeof raw === 'string' && Number.isFinite(Number(raw))) return Math.floor(Number(raw));

  const hist = Array.isArray(bv?.historico) ? bv.historico : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const c = hist[i]?.cantidad;
    if (isFiniteNumber(c)) return Math.floor(c);
    if (typeof c === 'string' && Number.isFinite(Number(c))) return Math.floor(Number(c));
  }

  return 0;
}

function readStockActualRobusto(bv: any, tipo: IceType): number {
  const raw = bv?.stockPorHielo?.[tipo]?.stockActual;

  if (isFiniteNumber(raw)) return raw;
  if (typeof raw === 'string' && Number.isFinite(Number(raw))) return Number(raw);

  return 0;
}

function needsRepairNumber(v: any) {
  return !(typeof v === 'number' && Number.isFinite(v));
}

// ============================================================
// Tipos
// ============================================================

type LlenarStockOpts = {
  bolsaVaciaCodigo: string; // BVxxx (SKU base)
  tipoHielo: IceType;
  cantidad: number; // bolsas a llenar
  usuarioCodigo: string; // quien ejecuta
  usuarioNombre?: string;
  origen: 'ADMIN' | 'PRODUCCION';
  barraOrigenCodigo?: string; // requerido SOLO si tipoHielo === 'BARRA'
  maquina?: MaquinaId; // opcional admin, requerido producción
  observaciones?: string;
};

// ✅ tipado de salidas
type SalidaSubtipo = 'ENTREGA_TRANSPORTE' | 'VENTA_PUBLICO';
type SalidaDestino = 'TRANSPORTE' | 'PUBLICO';

type AjusteStockOpts = {
  bolsaVaciaCodigo: string; // BVxxx
  tipoHielo: IceType;
  cantidad: number; // unidades
  usuarioCodigo: string;
  usuarioNombre?: string;

  motivo?: string;
  destinatario?: string; // legacy
  observaciones?: string;

  empleadoAsignadoCodigo?: string;
  empleadoAsignadoNombre?: string;

  maquina?: MaquinaId;

  salidaSubtipo?: SalidaSubtipo; // default ENTREGA_TRANSPORTE
  salidaDestino?: SalidaDestino; // default TRANSPORTE
  clienteNombre?: string; // requerido si VENTA_PUBLICO
};

// ✅ NUEVO: batch items
export type SalidaBatchItem = {
  bolsaVaciaCodigo: string;
  tipoHielo: IceType;
  cantidad: number; // unidades
};

export type SalidaBatchOpts = Omit<AjusteStockOpts, 'bolsaVaciaCodigo' | 'tipoHielo' | 'cantidad'> & {
  items: SalidaBatchItem[];
};

type LlenarDesdeAsignacionOpts = {
  asignacionId: string; // docId real
  bolsaVaciaCodigo: string; // BVxxx
  productoNombre: string; // legacy (ya NO se usa para movimientos)
  tipoHielo: IceType;
  cantidad: number;

  barraOrigenCodigo?: string;

  empleadoCodigo: string;
  empleadoNombre: string;

  usuarioCodigo?: string;
  usuarioNombre?: string;

  origen?: 'PRODUCCION' | 'ADMIN';
  observaciones?: string;

  descontarBolsaVaciaFisica?: boolean; // default true
  maquina?: MaquinaId; // producción la selecciona
};

export class ProductionService {
  static COLECCION_PRODUCTOS = 'productos';
  static COLECCION_ASIGNACIONES = 'asignaciones';
  static COLECCION_MOVIMIENTOS = 'movimientos';

  // ============================================================
  // HELPERS internos
  // ============================================================

  static async #resolverProductoPorCodigo(codigo: string) {
    const snap = await getDocs(
      query(collection(db, ProductionService.COLECCION_PRODUCTOS), where('codigo', '==', codigo))
    );

    if (snap.empty) return null;

    if (snap.size > 1) {
      throw new Error(`Código duplicado en productos: ${codigo} (${snap.size} docs). Corrige duplicados.`);
    }

    return snap.docs[0];
  }

  /** ✅ Nombre “neutral” para movimientos (NO usa bv.nombre) */
  static #buildNombreBolsaLlena(bv: any) {
    const kg = safeNum(bv?.pesoKg, 0);
    return kg > 0 ? `Bolsa llena ${kg}kg` : 'Bolsa llena';
  }

  static #validarBolsaVacia(bv: any) {
    const codigo = String(bv?.codigo ?? '');
    const tipo = String(bv?.tipo ?? '').toUpperCase().trim();
    const status = String(bv?.status ?? '').toUpperCase().trim();

    const tipoOk = tipo === 'BOLSA' || tipo === 'BOLSA_VACIA';
    const statusOk = !status || status === 'VACIA' || status === 'VACIO' || status === 'DISPONIBLE';

    if (!tipoOk || !statusOk) {
      throw new Error(
        `Producto ${codigo || '(sin código)'} no es BV utilizable. tipo=${tipo || '(vacío)'} status=${status || '(vacío)'}`
      );
    }
  }

  static #getTiposPermitidosLikeUI(bv: any): IceType[] {
    const a = bv?.configuracionAdmin?.tiposHieloConfigurados;
    if (Array.isArray(a) && a.length) return a as IceType[];

    const b = bv?.configuracionEspecifica?.tiposHieloHabilitados;
    if (Array.isArray(b) && b.length) return b as IceType[];

    const c = bv?.tiposHieloPermitidos;
    if (Array.isArray(c) && c.length) return c as IceType[];

    return [...TIPOS_HIELO];
  }

  static #validarTipoPermitido(bv: any, tipoHielo: IceType) {
    const permitidos = ProductionService.#getTiposPermitidosLikeUI(bv);
    if (permitidos.length && !permitidos.includes(tipoHielo)) {
      throw new Error(`Este producto no permite tipoHielo=${tipoHielo}`);
    }
  }

  static #validarCantidad(cantidad: number) {
    if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error('Cantidad debe ser > 0');
  }

  static #validarMaquinaSiProduccion(origen: 'ADMIN' | 'PRODUCCION', maquina?: MaquinaId) {
    if (origen === 'PRODUCCION' && !maquina) {
      throw new Error('Debes seleccionar la máquina (M1/M2/M3).');
    }
  }

  static #normalizeSalidaMeta(opts: Pick<AjusteStockOpts, 'salidaSubtipo' | 'salidaDestino' | 'clienteNombre'>) {
    const subtipo: SalidaSubtipo = (opts as any).salidaSubtipo ?? 'ENTREGA_TRANSPORTE';
    const destino: SalidaDestino =
      (opts as any).salidaDestino ?? (subtipo === 'VENTA_PUBLICO' ? 'PUBLICO' : 'TRANSPORTE');

    const cliente = String((opts as any).clienteNombre ?? '').trim();

    if (subtipo === 'VENTA_PUBLICO' && !cliente) {
      throw new Error('Cliente requerido para Venta al Público.');
    }

    return { subtipo, destino, clienteNombre: cliente || null };
  }

  // ============================================================
  // ✅ AUTO-REPAIR en transacción (cantidad + stockActual si vienen corruptos)
  // ============================================================

  static #repairIfNeededInTx(tx: any, bvRef: any, bv: any, tipoHielo?: IceType, ahora?: Date) {
    const fixes: any = {};
    const now = ahora ?? new Date();

    if (needsRepairNumber(bv?.cantidad)) {
      fixes.cantidad = readCantidadRobustaFromBV(bv);
    }

    if (tipoHielo) {
      const raw = bv?.stockPorHielo?.[tipoHielo]?.stockActual;
      if (needsRepairNumber(raw)) {
        fixes[`stockPorHielo.${tipoHielo}.stockActual`] = readStockActualRobusto(bv, tipoHielo);
      }
    }

    if (Object.keys(fixes).length) {
      tx.update(
        bvRef,
        prepararParaFirestorePlain({
          ...fixes,
          ultimaModificacion: now,
        })
      );
    }

    return {
      cantidad: isFiniteNumber(bv?.cantidad) ? Math.floor(bv.cantidad) : safeInt(fixes.cantidad, 0),
      stockActual:
        tipoHielo && isFiniteNumber(bv?.stockPorHielo?.[tipoHielo]?.stockActual)
          ? Number(bv.stockPorHielo[tipoHielo].stockActual)
          : tipoHielo
          ? safeNum(fixes[`stockPorHielo.${tipoHielo}.stockActual`], 0)
          : 0,
    };
  }

  // ✅ repair múltiple para varios tipos en un mismo BV
  static #repairIfNeededInTxMulti(tx: any, bvRef: any, bv: any, tipos: IceType[], ahora?: Date) {
    const now = ahora ?? new Date();
    const fixes: any = {};

    if (needsRepairNumber(bv?.cantidad)) {
      fixes.cantidad = readCantidadRobustaFromBV(bv);
    }

    for (const tipo of tipos) {
      const raw = bv?.stockPorHielo?.[tipo]?.stockActual;
      if (needsRepairNumber(raw)) {
        fixes[`stockPorHielo.${tipo}.stockActual`] = readStockActualRobusto(bv, tipo);
      }
    }

    if (Object.keys(fixes).length) {
      tx.update(
        bvRef,
        prepararParaFirestorePlain({
          ...fixes,
          ultimaModificacion: now,
        })
      );
    }

    const stockActualByTipo: Record<string, number> = {};
    for (const tipo of tipos) {
      const live = bv?.stockPorHielo?.[tipo]?.stockActual;
      stockActualByTipo[tipo] = isFiniteNumber(live)
        ? Number(live)
        : safeNum(fixes[`stockPorHielo.${tipo}.stockActual`], 0);
    }

    const cantidad = isFiniteNumber(bv?.cantidad) ? Math.floor(bv.cantidad) : safeInt(fixes.cantidad, 0);

    return { cantidad, stockActualByTipo };
  }

  // ============================================================
  // ✅ LLENADO (ADMIN / PRODUCCIÓN) — DIRECTO
  // ============================================================
  static async llenarStockDesdeBolsaVacia(opts: LlenarStockOpts) {
    ProductionService.#validarCantidad(opts.cantidad);
    ProductionService.#validarMaquinaSiProduccion(opts.origen, opts.maquina);

    if (opts.tipoHielo === 'BARRA' && !opts.barraOrigenCodigo) {
      throw new Error('Para tipoHielo=BARRA debes mandar barraOrigenCodigo');
    }

    const bvDoc = await ProductionService.#resolverProductoPorCodigo(opts.bolsaVaciaCodigo);
    if (!bvDoc) throw new Error(`Bolsa vacía ${opts.bolsaVaciaCodigo} no encontrada`);

    let barraDoc: any = null;
    if (opts.tipoHielo === 'BARRA') {
      barraDoc = await ProductionService.#resolverProductoPorCodigo(opts.barraOrigenCodigo!);
      if (!barraDoc) throw new Error(`Barra ${opts.barraOrigenCodigo} no encontrada`);
    }

    const ahora = new Date();
    const ubicacion = UBICACION_DEFAULT;
    const maquina = opts.maquina;

    return await runTransaction(db, async (tx) => {
      const bvTx = await tx.get(bvDoc.ref);
      if (!bvTx.exists()) throw new Error('La bolsa vacía ya no existe');

      const bv = bvTx.data() as any;

      ProductionService.#validarBolsaVacia(bv);
      ProductionService.#validarTipoPermitido(bv, opts.tipoHielo);

      const repaired = ProductionService.#repairIfNeededInTx(tx, bvDoc.ref, bv, opts.tipoHielo, ahora);

      const bolsasVaciasDisponibles = safeNum(repaired.cantidad, 0);
      if (bolsasVaciasDisponibles < opts.cantidad) {
        throw new Error(
          `Stock insuficiente de bolsas vacías: ${bolsasVaciasDisponibles} disponible, ${opts.cantidad} solicitado`
        );
      }

      const prev = safeNum(repaired.stockActual, 0);
      const next = prev + opts.cantidad;

      // ✅ Barra: 1 cuarto por bolsa
      let barraPrev: number | null = null;
      let barraNext: number | null = null;

      if (opts.tipoHielo === 'BARRA') {
        const brTx = await tx.get(barraDoc.ref);
        if (!brTx.exists()) throw new Error('La barra ya no existe');

        const br = brTx.data() as any;
        if (String(br?.tipo ?? '') !== 'BARRA') throw new Error('El producto barraOrigen no es BARRA');

        const cuartosNecesarios = opts.cantidad;
        const disp = safeNum(br.cuartosDisponibles, 0);

        if (disp < cuartosNecesarios) {
          throw new Error(`Barra sin cuartos suficientes: ${disp} disponibles, ${cuartosNecesarios} necesarios`);
        }

        barraPrev = disp;
        barraNext = disp - cuartosNecesarios;

        tx.update(
          barraDoc.ref,
          prepararParaFirestorePlain({
            cuartosDisponibles: barraNext,
            cuartosUsados: safeNum(br.cuartosUsados, 0) + cuartosNecesarios,
            ultimaModificacion: ahora,
            ubicacionActual: ubicacion,
            ...(maquina ? { maquinaActual: maquina } : {}),
          })
        );
      }

      // ✅ UPDATE BV SIN BORRAR stockPorHielo completo:
      const bvUpdate: any = {
        cantidad: increment(-opts.cantidad),
        [`stockPorHielo.${opts.tipoHielo}.stockActual`]: increment(opts.cantidad),
        [`stockPorHielo.${opts.tipoHielo}.ultimaActualizacion`]: toTs(ahora),
        ultimaModificacion: toTs(ahora),
        ubicacionActual: ubicacion,
        ...(maquina ? { maquinaActual: maquina } : {}),
      };

      tx.update(bvDoc.ref, prepararParaFirestoreAllowFieldValue(bvUpdate));

      // ✅ Movimiento
      const movRef = doc(collection(db, ProductionService.COLECCION_MOVIMIENTOS));
      const nombreBolsaLlena = ProductionService.#buildNombreBolsaLlena(bv);

      tx.set(
        movRef,
        prepararParaFirestorePlain({
          codigo: `MOV-${Date.now()}`,
          tipo: 'LLENADO_BOLSA',
          origen: opts.origen,

          maquina: maquina ?? null,
          ubicacion,

          productoCodigo: opts.bolsaVaciaCodigo,
          productoNombre: nombreBolsaLlena,
          tipoProducto: 'BOLSA',
          status: 'LLENA',
          tipoHielo: opts.tipoHielo,

          deltaPrincipal: +opts.cantidad,
          principalAnterior: prev,
          principalNuevo: next,

          bolsaVaciaCodigo: opts.bolsaVaciaCodigo,
          barraOrigenCodigo: opts.tipoHielo === 'BARRA' ? opts.barraOrigenCodigo : undefined,
          cuartosUsados: opts.tipoHielo === 'BARRA' ? opts.cantidad : 0,

          usuarioCodigo: opts.usuarioCodigo,
          usuarioNombre: opts.usuarioNombre ?? '',

          observaciones:
            opts.observaciones ?? (opts.origen === 'ADMIN' ? 'Llenado (admin)' : 'Llenado (producción)'),

          fecha: ahora,
          createdAt: ahora,

          impactos: [
            {
              entidad: 'PRODUCTO',
              codigo: opts.bolsaVaciaCodigo,
              campo: 'cantidad',
              delta: -opts.cantidad,
              anterior: bolsasVaciasDisponibles,
              nuevo: bolsasVaciasDisponibles - opts.cantidad,
            },
            {
              entidad: 'PRODUCTO',
              codigo: opts.bolsaVaciaCodigo,
              campo: `stockPorHielo.${opts.tipoHielo}.stockActual`,
              delta: +opts.cantidad,
              anterior: prev,
              nuevo: next,
            },
            ...(opts.tipoHielo === 'BARRA'
              ? [
                  {
                    entidad: 'PRODUCTO',
                    codigo: opts.barraOrigenCodigo,
                    campo: 'cuartosDisponibles',
                    delta: -opts.cantidad,
                    anterior: barraPrev,
                    nuevo: barraNext,
                  },
                ]
              : []),
          ],
        })
      );

      return { bolsaVaciaCodigo: opts.bolsaVaciaCodigo, tipoHielo: opts.tipoHielo, cantidad: opts.cantidad };
    });
  }

  // ============================================================
  // ✅ LLENADO PRODUCCIÓN DESDE ASIGNACIÓN
  // ============================================================
  static async llenarDesdeAsignacion(opts: LlenarDesdeAsignacionOpts) {
    ProductionService.#validarCantidad(opts.cantidad);

    const ahora = new Date();
    const origen = opts.origen ?? 'PRODUCCION';
    const descontarBV = opts.descontarBolsaVaciaFisica !== false;

    ProductionService.#validarMaquinaSiProduccion(origen, opts.maquina);
    const maquina = opts.maquina;
    const ubicacion = UBICACION_DEFAULT;

    const refAsig = doc(db, ProductionService.COLECCION_ASIGNACIONES, opts.asignacionId);

    const bvDoc = await ProductionService.#resolverProductoPorCodigo(opts.bolsaVaciaCodigo);
    if (!bvDoc) throw new Error(`Bolsa vacía ${opts.bolsaVaciaCodigo} no encontrada`);

    let barraDoc: any = null;
    if (opts.tipoHielo === 'BARRA') {
      if (!opts.barraOrigenCodigo) throw new Error('Para tipoHielo=BARRA debes seleccionar barraOrigenCodigo');
      barraDoc = await ProductionService.#resolverProductoPorCodigo(opts.barraOrigenCodigo);
      if (!barraDoc) throw new Error(`Barra ${opts.barraOrigenCodigo} no encontrada`);
    }

    return await runTransaction(db, async (tx) => {
      const asigTx = await tx.get(refAsig);
      if (!asigTx.exists()) throw new Error('Asignación no encontrada');
      const asig = asigTx.data() as any;

      if (String(asig?.productoCodigo ?? '') !== String(opts.bolsaVaciaCodigo)) {
        throw new Error('La asignación no corresponde a esta BV');
      }

      const estado = String(asig?.estado ?? 'PENDIENTE');
      if (estado !== 'PENDIENTE') throw new Error(`Asignación no disponible (estado: ${estado})`);

      const disponiblesAsig = safeNum(asig?.cantidad, 0);
      if (disponiblesAsig < opts.cantidad) throw new Error(`Asignación insuficiente. Disponibles: ${disponiblesAsig}`);

      const bvTx = await tx.get(bvDoc.ref);
      if (!bvTx.exists()) throw new Error('La bolsa vacía ya no existe');
      const bv = bvTx.data() as any;

      ProductionService.#validarBolsaVacia(bv);
      ProductionService.#validarTipoPermitido(bv, opts.tipoHielo);

      const repaired = ProductionService.#repairIfNeededInTx(tx, bvDoc.ref, bv, opts.tipoHielo, ahora);

      const bolsasVaciasFisicas = safeNum(repaired.cantidad, 0);
      if (descontarBV && bolsasVaciasFisicas < opts.cantidad) {
        throw new Error(`No hay suficientes bolsas vacías físicas. Disponibles: ${bolsasVaciasFisicas}`);
      }

      const prevStock = safeNum(repaired.stockActual, 0);
      const nextStock = prevStock + opts.cantidad;

      let barraPrev: number | null = null;
      let barraNext: number | null = null;

      if (opts.tipoHielo === 'BARRA') {
        const brTx = await tx.get(barraDoc.ref);
        if (!brTx.exists()) throw new Error('La barra ya no existe');

        const br = brTx.data() as any;
        if (String(br?.tipo ?? '') !== 'BARRA') throw new Error('El producto barraOrigen no es BARRA');

        const cuartosNecesarios = opts.cantidad;
        const disp = safeNum(br?.cuartosDisponibles, 0);

        if (disp < cuartosNecesarios) {
          throw new Error(`Barra sin cuartos suficientes: ${disp} disponibles, ${cuartosNecesarios} necesarios`);
        }

        barraPrev = disp;
        barraNext = disp - cuartosNecesarios;

        tx.update(
          barraDoc.ref,
          prepararParaFirestorePlain({
            cuartosDisponibles: barraNext,
            cuartosUsados: safeNum(br?.cuartosUsados, 0) + cuartosNecesarios,
            ultimaModificacion: ahora,
            ubicacionActual: ubicacion,
            ...(maquina ? { maquinaActual: maquina } : {}),
          })
        );
      }

      // ✅ update asignación
      const nuevoAsig = disponiblesAsig - opts.cantidad;
      tx.update(
        refAsig,
        prepararParaFirestorePlain({
          cantidad: nuevoAsig,
          updatedAt: ahora,
          ...(nuevoAsig === 0 ? { estado: 'COMPLETADA' } : {}),
        })
      );

      // ✅ update BV con increment (SIN prepararPlain)
      const bvUpdate: any = {
        [`stockPorHielo.${opts.tipoHielo}.stockActual`]: increment(opts.cantidad),
        [`stockPorHielo.${opts.tipoHielo}.ultimaActualizacion`]: toTs(ahora),
        ultimaModificacion: toTs(ahora),
        ubicacionActual: ubicacion,
        ...(maquina ? { maquinaActual: maquina } : {}),
      };
      if (descontarBV) bvUpdate.cantidad = increment(-opts.cantidad);

      tx.update(bvDoc.ref, prepararParaFirestoreAllowFieldValue(bvUpdate));

      // ✅ movimiento
      const movRef = doc(collection(db, ProductionService.COLECCION_MOVIMIENTOS));
      const nombreBolsaLlena = ProductionService.#buildNombreBolsaLlena(bv);

      tx.set(
        movRef,
        prepararParaFirestorePlain({
          codigo: `MOV-${Date.now()}`,
          tipo: 'LLENADO_BOLSA',
          origen,

          maquina: maquina ?? null,
          ubicacion,

          productoCodigo: opts.bolsaVaciaCodigo,
          productoNombre: nombreBolsaLlena,
          tipoProducto: 'BOLSA',

          deltaPrincipal: +opts.cantidad,
          principalAnterior: prevStock,
          principalNuevo: nextStock,

          tipoHielo: opts.tipoHielo,
          status: 'LLENA',

          bolsaVaciaCodigo: opts.bolsaVaciaCodigo,
          bolsaAsignadaCodigo: asig?.bolsaAsignadaCodigo ?? undefined,

          barraOrigenCodigo: opts.tipoHielo === 'BARRA' ? opts.barraOrigenCodigo : undefined,
          cuartosUsados: opts.tipoHielo === 'BARRA' ? opts.cantidad : 0,

          observaciones: opts.observaciones ?? '',

          empleadoAsignadoCodigo: opts.empleadoCodigo,
          empleadoAsignadoNombre: opts.empleadoNombre,

          usuarioCodigo: opts.usuarioCodigo ?? opts.empleadoCodigo,
          usuarioNombre: opts.usuarioNombre ?? opts.empleadoNombre,

          turno: asig?.turno ?? undefined,

          fecha: ahora,
          createdAt: ahora,

          impactos: [
            {
              entidad: 'ASIGNACION',
              codigo: asig?.codigo ?? opts.asignacionId,
              campo: 'cantidad',
              delta: -opts.cantidad,
              anterior: disponiblesAsig,
              nuevo: nuevoAsig,
            },
            ...(descontarBV
              ? [
                  {
                    entidad: 'PRODUCTO',
                    codigo: opts.bolsaVaciaCodigo,
                    campo: 'cantidad',
                    delta: -opts.cantidad,
                    anterior: bolsasVaciasFisicas,
                    nuevo: bolsasVaciasFisicas - opts.cantidad,
                  },
                ]
              : []),
            {
              entidad: 'PRODUCTO',
              codigo: opts.bolsaVaciaCodigo,
              campo: `stockPorHielo.${opts.tipoHielo}.stockActual`,
              delta: +opts.cantidad,
              anterior: prevStock,
              nuevo: nextStock,
            },
            ...(opts.tipoHielo === 'BARRA'
              ? [
                  {
                    entidad: 'PRODUCTO',
                    codigo: opts.barraOrigenCodigo,
                    campo: 'cuartosDisponibles',
                    delta: -opts.cantidad,
                    anterior: barraPrev,
                    nuevo: barraNext,
                  },
                ]
              : []),
          ],
        })
      );

      return { ok: true };
    });
  }

  // ============================================================
  // SALIDA / MERMA / DEVOLUCIÓN (stockPorHielo)
  // ============================================================

  static async registrarSalidaStock(opts: AjusteStockOpts) {
    const meta = ProductionService.#normalizeSalidaMeta(opts);

    return await ProductionService.#ajustarStockPorHielo({
      ...opts,
      salidaSubtipo: meta.subtipo,
      salidaDestino: meta.destino,
      clienteNombre: meta.clienteNombre ?? undefined,

      tipoMovimiento: 'SALIDA',
      delta: -Math.abs(opts.cantidad),
      origen: 'PRODUCCION',
    });
  }

  // ✅ NUEVO: SALIDA BATCH (1 MOVIMIENTO / N ITEMS) — recomendado para tu “carrito”
  static async registrarSalidaStockBatch(opts: SalidaBatchOpts) {
    if (!opts.items || !Array.isArray(opts.items) || opts.items.length === 0) {
      throw new Error('Debes enviar items[] (al menos 1) para registrar salida batch.');
    }

    const salidaMeta = ProductionService.#normalizeSalidaMeta(opts);

    // normaliza items: int >0, agrupa por BV+tipo
    const grouped = new Map<string, { bolsaVaciaCodigo: string; tipoHielo: IceType; cantidad: number }>();

    for (const it of opts.items) {
      const bv = String(it?.bolsaVaciaCodigo ?? '').trim();
      const tipo = it?.tipoHielo as IceType;
      const qty = safeInt(it?.cantidad, 0);

      if (!bv) throw new Error('Item inválido: bolsaVaciaCodigo vacío.');
      if (!TIPOS_HIELO.includes(tipo)) throw new Error(`Item inválido: tipoHielo no válido (${String(tipo)}).`);
      if (qty <= 0) throw new Error('Item inválido: cantidad debe ser > 0.');

      const key = `${bv}__${tipo}`;
      const prev = grouped.get(key);
      grouped.set(
        key,
        prev
          ? { ...prev, cantidad: prev.cantidad + qty }
          : { bolsaVaciaCodigo: bv, tipoHielo: tipo, cantidad: qty }
      );
    }

    const itemsAgrupados = Array.from(grouped.values());

    // resolver refs fuera de tx (para detectar duplicados de código)
    const uniqueBV = Array.from(new Set(itemsAgrupados.map((x) => x.bolsaVaciaCodigo)));
    const bvDocsByCodigo = new Map<string, any>();

    for (const codigo of uniqueBV) {
      const bvDoc = await ProductionService.#resolverProductoPorCodigo(codigo);
      if (!bvDoc) throw new Error(`Bolsa vacía ${codigo} no encontrada`);
      bvDocsByCodigo.set(codigo, bvDoc);
    }

    const ahora = new Date();
    const ubicacion = UBICACION_DEFAULT;
    const maquina = opts.maquina;

    // agrupar por BV para hacer 1 update por doc (con N tipos)
    const byBV = new Map<string, Array<{ tipoHielo: IceType; cantidad: number }>>();
    for (const it of itemsAgrupados) {
      const arr = byBV.get(it.bolsaVaciaCodigo) ?? [];
      arr.push({ tipoHielo: it.tipoHielo, cantidad: it.cantidad });
      byBV.set(it.bolsaVaciaCodigo, arr);
    }

    return await runTransaction(db, async (tx) => {
      const batchItemsMov: any[] = [];
      const impactos: any[] = [];

      for (const [bvCodigo, arr] of byBV.entries()) {
        const bvDoc = bvDocsByCodigo.get(bvCodigo);
        const bvTx = await tx.get(bvDoc.ref);
        if (!bvTx.exists()) throw new Error(`La bolsa vacía ${bvCodigo} ya no existe`);

        const bv = bvTx.data() as any;

        ProductionService.#validarBolsaVacia(bv);

        const tipos = Array.from(new Set(arr.map((x) => x.tipoHielo)));
        for (const t of tipos) ProductionService.#validarTipoPermitido(bv, t);

        // repair robusto para estos tipos
        const repaired = ProductionService.#repairIfNeededInTxMulti(tx, bvDoc.ref, bv, tipos, ahora);

        const bvUpdate: any = {
          ultimaModificacion: toTs(ahora),
          ubicacionActual: ubicacion,
          ...(maquina ? { maquinaActual: maquina } : {}),
        };

        for (const it of arr) {
          const prevStock = safeNum(repaired.stockActualByTipo[it.tipoHielo], 0);
          const delta = -Math.abs(it.cantidad);
          const nextStock = prevStock + delta;

          if (nextStock < 0) {
            throw new Error(
              `Stock insuficiente en ${bvCodigo} / ${it.tipoHielo}: ${prevStock} disponible, quieres ajustar ${delta}`
            );
          }

          bvUpdate[`stockPorHielo.${it.tipoHielo}.stockActual`] = increment(delta);
          bvUpdate[`stockPorHielo.${it.tipoHielo}.ultimaActualizacion`] = toTs(ahora);

          const nombreBolsaLlena = ProductionService.#buildNombreBolsaLlena(bv);

          batchItemsMov.push({
            bolsaVaciaCodigo: bvCodigo,
            productoCodigo: bvCodigo,
            productoNombre: nombreBolsaLlena,
            tipoHielo: it.tipoHielo,
            cantidad: it.cantidad,
            delta,
            anterior: prevStock,
            nuevo: nextStock,
          });

          impactos.push({
            entidad: 'PRODUCTO',
            codigo: bvCodigo,
            campo: `stockPorHielo.${it.tipoHielo}.stockActual`,
            delta,
            anterior: prevStock,
            nuevo: nextStock,
          });
        }

        tx.update(bvDoc.ref, prepararParaFirestoreAllowFieldValue(bvUpdate));
      }

      // 1 solo movimiento
      const movRef = doc(collection(db, ProductionService.COLECCION_MOVIMIENTOS));

      const empleadoCodigo = opts.empleadoAsignadoCodigo ?? opts.usuarioCodigo;
      const empleadoNombre = opts.empleadoAsignadoNombre ?? opts.usuarioNombre ?? '';

      tx.set(
        movRef,
        prepararParaFirestorePlain({
          codigo: `MOV-${Date.now()}`,
          tipo: 'SALIDA_BOLSA', // ✅ no rompe pantallas
          batch: true,
          batchCount: batchItemsMov.length,

          origen: 'PRODUCCION',

          maquina: maquina ?? null,
          ubicacion,

          salidaSubtipo: salidaMeta.subtipo,
          salidaDestino: salidaMeta.destino,
          clienteNombre: salidaMeta.clienteNombre,

          motivo: opts.motivo ?? '',
          destinatario: opts.destinatario ?? '',
          observaciones: opts.observaciones ?? '',

          usuarioCodigo: opts.usuarioCodigo,
          usuarioNombre: opts.usuarioNombre ?? '',

          empleadoAsignadoCodigo: empleadoCodigo,
          empleadoAsignadoNombre: empleadoNombre,

          fecha: ahora,
          createdAt: ahora,

          items: batchItemsMov,
          impactos,
        })
      );

      return { ok: true, items: batchItemsMov.length };
    });
  }

  static async registrarSalidaVentaPublico(
    opts: Omit<AjusteStockOpts, 'salidaSubtipo' | 'salidaDestino'> & { clienteNombre: string }
  ) {
    return await ProductionService.registrarSalidaStock({
      ...opts,
      salidaSubtipo: 'VENTA_PUBLICO',
      salidaDestino: 'PUBLICO',
      destinatario: opts.destinatario ?? opts.clienteNombre,
      clienteNombre: opts.clienteNombre,
    });
  }

  static async registrarMermaStock(opts: AjusteStockOpts) {
    return await ProductionService.#ajustarStockPorHielo({
      ...opts,
      tipoMovimiento: 'MERMA',
      delta: -Math.abs(opts.cantidad),
      origen: 'PRODUCCION',
    });
  }

  static async registrarDevolucionStock(opts: AjusteStockOpts) {
    return await ProductionService.#ajustarStockPorHielo({
      ...opts,
      tipoMovimiento: 'DEVOLUCION',
      delta: Math.abs(opts.cantidad),
      origen: 'PRODUCCION',
    });
  }

  static async #ajustarStockPorHielo(
    opts: AjusteStockOpts & {
      tipoMovimiento: 'SALIDA' | 'MERMA' | 'DEVOLUCION';
      delta: number;
      origen: 'ADMIN' | 'PRODUCCION';
    }
  ) {
    ProductionService.#validarCantidad(opts.cantidad);

    const bvDoc = await ProductionService.#resolverProductoPorCodigo(opts.bolsaVaciaCodigo);
    if (!bvDoc) throw new Error(`Bolsa vacía ${opts.bolsaVaciaCodigo} no encontrada`);

    const ahora = new Date();
    const ubicacion = UBICACION_DEFAULT;
    const maquina = opts.maquina;

    const salidaMeta =
      opts.tipoMovimiento === 'SALIDA'
        ? ProductionService.#normalizeSalidaMeta(opts)
        : { subtipo: null, destino: null, clienteNombre: null };

    return await runTransaction(db, async (tx) => {
      const bvTx = await tx.get(bvDoc.ref);
      if (!bvTx.exists()) throw new Error('La bolsa vacía ya no existe');

      const bv = bvTx.data() as any;
      ProductionService.#validarBolsaVacia(bv);
      ProductionService.#validarTipoPermitido(bv, opts.tipoHielo);

      const repaired = ProductionService.#repairIfNeededInTx(tx, bvDoc.ref, bv, opts.tipoHielo, ahora);

      const prev = safeNum(repaired.stockActual, 0);
      const next = prev + opts.delta;

      if (next < 0) {
        throw new Error(`Stock insuficiente en ${opts.tipoHielo}: ${prev} disponible, quieres ajustar ${opts.delta}`);
      }

      const bvUpdate: any = {
        [`stockPorHielo.${opts.tipoHielo}.stockActual`]: increment(opts.delta),
        [`stockPorHielo.${opts.tipoHielo}.ultimaActualizacion`]: toTs(ahora),
        ultimaModificacion: toTs(ahora),
        ubicacionActual: ubicacion,
        ...(maquina ? { maquinaActual: maquina } : {}),
      };

      tx.update(bvDoc.ref, prepararParaFirestoreAllowFieldValue(bvUpdate));

      const movRef = doc(collection(db, ProductionService.COLECCION_MOVIMIENTOS));

      const empleadoCodigo = opts.empleadoAsignadoCodigo ?? opts.usuarioCodigo;
      const empleadoNombre = opts.empleadoAsignadoNombre ?? opts.usuarioNombre ?? '';

      const nombreBolsaLlena = ProductionService.#buildNombreBolsaLlena(bv);

      tx.set(
        movRef,
        prepararParaFirestorePlain({
          codigo: `MOV-${Date.now()}`,
          tipo:
            opts.tipoMovimiento === 'MERMA'
              ? 'MERMA_BOLSA'
              : opts.tipoMovimiento === 'DEVOLUCION'
              ? 'DEVOLUCION_BOLSA'
              : 'SALIDA_BOLSA',

          origen: opts.origen,

          maquina: maquina ?? null,
          ubicacion,

          salidaSubtipo: salidaMeta.subtipo,
          salidaDestino: salidaMeta.destino,
          clienteNombre: salidaMeta.clienteNombre,

          productoCodigo: opts.bolsaVaciaCodigo,
          productoNombre: nombreBolsaLlena,
          tipoProducto: 'BOLSA',

          deltaPrincipal: opts.delta,
          principalAnterior: prev,
          principalNuevo: next,

          tipoHielo: opts.tipoHielo,
          status: 'LLENA',

          motivo: opts.motivo ?? '',
          destinatario: opts.destinatario ?? '',
          observaciones: opts.observaciones ?? '',

          usuarioCodigo: opts.usuarioCodigo,
          usuarioNombre: opts.usuarioNombre ?? '',

          empleadoAsignadoCodigo: empleadoCodigo,
          empleadoAsignadoNombre: empleadoNombre,

          fecha: ahora,
          createdAt: ahora,

          impactos: [
            {
              entidad: 'PRODUCTO',
              codigo: opts.bolsaVaciaCodigo,
              campo: `stockPorHielo.${opts.tipoHielo}.stockActual`,
              delta: opts.delta,
              anterior: prev,
              nuevo: next,
            },
          ],
        })
      );

      return { bolsaVaciaCodigo: opts.bolsaVaciaCodigo, tipoHielo: opts.tipoHielo, stockNuevo: next };
    });
  }
}
