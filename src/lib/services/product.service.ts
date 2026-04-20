'use client';

// lib/services/product.service.ts
// ✅ PRODUCTION READY
// ✅ FIX: barra NO se “consume sola” (auto-llenado OFF por default)
// ✅ FIX: status de BARRA coherente (si cantidad>0 => DISPONIBLE)
// ✅ FIX: NO queries dentro de runTransaction
// ✅ FIX: nombre.trim is not a function (overload crearBarra)
// ✅ Mantiene tus flujos: crear/producción/sync cuartos, bolsas, configs, etc.

import { db } from '@/lib/firebase/config.client';
import { ProductionService } from '@/lib/services/production.service';

import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  doc,
  Timestamp,
  orderBy,
  runTransaction,
  limit,
  deleteDoc,
  type DocumentReference,
} from 'firebase/firestore';

import {
  type BarraProduct,
  type BolsaProduct,
  type IceType,
  type ProductType,
  type ProductStatus,
  type Product,
  type StockPorHieloConfig,
  TIPOS_HIELO,
  PESOS_BOLSA,
  crearConfigStockHieloInicial,
  esBolsa,
} from '@/lib/utils/types/product.types';

/* ============================================================
   Firestore guard: NO EMPTY PATH
============================================================ */
function assertNonEmptyPath(path: unknown, label: string): asserts path is string {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error(`[ProductService] Ruta Firestore inválida para "${label}". Recibí: ${String(path)}`);
  }
}
function col(path: string, label: string) {
  assertNonEmptyPath(path, label);
  return collection(db, path);
}

/* ============================================================
   Helpers: FireDate (Date | Timestamp)
============================================================ */
const toDateSafe = (v: any): Date => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  return new Date(v);
};

const toTs = (d: Date) => Timestamp.fromDate(d);

const safeNum = (n: any, f = 0) => (Number.isFinite(Number(n)) ? Number(n) : f);
const safeInt = (n: any, f = 0) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return f;
  const i = Math.floor(v);
  return i < 0 ? f : i;
};

const asStr = (v: any) => String(v ?? '');

const normalizeName = (v: any) => {
  const s = asStr(v).trim();
  return s;
};

/** Convierte recursivamente Date -> Timestamp (incluye objetos anidados).
 *  ✅ También elimina undefined (Firestore NO acepta undefined)
 */
const prepareForFirestore = (value: any): any => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (value instanceof Date) return toTs(value);
  if (value instanceof Timestamp) return value;

  if (Array.isArray(value)) return value.map(prepareForFirestore);

  if (typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) {
      const v = prepareForFirestore(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  return value;
};

/** Normaliza IceType */
function normalizeIceType(v: any): IceType {
  const t = String(v ?? '').trim().toUpperCase();
  if (!(TIPOS_HIELO as readonly string[]).includes(t)) {
    throw new Error(`tipoHielo inválido: "${t}". Usa: ${TIPOS_HIELO.join(', ')}`);
  }
  return t as IceType;
}

/** Asegura que stockPorHielo exista y tenga todos los IceType */
const ensureStockPorHieloCompleto = (
  stockPorHielo?: Record<IceType, StockPorHieloConfig> | any,
  defaults: { stockMinimo: number; stockMaximo: number } = { stockMinimo: 10, stockMaximo: 100 }
): Record<IceType, StockPorHieloConfig> => {
  const base = crearConfigStockHieloInicial(TIPOS_HIELO, undefined, defaults);

  if (!stockPorHielo || typeof stockPorHielo !== 'object') return base;

  const out = { ...base } as Record<IceType, StockPorHieloConfig>;

  TIPOS_HIELO.forEach((t) => {
    const cfg = stockPorHielo[t];
    if (cfg && typeof cfg === 'object') {
      out[t] = {
        stockMinimo: Number(cfg.stockMinimo ?? out[t].stockMinimo),
        stockMaximo: Number(cfg.stockMaximo ?? out[t].stockMaximo),
        stockActual: Number(cfg.stockActual ?? 0),
        ultimaActualizacion: cfg.ultimaActualizacion ?? out[t].ultimaActualizacion,
        configAdmin: cfg.configAdmin ?? out[t].configAdmin,
      };
    }
  });

  return out;
};

/* ============================================================
   Generación de códigos: BR / BV / BA / BL
============================================================ */
async function obtenerProximoCodigo(tipo: ProductType, status: ProductStatus): Promise<string> {
  let prefijo = '';

  if (tipo === 'BARRA') prefijo = 'BR';
  else {
    switch (status) {
      case 'VACIA':
        prefijo = 'BV';
        break;
      case 'ASIGNADA':
        prefijo = 'BA';
        break;
      case 'LLENA':
        prefijo = 'BL';
        break;
      default:
        prefijo = 'BV';
    }
  }

  try {
    const productosRef = col(ProductService.COLECCION_PRODUCTOS, 'ProductService.COLECCION_PRODUCTOS');

    const qy = query(
      productosRef,
      where('codigo', '>=', prefijo),
      where('codigo', '<=', prefijo + '\uf8ff'),
      orderBy('codigo', 'desc'),
      limit(1)
    );

    const snap = await getDocs(qy);

    if (snap.empty) return `${prefijo}001`;

    const ultimo = (snap.docs[0].data() as any).codigo as string;
    const match = ultimo.match(new RegExp(`^${prefijo}(\\d+)$`));

    if (!match) return `${prefijo}${String(Math.floor(Math.random() * 900) + 100)}`;

    const n = parseInt(match[1], 10);
    if (Number.isNaN(n)) return `${prefijo}${String(Math.floor(Math.random() * 900) + 100)}`;

    return `${prefijo}${String(n + 1).padStart(3, '0')}`;
  } catch (e) {
    console.error('❌ Error generando código:', e);
    return `${prefijo}${String(Math.floor(Math.random() * 900) + 100)}`;
  }
}

/* ============================================================
   Creadores locales (objetos tipados)
============================================================ */
function crearBarraLocal(
  nombre: string,
  cantidad: number,
  creadoPor: string,
  peso: number = 50,
  stockMinimo: number = 10,
  stockMaximo: number = 100
): BarraProduct {
  const ahora = new Date();
  const barras = safeInt(cantidad, 0);
  const cuartosTotales = barras * 4;

  return {
    codigo: '',
    nombre,
    tipo: 'BARRA',
    // ✅ coherente: si hay barras físicas, está disponible
    status: barras > 0 ? 'DISPONIBLE' : 'VACIA',
    cantidad: barras,
    creadoPor,
    fechaCreacion: ahora,
    ultimaModificacion: ahora,
    stockMinimo,
    stockMaximo,

    peso,
    cuartosTotales,
    cuartosDisponibles: cuartosTotales,
    cuartosUsados: 0,
    bolsasLlenadasConEstaBarra: [],
  };
}

function crearBolsaVaciaLocal(opts: {
  nombre: string;
  cantidad: number;
  creadoPor: string;
  pesoKg: number;
  tiposHieloPermitidos: IceType[];
  stockMinimoDefecto?: number;
  stockMaximoDefecto?: number;
  configStockPorHielo?: Partial<Record<IceType, Partial<StockPorHieloConfig>>>;
}): BolsaProduct {
  const ahora = new Date();

  const stockBase = ensureStockPorHieloCompleto(undefined, {
    stockMinimo: opts.stockMinimoDefecto ?? 10,
    stockMaximo: opts.stockMaximoDefecto ?? 100,
  });

  if (opts.configStockPorHielo) {
    TIPOS_HIELO.forEach((t) => {
      const parcial = opts.configStockPorHielo?.[t];
      if (parcial) {
        stockBase[t] = {
          ...stockBase[t],
          ...parcial,
          stockMinimo: Number(parcial.stockMinimo ?? stockBase[t].stockMinimo),
          stockMaximo: Number(parcial.stockMaximo ?? stockBase[t].stockMaximo),
          stockActual: Number(parcial.stockActual ?? stockBase[t].stockActual ?? 0),
          ultimaActualizacion: ahora,
        };
      }
    });
  }

  return {
    codigo: '',
    nombre: opts.nombre,
    tipo: 'BOLSA',
    status: 'VACIA',
    cantidad: opts.cantidad,
    creadoPor: opts.creadoPor,
    fechaCreacion: ahora,
    ultimaModificacion: ahora,

    stockMinimo: opts.stockMinimoDefecto ?? 0,
    stockMaximo: opts.stockMaximoDefecto ?? 0,

    pesoKg: opts.pesoKg,
    tiposHieloPermitidos: opts.tiposHieloPermitidos,
    stockPorHielo: stockBase,

    cuartosUsados: 0,
    historico: [
      {
        fecha: ahora,
        accion: 'CREACION_BOLSA_VACIA',
        usuario: opts.creadoPor,
        cantidad: opts.cantidad,
      },
    ],
  };
}

function crearBolsaAsignadaLocal(opts: {
  baseBolsaVacia: BolsaProduct;
  empleadoCodigo: string;
  asignadoPor: string;
}): BolsaProduct {
  const ahora = new Date();
  const base = opts.baseBolsaVacia;

  return {
    ...base,
    codigo: '',
    status: 'ASIGNADA',
    cantidad: 1,
    asignadaA: opts.empleadoCodigo,
    fechaAsignacion: ahora,
    bolsaVaciaOriginal: base.codigo,
    ultimaModificacion: ahora,
    stockPorHielo: ensureStockPorHieloCompleto(base.stockPorHielo, { stockMinimo: 0, stockMaximo: 0 }),
    historico: [
      ...(base.historico ?? []),
      {
        fecha: ahora,
        accion: 'ASIGNACION_BOLSA',
        usuario: opts.asignadoPor,
        cantidad: 1,
        observaciones: `Asignada a ${opts.empleadoCodigo}`,
      },
    ],
  };
}

/** ✅ BARRA: clamp y mantiene cuartos coherentes */
function usarCuartosDeBarraLocal(barra: BarraProduct, cuartos: number, bolsaLlenaCodigo: string): BarraProduct {
  const ahora = new Date();

  const barrasFisicas = safeInt(barra.cantidad, 0);
  const cuartosTotales = Number.isFinite(Number(barra.cuartosTotales))
    ? Number(barra.cuartosTotales)
    : barrasFisicas * 4;

  const usadosPrev = safeNum(barra.cuartosUsados, 0);
  const usadosNext = Math.min(cuartosTotales, Math.max(0, usadosPrev + cuartos));
  const dispNext = Math.max(0, cuartosTotales - usadosNext);

  return {
    ...barra,
    cuartosTotales,
    cuartosDisponibles: dispNext,
    cuartosUsados: usadosNext,
    bolsasLlenadasConEstaBarra: [...(barra.bolsasLlenadasConEstaBarra ?? []), bolsaLlenaCodigo],
    ultimaModificacion: ahora,
  };
}

/* ============================================================
   ProductService
============================================================ */
export class ProductService {
  static COLECCION_PRODUCTOS = 'productos';
  static COLECCION_MOVIMIENTOS = 'movimientos';

  static validateCollections() {
    assertNonEmptyPath(ProductService.COLECCION_PRODUCTOS, 'ProductService.COLECCION_PRODUCTOS');
    assertNonEmptyPath(ProductService.COLECCION_MOVIMIENTOS, 'ProductService.COLECCION_MOVIMIENTOS');
    return true;
  }

  /* -----------------------------
     Helpers internos de Firestore
  ----------------------------- */
  private static async getDocRefByCodigo(codigo: string): Promise<DocumentReference | null> {
    const productosRef = col(ProductService.COLECCION_PRODUCTOS, 'ProductService.COLECCION_PRODUCTOS');
    const qy = query(productosRef, where('codigo', '==', codigo));
    const snap = await getDocs(qy);
    if (snap.empty) return null;
    if (snap.size > 1) throw new Error(`Código duplicado: ${codigo} (${snap.size} docs)`);
    return snap.docs[0].ref;
  }

  private static async getDocSnapByCodigo(codigo: string) {
    const productosRef = col(ProductService.COLECCION_PRODUCTOS, 'ProductService.COLECCION_PRODUCTOS');
    const qy = query(productosRef, where('codigo', '==', codigo), limit(1));
    const snap = await getDocs(qy);
    if (snap.empty) return null;
    return snap.docs[0];
  }

  private static mapBarra(data: any): BarraProduct {
    const barrasFisicas = safeInt(data.cantidad, 0);
    const cuartosTotales = Number.isFinite(Number(data.cuartosTotales))
      ? Number(data.cuartosTotales)
      : barrasFisicas * 4;

    const cuartosUsados = Math.min(Math.max(0, safeNum(data.cuartosUsados, 0)), cuartosTotales);
    const recomputedDisp = Math.max(0, cuartosTotales - cuartosUsados);

    const rawDisp = Number.isFinite(Number(data.cuartosDisponibles))
      ? Math.max(0, Number(data.cuartosDisponibles))
      : recomputedDisp;

    const cuartosDisponibles = Math.abs(rawDisp - recomputedDisp) > 0 ? recomputedDisp : rawDisp;

    const statusRaw = String(data.status ?? '').toUpperCase().trim();
    const status: any =
      statusRaw || barrasFisicas > 0 ? (barrasFisicas > 0 ? 'DISPONIBLE' : 'VACIA') : statusRaw;

    return {
      codigo: data.codigo,
      nombre: data.nombre,
      tipo: 'BARRA',
      status,
      cantidad: barrasFisicas,
      creadoPor: data.creadoPor ?? 'admin',
      fechaCreacion: toDateSafe(data.fechaCreacion),
      ultimaModificacion: toDateSafe(data.ultimaModificacion),
      stockMinimo: data.stockMinimo,
      stockMaximo: data.stockMaximo,

      peso: data.peso,
      cuartosTotales,
      cuartosDisponibles,
      cuartosUsados,
      bolsasLlenadasConEstaBarra: data.bolsasLlenadasConEstaBarra ?? [],
      configPorTipoHielo: data.configPorTipoHielo,
      configuracionAdmin: data.configuracionAdmin,
    };
  }

  private static mapBolsa(data: any): BolsaProduct {
    const stockPorHielo = ensureStockPorHieloCompleto(data.stockPorHielo);

    return {
      codigo: data.codigo,
      nombre: data.nombre,
      tipo: 'BOLSA',
      status: data.status,
      cantidad: Number(data.cantidad ?? 0),
      creadoPor: data.creadoPor ?? 'admin',
      fechaCreacion: toDateSafe(data.fechaCreacion),
      ultimaModificacion: toDateSafe(data.ultimaModificacion),
      stockMinimo: data.stockMinimo,
      stockMaximo: data.stockMaximo,

      pesoKg: Number(data.pesoKg ?? 3),
      tiposHieloPermitidos: data.tiposHieloPermitidos ?? [],
      stockPorHielo,

      configuracionEspecifica: data.configuracionEspecifica,
      configuracionAdmin: data.configuracionAdmin,

      tipoHieloContenido: data.tipoHieloContenido,
      llenadoPor: data.llenadoPor,
      fechaLlenado: data.fechaLlenado ? toDateSafe(data.fechaLlenado) : undefined,
      cuartosUsados: Number(data.cuartosUsados ?? 0),
      barraOrigen: data.barraOrigen,

      asignadaA: data.asignadaA,
      fechaAsignacion: data.fechaAsignacion ? toDateSafe(data.fechaAsignacion) : undefined,

      bolsaVaciaOriginal: data.bolsaVaciaOriginal,
      bolsaAsignadaOriginal: data.bolsaAsignadaOriginal,
      historico: (data.historico ?? []).map((h: any) => ({ ...h, fecha: toDateSafe(h.fecha) })),
    };
  }

  /* -----------------------------
     CRUD: Crear
  ----------------------------- */

  // ✅ Overload (para evitar nombre.trim is not a function)
  static async crearBarra(
    nombre: string,
    cantidad: number,
    creadoPor: string,
    peso?: number,
    stockMinimo?: number,
    stockMaximo?: number
  ): Promise<BarraProduct>;
  static async crearBarra(opts: {
    nombre: any;
    cantidad: any;
    creadoPor?: any;
    peso?: any;
    stockMinimo?: any;
    stockMaximo?: any;
    // ✅ opcional: auto-llenar usando esos cuartos (OFF por default)
    autoLlenarStockBarra?: boolean;
  }): Promise<BarraProduct>;
  static async crearBarra(
    a: any,
    b?: any,
    c?: any,
    d: any = 50,
    e: any = 10,
    f: any = 100
  ): Promise<BarraProduct> {
    ProductService.validateCollections();

    const isObj = a && typeof a === 'object' && !Array.isArray(a);

    const nombre = isObj ? normalizeName(a.nombre) : normalizeName(a);
    const cantidad = safeInt(isObj ? a.cantidad : b, 0);
    const creadoPor = normalizeName(isObj ? a.creadoPor : c) || 'admin';
    const peso = safeNum(isObj ? a.peso : d, 50);
    const stockMinimo = safeInt(isObj ? a.stockMinimo : e, 10);
    const stockMaximo = safeInt(isObj ? a.stockMaximo : f, 100);

    // ✅ DEFAULT OFF (evita bug BR con 0 disponibles / usados llenos)
    const autoLlenarStockBarra = isObj ? a.autoLlenarStockBarra === true : false;

    if (!nombre) throw new Error('Nombre requerido');
    if (cantidad < 0) throw new Error('Cantidad no puede ser negativa');

    const codigo = await obtenerProximoCodigo('BARRA', 'VACIA');
    const barra = crearBarraLocal(nombre, cantidad, creadoPor, peso, stockMinimo, stockMaximo);
    barra.codigo = codigo;

    await addDoc(col(ProductService.COLECCION_PRODUCTOS, 'ProductService.COLECCION_PRODUCTOS'), prepareForFirestore(barra));

    // ⚠️ OPT-IN: solo si lo activas explícitamente
    if (autoLlenarStockBarra && cantidad > 0) {
      const cuartos = cantidad * 4;
      try {
        await ProductionService.autoLlenarStockBarraDesdeCuartos({
          barraOrigenCodigo: codigo,
          cuartosDisponiblesAUsar: cuartos,
          usuarioCodigo: creadoPor,
          usuarioNombre: creadoPor,
          origen: 'ALTA_BARRA',
          observaciones: `FORZAR_AUTO_LLENA Auto-llenado desde alta de barra (${cuartos} cuartos)`,
        });
      } catch (err) {
        console.warn('⚠️ autoLlenarStockBarraDesdeCuartos falló (crearBarra):', err);
      }
    }

    return barra;
  }

  // ✅ Producción barra (SUMA) + auto-llenado OPT-IN (OFF por default)
  static async agregarProduccionBarra(opts: {
    codigo: string;
    barrasProducidas: number;
    usuario?: string;
    observaciones?: string;
    autoLlenarStockBarra?: boolean; // default false
  }): Promise<void> {
    ProductService.validateCollections();

    const codigo = asStr(opts.codigo).trim().toUpperCase();
    const n = safeInt(opts.barrasProducidas, 0);
    const autoLlenar = opts.autoLlenarStockBarra === true;

    if (!codigo) throw new Error('Código requerido');
    if (n <= 0) throw new Error('barrasProducidas debe ser > 0');

    const docSnap = await ProductService.getDocSnapByCodigo(codigo);
    if (!docSnap) throw new Error(`Barra ${codigo} no encontrada`);
    const ref = docSnap.ref;

    const addCuartos = n * 4;
    const ahora = new Date();

    await runTransaction(db, async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists()) throw new Error('Barra no encontrada');

      const data = s.data() as any;
      if (String(data.tipo ?? '').toUpperCase() !== 'BARRA') throw new Error(`El producto ${codigo} no es BARRA`);

      const barra = ProductService.mapBarra(data);

      const nextCantidad = safeInt(barra.cantidad, 0) + n;

      const prevTotales = safeInt(barra.cuartosTotales, safeInt(barra.cantidad, 0) * 4);
      const nextTotales = prevTotales + addCuartos;

      const usados = safeNum(barra.cuartosUsados, 0);

      const prevDisp = safeNum(barra.cuartosDisponibles, Math.max(0, prevTotales - usados));
      const nextDisp = Math.max(0, Math.min(nextTotales - usados, prevDisp + addCuartos));

      tx.update(ref, {
        cantidad: nextCantidad,
        cuartosTotales: nextTotales,
        cuartosDisponibles: nextDisp,
        // cuartosUsados NO se toca
        // si hay barras, status debería ser DISPONIBLE
        status: nextCantidad > 0 ? 'DISPONIBLE' : 'VACIA',
        ultimaModificacion: toTs(ahora),
      });

      const movRef = doc(col(ProductService.COLECCION_MOVIMIENTOS, 'ProductService.COLECCION_MOVIMIENTOS'));
      tx.set(
        movRef,
        prepareForFirestore({
          tipo: 'PRODUCCION',
          subtipo: 'PRODUCCION_BARRA',
          productoCodigo: codigo,
          productoNombre: barra.nombre ?? '',
          cantidad: n,
          cuartosAgregados: addCuartos,
          usuario: opts.usuario ?? 'ADMIN',
          observaciones: opts.observaciones ?? '',
          fecha: ahora,
        })
      );
    });

    if (autoLlenar) {
      try {
        await ProductionService.autoLlenarStockBarraDesdeCuartos({
          barraOrigenCodigo: codigo,
          cuartosDisponiblesAUsar: addCuartos,
          usuarioCodigo: opts.usuario ?? 'ADMIN',
          usuarioNombre: opts.usuario ?? 'ADMIN',
          origen: 'PRODUCCION_BARRA',
          observaciones: `FORZAR_AUTO_LLENA ${opts.observaciones ?? `Auto-llenado por producción (+${addCuartos})`}`,
        });
      } catch (err) {
        console.warn('⚠️ autoLlenarStockBarraDesdeCuartos falló (agregarProduccionBarra):', err);
      }
    }
  }

  static async crearBolsaVacia(opts: {
    nombre: string;
    cantidad: number;
    creadoPor: string;
    pesoKg: number;
    tiposHieloPermitidos?: IceType[];
    stockMinimoDefecto?: number;
    stockMaximoDefecto?: number;
    configStockPorHielo?: Partial<Record<IceType, Partial<StockPorHieloConfig>>>;
  }): Promise<BolsaProduct> {
    ProductService.validateCollections();

    const nombre = normalizeName(opts.nombre);
    if (!nombre) throw new Error('Nombre requerido');

    if (opts.cantidad <= 0) throw new Error('Cantidad debe ser > 0');
    if (!PESOS_BOLSA.includes(opts.pesoKg as any)) throw new Error(`Peso inválido. Usa: ${PESOS_BOLSA.join(', ')}kg`);

    const codigo = await obtenerProximoCodigo('BOLSA', 'VACIA');

    const bolsa = crearBolsaVaciaLocal({
      nombre,
      cantidad: opts.cantidad,
      creadoPor: normalizeName(opts.creadoPor) || 'admin',
      pesoKg: opts.pesoKg,
      tiposHieloPermitidos: opts.tiposHieloPermitidos?.length
        ? opts.tiposHieloPermitidos
        : (['ROLITO', 'FRAPPE', 'GOURMET', 'ENFRIAR'] as IceType[]),
      stockMinimoDefecto: opts.stockMinimoDefecto,
      stockMaximoDefecto: opts.stockMaximoDefecto,
      configStockPorHielo: opts.configStockPorHielo,
    });

    bolsa.codigo = codigo;

    await addDoc(col(ProductService.COLECCION_PRODUCTOS, 'ProductService.COLECCION_PRODUCTOS'), prepareForFirestore(bolsa));
    return bolsa;
  }

  /* -----------------------------
     CRUD: Leer
  ----------------------------- */
  static async obtenerBarras(): Promise<BarraProduct[]> {
    ProductService.validateCollections();
    const qy = query(
      col(ProductService.COLECCION_PRODUCTOS, 'ProductService.COLECCION_PRODUCTOS'),
      where('tipo', '==', 'BARRA')
    );
    const snap = await getDocs(qy);
    return snap.docs.map((d) => ProductService.mapBarra(d.data()));
  }

  static async obtenerBolsasPorEstado(status?: ProductStatus): Promise<BolsaProduct[]> {
    ProductService.validateCollections();

    const base = col(ProductService.COLECCION_PRODUCTOS, 'ProductService.COLECCION_PRODUCTOS');

    const qy = status
      ? query(base, where('tipo', '==', 'BOLSA'), where('status', '==', status))
      : query(base, where('tipo', '==', 'BOLSA'));

    const snap = await getDocs(qy);
    return snap.docs.map((d) => ProductService.mapBolsa(d.data()));
  }

  static async obtenerTodosProductos(): Promise<Product[]> {
    const [barras, bolsas] = await Promise.all([ProductService.obtenerBarras(), ProductService.obtenerBolsasPorEstado()]);
    return [...barras, ...bolsas];
  }

  static async obtenerProductoPorCodigo(codigo: string): Promise<Product | null> {
    ProductService.validateCollections();

    const qy = query(
      col(ProductService.COLECCION_PRODUCTOS, 'ProductService.COLECCION_PRODUCTOS'),
      where('codigo', '==', codigo),
      limit(1)
    );
    const snap = await getDocs(qy);
    if (snap.empty) return null;

    const data = snap.docs[0].data();
    return String(data.tipo ?? '').toUpperCase() === 'BARRA' ? ProductService.mapBarra(data) : ProductService.mapBolsa(data);
  }

  /* -----------------------------
     CRUD: Actualizar / Eliminar
  ----------------------------- */
  static async actualizarCantidadProducto(codigo: string, nuevaCantidad: number): Promise<void> {
    ProductService.validateCollections();

    const c = asStr(codigo).trim().toUpperCase();
    if (!c) throw new Error('Código requerido');
    if (nuevaCantidad < 0) throw new Error('Cantidad no puede ser negativa');

    const prod = await ProductService.obtenerProductoPorCodigo(c);
    if (prod && (prod as any).tipo === 'BARRA') {
      await ProductService.actualizarCuartosDesdeBarras({ codigo: c, barrasFisicas: nuevaCantidad });
      return;
    }

    const ref = await ProductService.getDocRefByCodigo(c);
    if (!ref) throw new Error(`Producto ${c} no encontrado`);

    await updateDoc(ref, {
      cantidad: nuevaCantidad,
      ultimaModificacion: toTs(new Date()),
    });
  }

  static async actualizarBarraConfig(opts: {
    codigo: string;
    nombre?: string;
    peso?: number;
    stockMinimo?: number;
    stockMaximo?: number;
  }): Promise<void> {
    ProductService.validateCollections();

    const codigo = asStr(opts.codigo).trim().toUpperCase();
    const ref = await ProductService.getDocRefByCodigo(codigo);
    if (!ref) throw new Error(`Barra ${codigo} no encontrada`);

    const patch: any = { ultimaModificacion: toTs(new Date()) };
    if (opts.nombre !== undefined) patch.nombre = normalizeName(opts.nombre);
    if (opts.peso !== undefined) patch.peso = opts.peso;
    if (opts.stockMinimo !== undefined) patch.stockMinimo = opts.stockMinimo;
    if (opts.stockMaximo !== undefined) patch.stockMaximo = opts.stockMaximo;

    await updateDoc(ref, patch);
  }

  static async actualizarBolsaVaciaConfig(opts: {
    codigo: string;
    nombre?: string;
    pesoKg?: number;
    tiposHieloPermitidos?: IceType[];
    stockMinimo?: number;
    stockMaximo?: number;
  }): Promise<void> {
    ProductService.validateCollections();

    const codigo = asStr(opts.codigo).trim().toUpperCase();
    const ref = await ProductService.getDocRefByCodigo(codigo);
    if (!ref) throw new Error(`Bolsa ${codigo} no encontrada`);

    if (opts.pesoKg !== undefined && !PESOS_BOLSA.includes(opts.pesoKg as any)) {
      throw new Error(`Peso inválido. Usa: ${PESOS_BOLSA.join(', ')}kg`);
    }

    const patch: any = { ultimaModificacion: toTs(new Date()) };
    if (opts.nombre !== undefined) patch.nombre = normalizeName(opts.nombre);
    if (opts.pesoKg !== undefined) patch.pesoKg = opts.pesoKg;
    if (opts.tiposHieloPermitidos !== undefined) patch.tiposHieloPermitidos = opts.tiposHieloPermitidos;
    if (opts.stockMinimo !== undefined) patch.stockMinimo = opts.stockMinimo;
    if (opts.stockMaximo !== undefined) patch.stockMaximo = opts.stockMaximo;

    await updateDoc(ref, patch);
  }

  static async eliminarProducto(codigoProducto: string): Promise<void> {
    ProductService.validateCollections();

    const codigo = asStr(codigoProducto).trim().toUpperCase();
    if (!codigo) throw new Error('Código requerido');

    const ref = await ProductService.getDocRefByCodigo(codigo);
    if (!ref) throw new Error(`Producto ${codigo} no encontrado`);

    await deleteDoc(ref);
  }

  /* -----------------------------
     Barra: actualizar cuartos (manual)
  ----------------------------- */
  static async actualizarCuartosBarra(opts: {
    codigo: string;
    cuartosTotales: number;
    cuartosDisponibles: number;
    cuartosUsados: number;
  }): Promise<void> {
    ProductService.validateCollections();

    const codigo = asStr(opts.codigo).trim().toUpperCase();
    const ref = await ProductService.getDocRefByCodigo(codigo);
    if (!ref) throw new Error(`Barra ${codigo} no encontrada`);

    const cuartosTotales = safeInt(opts.cuartosTotales, 0);
    const cuartosUsados = Math.min(Math.max(0, safeNum(opts.cuartosUsados, 0)), cuartosTotales);
    const cuartosDisponibles = Math.max(0, cuartosTotales - cuartosUsados);

    await updateDoc(ref, {
      cuartosTotales,
      cuartosDisponibles,
      cuartosUsados,
      ultimaModificacion: toTs(new Date()),
    });
  }

  // ✅ Sync físico (SET) y PROTEGE contra “perder usados”
  static async actualizarCuartosDesdeBarras(opts: { codigo: string; barrasFisicas: number }): Promise<void> {
    ProductService.validateCollections();

    const codigo = asStr(opts.codigo).trim().toUpperCase();
    if (!codigo) throw new Error('Código requerido');

    const docSnap = await ProductService.getDocSnapByCodigo(codigo);
    if (!docSnap) throw new Error(`Barra ${codigo} no encontrada`);

    const data = docSnap.data() as any;
    if (String(data.tipo ?? '').toUpperCase() !== 'BARRA') throw new Error(`El producto ${codigo} no es BARRA`);

    const barrasFisicas = safeInt(opts.barrasFisicas, 0);
    const cuartosTotales = barrasFisicas * 4;

    const usadosPrev = safeNum(data.cuartosUsados, 0);

    if (usadosPrev > cuartosTotales) {
      throw new Error(
        `Sync inválido: intentas dejar ${cuartosTotales} cuartos totales, pero ya hay ${usadosPrev} cuartos usados. ` +
          `Primero ajusta usados o revisa el conteo físico.`
      );
    }

    const cuartosUsados = Math.min(Math.max(0, usadosPrev), cuartosTotales);
    const cuartosDisponibles = Math.max(0, cuartosTotales - cuartosUsados);

    await updateDoc(docSnap.ref, {
      cantidad: barrasFisicas,
      cuartosTotales,
      cuartosDisponibles,
      cuartosUsados,
      status: barrasFisicas > 0 ? 'DISPONIBLE' : 'VACIA',
      ultimaModificacion: toTs(new Date()),
    });
  }

  /* -----------------------------
     Bolsa: configurar stockPorHielo
  ----------------------------- */
  static async actualizarConfigStockPorHielo(opts: {
    codigoProducto: string;
    stockPorHielo: Record<IceType, StockPorHieloConfig>;
    status?: ProductStatus;
  }): Promise<void> {
    ProductService.validateCollections();

    const codigo = asStr(opts.codigoProducto).trim().toUpperCase();
    const docSnap = await ProductService.getDocSnapByCodigo(codigo);
    if (!docSnap) throw new Error(`Producto ${codigo} no encontrado`);

    const data = docSnap.data() as any;
    if (String(data.tipo ?? '').toUpperCase() !== 'BOLSA') throw new Error('Solo aplica a productos tipo BOLSA');

    const now = new Date();
    const stockCompleto = ensureStockPorHieloCompleto(opts.stockPorHielo);

    const stockFS: Record<IceType, any> = {} as any;
    TIPOS_HIELO.forEach((t) => {
      const cfg = stockCompleto[t];
      stockFS[t] = {
        ...cfg,
        ultimaActualizacion: toDateSafe(cfg.ultimaActualizacion ?? now),
      };
    });

    await updateDoc(
      docSnap.ref,
      prepareForFirestore({
        stockPorHielo: stockFS,
        ...(opts.status ? { status: opts.status } : {}),
        ultimaModificacion: now,
      })
    );
  }

  static async actualizarTipoHieloContenido(opts: { codigo: string; tipoHieloContenido: IceType }): Promise<void> {
    ProductService.validateCollections();

    const codigo = asStr(opts.codigo).trim().toUpperCase();
    const ref = await ProductService.getDocRefByCodigo(codigo);
    if (!ref) throw new Error(`Producto ${codigo} no encontrado`);

    await updateDoc(ref, {
      tipoHieloContenido: normalizeIceType(opts.tipoHieloContenido),
      ultimaModificacion: toTs(new Date()),
    });
  }

  static async actualizarEstadoProducto(opts: {
    codigo: string;
    nuevoEstado: ProductStatus;
    modificadoPor?: string;
  }): Promise<void> {
    ProductService.validateCollections();

    const codigo = asStr(opts.codigo).trim().toUpperCase();
    const ref = await ProductService.getDocRefByCodigo(codigo);
    if (!ref) throw new Error(`Producto ${codigo} no encontrado`);

    await updateDoc(ref, {
      status: opts.nuevoEstado,
      ...(opts.modificadoPor ? { modificadoPor: opts.modificadoPor } : {}),
      ultimaModificacion: toTs(new Date()),
    });
  }

  /* ============================================================
     ✅ Llenado directo desde Admin (BVxxx -> stockPorHielo)
     ✅ Coherente con Producción (descuenta BV.cantidad / suma stockPorHielo)
============================================================ */
  static async llenarDesdeAdminStockPorHielo(opts: {
    codigoBolsaVacia: string;
    tipoHielo: IceType;
    cantidad: number;
    usuario: string;
    observaciones?: string;
    barraOrigenCodigo?: string;
  }): Promise<void> {
    ProductService.validateCollections();

    const codigoBolsaVacia = asStr(opts.codigoBolsaVacia).trim().toUpperCase();
    const tipoHielo = normalizeIceType(opts.tipoHielo);
    const cantidad = safeInt(opts.cantidad, 0);

    if (!codigoBolsaVacia) throw new Error('codigoBolsaVacia requerido');
    if (cantidad <= 0) throw new Error('Cantidad inválida');
    if (!normalizeName(opts.usuario)) throw new Error('usuario requerido');

    await ProductionService.llenarStockDesdeBolsaVacia({
      bolsaVaciaCodigo: codigoBolsaVacia,
      tipoHielo,
      cantidad,
      usuarioCodigo: normalizeName(opts.usuario) || 'ADMIN',
      usuarioNombre: normalizeName(opts.usuario) || 'ADMIN',
      origen: 'ADMIN',
      observaciones: opts.observaciones,
      barraOrigenCodigo: opts.barraOrigenCodigo,
    });
  }

  /* ============================================================
     FLUJO: Asignar bolsa vacía (BVxxx -> crea BAxxx unitario)
     ✅ FIX TX: NO obtenerProximoCodigo() dentro de tx
============================================================ */
  static async asignarBolsaVacia(opts: {
    bolsaVaciaCodigo: string;
    empleadoCodigo: string;
    asignadoPor: string;
  }): Promise<BolsaProduct> {
    ProductService.validateCollections();

    const bolsaVaciaCodigo = asStr(opts.bolsaVaciaCodigo).trim().toUpperCase();
    if (!bolsaVaciaCodigo) throw new Error('Código requerido');

    const bvSnap = await ProductService.getDocSnapByCodigo(bolsaVaciaCodigo);
    if (!bvSnap) throw new Error(`Bolsa ${bolsaVaciaCodigo} no encontrada`);

    const bvRef = bvSnap.ref;

    // ✅ genera código BA fuera de TX
    const codigoAsignada = await obtenerProximoCodigo('BOLSA', 'ASIGNADA');

    return await runTransaction(db, async (tx) => {
      const bvTx = await tx.get(bvRef);
      if (!bvTx.exists()) throw new Error(`Bolsa ${bolsaVaciaCodigo} no encontrada`);

      const bvData = bvTx.data() as any;
      if (String(bvData.tipo ?? '').toUpperCase() !== 'BOLSA' || String(bvData.status ?? '').toUpperCase() !== 'VACIA') {
        throw new Error('El producto origen no es bolsa vacía');
      }

      const cantidadActual = safeInt(bvData.cantidad, 0);
      if (cantidadActual <= 0) throw new Error('Stock insuficiente');

      const bv: BolsaProduct = ProductService.mapBolsa(bvData);
      const bolsaAsignada = crearBolsaAsignadaLocal({
        baseBolsaVacia: bv,
        empleadoCodigo: asStr(opts.empleadoCodigo).trim(),
        asignadoPor: asStr(opts.asignadoPor).trim(),
      });
      bolsaAsignada.codigo = codigoAsignada;

      tx.update(bvRef, { cantidad: cantidadActual - 1, ultimaModificacion: toTs(new Date()) });

      const baRef = doc(col(ProductService.COLECCION_PRODUCTOS, 'ProductService.COLECCION_PRODUCTOS'));
      tx.set(baRef, prepareForFirestore(bolsaAsignada));

      return bolsaAsignada;
    });
  }

  /* ============================================================
     FLUJO: Llenar bolsa asignada (BAxxx -> crea BLxxx) usando cuartos de barra
     ✅ Suma stockPorHielo en BV original (no en BL)
============================================================ */
  static async llenarBolsaAsignada(opts: {
    bolsaAsignadaCodigo: string;
    tipoHielo: IceType;
    llenadoPor: string;
    barraOrigenCodigo: string;
    cuartosUsados?: number;
  }): Promise<BolsaProduct> {
    ProductService.validateCollections();

    const tipoHielo = normalizeIceType(opts.tipoHielo);
    const cuartos = safeInt(opts.cuartosUsados ?? 1, 1);
    if (cuartos <= 0) throw new Error('Cuartos a usar debe ser > 0');

    const baCodigo = asStr(opts.bolsaAsignadaCodigo).trim().toUpperCase();
    const brCodigo = asStr(opts.barraOrigenCodigo).trim().toUpperCase();
    if (!baCodigo) throw new Error('bolsaAsignadaCodigo requerido');
    if (!brCodigo) throw new Error('barraOrigenCodigo requerido');

    const baSnap = await ProductService.getDocSnapByCodigo(baCodigo);
    if (!baSnap) throw new Error(`Bolsa ${baCodigo} no encontrada`);
    const brSnap = await ProductService.getDocSnapByCodigo(brCodigo);
    if (!brSnap) throw new Error(`Barra ${brCodigo} no encontrada`);

    const baRef = baSnap.ref;
    const brRef = brSnap.ref;

    const codigoLlena = await obtenerProximoCodigo('BOLSA', 'LLENA');

    // resolve BV original fuera de TX
    const preBA = baSnap.data() as any;
    const codigoBV = asStr(preBA?.bolsaVaciaOriginal).trim().toUpperCase();
    const bvRef = codigoBV ? await ProductService.getDocRefByCodigo(codigoBV) : null;

    return await runTransaction(db, async (tx) => {
      const baTx = await tx.get(baRef);
      if (!baTx.exists()) throw new Error(`Bolsa ${baCodigo} no encontrada`);
      const baData = baTx.data() as any;

      if (String(baData.tipo ?? '').toUpperCase() !== 'BOLSA' || String(baData.status ?? '').toUpperCase() !== 'ASIGNADA') {
        throw new Error('La bolsa no está ASIGNADA');
      }

      const bolsaAsignada = ProductService.mapBolsa(baData);

      if (bolsaAsignada.tiposHieloPermitidos?.length && !bolsaAsignada.tiposHieloPermitidos.includes(tipoHielo)) {
        throw new Error(`Esta bolsa no puede contener ${tipoHielo}`);
      }

      const brTx = await tx.get(brRef);
      if (!brTx.exists()) throw new Error(`Barra ${brCodigo} no encontrada`);
      const brData = brTx.data() as any;
      if (String(brData.tipo ?? '').toUpperCase() !== 'BARRA') throw new Error(`El producto ${brCodigo} no es BARRA`);

      const barra = ProductService.mapBarra(brData);
      if ((barra.cuartosDisponibles ?? 0) < cuartos) {
        throw new Error(`Barra sin cuartos suficientes: ${barra.cuartosDisponibles ?? 0} disponibles, ${cuartos} necesarios`);
      }

      const ahora = new Date();

      // ✅ SUMAR STOCK en BV ORIGINAL (si existe)
      if (bvRef) {
        const bvSnapTx = await tx.get(bvRef);
        if (bvSnapTx.exists()) {
          const bvData = bvSnapTx.data() as any;

          const stockBV = ensureStockPorHieloCompleto(bvData.stockPorHielo);
          const prevBV = safeNum(stockBV[tipoHielo]?.stockActual, 0);

          stockBV[tipoHielo] = {
            ...stockBV[tipoHielo],
            stockActual: prevBV + 1,
            ultimaActualizacion: ahora,
          };

          const historicoBV = Array.isArray(bvData.historico) ? bvData.historico : [];
          historicoBV.push(
            prepareForFirestore({
              fecha: ahora,
              accion: 'LLENADO_DESDE_ASIGNADA',
              usuario: opts.llenadoPor,
              cantidad: 1,
              observaciones: `BA->BL (${baCodigo}) a ${tipoHielo}`,
            })
          );

          tx.update(
            bvRef,
            prepareForFirestore({
              stockPorHielo: stockBV,
              historico: historicoBV,
              ultimaModificacion: ahora,
            })
          );
        }
      }

      const stockPorHieloBL = ensureStockPorHieloCompleto(bolsaAsignada.stockPorHielo, { stockMinimo: 0, stockMaximo: 0 });

      const bolsaLlena: BolsaProduct = {
        ...bolsaAsignada,
        codigo: codigoLlena,
        status: 'LLENA',
        cantidad: 1,
        tipoHieloContenido: tipoHielo,
        llenadoPor: opts.llenadoPor,
        fechaLlenado: ahora,
        barraOrigen: brCodigo,
        cuartosUsados: cuartos,
        bolsaAsignadaOriginal: bolsaAsignada.codigo,
        ultimaModificacion: ahora,
        stockPorHielo: stockPorHieloBL,
        historico: [
          ...(bolsaAsignada.historico ?? []),
          {
            fecha: ahora,
            accion: 'LLENADO_BOLSA',
            usuario: opts.llenadoPor,
            cantidad: 1,
            observaciones: `Llenado con ${tipoHielo} usando ${cuartos} cuarto(s) de ${brCodigo}`,
          },
        ],
      };

      const barraActualizada = usarCuartosDeBarraLocal(barra, cuartos, codigoLlena);

      const blRef = doc(col(ProductService.COLECCION_PRODUCTOS, 'ProductService.COLECCION_PRODUCTOS'));
      tx.set(blRef, prepareForFirestore(bolsaLlena));

      tx.update(brRef, {
        cuartosTotales: barraActualizada.cuartosTotales,
        cuartosDisponibles: barraActualizada.cuartosDisponibles,
        cuartosUsados: barraActualizada.cuartosUsados,
        bolsasLlenadasConEstaBarra: barraActualizada.bolsasLlenadasConEstaBarra,
        ultimaModificacion: toTs(new Date()),
      });

      tx.delete(baRef);

      const movRef = doc(col(ProductService.COLECCION_MOVIMIENTOS, 'ProductService.COLECCION_MOVIMIENTOS'));
      tx.set(
        movRef,
        prepareForFirestore({
          tipo: 'PRODUCCION',
          subtipo: 'BA_A_BL',
          productoCodigo: bolsaAsignada.codigo,
          productoNombre: bolsaAsignada.nombre ?? '',
          tipoHielo,
          cantidad: 1,
          usuario: opts.llenadoPor,
          observaciones: `BA->BL con ${cuartos} cuarto(s) de ${brCodigo}`,
          fecha: ahora,
        })
      );

      return bolsaLlena;
    });
  }

  /* ============================================================
     Consultas rápidas
============================================================ */
  static obtenerBolsasVacias(): Promise<BolsaProduct[]> {
    return ProductService.obtenerBolsasPorEstado('VACIA');
  }
  static obtenerBolsasAsignadas(): Promise<BolsaProduct[]> {
    return ProductService.obtenerBolsasPorEstado('ASIGNADA');
  }
  static obtenerBolsasLlenas(): Promise<BolsaProduct[]> {
    return ProductService.obtenerBolsasPorEstado('LLENA');
  }

  static async buscarProductosPorNombre(texto: string): Promise<Product[]> {
    const all = await ProductService.obtenerTodosProductos();
    const t = (texto ?? '').toLowerCase().trim();
    if (!t) return all;

    return all.filter(
      (p: any) => String(p.nombre ?? '').toLowerCase().includes(t) || String(p.codigo ?? '').toLowerCase().includes(t)
    );
  }

  static async obtenerProductosPorTipo(tipo: ProductType): Promise<Product[]> {
    const all = await ProductService.obtenerTodosProductos();
    return all.filter((p: any) => p.tipo === tipo);
  }

  /* ============================================================
     Agrupar bolsas asignadas por empleado
============================================================ */
  static async obtenerBolsasAgrupadasPorEmpleado(): Promise<
    Array<{
      empleado: string;
      bolsas: BolsaProduct[];
      totalBolsas: number;
      tiposHielo: IceType[];
      stockTotal: number;
      pesoTotalKg: number;
      fechaUltimaAsignacion?: Date;
    }>
  > {
    const bolsasAsignadas = await ProductService.obtenerBolsasAsignadas();

    const grupos: Record<
      string,
      {
        empleado: string;
        bolsas: BolsaProduct[];
        totalBolsas: number;
        tiposHielo: Set<IceType>;
        stockTotal: number;
        pesoTotalKg: number;
        fechaUltimaAsignacion?: Date;
      }
    > = {};

    bolsasAsignadas.forEach((b) => {
      const emp = b.asignadaA || 'Sin asignar';

      if (!grupos[emp]) {
        grupos[emp] = {
          empleado: emp,
          bolsas: [],
          totalBolsas: 0,
          tiposHielo: new Set<IceType>(),
          stockTotal: 0,
          pesoTotalKg: 0,
          fechaUltimaAsignacion: undefined,
        };
      }

      grupos[emp].bolsas.push(b);
      grupos[emp].totalBolsas += Number(b.cantidad ?? 1);

      (b.tiposHieloPermitidos ?? []).forEach((t) => grupos[emp].tiposHielo.add(t));

      grupos[emp].stockTotal += Number(b.cantidad ?? 1);
      grupos[emp].pesoTotalKg += Number(b.pesoKg ?? 3) * Number(b.cantidad ?? 1);

      if (b.fechaAsignacion) {
        const f = toDateSafe(b.fechaAsignacion);
        if (!grupos[emp].fechaUltimaAsignacion || f > grupos[emp].fechaUltimaAsignacion) {
          grupos[emp].fechaUltimaAsignacion = f;
        }
      }
    });

    return Object.values(grupos)
      .map((g) => ({ ...g, tiposHielo: Array.from(g.tiposHielo) }))
      .sort((a, b) => b.totalBolsas - a.totalBolsas);
  }

  /* ============================================================
     Registro simple de movimiento
============================================================ */
  static async registrarMovimiento(opts: { tipo: string; productoCodigo: string; detalles: string; usuario: string }): Promise<void> {
    ProductService.validateCollections();

    const movimiento = {
      tipo: opts.tipo,
      productoCodigo: asStr(opts.productoCodigo).trim().toUpperCase(),
      detalles: opts.detalles,
      usuario: opts.usuario,
      fecha: new Date(),
    };

    await addDoc(
      col(ProductService.COLECCION_MOVIMIENTOS, 'ProductService.COLECCION_MOVIMIENTOS'),
      prepareForFirestore(movimiento)
    );
  }

  /* ============================================================
     Compat: “simular llenado” (coherente)
============================================================ */
  static async simularLlenadoBolsa(opts: {
    codigoBolsa: string;
    tipoHielo: IceType;
    cantidad: number;
    usuarioNombre: string;
    barraOrigenCodigo?: string;
  }): Promise<BolsaProduct> {
    await ProductService.llenarDesdeAdminStockPorHielo({
      codigoBolsaVacia: opts.codigoBolsa,
      tipoHielo: opts.tipoHielo,
      cantidad: opts.cantidad,
      usuario: opts.usuarioNombre,
      observaciones: 'Llenado desde Admin (simulación compat)',
      barraOrigenCodigo: opts.barraOrigenCodigo,
    });

    const prod = await ProductService.obtenerProductoPorCodigo(asStr(opts.codigoBolsa).trim().toUpperCase());
    if (!prod || !esBolsa(prod)) throw new Error('Bolsa no encontrada tras llenado');
    return prod;
  }

  /* ============================================================
     Estadísticas simples
============================================================ */
  static async obtenerEstadisticas(): Promise<{
    totalBarras: number;
    totalCuartosDisponibles: number;
    totalBolsasVacias: number;
    totalBolsasAsignadas: number;
    totalBolsasLlenas: number;
  }> {
    const [barras, vacias, asignadas, llenas] = await Promise.all([
      ProductService.obtenerBarras(),
      ProductService.obtenerBolsasVacias(),
      ProductService.obtenerBolsasAsignadas(),
      ProductService.obtenerBolsasLlenas(),
    ]);

    const totalBarras = barras.reduce((s, b) => s + Number(b.cantidad ?? 0), 0);
    const totalCuartosDisponibles = barras.reduce((s, b) => s + Number(b.cuartosDisponibles ?? 0), 0);
    const totalBolsasVacias = vacias.reduce((s, b) => s + Number(b.cantidad ?? 0), 0);
    const totalBolsasAsignadas = asignadas.reduce((s, b) => s + Number(b.cantidad ?? 0), 0);
    const totalBolsasLlenas = llenas.reduce((s, b) => s + Number(b.cantidad ?? 0), 0);

    return {
      totalBarras,
      totalCuartosDisponibles,
      totalBolsasVacias,
      totalBolsasAsignadas,
      totalBolsasLlenas,
    };
  }
}