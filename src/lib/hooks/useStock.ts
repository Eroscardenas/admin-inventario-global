'use client';

// lib/hooks/useStock.ts
// =====================================================
// useStock - FINAL B
// - Compatible con tu StockService FINAL + stock.types.ts + product.types.ts
// - Global por hielo: resumen.stockPorTipoHielo (min/max global)
// - Barra por cuartosDisponibles
// - Evita carreras / unmount setState
// =====================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { IceType, ProductType } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO } from '@/lib/utils/types/product.types';

import type {
  StockAlerta,
  StockResumen,
  StockActualizacionResultado,
  StockEstado,
  TipoAlertaStock,
} from '@/lib/utils/types/stock.types';

import { StockService } from '@/lib/services/stock.service';

// =====================================================
// Tipos locales
// =====================================================

type Timeframe = 'realtime' | 'daily' | 'hourly' | 'manual';

type StockStats = {
  alertasCriticas: number;
  alertasBajas: number;
  totalProductos: number;
  porcentajeCritico: number;
  salud: 'CRÍTICA' | 'PRECAUCIÓN' | 'EXCELENTE';
};

type StockRapido = {
  totalProductos: number;
  totalUnidades: number;
  alertasCriticas: number;
  productosBajoStock: number;
  ultimaActualizacion: Date;
};

// =====================================================
// Helpers
// =====================================================

function pickIntervalMs(timeframe: Timeframe) {
  if (timeframe === 'realtime') return 30_000;
  if (timeframe === 'hourly') return 3_600_000;
  if (timeframe === 'daily') return 60_000;
  return 0;
}

function clampNum(n: any) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function estadoToPrioridad(estado: StockEstado) {
  if (estado === 'CRITICO') return 1;
  if (estado === 'BAJO') return 2;
  if (estado === 'EXCESO') return 3;
  return 99;
}

function buildGlobalAlertasFromResumen(resumen: StockResumen | null): StockAlerta[] {
  if (!resumen) return [];
  const now = new Date();

  return (TIPOS_HIELO as readonly IceType[]).map((tipoHielo) => {
    const item = resumen.stockPorTipoHielo?.[tipoHielo];

    const actual =
      tipoHielo === 'BARRA'
        ? clampNum(item?.cuartosDisponibles)
        : clampNum(item?.bolsasLlenasDisponibles);

    const min = clampNum(item?.stockMinimo);
    const max = clampNum(item?.stockMaximo);
    const estado = (item?.estado ?? 'NORMAL') as StockEstado;

    const mensaje =
      tipoHielo === 'BARRA'
        ? `Global BARRA (cuartos): ${actual} (min ${min}, max ${max})`
        : `Global ${tipoHielo}: ${actual} (min ${min}, max ${max})`;

    return {
      id: `GLOBAL__${tipoHielo}`,
      codigo: `GLOBAL__${tipoHielo}`,
      nombre: `Stock global ${tipoHielo}`,
      tipo: 'BOLSA', // dummy para UI
      estado,
      prioridad: estadoToPrioridad(estado),
      stockActual: actual,
      stockMinimo: min,
      stockMaximo: max,
      status: undefined,
      tipoHielo,
      cuartosDisponibles: tipoHielo === 'BARRA' ? actual : undefined,
      cuartosTotales: tipoHielo === 'BARRA' ? clampNum(item?.cuartosTotales) : undefined,
      mensaje,
      tipoAlerta: 'STOCK_POR_HIELO' as TipoAlertaStock,
      fecha: now,
    };
  });
}

// =====================================================
// Hook
// =====================================================

export function useStock(timeframe: Timeframe = 'daily') {
  const [alertasProducto, setAlertasProducto] = useState<StockAlerta[]>([]);
  const [resumen, setResumen] = useState<StockResumen | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultimaVerificacion, setUltimaVerificacion] = useState<Date | null>(null);

  const aliveRef = useRef(true);
  const inflightRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // =========================================
  // CARGA PRINCIPAL
  // =========================================
  const reload = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;

    setLoading(true);
    setError(null);

    try {
      const [resumenData, alertasData] = await Promise.all([
        StockService.obtenerResumenStock(),
        StockService.obtenerAlertasStock(),
      ]);

      if (!aliveRef.current) return;

      setResumen(resumenData);
      setAlertasProducto(Array.isArray(alertasData) ? alertasData : []);
      setUltimaVerificacion(new Date());
    } catch (e: any) {
      if (!aliveRef.current) return;
      setError(e?.message ?? 'Error al cargar stock');
    } finally {
      inflightRef.current = false;
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();

    const ms = pickIntervalMs(timeframe);
    if (!ms) return;

    const id = setInterval(() => {
      if (!inflightRef.current) reload();
    }, ms);

    return () => clearInterval(id);
  }, [reload, timeframe]);

  // =========================================
  // ACCIONES (las que existen en StockService FINAL)
  // =========================================
  const actualizarStock = useCallback(
    async (codigo: string, _tipo: ProductType, nuevaCantidad: number): Promise<StockActualizacionResultado> => {
      setLoading(true);
      setError(null);

      try {
        const res = await StockService.actualizarStockProducto(codigo, nuevaCantidad);
        await reload();
        return res;
      } catch (e: any) {
        setError(e?.message ?? 'Error al actualizar stock');
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [reload]
  );

  const incrementarStock = useCallback(
    async (codigo: string, tipo: ProductType, cantidad: number): Promise<StockActualizacionResultado> => {
      setLoading(true);
      setError(null);

      try {
        const res = await StockService.incrementarStock(codigo, cantidad, tipo);
        await reload();
        return res;
      } catch (e: any) {
        setError(e?.message ?? 'Error al incrementar stock');
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [reload]
  );

  const decrementarStock = useCallback(
    async (codigo: string, tipo: ProductType, cantidad: number): Promise<StockActualizacionResultado> => {
      setLoading(true);
      setError(null);

      try {
        const res = await StockService.decrementarStock(codigo, cantidad, tipo);
        await reload();
        return res;
      } catch (e: any) {
        setError(e?.message ?? 'Error al decrementar stock');
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [reload]
  );

  const verificarStockDisponible = useCallback(async (codigo: string, cantidadRequerida: number) => {
    return await StockService.verificarStockDisponible(codigo, cantidadRequerida);
  }, []);

  const obtenerProductosBajoStock = useCallback(async (): Promise<StockAlerta[]> => {
    try {
      const arr = await StockService.obtenerProductosBajoStock();
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.error('❌ Error obtenerProductosBajoStock:', e);
      return [];
    }
  }, []);

  const verificarStockMinimo = useCallback(async (): Promise<StockAlerta[]> => {
    const low = await obtenerProductosBajoStock();
    await reload();
    return low;
  }, [obtenerProductosBajoStock, reload]);

  const resetError = useCallback(() => setError(null), []);

  // =========================================
  // DERIVADOS
  // =========================================
  const alertasGlobalPorHielo = useMemo(() => buildGlobalAlertasFromResumen(resumen), [resumen]);

  const alertas = useMemo(() => {
    const merged = [...alertasGlobalPorHielo, ...alertasProducto];
    return merged.sort((a, b) => a.prioridad - b.prioridad || a.nombre.localeCompare(b.nombre));
  }, [alertasGlobalPorHielo, alertasProducto]);

  const tieneAlertasCriticas = useMemo(() => alertas.some((a) => a.estado === 'CRITICO'), [alertas]);
  const tieneAlertasBajas = useMemo(() => alertas.some((a) => a.estado === 'BAJO'), [alertas]);
  const totalAlertas = alertas.length;

  const metricas = useMemo(
    () => ({
      totalBarras: resumen?.totalBarras || 0,
      totalBolsasVacias: resumen?.totalBolsasVacias || 0,
      totalBolsasAsignadas: resumen?.totalBolsasAsignadas || 0,
      totalBolsasLlenas: resumen?.totalBolsasLlenas || 0,
      productosBajoStock: resumen?.productosBajoStock || 0,
      productosCriticos: resumen?.productosCriticos || 0,
      totalProductos: resumen?.totalProductos || 0,
    }),
    [resumen]
  );

  const obtenerAlertasCriticas = useCallback(() => alertas.filter((a) => a.estado === 'CRITICO'), [alertas]);
  const obtenerAlertasBajas = useCallback(() => alertas.filter((a) => a.estado === 'BAJO'), [alertas]);

  const filtrarAlertas = useCallback(
    (filtros: {
      estado?: StockEstado;
      tipoProducto?: ProductType;
      tipoHielo?: IceType;
      prioridad?: number;
      tipoAlerta?: TipoAlertaStock;
    }) => {
      return alertas.filter((a) => {
        if (filtros.estado && a.estado !== filtros.estado) return false;
        if (filtros.tipoProducto && a.tipo !== filtros.tipoProducto) return false;
        if (filtros.tipoHielo && a.tipoHielo !== filtros.tipoHielo) return false;
        if (filtros.prioridad && a.prioridad !== filtros.prioridad) return false;
        if (filtros.tipoAlerta && a.tipoAlerta !== filtros.tipoAlerta) return false;
        return true;
      });
    },
    [alertas]
  );

  const calcularEstadisticas = useCallback((): StockStats | null => {
    if (!resumen) return null;

    const crit = obtenerAlertasCriticas().length;
    const bajas = obtenerAlertasBajas().length;

    const totalProductos = resumen.totalProductos || 0;
    const porcentajeCritico = totalProductos > 0 ? (crit / totalProductos) * 100 : 0;

    return {
      alertasCriticas: crit,
      alertasBajas: bajas,
      totalProductos,
      porcentajeCritico: Math.round(porcentajeCritico * 100) / 100,
      salud: porcentajeCritico > 20 ? 'CRÍTICA' : porcentajeCritico > 10 ? 'PRECAUCIÓN' : 'EXCELENTE',
    };
  }, [resumen, obtenerAlertasCriticas, obtenerAlertasBajas]);

  const obtenerEstadisticasRapidas = useCallback(async (): Promise<StockRapido> => {
    if (!resumen) await reload();

    const r = resumen;
    if (r) {
      return {
        totalProductos: r.totalProductos,
        totalUnidades: (r.totalBarras || 0) + (r.totalBolsasLlenas || 0),
        alertasCriticas: r.productosCriticos,
        productosBajoStock: r.productosBajoStock,
        ultimaActualizacion: new Date(r.ultimaActualizacion as any),
      };
    }

    return {
      totalProductos: 0,
      totalUnidades: 0,
      alertasCriticas: 0,
      productosBajoStock: 0,
      ultimaActualizacion: new Date(),
    };
  }, [resumen, reload]);

  const actualizarStockGeneral = useCallback(async () => {
    await reload();
  }, [reload]);

  const debugInfo = useCallback(() => {
    console.log('=== DEBUG STOCK ===');
    console.log('alertasProducto:', alertasProducto.length);
    console.log('alertasGlobalPorHielo:', alertasGlobalPorHielo.length);
    console.log('alertasTotal:', alertas.length);
    console.log('resumen:', resumen ? 'OK' : 'null');
    console.log('ultimaVerificacion:', ultimaVerificacion);
    console.log('metricas:', metricas);
    console.log('====================');
  }, [alertasProducto.length, alertasGlobalPorHielo.length, alertas.length, resumen, ultimaVerificacion, metricas]);

  return {
    alertas,
    alertasProducto,
    alertasGlobalPorHielo,
    resumen,
    metricas,

    loading,
    error,
    ultimaVerificacion,

    reload,
    reloadAll: reload,
    reloadAlertas: reload,
    reloadResumen: reload,

    actualizarStock,
    incrementarStock,
    decrementarStock,
    verificarStockDisponible,

    obtenerProductosBajoStock,
    verificarStockMinimo,

    filtrarAlertas,
    obtenerAlertasCriticas,
    obtenerAlertasBajas,
    calcularEstadisticas,
    obtenerEstadisticasRapidas,
    actualizarStockGeneral,
    resetError,

    tieneAlertasCriticas,
    tieneAlertasBajas,
    totalAlertas,
    totalProductosEnStock: metricas.totalProductos,

    debugInfo,
  };
}
