'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase/config.client';

import type {
  Product,
  BarraProduct,
  BolsaProduct,
  IceType,
  StockPorHieloConfig,
} from '@/lib/utils/types/product.types';

import {
  TIPOS_HIELO,
  crearConfigStockHieloInicial,
  esBolsa,
  esBarra,
} from '@/lib/utils/types/product.types';

import { ProductService } from '@/lib/services/product.service';
import { ProductionService } from '@/lib/services/production.service';
import { AsignacionService } from '@/lib/services/asignacion.service';

// ✅ reportes desde movimientos
import { ReportsService, type ReporteProduccionDiaria } from '@/lib/services/reports.service';

/* ============================================================
   COLECCIONES
============================================================ */
const COLECCION_EMPLEADOS = 'empleados';
const COLECCION_ASIGNACIONES = 'asignaciones';
const COLECCION_COSECHAS = 'cosechas';

/** ✅ Si por error alguien pisa ProductService.COLECCION_PRODUCTOS, usamos fallback "productos" */
const COLECCION_PRODUCTOS_SAFE =
  (ProductService as any)?.COLECCION_PRODUCTOS && String((ProductService as any).COLECCION_PRODUCTOS).trim()
    ? String((ProductService as any).COLECCION_PRODUCTOS).trim()
    : 'productos';

/* ============================================================
   Tipos extra (Asignaciones / Cosechas)
============================================================ */
export type TurnoType = 'MATUTINO' | 'VESPERTINO' | 'NOCTURNO';

export interface EmpleadoSimple {
  codigo: string;
  nombre: string;
  email?: string;
  telefono?: string;
  turno?: TurnoType;
  isActive?: boolean;
  fechaIngreso?: Date;
}

export type CosechaEstado = 'ABIERTA' | 'CERRADA' | 'CANCELADA';

export interface Cosecha {
  id: string;
  codigo: string;
  empleadoCodigo: string;
  empleadoNombre: string;
  turno: TurnoType;
  fecha: Date;
  estado: CosechaEstado;
  creadoPor: string;
  createdAt: Date;
  updatedAt?: Date;
  totalItems?: number;
  totalBolsas?: number;
}

/**
 * DocId determinístico: `${cosechaId}__${empleadoCodigo}__${productoCodigo}`
 */
export interface Asignacion {
  id: string;
  codigo: string;

  productoCodigo: string;
  productoNombre: string;
  tipoHielo?: IceType | string;

  empleadoCodigo: string;
  empleadoNombre: string;
  empleadoEmail?: string;

  fechaAsignacion: Date;
  cantidad: number;
  pesoKg?: number;
  turno?: TurnoType;
  observaciones?: string;
  cuartosAsignados?: number;

  creadoPor?: string;
  createdAt: Date;
  updatedAt?: Date;
  estado?: string;

  cosechaId?: string;
  cosechaCodigo?: string;
  cosechaEstado?: CosechaEstado | string;
}

/* ============================================================
   Helpers
============================================================ */
const toDateSafe = (v: any): Date => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  return new Date(v);
};

/** Detecta FieldValue.increment serializado (corrupto) */
const isIncrementLike = (v: any) => {
  if (!v || typeof v !== 'object') return false;
  const m = String((v as any)._methodName ?? '');
  return m.toLowerCase() === 'increment';
};

const safeNum = (v: any, fallback = 0): number => {
  if (v == null) return fallback;
  if (isIncrementLike(v)) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const safeInt = (v: any, fallback = 0): number => {
  const n = safeNum(v, fallback);
  const i = Math.floor(n);
  return i < 0 ? fallback : i;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();

/** ✅ BV real por código (tu modelo): BVxxx */
const isBVCodigo = (codigo: any) => /^BV/i.test(String(codigo ?? '').trim());

/**
 * ✅ BARRA: coherencia SIEMPRE:
 * - totales = cuartosTotales (o cantidad*4)
 * - disponibles + usados = totales
 */
const computeCuartosCoherentes = (raw: { totales: number; disponibles?: any; usados?: any }) => {
  const tot = Math.max(0, safeInt(raw.totales, 0));

  const rd = Number.isFinite(Number(raw.disponibles)) ? safeInt(raw.disponibles, 0) : null;
  const ru = Number.isFinite(Number(raw.usados)) ? safeInt(raw.usados, 0) : null;

  let disp = tot;
  let usados = 0;

  if (rd != null) {
    disp = clamp(rd, 0, tot);
    usados = clamp(tot - disp, 0, tot);
    return { tot, disp, usados };
  }

  if (ru != null) {
    usados = clamp(ru, 0, tot);
    disp = clamp(tot - usados, 0, tot);
    return { tot, disp, usados };
  }

  return { tot, disp, usados };
};

const ensureStockPorHieloCompleto = (
  stockPorHielo?: Record<IceType, StockPorHieloConfig> | any,
  defaults: { stockMinimo: number; stockMaximo: number } = { stockMinimo: 0, stockMaximo: 0 }
): Record<IceType, StockPorHieloConfig> => {
  const base = crearConfigStockHieloInicial(TIPOS_HIELO, undefined, defaults);

  if (!stockPorHielo || typeof stockPorHielo !== 'object') return base;

  const out = { ...base } as Record<IceType, StockPorHieloConfig>;

  TIPOS_HIELO.forEach((t) => {
    const cfg = stockPorHielo[t];
    if (cfg && typeof cfg === 'object') {
      out[t] = {
        stockMinimo: safeNum(cfg.stockMinimo, out[t].stockMinimo),
        stockMaximo: safeNum(cfg.stockMaximo, out[t].stockMaximo),
        // ✅ CLAVE: entero >= 0
        stockActual: Math.max(0, safeInt(cfg.stockActual, 0)),
        ultimaActualizacion: cfg.ultimaActualizacion ? toDateSafe(cfg.ultimaActualizacion) : out[t].ultimaActualizacion,
        configAdmin: cfg.configAdmin ?? out[t].configAdmin,
      };
    }
  });

  return out;
};

const mapDocToProduct = (data: any, id?: string): Product => {
  const codigo = String(data.codigo ?? '').trim();

  const base = {
    id: id ?? data.id ?? codigo,
    codigo,
    nombre: String(data.nombre ?? ''),
    tipo: data.tipo,
    status: data.status,

    // ✅ cantidad como entero >= 0 (BV)
    cantidad: Math.max(0, safeInt(data.cantidad, 0)),

    creadoPor: data.creadoPor ?? 'admin',
    fechaCreacion: toDateSafe(data.fechaCreacion),
    ultimaModificacion: toDateSafe(data.ultimaModificacion),

    stockMinimo: data.stockMinimo,
    stockMaximo: data.stockMaximo,
  } as any;

  if (data.tipo === 'BARRA') {
    const barrasFisicas = Math.max(0, safeInt(data.cantidad, 0));
    const totales = Number.isFinite(Number(data.cuartosTotales))
      ? Math.max(0, safeInt(data.cuartosTotales, barrasFisicas * 4))
      : barrasFisicas * 4;

    const { disp, usados } = computeCuartosCoherentes({
      totales,
      disponibles: data.cuartosDisponibles,
      usados: data.cuartosUsados,
    });

    const barra: BarraProduct = {
      ...base,
      tipo: 'BARRA',
      peso: data.peso,
      cuartosTotales: totales,
      cuartosDisponibles: disp,
      cuartosUsados: usados,
      bolsasLlenadasConEstaBarra: data.bolsasLlenadasConEstaBarra ?? [],
      configPorTipoHielo: data.configPorTipoHielo,
      configuracionAdmin: data.configuracionAdmin,
    };
    return barra;
  }

  const stockPorHielo = ensureStockPorHieloCompleto(data.stockPorHielo);

  const bolsa: BolsaProduct = {
    ...base,
    tipo: 'BOLSA',
    pesoKg: safeNum(data.pesoKg, 3),
    tiposHieloPermitidos: data.tiposHieloPermitidos ?? [],
    stockPorHielo,

    configuracionEspecifica: data.configuracionEspecifica,
    configuracionAdmin: data.configuracionAdmin,

    // legacy
    tipoHieloContenido: data.tipoHieloContenido,
    llenadoPor: data.llenadoPor,
    fechaLlenado: data.fechaLlenado ? toDateSafe(data.fechaLlenado) : undefined,
    cuartosUsados: safeNum(data.cuartosUsados, 0),
    barraOrigen: data.barraOrigen,
    asignadaA: data.asignadaA,
    fechaAsignacion: data.fechaAsignacion ? toDateSafe(data.fechaAsignacion) : undefined,
    bolsaVaciaOriginal: data.bolsaVaciaOriginal,
    bolsaAsignadaOriginal: data.bolsaAsignadaOriginal,
    historico: (data.historico ?? []).map((h: any) => ({ ...h, fecha: toDateSafe(h.fecha) })),
  };

  return bolsa;
};

/* ============================================================
   Tipos derivados para stock real (TU MODELO)
============================================================ */
export interface StockLlenoPorTipo {
  tipoHielo: IceType;
  stockActual: number;
  stockMinimo: number;
  stockMaximo: number;
  ultimaActualizacion?: Date;
}

export interface StockLlenoPorProducto {
  bolsaVaciaCodigo: string;
  productoNombre: string;
  pesoKg?: number;
  tipos: StockLlenoPorTipo[];
  totalLlenas: number;
  bolsasVaciasDisponibles: number;
}

/* ============================================================
   Hook
============================================================ */
export function useProducts() {
  const [productos, setProductos] = useState<Product[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoSimple[]>([]);
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
  const [cosechas, setCosechas] = useState<Cosecha[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---------------------------
     Productos realtime
  ---------------------------- */
  const qyProductos = useMemo(
    () => query(collection(db, COLECCION_PRODUCTOS_SAFE), orderBy('codigo', 'asc')),
    []
  );

  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsub = onSnapshot(
      qyProductos,
      (snap) => {
        const items = snap.docs.map((d) => mapDocToProduct(d.data(), d.id));
        setProductos(items);
        setLoading(false);
      },
      (err) => {
        console.error('useProducts productos snapshot error:', err);
        setError(err.message ?? 'Error cargando productos');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [qyProductos]);

  /* ---------------------------
     Empleados realtime
  ---------------------------- */
  const qyEmpleados = useMemo(
    () => query(collection(db, COLECCION_EMPLEADOS), orderBy('codigo', 'asc')),
    []
  );

  useEffect(() => {
    const unsub = onSnapshot(
      qyEmpleados,
      (snap) => {
        const list: EmpleadoSimple[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            codigo: String(data.codigo ?? d.id),
            nombre: String(data.nombre ?? 'Sin nombre'),
            email: data.email,
            telefono: data.telefono,
            turno: data.turno,
            isActive: (data.isActive ?? data.activo) ?? true,
            fechaIngreso: data.fechaIngreso ? toDateSafe(data.fechaIngreso) : undefined,
          };
        });

        setEmpleados(list);
      },
      (err) => {
        console.error('useProducts empleados snapshot error:', err);
      }
    );

    return () => unsub();
  }, [qyEmpleados]);

  /* ---------------------------
     Cosechas realtime
  ---------------------------- */
  const qyCosechas = useMemo(
    () => query(collection(db, COLECCION_COSECHAS), orderBy('createdAt', 'desc')),
    []
  );

  useEffect(() => {
    const unsub = onSnapshot(
      qyCosechas,
      (snap) => {
        const list: Cosecha[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            codigo: String(data.codigo ?? d.id),
            empleadoCodigo: String(data.empleadoCodigo ?? ''),
            empleadoNombre: String(data.empleadoNombre ?? ''),
            turno: (data.turno as TurnoType) ?? 'MATUTINO',
            fecha: toDateSafe(data.fecha ?? data.createdAt),
            estado: (data.estado as CosechaEstado) ?? 'ABIERTA',
            creadoPor: String(data.creadoPor ?? ''),
            createdAt: toDateSafe(data.createdAt),
            updatedAt: data.updatedAt ? toDateSafe(data.updatedAt) : undefined,
            totalItems: data.totalItems != null ? safeNum(data.totalItems, 0) : undefined,
            totalBolsas: data.totalBolsas != null ? safeNum(data.totalBolsas, 0) : undefined,
          };
        });

        setCosechas(list);
      },
      (err) => {
        console.error('useProducts cosechas snapshot error:', err);
      }
    );

    return () => unsub();
  }, [qyCosechas]);

  /* ---------------------------
     Asignaciones realtime
  ---------------------------- */
  const qyAsignaciones = useMemo(
    () => query(collection(db, COLECCION_ASIGNACIONES), orderBy('createdAt', 'desc')),
    []
  );

  useEffect(() => {
    const unsub = onSnapshot(
      qyAsignaciones,
      (snap) => {
        const list: Asignacion[] = snap.docs.map((d) => {
          const data = d.data() as any;

          return {
            id: d.id,
            codigo: String(data.codigo ?? d.id),

            productoCodigo: String(data.productoCodigo ?? ''),
            productoNombre: String(data.productoNombre ?? ''),
            tipoHielo: data.tipoHielo ?? undefined,

            empleadoCodigo: String(data.empleadoCodigo ?? ''),
            empleadoNombre: String(data.empleadoNombre ?? ''),
            empleadoEmail: data.empleadoEmail ?? undefined,

            fechaAsignacion: toDateSafe(data.fechaAsignacion ?? data.createdAt),
            cantidad: safeNum(data.cantidad, 0),
            pesoKg: data.pesoKg != null ? safeNum(data.pesoKg, 0) : undefined,
            turno: data.turno ?? undefined,
            observaciones: data.observaciones ?? undefined,
            cuartosAsignados: data.cuartosAsignados != null ? safeNum(data.cuartosAsignados, 0) : undefined,

            creadoPor: data.creadoPor ?? undefined,
            createdAt: toDateSafe(data.createdAt),
            updatedAt: data.updatedAt ? toDateSafe(data.updatedAt) : undefined,
            estado: data.estado ?? 'PENDIENTE',

            cosechaId: data.cosechaId ?? undefined,
            cosechaCodigo: data.cosechaCodigo ?? undefined,
            cosechaEstado: data.cosechaEstado ?? undefined,
          };
        });

        setAsignaciones(list);
      },
      (err) => {
        console.error('useProducts asignaciones snapshot error:', err);
      }
    );

    return () => unsub();
  }, [qyAsignaciones]);

  /* ---------------------------
     Reload manual
  ---------------------------- */
  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [snapP, snapE, snapA, snapC] = await Promise.all([
        getDocs(qyProductos),
        getDocs(qyEmpleados),
        getDocs(qyAsignaciones),
        getDocs(qyCosechas),
      ]);

      setProductos(snapP.docs.map((d) => mapDocToProduct(d.data(), d.id)));

      setEmpleados(
        snapE.docs.map((d) => {
          const data = d.data() as any;
          return {
            codigo: String(data.codigo ?? d.id),
            nombre: String(data.nombre ?? 'Sin nombre'),
            email: data.email,
            telefono: data.telefono,
            turno: data.turno,
            isActive: (data.isActive ?? data.activo) ?? true,
            fechaIngreso: data.fechaIngreso ? toDateSafe(data.fechaIngreso) : undefined,
          } as EmpleadoSimple;
        })
      );

      setAsignaciones(
        snapA.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            codigo: String(data.codigo ?? d.id),

            productoCodigo: String(data.productoCodigo ?? ''),
            productoNombre: String(data.productoNombre ?? ''),
            tipoHielo: data.tipoHielo ?? undefined,

            empleadoCodigo: String(data.empleadoCodigo ?? ''),
            empleadoNombre: String(data.empleadoNombre ?? ''),
            empleadoEmail: data.empleadoEmail ?? undefined,

            fechaAsignacion: toDateSafe(data.fechaAsignacion ?? data.createdAt),
            cantidad: safeNum(data.cantidad, 0),
            pesoKg: data.pesoKg != null ? safeNum(data.pesoKg, 0) : undefined,
            turno: data.turno ?? undefined,
            observaciones: data.observaciones ?? undefined,
            cuartosAsignados: data.cuartosAsignados != null ? safeNum(data.cuartosAsignados, 0) : undefined,

            creadoPor: data.creadoPor ?? undefined,
            createdAt: toDateSafe(data.createdAt),
            updatedAt: data.updatedAt ? toDateSafe(data.updatedAt) : undefined,
            estado: data.estado ?? 'PENDIENTE',

            cosechaId: data.cosechaId ?? undefined,
            cosechaCodigo: data.cosechaCodigo ?? undefined,
            cosechaEstado: data.cosechaEstado ?? undefined,
          } as Asignacion;
        })
      );

      setCosechas(
        snapC.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            codigo: String(data.codigo ?? d.id),
            empleadoCodigo: String(data.empleadoCodigo ?? ''),
            empleadoNombre: String(data.empleadoNombre ?? ''),
            turno: (data.turno as TurnoType) ?? 'MATUTINO',
            fecha: toDateSafe(data.fecha ?? data.createdAt),
            estado: (data.estado as CosechaEstado) ?? 'ABIERTA',
            creadoPor: String(data.creadoPor ?? ''),
            createdAt: toDateSafe(data.createdAt),
            updatedAt: data.updatedAt ? toDateSafe(data.updatedAt) : undefined,
            totalItems: data.totalItems != null ? safeNum(data.totalItems, 0) : undefined,
            totalBolsas: data.totalBolsas != null ? safeNum(data.totalBolsas, 0) : undefined,
          } as Cosecha;
        })
      );
    } catch (e: any) {
      console.error('useProducts reload error:', e);
      setError(e?.message ?? 'Error recargando datos');
    } finally {
      setLoading(false);
    }
  }, [qyProductos, qyEmpleados, qyAsignaciones, qyCosechas]);

  /* ---------------------------
     Derivados (productos)
  ---------------------------- */
  const barras = useMemo(() => productos.filter(esBarra) as BarraProduct[], [productos]);
  const bolsas = useMemo(() => productos.filter(esBolsa) as BolsaProduct[], [productos]);

  /**
   * ✅ BV = bolsa base (BVxxx) — aquí vive stockPorHielo
   * 🔥 FIX: ya NO depende de status, depende de codigo BVxxx (robusto)
   */
  const bolsasVacias = useMemo(() => {
    return bolsas.filter((b) => {
      const codigo = String((b as any).codigo ?? '').trim();
      if (isBVCodigo(codigo)) return true;

      // fallback legacy por si tienes BV sin prefijo BV (raro)
      const st = String((b as any).status ?? '').toUpperCase().trim();
      return !st || st === 'VACIA' || st === 'VACIO' || st === 'DISPONIBLE' || st === 'BOLSA_VACIA';
    });
  }, [bolsas]);

  // Compat visual (legacy)
  const bolsasAsignadas = useMemo(() => [] as BolsaProduct[], []);
  const bolsasLlenas = useMemo(() => [] as BolsaProduct[], []);

  /* ---------------------------
     Stock real: llenas por tipo de hielo (desde BV.stockPorHielo)
  ---------------------------- */
  const stockLlenoPorProducto = useMemo(() => {
    return bolsasVacias.map((bv) => {
      const stock = ensureStockPorHieloCompleto((bv as any).stockPorHielo);

      const tipos = TIPOS_HIELO.map((t) => {
        const cfg = stock[t];
        return {
          tipoHielo: t,
          stockActual: Math.max(0, safeInt(cfg?.stockActual, 0)),
          stockMinimo: Math.max(0, safeInt(cfg?.stockMinimo, 0)),
          stockMaximo: Math.max(0, safeInt(cfg?.stockMaximo, 0)),
          ultimaActualizacion: cfg?.ultimaActualizacion ? toDateSafe(cfg.ultimaActualizacion) : undefined,
        };
      });

      const totalLlenas = tipos.reduce((s, x) => s + safeInt(x.stockActual, 0), 0);

      return {
        bolsaVaciaCodigo: String((bv as any).codigo ?? ''),
        productoNombre: String((bv as any).nombre ?? ''),
        pesoKg: safeNum((bv as any).pesoKg, 0),
        tipos,
        totalLlenas,
        bolsasVaciasDisponibles: Math.max(0, safeInt((bv as any).cantidad, 0)),
      };
    });
  }, [bolsasVacias]);

  const stockLlenoTotalPorTipo = useMemo(() => {
    const out = {} as Record<IceType, number>;
    TIPOS_HIELO.forEach((t) => (out[t] = 0));

    stockLlenoPorProducto.forEach((p) => {
      p.tipos.forEach((x) => {
        out[x.tipoHielo] = safeInt(out[x.tipoHielo], 0) + safeInt(x.stockActual, 0);
      });
    });

    return out;
  }, [stockLlenoPorProducto]);

  const stockLlenoTotalGeneral = useMemo(() => {
    return Object.values(stockLlenoTotalPorTipo).reduce((s, n) => s + safeInt(n, 0), 0);
  }, [stockLlenoTotalPorTipo]);

  /* ---------------------------
     Getters para pages
  ---------------------------- */
  const getBolsasVacias = useCallback(() => bolsasVacias, [bolsasVacias]);
  const getBarras = useCallback(() => barras, [barras]);

  // ✅ métricas correctas (SUMA barras físicas)
  const totalBarrasFisicas = useMemo(() => {
    return barras.reduce((s, b) => s + safeInt((b as any).cantidad, 0), 0);
  }, [barras]);

  const getStockAlmacen = useCallback(() => {
    const totalBolsasVaciasDisponibles = bolsasVacias.reduce((sum, b) => sum + safeInt((b as any).cantidad, 0), 0);
    const totalCuartosDisponibles = barras.reduce((sum, b) => sum + safeInt((b as any).cuartosDisponibles, 0), 0);

    return {
      totalBolsasVaciasDisponibles,
      totalBolsasLlenas: stockLlenoTotalGeneral,
      totalCuartosDisponibles,
      totalBarras: totalBarrasFisicas,
      totalProductos: productos.length,
    };
  }, [bolsasVacias, barras, productos.length, stockLlenoTotalGeneral, totalBarrasFisicas]);

  /* ============================================================
     ✅ Admin llenado COHERENTE (MISMA lógica que producción)
============================================================ */
  const llenarDesdeAdmin = useCallback(
    async (opts: {
      codigoBolsaVacia: string;
      tipoHielo: IceType;
      cantidad: number;
      usuario: string;
      observaciones?: string;
      barraOrigenCodigo?: string; // ✅ requerido si tipo=BARRA
    }) => {
      await ProductionService.llenarStockDesdeBolsaVacia({
        bolsaVaciaCodigo: opts.codigoBolsaVacia,
        tipoHielo: opts.tipoHielo,
        cantidad: opts.cantidad,
        usuarioCodigo: opts.usuario,
        usuarioNombre: opts.usuario,
        origen: 'ADMIN',
        observaciones: opts.observaciones,
        barraOrigenCodigo: opts.barraOrigenCodigo,
      });
    },
    []
  );

  /* ============================================================
     ✅ Producción BARRAS (SUMA)
============================================================ */
  const agregarProduccionBarra = useCallback(
    async (opts: { codigo: string; barrasProducidas: number; usuario?: string; observaciones?: string }) => {
      await ProductService.agregarProduccionBarra(opts);
    },
    []
  );

  /* ---------------------------
     Actions (services)
  ---------------------------- */
  const actions = {
    crearBarra: ProductService.crearBarra,
    crearBolsaVacia: ProductService.crearBolsaVacia,
    actualizarCantidadProducto: ProductService.actualizarCantidadProducto,

    actualizarCuartosDesdeBarras: ProductService.actualizarCuartosDesdeBarras,
    actualizarConfigStockPorHielo: ProductService.actualizarConfigStockPorHielo,
    eliminarProducto: ProductService.eliminarProducto,

    llenarDesdeAdminStockPorHielo: ProductService.llenarDesdeAdminStockPorHielo,
    agregarProduccionBarra,

    // producción (inventario real)
    llenarStockDesdeBolsaVacia: ProductionService.llenarStockDesdeBolsaVacia,
    llenarDesdeAsignacion: ProductionService.llenarDesdeAsignacion,
    registrarSalidaStock: ProductionService.registrarSalidaStock,
    registrarSalidaStockBatch: ProductionService.registrarSalidaStockBatch,
    registrarDevolucionStock: ProductionService.registrarDevolucionStock,
    registrarMermaStock: ProductionService.registrarMermaStock,

    // reportes
    obtenerMovimientosRecientes: ReportsService.obtenerMovimientosRecientes,
    obtenerProduccionDelDia: (fecha?: Date): Promise<ReporteProduccionDiaria> =>
      ReportsService.generarReporteProduccionDiaria(fecha ?? new Date()),
  };

  /* ============================================================
     ✅ COSECHAS HELPERS
============================================================ */
  const cosechasAbiertas = useMemo(() => {
    return cosechas.filter((c) => (c.estado ?? 'ABIERTA') === 'ABIERTA');
  }, [cosechas]);

  const getCosechasAbiertasPara = useCallback(
    (opts: { empleadoCodigo?: string; turno?: TurnoType; fecha?: Date } = {}) => {
      const fecha = opts.fecha ?? new Date();
      return cosechasAbiertas.filter((c) => {
        if (opts.empleadoCodigo && c.empleadoCodigo !== opts.empleadoCodigo) return false;
        if (opts.turno && c.turno !== opts.turno) return false;
        if (!sameDay(c.fecha, fecha)) return false;
        return true;
      });
    },
    [cosechasAbiertas]
  );

  /* ============================================================
     ✅ WRAPPER: asignarBolsasConStock (delegado al Service)
============================================================ */
  type ModoCosecha = 'NUEVA' | 'EXISTENTE';

  const asignarBolsasConStock = useCallback(
    async (
      productoCodigo: string,
      cantidad: number,
      asignadoPor: string,
      empleadoNombre: string,
      empleadoCodigo: string,
      turno: TurnoType,
      observaciones?: string,
      cuartosAsignados?: number,
      cosecha?: { modo: ModoCosecha; cosechaId?: string },
      fechaAsignacion?: Date
    ) => {
      if (!productoCodigo) throw new Error('productoCodigo requerido');
      if (!empleadoCodigo) throw new Error('empleadoCodigo requerido');
      if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error('cantidad debe ser > 0');

      const prod = productos.find((p) => p.codigo === productoCodigo);
      if (!prod) throw new Error(`Producto ${productoCodigo} no encontrado`);
      if (!esBolsa(prod)) throw new Error('Solo puedes asignar desde una bolsa (BV)');

      // ✅ FIX: validación real por prefijo BV
      if (!isBVCodigo((prod as any).codigo)) throw new Error('Solo puedes asignar desde una BVxxx');

      const productoNombre = String((prod as any).nombre ?? '');
      const pesoKg = (prod as any).pesoKg;

      await AsignacionService.crearOActualizarAsignacionPorCosecha({
        productoCodigo,
        productoNombre,
        tipoHielo: undefined,

        empleadoCodigo,
        empleadoNombre,

        turno,
        cantidad,

        observaciones,
        cuartosAsignados,
        pesoKg,

        creadoPor: asignadoPor,
        estado: 'PENDIENTE',
        fechaAsignacion: fechaAsignacion ?? new Date(),

        cosecha: {
          modo: cosecha?.modo ?? 'NUEVA',
          cosechaId: cosecha?.cosechaId,
        },

        stock: {
          ajustarStock: true,
          productoDocId: String((prod as any).id ?? '').trim(),
        },
      });

      return { ok: true };
    },
    [productos]
  );

  /* ---------------------------
     Legacy (compat): crearAsignacion
  ---------------------------- */
  const crearAsignacion = useCallback(
    async (
      productoCodigo: string,
      productoNombre: string,
      cantidad: number,
      creadoPor: string,
      empleadoNombre: string,
      pesoKg?: number,
      tiposHielo?: string[],
      observaciones?: string
    ) => {
      if (!productoCodigo) throw new Error('productoCodigo requerido');
      if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error('cantidad debe ser > 0');

      const prod = productos.find((p) => p.codigo === productoCodigo);
      const pesoFinal = pesoKg ?? (prod && esBolsa(prod) ? (prod as any).pesoKg : undefined);

      await AsignacionService.crearAsignacion({
        productoCodigo,
        productoNombre,
        empleadoCodigo: '',
        empleadoNombre,
        turno: 'MATUTINO',
        cantidad,
        observaciones,
        pesoKg: pesoFinal,
        tipoHielo: tiposHielo?.[0],
        creadoPor,
        estado: 'PENDIENTE',
        fechaAsignacion: new Date(),
      });
    },
    [productos]
  );

  /* ---------------------------
     Admin historial (editar/cancelar)
  ---------------------------- */
  const adminEditarAsignacion = useCallback(
    async (opts: {
      asignacionId: string;
      actor: string;
      nuevaCantidad: number;
      nuevasObservaciones?: string;
      nuevoTurno?: TurnoType;
      force?: boolean;
    }) => {
      await AsignacionService.adminEditarItem({
        asignacionId: opts.asignacionId,
        actor: opts.actor,
        nuevaCantidad: opts.nuevaCantidad,
        nuevasObservaciones: opts.nuevasObservaciones,
        nuevoTurno: opts.nuevoTurno,
        force: opts.force,
      });
    },
    []
  );

  const adminCancelarAsignacion = useCallback(
    async (opts: { asignacionId: string; actor: string; motivo?: string; force?: boolean }) => {
      await AsignacionService.adminCancelarItem({
        asignacionId: opts.asignacionId,
        actor: opts.actor,
        motivo: opts.motivo,
        force: opts.force,
      });
    },
    []
  );

  /* ---------------------------
     Aliases viejos para compat
  ---------------------------- */
  const products = productos;
  const crearBarra = actions.crearBarra;
  const crearBolsaVacia = actions.crearBolsaVacia;
  const actualizarCantidad = actions.actualizarCantidadProducto;

  return {
    productos,
    products,

    barras,
    bolsas,
    bolsasVacias,

    // compat (legacy)
    bolsasAsignadas: [] as BolsaProduct[],
    bolsasLlenas: [] as BolsaProduct[],

    asignaciones,
    empleados,

    // ✅ cosechas
    cosechas,
    cosechasAbiertas,
    getCosechasAbiertasPara,

    // stock real
    stockLlenoPorProducto,
    stockLlenoTotalPorTipo,
    stockLlenoTotalGeneral,

    // ✅ métricas correctas
    totalBarrasFisicas,

    loading,
    error,

    actions,
    reload,

    // compat/aliases
    crearBarra,
    crearBolsaVacia,
    actualizarCantidad,

    // ✅ wrapper inventario admin
    llenarDesdeAdmin,

    // ✅ admin historial actions
    adminEditarAsignacion,
    adminCancelarAsignacion,

    // pages
    asignarBolsasConStock,
    crearAsignacion,
    getBolsasVacias: () => bolsasVacias,
    getBarras: () => barras,
    getStockAlmacen,
  };
}