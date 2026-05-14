'use client';

// lib/services/production.service.ts

import { db } from '@/lib/firebase/config.client';
import type { IceType, MaquinaId, UbicacionId } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO } from '@/lib/utils/types/product.types';

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  Timestamp,
  runTransaction,
  increment,
  limit as qLimit,
  type DocumentReference,
  type QueryConstraint,
} from 'firebase/firestore';

const PRODUCTOS_COLLECTION = 'productos';
const ASIGNACIONES_COLLECTION = 'asignaciones';
const MOVIMIENTOS_COLLECTION = 'movimientos';

const UBICACION_DEFAULT: UbicacionId = 'CAMARA_FRIA';

const toTs = (d: Date) => Timestamp.fromDate(d);

const safeNum = (n: any, f = 0) => (Number.isFinite(Number(n)) ? Number(n) : f);

const safeInt = (n: any, f = 0) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return f;
  const i = Math.floor(v);
  return i < 0 ? f : i;
};

const isFiniteNumber = (v: any) => typeof v === 'number' && Number.isFinite(v);

const safeStr = (v: any) => String(v ?? '').trim();

const prepararParaFirestorePlain = (value: any): any => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return toTs(value);
  if (value instanceof Timestamp) return value;

  if (Array.isArray(value)) return value.map(prepararParaFirestorePlain);

  if (typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) {
      const v = prepararParaFirestorePlain(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  return value;
};

const isFirestoreFieldValueLike = (v: any) => {
  if (!v) return false;
  if (typeof v === 'object' && typeof (v as any)._methodName === 'string') return true;
  if (typeof v === 'object' && typeof (v as any).isEqual === 'function') return true;
  return false;
};

const prepararParaFirestoreAllowFieldValue = (value: any): any => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (isFirestoreFieldValueLike(value)) return value;

  if (value instanceof Date) return toTs(value);
  if (value instanceof Timestamp) return value;

  if (Array.isArray(value)) return value.map(prepararParaFirestoreAllowFieldValue);

  if (typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) {
      const v = prepararParaFirestoreAllowFieldValue(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  return value;
};

function needsRepairNumber(v: any) {
  return !(typeof v === 'number' && Number.isFinite(v));
}

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

function readBarraCuartosRobusto(br: any) {
  const barrasFisicas = safeInt(br?.cantidad, 0);
  const cuartosTotales = Number.isFinite(Number(br?.cuartosTotales))
    ? Number(br.cuartosTotales)
    : barrasFisicas * 4;

  const cuartosUsadosRaw = safeNum(br?.cuartosUsados, 0);
  const cuartosUsados = Math.min(Math.max(0, cuartosUsadosRaw), cuartosTotales);

  let cuartosDisponibles: number;

  if (Number.isFinite(Number(br?.cuartosDisponibles))) {
    cuartosDisponibles = Math.max(0, Number(br.cuartosDisponibles));
  } else {
    cuartosDisponibles = Math.max(0, cuartosTotales - cuartosUsados);
  }

  const recomputed = Math.max(0, cuartosTotales - cuartosUsados);
  if (Math.abs(cuartosDisponibles - recomputed) > 0) {
    cuartosDisponibles = recomputed;
  }

  return { barrasFisicas, cuartosTotales, cuartosUsados, cuartosDisponibles };
}

function normalizeIceType(v: any): IceType {
  const t = String(v ?? '').trim().toUpperCase();

  if (!(TIPOS_HIELO as readonly string[]).includes(t)) {
    throw new Error(`tipoHielo inválido: "${t}". Usa: ${TIPOS_HIELO.join(', ')}`);
  }

  return t as IceType;
}

function buildInventoryKey(bolsaVaciaCodigo: string, tipoHielo: IceType | string, pesoKg: number) {
  return `${safeStr(bolsaVaciaCodigo).toUpperCase()}__${safeStr(tipoHielo).toUpperCase()}__${safeNum(pesoKg, 0)}`;
}

type LlenarStockOpts = {
  bolsaVaciaCodigo: string;
  tipoHielo: IceType;
  cantidad: number;
  usuarioCodigo: string;
  usuarioNombre?: string;
  origen: 'ADMIN' | 'PRODUCCION';
  barraOrigenCodigo?: string;
  maquina?: MaquinaId;
  observaciones?: string;
};

type SalidaSubtipo = 'ENTREGA_TRANSPORTE' | 'VENTA_PUBLICO';
type SalidaDestino = 'TRANSPORTE' | 'PUBLICO';

type SalidaProductMeta = {
  productoCodigo?: string;
  productoNombre?: string;
  pesoKg?: number;
  inventoryKey?: string;
};

type AjusteStockOpts = SalidaProductMeta & {
  bolsaVaciaCodigo: string;
  tipoHielo: IceType;
  cantidad: number;
  usuarioCodigo: string;
  usuarioNombre?: string;

  motivo?: string;
  destinatario?: string;
  observaciones?: string;

  empleadoAsignadoCodigo?: string;
  empleadoAsignadoNombre?: string;

  maquina?: MaquinaId;

  salidaSubtipo?: SalidaSubtipo;
  salidaDestino?: SalidaDestino;
  clienteNombre?: string;
};

export type SalidaBatchItem = SalidaProductMeta & {
  bolsaVaciaCodigo: string;
  tipoHielo: IceType;
  cantidad: number;
};

export type SalidaBatchOpts = Omit<AjusteStockOpts, 'bolsaVaciaCodigo' | 'tipoHielo' | 'cantidad'> & {
  items: SalidaBatchItem[];
};

type LlenarDesdeAsignacionOpts = {
  asignacionId: string;
  bolsaVaciaCodigo: string;
  productoNombre: string;
  tipoHielo: IceType;
  cantidad: number;

  barraOrigenCodigo?: string;

  empleadoCodigo: string;
  empleadoNombre: string;

  usuarioCodigo?: string;
  usuarioNombre?: string;

  origen?: 'PRODUCCION' | 'ADMIN';
  observaciones?: string;

  descontarBolsaVaciaFisica?: boolean;

  maquina?: MaquinaId;
};

type AutoLlenarBarraOpts = {
  barraOrigenCodigo: string;
  cuartosDisponiblesAUsar: number;
  usuarioCodigo: string;
  usuarioNombre?: string;
  origen: 'ALTA_BARRA' | 'PRODUCCION_BARRA';
  maquina?: MaquinaId;
  observaciones?: string;
};

export class ProductionService {
  static COLECCION_PRODUCTOS = PRODUCTOS_COLLECTION;
  static COLECCION_ASIGNACIONES = ASIGNACIONES_COLLECTION;
  static COLECCION_MOVIMIENTOS = MOVIMIENTOS_COLLECTION;

  static async #resolverProductoPorCodigo(codigo: string) {
    const cod = String(codigo ?? '').trim().toUpperCase();
    if (!cod) return null;

    const snap = await getDocs(
      query(collection(db, PRODUCTOS_COLLECTION), where('codigo', '==', cod), qLimit(1))
    );

    if (snap.empty) return null;

    return snap.docs[0];
  }

  static async #resolverRefsPorCodigos(codigos: string[]) {
    const unique = Array.from(
      new Set(
        codigos
          .map((c) => String(c ?? '').trim().toUpperCase())
          .filter(Boolean)
      )
    );

    const out = new Map<string, { ref: DocumentReference; data?: any }>();
    if (!unique.length) return out;

    const colRef = collection(db, PRODUCTOS_COLLECTION);
    const chunkSize = 10;

    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const snap = await getDocs(query(colRef, where('codigo', 'in', chunk)));

      snap.forEach((d) => {
        const data = d.data() as any;
        const codigo = String(data?.codigo ?? '').trim().toUpperCase();
        if (codigo) out.set(codigo, { ref: d.ref as any, data });
      });
    }

    return out;
  }

  static #buildNombreBolsaLlena(bv: any) {
    const kg = safeNum(bv?.pesoKg, 0);
    return kg > 0 ? `Bolsa llena ${kg}kg` : 'Bolsa llena';
  }

  static #resolveSalidaProductMeta(input: SalidaProductMeta & { bolsaVaciaCodigo: string; tipoHielo: IceType }, bvData: any) {
    const bvCodigo = safeStr(input.bolsaVaciaCodigo).toUpperCase();
    const tipoHielo = normalizeIceType(input.tipoHielo);
    const pesoKg = safeNum(input.pesoKg, safeNum(bvData?.pesoKg, 0));

    const productoCodigo = safeStr(input.productoCodigo) || bvCodigo;
    const productoNombre = safeStr(input.productoNombre) || ProductionService.#buildNombreBolsaLlena(bvData);
    const inventoryKey = safeStr(input.inventoryKey) || buildInventoryKey(bvCodigo, tipoHielo, pesoKg);

    return {
      productoCodigo,
      productoNombre,
      pesoKg,
      inventoryKey,
    };
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
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new Error('Cantidad debe ser > 0');
    }
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

  static async autoLlenarStockBarraDesdeCuartos(opts: AutoLlenarBarraOpts) {
    const barraCodigo = String(opts.barraOrigenCodigo ?? '').trim().toUpperCase();
    const cuartosInput = safeInt(opts.cuartosDisponiblesAUsar, 0);

    if (!barraCodigo) throw new Error('barraOrigenCodigo requerido');
    if (cuartosInput <= 0) return { usados: 0, sobrantes: 0 };

    const origen = String(opts.origen ?? '');
    if (origen === 'ALTA_BARRA' || origen === 'PRODUCCION_BARRA') {
      const obs = String(opts.observaciones ?? '');
      if (!obs.includes('FORZAR_AUTO_LLENA')) return { usados: 0, sobrantes: cuartosInput };
    }

    const barraDoc = await ProductionService.#resolverProductoPorCodigo(barraCodigo);
    if (!barraDoc) throw new Error(`Barra ${barraCodigo} no encontrada`);

    const constraints: QueryConstraint[] = [where('tipo', '==', 'BOLSA'), qLimit(2000)];
    const snapBV = await getDocs(query(collection(db, PRODUCTOS_COLLECTION), ...constraints));

    const bvDocs = snapBV.docs.filter((d) => {
      const bv = d.data() as any;

      try {
        ProductionService.#validarBolsaVacia(bv);
        ProductionService.#validarTipoPermitido(bv, 'BARRA');
        return true;
      } catch {
        return false;
      }
    });

    if (bvDocs.length === 0) return { usados: 0, sobrantes: cuartosInput };

    const ahora = new Date();
    const ubicacion = UBICACION_DEFAULT;
    const maquina = opts.maquina;

    return await runTransaction(db, async (tx) => {
      const brTx = await tx.get(barraDoc.ref);
      if (!brTx.exists()) throw new Error('La barra ya no existe');

      const br = brTx.data() as any;
      if (String(br?.tipo ?? '').toUpperCase().trim() !== 'BARRA') {
        throw new Error('barraOrigen no es BARRA');
      }

      const { cuartosTotales, cuartosUsados, cuartosDisponibles } = readBarraCuartosRobusto(br);

      let cuartos = Math.min(cuartosInput, cuartosDisponibles);
      if (cuartos <= 0) return { usados: 0, sobrantes: cuartosInput };

      const candidatos: Array<{
        ref: any;
        codigo: string;
        capacidad: number;
        prevStock: number;
        prevVacias: number;
        max: number;
      }> = [];

      for (const d of bvDocs) {
        const s = await tx.get(d.ref);
        if (!s.exists()) continue;

        const bv = s.data() as any;

        ProductionService.#validarBolsaVacia(bv);
        ProductionService.#validarTipoPermitido(bv, 'BARRA');

        const repaired = ProductionService.#repairIfNeededInTx(tx, d.ref, bv, 'BARRA', ahora);

        const vacias = safeInt(repaired.cantidad, 0);
        const prevStock = safeNum(repaired.stockActual, 0);

        const max = safeInt(bv?.stockPorHielo?.BARRA?.stockMaximo, 0);
        const capPorMax = max > 0 ? Math.max(0, max - prevStock) : vacias;

        const capacidad = Math.max(0, Math.min(vacias, capPorMax));

        if (capacidad > 0) {
          candidatos.push({
            ref: d.ref,
            codigo: String(bv?.codigo ?? ''),
            capacidad,
            prevStock,
            prevVacias: vacias,
            max,
          });
        }
      }

      if (!candidatos.length) return { usados: 0, sobrantes: cuartosInput };

      candidatos.sort((a, b) => {
        const pa = a.max > 0 ? a.prevStock / a.max : 0;
        const pb = b.max > 0 ? b.prevStock / b.max : 0;
        return pa - pb;
      });

      let usados = 0;
      const items: any[] = [];
      const impactos: any[] = [];

      for (const bv of candidatos) {
        if (cuartos <= 0) break;

        const asignar = Math.min(cuartos, bv.capacidad);
        if (asignar <= 0) continue;

        tx.update(
          bv.ref,
          prepararParaFirestoreAllowFieldValue({
            cantidad: increment(-asignar),
            'stockPorHielo.BARRA.stockActual': increment(asignar),
            'stockPorHielo.BARRA.ultimaActualizacion': toTs(ahora),
            ultimaModificacion: toTs(ahora),
            ubicacionActual: ubicacion,
            ...(maquina ? { maquinaActual: maquina } : {}),
          })
        );

        items.push({
          bolsaVaciaCodigo: bv.codigo,
          tipoHielo: 'BARRA',
          cantidad: asignar,
          vaciasAnterior: bv.prevVacias,
          vaciasNuevo: bv.prevVacias - asignar,
          stockAnterior: bv.prevStock,
          stockNuevo: bv.prevStock + asignar,
        });

        impactos.push(
          {
            entidad: 'PRODUCTO',
            codigo: bv.codigo,
            campo: 'cantidad',
            delta: -asignar,
            anterior: bv.prevVacias,
            nuevo: bv.prevVacias - asignar,
          },
          {
            entidad: 'PRODUCTO',
            codigo: bv.codigo,
            campo: 'stockPorHielo.BARRA.stockActual',
            delta: +asignar,
            anterior: bv.prevStock,
            nuevo: bv.prevStock + asignar,
          }
        );

        usados += asignar;
        cuartos -= asignar;
      }

      if (usados <= 0) return { usados: 0, sobrantes: cuartosInput };

      const barraNextDisponibles = Math.max(0, cuartosDisponibles - usados);
      const barraNextUsados = Math.min(cuartosTotales, cuartosUsados + usados);

      tx.update(
        barraDoc.ref,
        prepararParaFirestorePlain({
          cuartosTotales,
          cuartosDisponibles: barraNextDisponibles,
          cuartosUsados: barraNextUsados,
          ultimaModificacion: ahora,
          ubicacionActual: ubicacion,
          ...(maquina ? { maquinaActual: maquina } : {}),
        })
      );

      impactos.push(
        {
          entidad: 'PRODUCTO',
          codigo: barraCodigo,
          campo: 'cuartosDisponibles',
          delta: -usados,
          anterior: cuartosDisponibles,
          nuevo: barraNextDisponibles,
        },
        {
          entidad: 'PRODUCTO',
          codigo: barraCodigo,
          campo: 'cuartosUsados',
          delta: +usados,
          anterior: cuartosUsados,
          nuevo: barraNextUsados,
        }
      );

      const movRef = doc(collection(db, MOVIMIENTOS_COLLECTION));

      tx.set(
        movRef,
        prepararParaFirestorePlain({
          codigo: `MOV-${Date.now()}`,
          tipo: 'AUTO_LLENA_BARRA',
          origen: opts.origen,
          afectaStock: true,

          barraOrigenCodigo: barraCodigo,

          maquina: maquina ?? null,
          ubicacion,

          usuarioCodigo: opts.usuarioCodigo,
          usuarioNombre: opts.usuarioNombre ?? '',

          cuartosIntentados: cuartosInput,
          cuartosUsados: usados,
          cuartosSobrantes: cuartosInput - usados,

          observaciones: opts.observaciones ?? 'FORZAR_AUTO_LLENA',

          fecha: ahora,
          createdAt: ahora,

          items,
          impactos,
        })
      );

      return { usados, sobrantes: cuartosInput - usados };
    });
  }

  static async llenarStockDesdeBolsaVacia(opts: LlenarStockOpts) {
    const tipoHielo = normalizeIceType(opts.tipoHielo);

    ProductionService.#validarCantidad(opts.cantidad);
    ProductionService.#validarMaquinaSiProduccion(opts.origen, opts.maquina);

    if (tipoHielo === 'BARRA' && !opts.barraOrigenCodigo) {
      throw new Error('Para tipoHielo=BARRA debes mandar barraOrigenCodigo');
    }

    const bvDoc = await ProductionService.#resolverProductoPorCodigo(opts.bolsaVaciaCodigo);
    if (!bvDoc) throw new Error(`Bolsa vacía ${opts.bolsaVaciaCodigo} no encontrada`);

    let barraDoc: any = null;

    if (tipoHielo === 'BARRA') {
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
      ProductionService.#validarTipoPermitido(bv, tipoHielo);

      const repaired = ProductionService.#repairIfNeededInTx(tx, bvDoc.ref, bv, tipoHielo, ahora);

      const bolsasVaciasDisponibles = safeNum(repaired.cantidad, 0);
      if (bolsasVaciasDisponibles < opts.cantidad) {
        throw new Error(
          `Stock insuficiente de bolsas vacías: ${bolsasVaciasDisponibles} disponible, ${opts.cantidad} solicitado`
        );
      }

      const prev = safeNum(repaired.stockActual, 0);
      const next = prev + opts.cantidad;

      if (tipoHielo === 'BARRA') {
        const brTx = await tx.get(barraDoc.ref);
        if (!brTx.exists()) throw new Error('La barra ya no existe');

        const br = brTx.data() as any;

        if (String(br?.tipo ?? '').toUpperCase().trim() !== 'BARRA') {
          throw new Error('El producto barraOrigen no es BARRA');
        }

        const { cuartosTotales, cuartosUsados, cuartosDisponibles } = readBarraCuartosRobusto(br);
        const cuartosNecesarios = opts.cantidad;

        if (cuartosDisponibles < cuartosNecesarios) {
          throw new Error(
            `Barra sin cuartos suficientes: ${cuartosDisponibles} disponibles, ${cuartosNecesarios} necesarios`
          );
        }

        tx.update(
          barraDoc.ref,
          prepararParaFirestorePlain({
            cuartosTotales,
            cuartosDisponibles: cuartosDisponibles - cuartosNecesarios,
            cuartosUsados: Math.min(cuartosTotales, cuartosUsados + cuartosNecesarios),
            ultimaModificacion: ahora,
            ubicacionActual: ubicacion,
            ...(maquina ? { maquinaActual: maquina } : {}),
          })
        );
      }

      tx.update(
        bvDoc.ref,
        prepararParaFirestoreAllowFieldValue({
          cantidad: increment(-opts.cantidad),
          [`stockPorHielo.${tipoHielo}.stockActual`]: increment(opts.cantidad),
          [`stockPorHielo.${tipoHielo}.ultimaActualizacion`]: toTs(ahora),
          ultimaModificacion: toTs(ahora),
          ubicacionActual: ubicacion,
          ...(maquina ? { maquinaActual: maquina } : {}),
        })
      );

      const movRef = doc(collection(db, MOVIMIENTOS_COLLECTION));
      const nombreBolsaLlena = ProductionService.#buildNombreBolsaLlena(bv);

      tx.set(
        movRef,
        prepararParaFirestorePlain({
          codigo: `MOV-${Date.now()}`,
          tipo: 'LLENADO_BOLSA',
          origen: opts.origen,
          afectaStock: true,

          maquina: maquina ?? null,
          ubicacion,

          productoCodigo: opts.bolsaVaciaCodigo,
          productoNombre: nombreBolsaLlena,
          tipoProducto: 'BOLSA',
          status: 'LLENA',
          tipoHielo,

          deltaPrincipal: +opts.cantidad,
          principalAnterior: prev,
          principalNuevo: next,

          bolsaVaciaCodigo: opts.bolsaVaciaCodigo,
          barraOrigenCodigo: tipoHielo === 'BARRA' ? opts.barraOrigenCodigo : undefined,
          cuartosUsados: tipoHielo === 'BARRA' ? opts.cantidad : 0,

          usuarioCodigo: opts.usuarioCodigo,
          usuarioNombre: opts.usuarioNombre ?? '',

          observaciones:
            opts.observaciones ?? (opts.origen === 'ADMIN' ? 'Llenado (admin)' : 'Llenado (producción)'),

          fecha: ahora,
          createdAt: ahora,
        })
      );

      return { bolsaVaciaCodigo: opts.bolsaVaciaCodigo, tipoHielo, cantidad: opts.cantidad };
    });
  }

  static async llenarDesdeAsignacion(opts: LlenarDesdeAsignacionOpts) {
    const tipoHielo = normalizeIceType(opts.tipoHielo);

    ProductionService.#validarCantidad(opts.cantidad);

    const ahora = new Date();
    const origen = opts.origen ?? 'PRODUCCION';

    /**
     * ✅ REGLA DEL FLUJO REAL:
     *
     * ADMIN / ASIGNACIONES ya descuenta las bolsas vacías del almacén
     * cuando se asignan al empleado de producción.
     *
     * Por eso, cuando el origen es PRODUCCION, este método debe descontar
     * SOLO la asignación pendiente y NO debe volver a validar/descontar
     * contra productos.cantidad del almacén.
     *
     * Se conserva el flujo anterior para ADMIN: si origen === 'ADMIN' y
     * descontarBolsaVaciaFisica === true, entonces sí valida y descuenta
     * bolsas vacías físicas del producto global.
     */
    const descontarBV = origen === 'ADMIN' && opts.descontarBolsaVaciaFisica === true;

    ProductionService.#validarMaquinaSiProduccion(origen, opts.maquina);

    const maquina = opts.maquina;
    const ubicacion = UBICACION_DEFAULT;

    const refAsig = doc(db, ASIGNACIONES_COLLECTION, opts.asignacionId);

    const bvDoc = await ProductionService.#resolverProductoPorCodigo(opts.bolsaVaciaCodigo);
    if (!bvDoc) throw new Error(`Bolsa vacía ${opts.bolsaVaciaCodigo} no encontrada`);

    let barraDoc: any = null;

    if (tipoHielo === 'BARRA') {
      if (!opts.barraOrigenCodigo) throw new Error('Para tipoHielo=BARRA debes seleccionar barraOrigenCodigo');

      barraDoc = await ProductionService.#resolverProductoPorCodigo(opts.barraOrigenCodigo);
      if (!barraDoc) throw new Error(`Barra ${opts.barraOrigenCodigo} no encontrada`);
    }

    return await runTransaction(db, async (tx) => {
      const asigTx = await tx.get(refAsig);
      if (!asigTx.exists()) throw new Error('Asignación no encontrada');

      const asig = asigTx.data() as any;

      if (String(asig?.productoCodigo ?? '').toUpperCase() !== String(opts.bolsaVaciaCodigo ?? '').toUpperCase()) {
        throw new Error('La asignación no corresponde a esta BV');
      }

      const estado = String(asig?.estado ?? 'PENDIENTE');
      if (estado !== 'PENDIENTE') throw new Error(`Asignación no disponible (estado: ${estado})`);

      const disponiblesAsig = safeNum(asig?.cantidad, 0);
      if (disponiblesAsig < opts.cantidad) {
        throw new Error(`Asignación insuficiente. Disponibles: ${disponiblesAsig}`);
      }

      const bvTx = await tx.get(bvDoc.ref);
      if (!bvTx.exists()) throw new Error('La bolsa vacía ya no existe');

      const bv = bvTx.data() as any;

      ProductionService.#validarBolsaVacia(bv);
      ProductionService.#validarTipoPermitido(bv, tipoHielo);

      const repaired = ProductionService.#repairIfNeededInTx(tx, bvDoc.ref, bv, tipoHielo, ahora);

      const bolsasVaciasFisicas = safeNum(repaired.cantidad, 0);
      if (descontarBV && bolsasVaciasFisicas < opts.cantidad) {
        throw new Error(`No hay suficientes bolsas vacías físicas. Disponibles: ${bolsasVaciasFisicas}`);
      }

      const prevStock = safeNum(repaired.stockActual, 0);
      const nextStock = prevStock + opts.cantidad;

      if (tipoHielo === 'BARRA') {
        const brTx = await tx.get(barraDoc.ref);
        if (!brTx.exists()) throw new Error('La barra ya no existe');

        const br = brTx.data() as any;

        if (String(br?.tipo ?? '').toUpperCase().trim() !== 'BARRA') {
          throw new Error('El producto barraOrigen no es BARRA');
        }

        const { cuartosTotales, cuartosUsados, cuartosDisponibles } = readBarraCuartosRobusto(br);
        const cuartosNecesarios = opts.cantidad;

        if (cuartosDisponibles < cuartosNecesarios) {
          throw new Error(
            `Barra sin cuartos suficientes: ${cuartosDisponibles} disponibles, ${cuartosNecesarios} necesarios`
          );
        }

        tx.update(
          barraDoc.ref,
          prepararParaFirestorePlain({
            cuartosTotales,
            cuartosDisponibles: cuartosDisponibles - cuartosNecesarios,
            cuartosUsados: Math.min(cuartosTotales, cuartosUsados + cuartosNecesarios),
            ultimaModificacion: ahora,
            ubicacionActual: ubicacion,
            ...(maquina ? { maquinaActual: maquina } : {}),
          })
        );
      }

      const nuevoAsig = disponiblesAsig - opts.cantidad;

      tx.update(
        refAsig,
        prepararParaFirestorePlain({
          cantidad: nuevoAsig,
          updatedAt: ahora,
          ...(nuevoAsig === 0 ? { estado: 'COMPLETADA' } : {}),
        })
      );

      const bvUpdate: any = {
        [`stockPorHielo.${tipoHielo}.stockActual`]: increment(opts.cantidad),
        [`stockPorHielo.${tipoHielo}.ultimaActualizacion`]: toTs(ahora),
        ultimaModificacion: toTs(ahora),
        ubicacionActual: ubicacion,
        ...(maquina ? { maquinaActual: maquina } : {}),
      };

      if (descontarBV) bvUpdate.cantidad = increment(-opts.cantidad);

      tx.update(bvDoc.ref, prepararParaFirestoreAllowFieldValue(bvUpdate));

      const movRef = doc(collection(db, MOVIMIENTOS_COLLECTION));
      const nombreBolsaLlena = ProductionService.#buildNombreBolsaLlena(bv);

      tx.set(
        movRef,
        prepararParaFirestorePlain({
          codigo: `MOV-${Date.now()}`,
          tipo: 'LLENADO_BOLSA',
          origen,
          afectaStock: true,

          maquina: maquina ?? null,
          ubicacion,

          productoCodigo: opts.bolsaVaciaCodigo,
          productoNombre: nombreBolsaLlena,
          tipoProducto: 'BOLSA',

          deltaPrincipal: +opts.cantidad,
          principalAnterior: prevStock,
          principalNuevo: nextStock,

          tipoHielo,
          status: 'LLENA',

          bolsaVaciaCodigo: opts.bolsaVaciaCodigo,
          bolsaAsignadaCodigo: asig?.bolsaAsignadaCodigo ?? undefined,

          barraOrigenCodigo: tipoHielo === 'BARRA' ? opts.barraOrigenCodigo : undefined,
          cuartosUsados: tipoHielo === 'BARRA' ? opts.cantidad : 0,

          observaciones: opts.observaciones ?? '',

          empleadoAsignadoCodigo: opts.empleadoCodigo,
          empleadoAsignadoNombre: opts.empleadoNombre,

          usuarioCodigo: opts.usuarioCodigo ?? opts.empleadoCodigo,
          usuarioNombre: opts.usuarioNombre ?? opts.empleadoNombre,

          turno: asig?.turno ?? undefined,

          fecha: ahora,
          createdAt: ahora,
        })
      );

      return { ok: true };
    });
  }

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

  static async registrarSalidaStockBatch(opts: SalidaBatchOpts) {
    if (!opts.items || !Array.isArray(opts.items) || opts.items.length === 0) {
      throw new Error('Debes enviar items[] (al menos 1) para registrar salida batch.');
    }

    const salidaMeta = ProductionService.#normalizeSalidaMeta(opts);

    const grouped = new Map<
      string,
      {
        bolsaVaciaCodigo: string;
        tipoHielo: IceType;
        cantidad: number;
      } & SalidaProductMeta
    >();

    for (const it of opts.items) {
      const bv = String(it?.bolsaVaciaCodigo ?? '').trim().toUpperCase();
      const tipo = normalizeIceType(it?.tipoHielo);
      const qty = safeInt(it?.cantidad, 0);

      if (!bv) throw new Error('Item inválido: bolsaVaciaCodigo vacío.');
      if (qty <= 0) throw new Error('Item inválido: cantidad debe ser > 0.');

      const key = `${bv}__${tipo}`;
      const prev = grouped.get(key);

      if (prev) {
        grouped.set(key, {
          ...prev,
          cantidad: prev.cantidad + qty,

          productoCodigo: prev.productoCodigo || it.productoCodigo,
          productoNombre: prev.productoNombre || it.productoNombre,
          pesoKg: prev.pesoKg ?? it.pesoKg,
          inventoryKey: prev.inventoryKey || it.inventoryKey,
        });
      } else {
        grouped.set(key, {
          bolsaVaciaCodigo: bv,
          tipoHielo: tipo,
          cantidad: qty,

          productoCodigo: it.productoCodigo,
          productoNombre: it.productoNombre,
          pesoKg: it.pesoKg,
          inventoryKey: it.inventoryKey,
        });
      }
    }

    const itemsAgrupados = Array.from(grouped.values());
    const ahora = new Date();
    const ubicacion = UBICACION_DEFAULT;
    const maquina = opts.maquina;

    const mapRefs = await ProductionService.#resolverRefsPorCodigos(itemsAgrupados.map((x) => x.bolsaVaciaCodigo));

    for (const it of itemsAgrupados) {
      if (!mapRefs.has(it.bolsaVaciaCodigo)) {
        throw new Error(`Bolsa vacía ${it.bolsaVaciaCodigo} no encontrada`);
      }
    }

    return await runTransaction(db, async (tx) => {
      const reads: Array<{
        bvCodigo: string;
        tipoHielo: IceType;
        cantidad: number;
        bvRef: any;
        bvData: any;
        prevStock: number;
        nextStock: number;
      } & SalidaProductMeta> = [];

      for (const it of itemsAgrupados) {
        const entry = mapRefs.get(it.bolsaVaciaCodigo)!;
        const bvRef = entry.ref;

        const bvTx = await tx.get(bvRef);
        if (!bvTx.exists()) throw new Error(`La bolsa vacía ${it.bolsaVaciaCodigo} ya no existe`);

        const bv = bvTx.data() as any;

        ProductionService.#validarBolsaVacia(bv);
        ProductionService.#validarTipoPermitido(bv, it.tipoHielo);

        const repaired = ProductionService.#repairIfNeededInTx(tx, bvRef, bv, it.tipoHielo, ahora);

        const prevStock = safeNum(repaired.stockActual, 0);
        const delta = -Math.abs(it.cantidad);
        const nextStock = prevStock + delta;

        if (nextStock < 0) {
          throw new Error(`Stock insuficiente en ${it.bolsaVaciaCodigo} / ${it.tipoHielo}: ${prevStock} disponible`);
        }

        const productoMeta = ProductionService.#resolveSalidaProductMeta(
          {
            bolsaVaciaCodigo: it.bolsaVaciaCodigo,
            tipoHielo: it.tipoHielo,
            productoCodigo: it.productoCodigo,
            productoNombre: it.productoNombre,
            pesoKg: it.pesoKg,
            inventoryKey: it.inventoryKey,
          },
          bv
        );

        reads.push({
          bvCodigo: it.bolsaVaciaCodigo,
          tipoHielo: it.tipoHielo,
          cantidad: it.cantidad,
          bvRef,
          bvData: bv,
          prevStock,
          nextStock,

          productoCodigo: productoMeta.productoCodigo,
          productoNombre: productoMeta.productoNombre,
          pesoKg: productoMeta.pesoKg,
          inventoryKey: productoMeta.inventoryKey,
        });
      }

      for (const r of reads) {
        tx.update(
          r.bvRef,
          prepararParaFirestoreAllowFieldValue({
            [`stockPorHielo.${r.tipoHielo}.stockActual`]: increment(-Math.abs(r.cantidad)),
            [`stockPorHielo.${r.tipoHielo}.ultimaActualizacion`]: toTs(ahora),
            ultimaModificacion: toTs(ahora),
            ubicacionActual: ubicacion,
            ...(maquina ? { maquinaActual: maquina } : {}),
          })
        );
      }

      const movRef = doc(collection(db, MOVIMIENTOS_COLLECTION));

      const empleadoCodigo = opts.empleadoAsignadoCodigo ?? opts.usuarioCodigo;
      const empleadoNombre = opts.empleadoAsignadoNombre ?? opts.usuarioNombre ?? '';

      tx.set(
        movRef,
        prepararParaFirestorePlain({
          codigo: `MOV-${Date.now()}`,
          tipo: 'SALIDA_BOLSA',
          batch: true,
          batchCount: reads.length,
          origen: 'PRODUCCION',
          afectaStock: true,

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

          items: reads.map((r) => ({
            bolsaVaciaCodigo: r.bvCodigo,
            productoCodigo: r.productoCodigo || r.bvCodigo,
            productoNombre: r.productoNombre || ProductionService.#buildNombreBolsaLlena(r.bvData),
            pesoKg: safeNum(r.pesoKg, safeNum(r.bvData?.pesoKg, 0)),
            inventoryKey: r.inventoryKey || buildInventoryKey(r.bvCodigo, r.tipoHielo, safeNum(r.pesoKg, r.bvData?.pesoKg)),

            tipoHielo: r.tipoHielo,
            cantidad: r.cantidad,
            delta: -Math.abs(r.cantidad),
            anterior: r.prevStock,
            nuevo: r.nextStock,
          })),
        })
      );

      return { ok: true, items: reads.length };
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
    const tipoHielo = normalizeIceType(opts.tipoHielo);

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
      ProductionService.#validarTipoPermitido(bv, tipoHielo);

      const repaired = ProductionService.#repairIfNeededInTx(tx, bvDoc.ref, bv, tipoHielo, ahora);

      const prev = safeNum(repaired.stockActual, 0);
      const next = prev + opts.delta;

      if (next < 0) {
        throw new Error(`Stock insuficiente en ${tipoHielo}: ${prev} disponible, quieres ajustar ${opts.delta}`);
      }

      tx.update(
        bvDoc.ref,
        prepararParaFirestoreAllowFieldValue({
          [`stockPorHielo.${tipoHielo}.stockActual`]: increment(opts.delta),
          [`stockPorHielo.${tipoHielo}.ultimaActualizacion`]: toTs(ahora),
          ultimaModificacion: toTs(ahora),
          ubicacionActual: ubicacion,
          ...(maquina ? { maquinaActual: maquina } : {}),
        })
      );

      const movRef = doc(collection(db, MOVIMIENTOS_COLLECTION));

      const empleadoCodigo = opts.empleadoAsignadoCodigo ?? opts.usuarioCodigo;
      const empleadoNombre = opts.empleadoAsignadoNombre ?? opts.usuarioNombre ?? '';

      const productoMeta = ProductionService.#resolveSalidaProductMeta(
        {
          bolsaVaciaCodigo: opts.bolsaVaciaCodigo,
          tipoHielo,
          productoCodigo: opts.productoCodigo,
          productoNombre: opts.productoNombre,
          pesoKg: opts.pesoKg,
          inventoryKey: opts.inventoryKey,
        },
        bv
      );

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
          afectaStock: true,

          maquina: maquina ?? null,
          ubicacion,

          salidaSubtipo: salidaMeta.subtipo,
          salidaDestino: salidaMeta.destino,
          clienteNombre: salidaMeta.clienteNombre,

          productoCodigo: productoMeta.productoCodigo,
          productoNombre: productoMeta.productoNombre,
          pesoKg: productoMeta.pesoKg,
          inventoryKey: productoMeta.inventoryKey,

          tipoProducto: 'BOLSA',

          deltaPrincipal: opts.delta,
          principalAnterior: prev,
          principalNuevo: next,

          tipoHielo,
          status: 'LLENA',

          bolsaVaciaCodigo: opts.bolsaVaciaCodigo,

          motivo: opts.motivo ?? '',
          destinatario: opts.destinatario ?? '',
          observaciones: opts.observaciones ?? '',
          usuarioCodigo: opts.usuarioCodigo,
          usuarioNombre: opts.usuarioNombre ?? '',
          
          empleadoAsignadoCodigo: empleadoCodigo,
          empleadoAsignadoNombre: empleadoNombre,

          fecha: ahora,
          createdAt: ahora,
        })
      );

      return { bolsaVaciaCodigo: opts.bolsaVaciaCodigo, tipoHielo, stockNuevo: next };
    });
  }
}