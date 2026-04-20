// context/InventoryContext.tsx  ✅ PRODUCTION READY (Firestore realtime + sin localStorage)
// - Realtime con onSnapshot (productos + empleados)
// - Alertas + stats derivados y siempre consistentes
// - Filtros + helpers + export CSV
// - Sin dependencias circulares con hooks/contexts

'use client';

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
} from 'react';

import { db } from '@/lib/firebase/config.client';

import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  Unsubscribe,
} from 'firebase/firestore';

import type {
  Product,
  BarraProduct,
  BolsaProduct,
  IceType,
  ProductType,
  ProductStatus,
} from '@/lib/utils/types/product.types';

import type { Empleado } from '@/lib/utils/types/user.types';

/* ============================================================
   ⚠️ AJUSTA ESTO a tus colecciones reales
   ============================================================ */
const COLLECTIONS = {
  PRODUCTOS: 'productos', // <-- cambia si tu colección se llama distinto
  EMPLEADOS: 'empleados', // <-- cambia si tu colección se llama distinto
};

/* ============================================================
   TIPOS PARA EL CONTEXTO
   ============================================================ */

interface StockAlerta {
  codigo: string;
  nombre: string;
  tipoProducto: ProductType;
  stockActual: number;
  stockMinimo: number;
  stockMaximo: number;
  estado: 'NORMAL' | 'BAJO' | 'CRITICO' | 'EXCESO';
  prioridad: number;
  tipoHielo?: IceType;
  cuartosDisponibles?: number;
  cuartosTotales?: number;

  // compat/alias
  productoNombre?: string;
  tipoProductoNombre?: ProductType;
}

interface StockPorTipoHielo {
  stockTotal: number;
  stockAsignado: number;
  stockDisponible: number;
  stockMinimo: number;
  stockMaximo: number;
  porcentajeUso: number;
  necesitaReposicion: boolean;
  ultimaActualizacion: Date;
}

interface InventoryState {
  productos: Product[];
  usuarios: Empleado[];
  alertas: StockAlerta[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refrescando: boolean;

  filtros: {
    tipoProducto?: ProductType;
    estadoProducto?: ProductStatus;
    tipoHielo?: IceType;
    empleadoCodigo?: string;
    mostrarSoloAlertas: boolean;
  };

  stats: {
    // Barras
    totalBarras: number;
    totalBarrasCuartos: number;
    cuartosDisponibles: number;
    cuartosUsados: number;

    // Bolsas
    totalBolsasVacias: number;
    totalBolsasAsignadas: number;
    totalBolsasLlenas: number;
    bolsasPorEmpleado: Record<string, number>;

    // Alertas
    alertasCriticas: number;
    alertasBajas: number;
    alertasStock: number;

    // Stock por tipo de hielo
    stockPorTipoHielo: Record<IceType, StockPorTipoHielo>;

    // Stock para barras
    stockBarras: {
      totalBarras: number;
      cuartosTotales: number;
      cuartosDisponibles: number;
      cuartosUsados: number;
      stockMinimo: number;
      stockMaximo: number;
    };

    // Totales globales (equivalentes)
    stockTotalGlobal: number;
    stockMinimoGlobal: number;
    stockMaximoGlobal: number;
    porcentajeUsoGlobal: number;
  };
}

type InventoryAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_REFRESCANDO'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_PRODUCTOS'; payload: Product[] }
  | { type: 'SET_USUARIOS'; payload: Empleado[] }
  | { type: 'SET_ALERTAS'; payload: StockAlerta[] }
  | { type: 'SET_FILTRO_TIPO_PRODUCTO'; payload: ProductType | undefined }
  | { type: 'SET_FILTRO_ESTADO'; payload: ProductStatus | undefined }
  | { type: 'SET_FILTRO_TIPO_HIELO'; payload: IceType | undefined }
  | { type: 'SET_FILTRO_EMPLEADO'; payload: string | undefined }
  | { type: 'TOGGLE_SOLO_ALERTAS' }
  | { type: 'RESET_FILTROS' }
  | { type: 'CLEAR_ERROR' };

interface InventoryContextType extends InventoryState {
  refreshProductos: () => Promise<void>;
  refreshUsuarios: () => Promise<void>;
  refreshAlertas: () => Promise<void>;
  refreshAll: () => Promise<void>;

  setFiltroTipoProducto: (tipo?: ProductType) => void;
  setFiltroEstado: (estado?: ProductStatus) => void;
  setFiltroTipoHielo: (tipoHielo?: IceType) => void;
  setFiltroEmpleado: (empleadoCodigo?: string) => void;
  toggleSoloAlertas: () => void;
  resetFiltros: () => void;

  getProductosFiltrados: () => Product[];
  getProductosByTipo: (tipo: ProductType) => Product[];
  getProductosByStatus: (status: ProductStatus) => Product[];
  getProductosByEmpleado: (empleadoCodigo: string) => Product[];
  getBolsasAsignadasPorEmpleado: (empleadoCodigo: string) => Product[];
  getBarrasConCuartosDisponibles: () => Product[];

  getStockPorTipoHielo: () => Record<IceType, StockPorTipoHielo>;
  getProductosBajoStock: () => Product[];
  getAlertasStock: () => StockAlerta[];

  getEmpleadoByCodigo: (empleadoCodigo: string) => Empleado | undefined;
  getProductoByCodigo: (codigo: string) => Product | undefined;

  puedeAsignarBolsa: (bolsaCodigo: string) => { puede: boolean; razon?: string };
  puedeLlenarBolsa: (
    bolsaCodigo: string,
    tipoHielo: IceType
  ) => { puede: boolean; razon?: string };
  hayStockSuficienteBarra: (barraCodigo: string, cuartosNecesarios: number) => boolean;

  clearError: () => void;

  exportarInventarioCSV: () => string;
  exportarStockPorHieloCSV: () => string;

  debugStats: () => void;
}

/* ============================================================
   Helpers
   ============================================================ */

const esBarra = (producto: Product | any): producto is BarraProduct => producto?.tipo === 'BARRA';
const esBolsa = (producto: Product | any): producto is BolsaProduct => producto?.tipo === 'BOLSA';

const toDateSafe = (v: any): Date | undefined => {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  // si viene como string/number, intentamos parsear
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const calcularEstadoStock = (
  cantidad: number,
  stockMinimo?: number,
  stockMaximo?: number
): 'NORMAL' | 'BAJO' | 'CRITICO' | 'EXCESO' => {
  const min = stockMinimo ?? 10;
  const max = stockMaximo ?? 50;

  if (cantidad <= 0) return 'CRITICO';
  if (cantidad <= min * 0.3) return 'CRITICO';
  if (cantidad <= min) return 'BAJO';
  if (stockMaximo != null && cantidad >= max * 1.5) return 'EXCESO';
  return 'NORMAL';
};

const puedeContenerHielo = (bolsa: BolsaProduct, tipoHielo: IceType): boolean => {
  return bolsa.tiposHieloPermitidos?.includes(tipoHielo) || false;
};

const getTipoHieloFromBolsa = (bolsa: BolsaProduct): IceType | undefined => bolsa.tipoHieloContenido;

const calcularStockPorTipoHielo = (productos: Product[]): Record<IceType, StockPorTipoHielo> => {
  const tiposHielo: IceType[] = ['ROLITO', 'FRAPPE', 'GOURMET', 'ENFRIAR', 'BARRA'];

  const base = tiposHielo.reduce((acc, tipo) => {
    acc[tipo] = {
      stockTotal: 0,
      stockAsignado: 0,
      stockDisponible: 0,
      stockMinimo: 0,
      stockMaximo: 0,
      porcentajeUso: 0,
      necesitaReposicion: false,
      ultimaActualizacion: new Date(),
    };
    return acc;
  }, {} as Record<IceType, StockPorTipoHielo>);

  productos.forEach((p) => {
    if (esBarra(p)) {
      const tipo: IceType = 'BARRA';
      const barrasStockCuartos = (p.cantidad || 0) * 4;

      base[tipo].stockTotal += barrasStockCuartos;
      base[tipo].stockDisponible += (p.cuartosDisponibles || 0);
      base[tipo].stockAsignado += (p.cuartosUsados || 0);
      base[tipo].stockMinimo += (p.stockMinimo || 0) * 4;
      base[tipo].stockMaximo += (p.stockMaximo || 0) * 4;
      return;
    }

    if (esBolsa(p)) {
      if (p.status === 'ASIGNADA') {
        // bolsas asignadas cuentan como "asignado" para los tipos permitidos
        p.tiposHieloPermitidos?.forEach((tipo) => {
          base[tipo].stockAsignado += p.cantidad || 1;
          base[tipo].stockMinimo += p.stockMinimo || 0;
          base[tipo].stockMaximo += p.stockMaximo || 0;
        });
        return;
      }

      if (p.status === 'LLENA' && p.tipoHieloContenido) {
        const tipo = p.tipoHieloContenido;
        base[tipo].stockTotal += p.cantidad || 1;
        base[tipo].stockDisponible += p.cantidad || 1;
        base[tipo].stockMinimo += p.stockMinimo || 0;
        base[tipo].stockMaximo += p.stockMaximo || 0;
      }
    }
  });

  tiposHielo.forEach((tipo) => {
    const s = base[tipo];

    if (tipo === 'BARRA') {
      if (s.stockTotal > 0) {
        s.porcentajeUso = Math.min(((s.stockTotal - s.stockDisponible) / s.stockTotal) * 100, 100);
      } else {
        s.porcentajeUso = 0;
      }
      s.necesitaReposicion = s.stockDisponible < (s.stockMinimo || 10);
      return;
    }

    if (s.stockMaximo > 0) {
      s.porcentajeUso = Math.min((s.stockDisponible / s.stockMaximo) * 100, 100);
    } else {
      s.porcentajeUso = 0;
    }
    s.necesitaReposicion = s.stockDisponible < s.stockMinimo;
  });

  return base;
};

const crearAlertaParaProducto = (producto: Product): StockAlerta => {
  let tipoHielo: IceType | undefined;
  let cuartosDisponibles: number | undefined;
  let cuartosTotales: number | undefined;

  if (esBarra(producto)) {
    tipoHielo = 'BARRA';
    cuartosDisponibles = producto.cuartosDisponibles;
    cuartosTotales = producto.cuartosTotales;
  } else if (esBolsa(producto)) {
    tipoHielo = producto.tipoHieloContenido;
  }

  const estado = calcularEstadoStock(
    producto.cantidad || 0,
    producto.stockMinimo ?? 0,
    producto.stockMaximo ?? 100
  );

  let prioridad = 3;
  if (estado === 'CRITICO') prioridad = 1;
  else if (estado === 'BAJO') prioridad = 2;
  else if (estado === 'EXCESO') prioridad = 4;

  return {
    codigo: producto.codigo,
    nombre: producto.nombre,
    productoNombre: producto.nombre,

    tipoProducto: producto.tipo,
    stockActual: producto.cantidad || 0,
    stockMinimo: producto.stockMinimo ?? 0,
    stockMaximo: producto.stockMaximo ?? 100,
    estado,
    prioridad,

    tipoHielo,
    cuartosDisponibles,
    cuartosTotales,
  };
};

const computeStats = (productos: Product[], alertas: StockAlerta[]) => {
  const barras = productos.filter(esBarra);
  const bolsas = productos.filter(esBolsa);

  const bolsasVacias = bolsas.filter((p) => p.status === 'VACIA');
  const bolsasAsignadas = bolsas.filter((p) => p.status === 'ASIGNADA');
  const bolsasLlenas = bolsas.filter((p) => p.status === 'LLENA');

  const totalBarras = barras.length;
  const totalBarrasCuartos = barras.reduce((sum, p) => sum + (p.cuartosTotales || 0), 0);
  const cuartosUsados = barras.reduce((sum, p) => sum + (p.cuartosUsados || 0), 0);
  const cuartosDisponibles = barras.reduce((sum, p) => sum + (p.cuartosDisponibles || 0), 0);

  const totalBolsasVacias = bolsasVacias.length;
  const totalBolsasAsignadas = bolsasAsignadas.length;
  const totalBolsasLlenas = bolsasLlenas.length;

  const bolsasPorEmpleado: Record<string, number> = {};
  bolsasAsignadas.forEach((bolsa) => {
    if (bolsa.asignadaA) {
      bolsasPorEmpleado[bolsa.asignadaA] =
        (bolsasPorEmpleado[bolsa.asignadaA] || 0) + (bolsa.cantidad || 1);
    }
  });

  const alertasCriticas = alertas.filter((a) => a.estado === 'CRITICO').length;
  const alertasBajas = alertas.filter((a) => a.estado === 'BAJO').length;
  const alertasStock = alertas.length;

  const stockPorTipoHielo = calcularStockPorTipoHielo(productos);

  const stockMinimoBarras = barras.reduce((sum, p) => sum + (p.stockMinimo || 0), 0);
  const stockMaximoBarras = barras.reduce((sum, p) => sum + (p.stockMaximo || 0), 0);

  const stockBarras = {
    totalBarras,
    cuartosTotales: totalBarrasCuartos,
    cuartosDisponibles,
    cuartosUsados,
    stockMinimo: stockMinimoBarras,
    stockMaximo: stockMaximoBarras,
  };

  const stockTotalHieloBolsas = (['ROLITO', 'FRAPPE', 'GOURMET', 'ENFRIAR'] as IceType[]).reduce(
    (sum, tipo) => sum + stockPorTipoHielo[tipo].stockDisponible,
    0
  );

  const stockTotalBarrasEquivalente = stockPorTipoHielo['BARRA'].stockDisponible / 4;
  const stockTotalGlobal = stockTotalHieloBolsas + stockTotalBarrasEquivalente;

  const stockMinimoGlobal =
    Object.values(stockPorTipoHielo).reduce((sum, s) => sum + s.stockMinimo, 0) / 4;
  const stockMaximoGlobal =
    Object.values(stockPorTipoHielo).reduce((sum, s) => sum + s.stockMaximo, 0) / 4;

  const porcentajeUsoGlobal =
    stockMaximoGlobal > 0 ? Math.min((stockTotalGlobal / stockMaximoGlobal) * 100, 100) : 0;

  return {
    totalBarras,
    totalBarrasCuartos,
    cuartosDisponibles,
    cuartosUsados,

    totalBolsasVacias,
    totalBolsasAsignadas,
    totalBolsasLlenas,
    bolsasPorEmpleado,

    alertasCriticas,
    alertasBajas,
    alertasStock,

    stockPorTipoHielo,
    stockBarras,

    stockTotalGlobal: Math.round(stockTotalGlobal * 100) / 100,
    stockMinimoGlobal: Math.round(stockMinimoGlobal * 100) / 100,
    stockMaximoGlobal: Math.round(stockMaximoGlobal * 100) / 100,
    porcentajeUsoGlobal: Math.round(porcentajeUsoGlobal * 100) / 100,
  };
};

/* ============================================================
   Estado inicial
   ============================================================ */

const emptyStockPorTipoHielo: Record<IceType, StockPorTipoHielo> = {
  ROLITO: {
    stockTotal: 0,
    stockAsignado: 0,
    stockDisponible: 0,
    stockMinimo: 0,
    stockMaximo: 0,
    porcentajeUso: 0,
    necesitaReposicion: false,
    ultimaActualizacion: new Date(),
  },
  FRAPPE: {
    stockTotal: 0,
    stockAsignado: 0,
    stockDisponible: 0,
    stockMinimo: 0,
    stockMaximo: 0,
    porcentajeUso: 0,
    necesitaReposicion: false,
    ultimaActualizacion: new Date(),
  },
  GOURMET: {
    stockTotal: 0,
    stockAsignado: 0,
    stockDisponible: 0,
    stockMinimo: 0,
    stockMaximo: 0,
    porcentajeUso: 0,
    necesitaReposicion: false,
    ultimaActualizacion: new Date(),
  },
  ENFRIAR: {
    stockTotal: 0,
    stockAsignado: 0,
    stockDisponible: 0,
    stockMinimo: 0,
    stockMaximo: 0,
    porcentajeUso: 0,
    necesitaReposicion: false,
    ultimaActualizacion: new Date(),
  },
  BARRA: {
    stockTotal: 0,
    stockAsignado: 0,
    stockDisponible: 0,
    stockMinimo: 0,
    stockMaximo: 0,
    porcentajeUso: 0,
    necesitaReposicion: false,
    ultimaActualizacion: new Date(),
  },
};

const initialState: InventoryState = {
  productos: [],
  usuarios: [],
  alertas: [],
  loading: true,
  error: null,
  lastUpdated: null,
  refrescando: false,

  filtros: {
    mostrarSoloAlertas: false,
  },

  stats: {
    totalBarras: 0,
    totalBarrasCuartos: 0,
    cuartosDisponibles: 0,
    cuartosUsados: 0,

    totalBolsasVacias: 0,
    totalBolsasAsignadas: 0,
    totalBolsasLlenas: 0,
    bolsasPorEmpleado: {},

    alertasCriticas: 0,
    alertasBajas: 0,
    alertasStock: 0,

    stockPorTipoHielo: emptyStockPorTipoHielo,

    stockBarras: {
      totalBarras: 0,
      cuartosTotales: 0,
      cuartosDisponibles: 0,
      cuartosUsados: 0,
      stockMinimo: 0,
      stockMaximo: 0,
    },

    stockTotalGlobal: 0,
    stockMinimoGlobal: 0,
    stockMaximoGlobal: 0,
    porcentajeUsoGlobal: 0,
  },
};

/* ============================================================
   Reducer (stats derivado automáticamente)
   ============================================================ */

function inventoryReducer(state: InventoryState, action: InventoryAction): InventoryState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_REFRESCANDO':
      return { ...state, refrescando: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload };

    case 'SET_PRODUCTOS': {
      const productos = action.payload || [];
      // recalcula alertas desde productos
      const alertasGeneradas = productos
        .map(crearAlertaParaProducto)
        .filter((a) => a.estado !== 'NORMAL')
        .sort((a, b) => a.prioridad - b.prioridad);

      const stats = computeStats(productos, alertasGeneradas);

      return {
        ...state,
        productos,
        alertas: alertasGeneradas,
        stats,
        lastUpdated: new Date(),
      };
    }

    case 'SET_USUARIOS':
      return { ...state, usuarios: action.payload || [], lastUpdated: new Date() };

    case 'SET_ALERTAS': {
      const alertas = action.payload || [];
      const stats = computeStats(state.productos, alertas);
      return { ...state, alertas, stats, lastUpdated: new Date() };
    }

    case 'SET_FILTRO_TIPO_PRODUCTO':
      return { ...state, filtros: { ...state.filtros, tipoProducto: action.payload } };

    case 'SET_FILTRO_ESTADO':
      return { ...state, filtros: { ...state.filtros, estadoProducto: action.payload } };

    case 'SET_FILTRO_TIPO_HIELO':
      return { ...state, filtros: { ...state.filtros, tipoHielo: action.payload } };

    case 'SET_FILTRO_EMPLEADO':
      return { ...state, filtros: { ...state.filtros, empleadoCodigo: action.payload } };

    case 'TOGGLE_SOLO_ALERTAS':
      return {
        ...state,
        filtros: {
          ...state.filtros,
          mostrarSoloAlertas: !state.filtros.mostrarSoloAlertas,
        },
      };

    case 'RESET_FILTROS':
      return { ...state, filtros: { mostrarSoloAlertas: false } };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    default:
      return state;
  }
}

/* ============================================================
   Context + Provider
   ============================================================ */

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

export function InventoryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(inventoryReducer, initialState);

  // ---- suscripciones realtime (productos + empleados)
  useEffect(() => {
    let unsubProductos: Unsubscribe | null = null;
    let unsubEmpleados: Unsubscribe | null = null;

    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      // Productos
      const qProductos = query(collection(db, COLLECTIONS.PRODUCTOS), orderBy('updatedAt', 'desc'));
      unsubProductos = onSnapshot(
        qProductos,
        (snap) => {
          const productos = snap.docs.map((d) => {
            const data: any = d.data();
            // Garantiza campos de fechas si existen
            return {
              ...data,
              id: data.id ?? d.id,
              docId: data.docId ?? d.id,
              ultimaModificacion: toDateSafe(data.ultimaModificacion) ?? toDateSafe(data.updatedAt),
              createdAt: toDateSafe(data.createdAt),
              updatedAt: toDateSafe(data.updatedAt),
            } as Product;
          });

          dispatch({ type: 'SET_PRODUCTOS', payload: productos });
          dispatch({ type: 'SET_LOADING', payload: false });
        },
        (err) => {
          console.error('❌ onSnapshot productos:', err);
          dispatch({
            type: 'SET_ERROR',
            payload: err?.message || 'Error cargando productos (realtime)',
          });
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      );

      // Empleados
      const qEmpleados = query(collection(db, COLLECTIONS.EMPLEADOS), orderBy('codigo', 'asc'));
      unsubEmpleados = onSnapshot(
        qEmpleados,
        (snap) => {
          const empleados = snap.docs.map((d) => ({ ...d.data(), id: d.id } as any)) as Empleado[];
          dispatch({ type: 'SET_USUARIOS', payload: empleados });
        },
        (err) => {
          console.error('❌ onSnapshot empleados:', err);
          dispatch({
            type: 'SET_ERROR',
            payload: err?.message || 'Error cargando empleados (realtime)',
          });
        }
      );
    } catch (e: any) {
      console.error('❌ Error montando suscripciones:', e);
      dispatch({ type: 'SET_ERROR', payload: e?.message || 'Error inicializando inventario' });
      dispatch({ type: 'SET_LOADING', payload: false });
    }

    return () => {
      try {
        unsubProductos?.();
        unsubEmpleados?.();
      } catch {}
    };
  }, []);

  // ---- refresh “manual” (en realtime no es necesario, pero lo dejas para botones)
  const refreshProductos = useCallback(async () => {
    // en realtime ya se actualiza solo; esto solo fuerza UI "refrescando" por UX
    dispatch({ type: 'SET_REFRESCANDO', payload: true });
    setTimeout(() => dispatch({ type: 'SET_REFRESCANDO', payload: false }), 400);
  }, []);

  const refreshUsuarios = useCallback(async () => {
    dispatch({ type: 'SET_REFRESCANDO', payload: true });
    setTimeout(() => dispatch({ type: 'SET_REFRESCANDO', payload: false }), 400);
  }, []);

  const refreshAlertas = useCallback(async () => {
    // alertas se derivan de productos; refrescamos “visual”
    dispatch({ type: 'SET_REFRESCANDO', payload: true });
    setTimeout(() => dispatch({ type: 'SET_REFRESCANDO', payload: false }), 300);
  }, []);

  const refreshAll = useCallback(async () => {
    dispatch({ type: 'SET_REFRESCANDO', payload: true });
    setTimeout(() => dispatch({ type: 'SET_REFRESCANDO', payload: false }), 500);
  }, []);

  // ---- filtros
  const setFiltroTipoProducto = useCallback((tipo?: ProductType) => {
    dispatch({ type: 'SET_FILTRO_TIPO_PRODUCTO', payload: tipo });
  }, []);

  const setFiltroEstado = useCallback((estado?: ProductStatus) => {
    dispatch({ type: 'SET_FILTRO_ESTADO', payload: estado });
  }, []);

  const setFiltroTipoHielo = useCallback((tipoHielo?: IceType) => {
    dispatch({ type: 'SET_FILTRO_TIPO_HIELO', payload: tipoHielo });
  }, []);

  const setFiltroEmpleado = useCallback((empleadoCodigo?: string) => {
    dispatch({ type: 'SET_FILTRO_EMPLEADO', payload: empleadoCodigo });
  }, []);

  const toggleSoloAlertas = useCallback(() => {
    dispatch({ type: 'TOGGLE_SOLO_ALERTAS' });
  }, []);

  const resetFiltros = useCallback(() => {
    dispatch({ type: 'RESET_FILTROS' });
  }, []);

  // ---- consultas
  const getProductosFiltrados = useCallback((): Product[] => {
    let filtrados = [...state.productos];

    if (state.filtros.tipoProducto) {
      filtrados = filtrados.filter((p) => p.tipo === state.filtros.tipoProducto);
    }

    if (state.filtros.estadoProducto) {
      filtrados = filtrados.filter((p) => p.status === state.filtros.estadoProducto);
    }

    if (state.filtros.tipoHielo) {
      filtrados = filtrados.filter((p) => {
        if (esBarra(p)) return state.filtros.tipoHielo === 'BARRA';
        if (esBolsa(p)) return getTipoHieloFromBolsa(p) === state.filtros.tipoHielo;
        return false;
      });
    }

    if (state.filtros.empleadoCodigo) {
      filtrados = filtrados.filter((p) => esBolsa(p) && p.asignadaA === state.filtros.empleadoCodigo);
    }

    if (state.filtros.mostrarSoloAlertas) {
      const set = new Set(state.alertas.map((a) => a.codigo));
      filtrados = filtrados.filter((p) => set.has(p.codigo));
    }

    return filtrados;
  }, [state.productos, state.filtros, state.alertas]);

  const getProductosByTipo = useCallback(
    (tipo: ProductType) => state.productos.filter((p) => p.tipo === tipo),
    [state.productos]
  );

  const getProductosByStatus = useCallback(
    (status: ProductStatus) => state.productos.filter((p) => p.status === status),
    [state.productos]
  );

  const getProductosByEmpleado = useCallback(
    (empleadoCodigo: string) =>
      state.productos.filter((p) => esBolsa(p) && p.asignadaA === empleadoCodigo),
    [state.productos]
  );

  const getBolsasAsignadasPorEmpleado = useCallback(
    (empleadoCodigo: string) =>
      state.productos.filter((p) => esBolsa(p) && p.status === 'ASIGNADA' && p.asignadaA === empleadoCodigo),
    [state.productos]
  );

  const getBarrasConCuartosDisponibles = useCallback(
    () => state.productos.filter((p) => esBarra(p) && (p.cuartosDisponibles || 0) > 0),
    [state.productos]
  );

  // ---- análisis
  const getStockPorTipoHielo = useCallback(
    () => calcularStockPorTipoHielo(state.productos),
    [state.productos]
  );

  const getProductosBajoStock = useCallback(() => {
    return state.productos.filter((p) => {
      const estado = calcularEstadoStock(p.cantidad || 0, p.stockMinimo ?? 0, p.stockMaximo ?? 100);
      return estado === 'BAJO' || estado === 'CRITICO';
    });
  }, [state.productos]);

  const getAlertasStock = useCallback(() => state.alertas, [state.alertas]);

  // ---- util
  const getEmpleadoByCodigo = useCallback(
    (empleadoCodigo: string) => state.usuarios.find((u) => u.codigo === empleadoCodigo),
    [state.usuarios]
  );

  const getProductoByCodigo = useCallback(
    (codigo: string) => state.productos.find((p) => p.codigo === codigo),
    [state.productos]
  );

  // ---- validaciones
  const puedeAsignarBolsa = useCallback(
    (bolsaCodigo: string) => {
      const producto = getProductoByCodigo(bolsaCodigo);
      if (!producto || !esBolsa(producto)) return { puede: false, razon: 'Bolsa no encontrada' };
      if (producto.status !== 'VACIA') return { puede: false, razon: `La bolsa está ${producto.status}` };
      if ((producto.cantidad || 0) <= 0) return { puede: false, razon: 'No hay stock disponible' };
      return { puede: true };
    },
    [getProductoByCodigo]
  );

  const puedeLlenarBolsa = useCallback(
    (bolsaCodigo: string, tipoHielo: IceType) => {
      const producto = getProductoByCodigo(bolsaCodigo);
      if (!producto || !esBolsa(producto)) return { puede: false, razon: 'Bolsa no encontrada' };
      if (producto.status !== 'ASIGNADA') return { puede: false, razon: 'La bolsa no está asignada' };
      if (!puedeContenerHielo(producto, tipoHielo))
        return { puede: false, razon: `Esta bolsa no puede contener ${tipoHielo}` };
      return { puede: true };
    },
    [getProductoByCodigo]
  );

  const hayStockSuficienteBarra = useCallback(
    (barraCodigo: string, cuartosNecesarios: number) => {
      const producto = getProductoByCodigo(barraCodigo);
      if (!producto || !esBarra(producto)) return false;
      return (producto.cuartosDisponibles || 0) >= cuartosNecesarios;
    },
    [getProductoByCodigo]
  );

  // ---- export
  const exportarInventarioCSV = useCallback(() => {
    const headers = [
      'Código',
      'Nombre',
      'Tipo',
      'Estado',
      'Cantidad',
      'Stock Mínimo',
      'Stock Máximo',
      'Empleado Asignado',
      'Última Modificación',
    ];

    const filas = state.productos.map((p) => {
      const empleado = esBolsa(p) ? (p.asignadaA || '') : '';
      const ultima = (toDateSafe((p as any).ultimaModificacion) || toDateSafe((p as any).updatedAt))?.toLocaleString('es-MX') || '';
      return [
        p.codigo,
        p.nombre,
        p.tipo,
        p.status,
        String(p.cantidad || 0),
        String(p.stockMinimo || 0),
        String(p.stockMaximo || 0),
        empleado,
        ultima,
      ];
    });

    return [headers, ...filas].map((fila) => fila.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
  }, [state.productos]);

  const exportarStockPorHieloCSV = useCallback(() => {
    const headers = [
      'Tipo de Hielo',
      'Stock Total',
      'Stock Asignado',
      'Stock Disponible',
      'Stock Mínimo',
      'Stock Máximo',
      'Porcentaje Uso',
      'Necesita Reposición',
    ];

    const filas = Object.entries(state.stats.stockPorTipoHielo).map(([tipo, s]) => [
      tipo,
      String(s.stockTotal),
      String(s.stockAsignado),
      String(s.stockDisponible),
      String(s.stockMinimo),
      String(s.stockMaximo),
      `${(s.porcentajeUso ?? 0).toFixed(1)}%`,
      s.necesitaReposicion ? 'SÍ' : 'NO',
    ]);

    return [headers, ...filas].map((fila) => fila.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
  }, [state.stats.stockPorTipoHielo]);

  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);

  const debugStats = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('📊 INVENTORY DEBUG:', {
      productos: state.productos.length,
      empleados: state.usuarios.length,
      alertas: state.alertas.length,
      stats: state.stats,
      filtros: state.filtros,
    });
  }, [state]);

  const contextValue: InventoryContextType = useMemo(
    () => ({
      ...state,

      refreshProductos,
      refreshUsuarios,
      refreshAlertas,
      refreshAll,

      setFiltroTipoProducto,
      setFiltroEstado,
      setFiltroTipoHielo,
      setFiltroEmpleado,
      toggleSoloAlertas,
      resetFiltros,

      getProductosFiltrados,
      getProductosByTipo,
      getProductosByStatus,
      getProductosByEmpleado,
      getBolsasAsignadasPorEmpleado,
      getBarrasConCuartosDisponibles,

      getStockPorTipoHielo,
      getProductosBajoStock,
      getAlertasStock,

      getEmpleadoByCodigo,
      getProductoByCodigo,

      puedeAsignarBolsa,
      puedeLlenarBolsa,
      hayStockSuficienteBarra,

      clearError,

      exportarInventarioCSV,
      exportarStockPorHieloCSV,

      debugStats,
    }),
    [
      state,

      refreshProductos,
      refreshUsuarios,
      refreshAlertas,
      refreshAll,

      setFiltroTipoProducto,
      setFiltroEstado,
      setFiltroTipoHielo,
      setFiltroEmpleado,
      toggleSoloAlertas,
      resetFiltros,

      getProductosFiltrados,
      getProductosByTipo,
      getProductosByStatus,
      getProductosByEmpleado,
      getBolsasAsignadasPorEmpleado,
      getBarrasConCuartosDisponibles,

      getStockPorTipoHielo,
      getProductosBajoStock,
      getAlertasStock,

      getEmpleadoByCodigo,
      getProductoByCodigo,

      puedeAsignarBolsa,
      puedeLlenarBolsa,
      hayStockSuficienteBarra,

      clearError,

      exportarInventarioCSV,
      exportarStockPorHieloCSV,

      debugStats,
    ]
  );

  return <InventoryContext.Provider value={contextValue}>{children}</InventoryContext.Provider>;
}

/* ============================================================
   Hook
   ============================================================ */

export function useInventoryContext() {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error('useInventoryContext debe usarse dentro de un InventoryProvider');
  return ctx;
}
