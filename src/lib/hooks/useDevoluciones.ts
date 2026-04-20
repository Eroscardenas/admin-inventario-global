'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { DevolucionesService } from '@/lib/services/devoluciones.service';

import type {
  Devolucion,
  DevolucionRequest,
  ProcesarDevolucionRequest,
  DevolucionResultado,
  DevolucionStats,
  DevolucionEstado,
  MotivoDevolucion,
} from '@/lib/utils/types/devolucion.types';

import { MOTIVOS_DEVOLUCION } from '@/lib/utils/types/devolucion.types';
import { useAuthContext } from '@/context/AuthContext';

// ==============================
// Filters
// ==============================
interface DevolucionFilters {
  estado?: DevolucionEstado;
  devueltoPorCodigo?: string;
  productoCodigo?: string;
  tipoProducto?: 'BOLSA' | 'BARRA';
  fechaInicio?: Date;
  fechaFin?: Date;
  limit?: number;
}

// ==============================
// Helpers
// ==============================
const toDateSafe = (v: any): Date => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  return new Date(v);
};

const normalizeDevolucion = (raw: any): Devolucion => {
  const d = raw ?? {};
  return {
    ...d,
    createdAt: toDateSafe(d.createdAt),
    updatedAt: toDateSafe(d.updatedAt),
    fechaRecepcion: d.fechaRecepcion ? toDateSafe(d.fechaRecepcion) : undefined,
  } as Devolucion;
};

const normalizeArray = (list: any[]): Devolucion[] => (list ?? []).map(normalizeDevolucion);

const formatMotivoLabel = (m: string): string => {
  // bonito para UI sin depender de i18n
  return m
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
};

// Tip: tu types sólo trae strings, pero tu hook/UI esperaba {id,label,afectaStock}
const MOTIVOS_UI: Array<{ id: MotivoDevolucion; label: string; afectaStock: boolean }> =
  (MOTIVOS_DEVOLUCION as readonly MotivoDevolucion[]).map((id) => ({
    id,
    label: formatMotivoLabel(id),
    // default industrial: normalmente una devolución puede afectar stock si se acepta,
    // pero lo define el request.afectaStock. Aquí lo dejamos “true” para UX, no lógica.
    afectaStock: true,
  }));

// ==============================
// Hook
// ==============================
export const useDevoluciones = () => {
  const { productionSession, adminSession } = useAuthContext();

  // ------------------------------
  // Usuario actual
  // ------------------------------
  const getUsuarioActivo = useCallback(() => {
    if (productionSession) {
      return {
        id: (productionSession as any).id ?? (productionSession as any).codigo ?? `EMP-${Date.now()}`,
        nombre: (productionSession as any).nombre ?? 'Producción',
        email: (productionSession as any).email || 'produccion@hielo.com',
        rol: 'PRODUCCION' as const,
      };
    }
    if (adminSession) {
      return {
        id: (adminSession as any).id ?? (adminSession as any).codigo ?? `ADMIN-${Date.now()}`,
        nombre: (adminSession as any).nombre ?? 'Administrador',
        email: (adminSession as any).email || 'admin@hielo.com',
        rol: 'ADMIN' as const,
      };
    }
    return null;
  }, [productionSession, adminSession]);

  const usuario = getUsuarioActivo();

  // ------------------------------
  // Data state
  // ------------------------------
  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([]);
  const [devolucionesPendientes, setDevolucionesPendientes] = useState<Devolucion[]>([]);
  const [devolucionesAceptadas, setDevolucionesAceptadas] = useState<Devolucion[]>([]);
  const [devolucionesRechazadas, setDevolucionesRechazadas] = useState<Devolucion[]>([]);
  const [misDevoluciones, setMisDevoluciones] = useState<Devolucion[]>([]);
  const [stats, setStats] = useState<DevolucionStats | null>(null);

  // ------------------------------
  // Loading / error
  // ------------------------------
  const [loading, setLoading] = useState({
    all: false,
    pending: false,
    accepted: false,
    rejected: false,
    mine: false,
    stats: false,
    processing: false,
    registering: false,
    canceling: false,
  });

  const [error, setError] = useState<string | null>(null);

  const isLoading = useMemo(() => Object.values(loading).some(Boolean), [loading]);
  const isProcessing = loading.processing || loading.registering || loading.canceling;

  // ==============================
  // Cargas
  // ==============================

  const loadDevoluciones = useCallback(
    async (filters?: DevolucionFilters) => {
      if (!usuario || usuario.rol !== 'ADMIN') return;

      try {
        setLoading((p) => ({ ...p, all: true }));
        setError(null);

        const data = await DevolucionesService.obtenerDevoluciones(filters);
        setDevoluciones(normalizeArray(data));
      } catch (err: any) {
        setError(`Error al cargar devoluciones: ${err?.message ?? 'Error'}`);
      } finally {
        setLoading((p) => ({ ...p, all: false }));
      }
    },
    [usuario]
  );

  const loadDevolucionesPendientes = useCallback(async () => {
    try {
      setLoading((p) => ({ ...p, pending: true }));
      const data = await DevolucionesService.obtenerDevoluciones({ estado: 'PENDIENTE', limit: 50 });
      setDevolucionesPendientes(normalizeArray(data));
    } catch (err: any) {
      console.error('❌ Error loadDevolucionesPendientes:', err);
    } finally {
      setLoading((p) => ({ ...p, pending: false }));
    }
  }, []);

  const loadDevolucionesAceptadas = useCallback(async () => {
    try {
      setLoading((p) => ({ ...p, accepted: true }));
      const data = await DevolucionesService.obtenerDevoluciones({ estado: 'ACEPTADA', limit: 50 });
      setDevolucionesAceptadas(normalizeArray(data));
    } catch (err: any) {
      console.error('❌ Error loadDevolucionesAceptadas:', err);
    } finally {
      setLoading((p) => ({ ...p, accepted: false }));
    }
  }, []);

  const loadDevolucionesRechazadas = useCallback(async () => {
    try {
      setLoading((p) => ({ ...p, rejected: true }));
      const data = await DevolucionesService.obtenerDevoluciones({ estado: 'RECHAZADA', limit: 50 });
      setDevolucionesRechazadas(normalizeArray(data));
    } catch (err: any) {
      console.error('❌ Error loadDevolucionesRechazadas:', err);
    } finally {
      setLoading((p) => ({ ...p, rejected: false }));
    }
  }, []);

  const loadMisDevoluciones = useCallback(async () => {
    if (!usuario || usuario.rol !== 'PRODUCCION') return;

    try {
      setLoading((p) => ({ ...p, mine: true }));
      const data = await DevolucionesService.obtenerDevolucionesPendientesEmpleado(usuario.id);
      setMisDevoluciones(normalizeArray(data));
    } catch (err: any) {
      console.error('❌ Error loadMisDevoluciones:', err);
    } finally {
      setLoading((p) => ({ ...p, mine: false }));
    }
  }, [usuario]);

  const loadMisDevolucionesAceptadas = useCallback(async () => {
    if (!usuario || usuario.rol !== 'PRODUCCION') return [];
    try {
      const data = await DevolucionesService.obtenerDevolucionesAceptadasEmpleado(usuario.id);
      return normalizeArray(data);
    } catch (err: any) {
      console.error('❌ Error loadMisDevolucionesAceptadas:', err);
      return [];
    }
  }, [usuario]);

  const loadStats = useCallback(async (fechaInicio?: Date, fechaFin?: Date) => {
    try {
      setLoading((p) => ({ ...p, stats: true }));
      const s = await DevolucionesService.obtenerEstadisticasDevoluciones(fechaInicio, fechaFin);
      setStats({ ...s, ultimaActualizacion: toDateSafe((s as any).ultimaActualizacion) });
    } catch (err: any) {
      console.error('❌ Error loadStats:', err);
    } finally {
      setLoading((p) => ({ ...p, stats: false }));
    }
  }, []);

  // ==============================
  // Acciones
  // ==============================

  const registrarDevolucion = useCallback(
    async (request: DevolucionRequest): Promise<DevolucionResultado> => {
      if (!usuario || usuario.rol !== 'PRODUCCION') {
        throw new Error('Solo personal de producción puede registrar devoluciones');
      }

      try {
        setLoading((p) => ({ ...p, registering: true }));
        setError(null);

        const res = await DevolucionesService.registrarDevolucion(request, usuario.id, usuario.nombre);

        await Promise.all([loadMisDevoluciones(), loadDevolucionesPendientes(), loadStats()]);
        return res;
      } catch (err: any) {
        const msg = err?.message ?? 'Error al registrar devolución';
        setError(msg);
        throw err;
      } finally {
        setLoading((p) => ({ ...p, registering: false }));
      }
    },
    [usuario, loadMisDevoluciones, loadDevolucionesPendientes, loadStats]
  );

  const procesarDevolucion = useCallback(
    async (request: ProcesarDevolucionRequest): Promise<DevolucionResultado> => {
      if (!usuario || usuario.rol !== 'ADMIN') {
        throw new Error('Solo administradores pueden procesar devoluciones');
      }

      try {
        setLoading((p) => ({ ...p, processing: true }));
        setError(null);

        const res = await DevolucionesService.procesarDevolucion(request, usuario.nombre);

        await Promise.all([
          loadDevoluciones(),
          loadDevolucionesPendientes(),
          loadDevolucionesAceptadas(),
          loadDevolucionesRechazadas(),
          loadStats(),
        ]);

        return res;
      } catch (err: any) {
        const msg = err?.message ?? 'Error al procesar devolución';
        setError(msg);
        throw err;
      } finally {
        setLoading((p) => ({ ...p, processing: false }));
      }
    },
    [
      usuario,
      loadDevoluciones,
      loadDevolucionesPendientes,
      loadDevolucionesAceptadas,
      loadDevolucionesRechazadas,
      loadStats,
    ]
  );

  const cancelarDevolucion = useCallback(
    async (devolucionCodigo: string): Promise<{ exito: boolean; mensaje: string }> => {
      if (!usuario || usuario.rol !== 'PRODUCCION') {
        throw new Error('Solo personal de producción puede cancelar devoluciones');
      }

      try {
        setLoading((p) => ({ ...p, canceling: true }));
        setError(null);

        const res = await DevolucionesService.cancelarDevolucion(devolucionCodigo, usuario.id);

        await Promise.all([loadMisDevoluciones(), loadDevolucionesPendientes(), loadStats()]);
        return res;
      } catch (err: any) {
        const msg = err?.message ?? 'Error al cancelar devolución';
        setError(msg);
        throw err;
      } finally {
        setLoading((p) => ({ ...p, canceling: false }));
      }
    },
    [usuario, loadMisDevoluciones, loadDevolucionesPendientes, loadStats]
  );

  const validarProductoParaDevolucion = useCallback(
    async (productoCodigo: string, tipoProducto: 'BOLSA' | 'BARRA', cantidad: number) => {
      try {
        return await DevolucionesService.validarDevolucionProducto(productoCodigo, tipoProducto, cantidad);
      } catch (err: any) {
        console.error('❌ Error validarProductoParaDevolucion:', err);
        return { valido: false, mensaje: 'Error al validar producto', productoExiste: false };
      }
    },
    []
  );

  const obtenerDevolucionPorCodigo = useCallback(async (codigo: string) => {
    try {
      const d = await DevolucionesService.obtenerDevolucionPorCodigo(codigo);
      return d ? normalizeDevolucion(d) : null;
    } catch (err: any) {
      console.error('❌ Error obtenerDevolucionPorCodigo:', err);
      throw err;
    }
  }, []);

  // ==============================
  // Local updates
  // ==============================

  const actualizarDevolucionLocal = useCallback((devolucionActualizada: Devolucion) => {
    const u = normalizeDevolucion(devolucionActualizada);

    setDevoluciones((prev) => prev.map((d) => (d.codigo === u.codigo ? u : d)));
    setDevolucionesPendientes((prev) => prev.map((d) => (d.codigo === u.codigo ? u : d)));
    setDevolucionesAceptadas((prev) => prev.map((d) => (d.codigo === u.codigo ? u : d)));
    setDevolucionesRechazadas((prev) => prev.map((d) => (d.codigo === u.codigo ? u : d)));
    setMisDevoluciones((prev) => prev.map((d) => (d.codigo === u.codigo ? u : d)));
  }, []);

  const eliminarDevolucionLocal = useCallback((devolucionCodigo: string) => {
    setDevoluciones((prev) => prev.filter((d) => d.codigo !== devolucionCodigo));
    setDevolucionesPendientes((prev) => prev.filter((d) => d.codigo !== devolucionCodigo));
    setDevolucionesAceptadas((prev) => prev.filter((d) => d.codigo !== devolucionCodigo));
    setDevolucionesRechazadas((prev) => prev.filter((d) => d.codigo !== devolucionCodigo));
    setMisDevoluciones((prev) => prev.filter((d) => d.codigo !== devolucionCodigo));
  }, []);

  // ==============================
  // Helpers motivos (compat UI)
  // ==============================
  const MOTIVOS = MOTIVOS_UI;

  const getMotivoById = useCallback((id: string) => MOTIVOS.find((m) => m.id === id), [MOTIVOS]);

  const getMotivoLabel = useCallback(
    (id: string) => {
      const m = getMotivoById(id);
      return m ? m.label : 'Motivo desconocido';
    },
    [getMotivoById]
  );

  const getMotivoAfectaStock = useCallback(
    (id: string) => {
      const m = getMotivoById(id);
      return m ? m.afectaStock : false;
    },
    [getMotivoById]
  );

  // ==============================
  // LoadAll (según rol)
  // ==============================
  const loadAll = useCallback(async () => {
    if (!usuario) return;

    try {
      setError(null);

      if (usuario.rol === 'PRODUCCION') {
        await Promise.all([loadMisDevoluciones(), loadDevolucionesPendientes(), loadStats()]);
      } else if (usuario.rol === 'ADMIN') {
        await Promise.all([
          loadDevoluciones(),
          loadDevolucionesPendientes(),
          loadDevolucionesAceptadas(),
          loadDevolucionesRechazadas(),
          loadStats(),
        ]);
      }
    } catch (err: any) {
      setError(`Error al cargar devoluciones: ${err?.message ?? 'Error'}`);
    }
  }, [
    usuario,
    loadDevoluciones,
    loadMisDevoluciones,
    loadDevolucionesPendientes,
    loadDevolucionesAceptadas,
    loadDevolucionesRechazadas,
    loadStats,
  ]);

  useEffect(() => {
    if (usuario) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id]);

  const refresh = useCallback(() => {
    if (usuario) loadAll();
  }, [usuario, loadAll]);

  // ==============================
  // Summary + filtros personales
  // ==============================
  const summary = useMemo(() => {
    const fallbackStats: DevolucionStats = {
      totalDevoluciones: 0,
      devolucionesPendientes: 0,
      devolucionesAceptadas: 0,
      devolucionesRechazadas: 0,
      porMotivo: [],
      porTipoProducto: [],
      porTipoHielo: [],
      porEmpleado: [],
      tendenciaMensual: [],
      ultimaActualizacion: new Date(),
    };

    return {
      totalDevoluciones: devoluciones.length,
      totalMisDevoluciones: misDevoluciones.length,
      totalPendientes: devolucionesPendientes.length,
      totalAceptadas: devolucionesAceptadas.length,
      totalRechazadas: devolucionesRechazadas.length,
      stats: stats ?? fallbackStats,
    };
  }, [devoluciones, misDevoluciones, devolucionesPendientes, devolucionesAceptadas, devolucionesRechazadas, stats]);

  const misDevolucionesPendientes = useMemo(
    () => misDevoluciones.filter((d) => d.estado === 'PENDIENTE'),
    [misDevoluciones]
  );
  const misDevolucionesAceptadas = useMemo(
    () => misDevoluciones.filter((d) => d.estado === 'ACEPTADA'),
    [misDevoluciones]
  );
  const misDevolucionesRechazadas = useMemo(
    () => misDevoluciones.filter((d) => d.estado === 'RECHAZADA'),
    [misDevoluciones]
  );

  // ==============================
  // Permisos
  // ==============================
  const canRegister = usuario?.rol === 'PRODUCCION';
  const canProcess = usuario?.rol === 'ADMIN';
  const canViewAll = usuario?.rol === 'ADMIN';
  const canViewStats = usuario?.rol === 'ADMIN';

  const canUpdate = useCallback(
    (devolucion: Devolucion) => {
      if (!usuario) return false;
      return (
        usuario.rol === 'ADMIN' ||
        (usuario.rol === 'PRODUCCION' && devolucion.devueltoPorCodigo === usuario.id)
      );
    },
    [usuario]
  );

  const canCancel = useCallback(
    (devolucion: Devolucion) => {
      if (!usuario || usuario.rol !== 'PRODUCCION') return false;
      return devolucion.devueltoPorCodigo === usuario.id && devolucion.estado === 'PENDIENTE';
    },
    [usuario]
  );

  // ==============================
  // Consultas rápidas
  // ==============================
  const getDevolucionesPorProducto = useCallback(
    (productoCodigo: string) => devoluciones.filter((d) => d.productoCodigo === productoCodigo),
    [devoluciones]
  );

  const getDevolucionesPorEmpleado = useCallback(
    (empleadoCodigo: string) => devoluciones.filter((d) => d.devueltoPorCodigo === empleadoCodigo),
    [devoluciones]
  );

  const getDevolucionesPorTipoProducto = useCallback(
    (tipoProducto: 'BOLSA' | 'BARRA') => devoluciones.filter((d) => d.tipoProducto === tipoProducto),
    [devoluciones]
  );

  const getDevolucionesPorTipoHielo = useCallback(
    (tipoHielo: string) => devoluciones.filter((d) => d.tipoHielo === tipoHielo),
    [devoluciones]
  );

  const getDevolucionesPorFecha = useCallback(
    (inicio: Date, fin: Date) =>
      devoluciones.filter((d) => {
        const f = toDateSafe(d.createdAt);
        return f >= inicio && f <= fin;
      }),
    [devoluciones]
  );

  return {
    // Datos
    devoluciones,
    devolucionesPendientes,
    devolucionesAceptadas,
    devolucionesRechazadas,
    misDevoluciones,
    stats,
    summary,

    // Filtros personales
    misDevolucionesPendientes,
    misDevolucionesAceptadas,
    misDevolucionesRechazadas,

    // Constantes
    MOTIVOS,

    // Estados
    loading,
    isLoading,
    isProcessing,
    error,

    // Acciones principales
    registrarDevolucion,
    procesarDevolucion,
    cancelarDevolucion,
    validarProductoParaDevolucion,

    // Consultas
    obtenerDevolucionPorCodigo,
    getDevolucionesPorProducto,
    getDevolucionesPorEmpleado,
    getDevolucionesPorTipoProducto,
    getDevolucionesPorTipoHielo,
    getDevolucionesPorFecha,

    // Recargar
    loadDevoluciones,
    loadMisDevoluciones,
    loadMisDevolucionesAceptadas,
    loadDevolucionesPendientes,
    loadDevolucionesAceptadas,
    loadDevolucionesRechazadas,
    loadStats,
    loadAll,
    refresh,

    // Manipulación local
    actualizarDevolucionLocal,
    eliminarDevolucionLocal,

    // Helpers motivos
    getMotivoById,
    getMotivoLabel,
    getMotivoAfectaStock,

    // Permisos
    canRegister,
    canProcess,
    canViewAll,
    canViewStats,
    canUpdate,
    canCancel,

    // Validaciones
    hasDevoluciones: devoluciones.length > 0,
    hasMisDevoluciones: misDevoluciones.length > 0,
    hasPendientes: devolucionesPendientes.length > 0,
    hasAceptadas: devolucionesAceptadas.length > 0,
    hasRechazadas: devolucionesRechazadas.length > 0,

    // Usuario
    usuario,
    esAdmin: usuario?.rol === 'ADMIN',
    esProduccion: usuario?.rol === 'PRODUCCION',
    estaAutenticado: !!usuario,

    // Dashboard
    alertasDevoluciones: devolucionesPendientes.length,
    eficienciaDevoluciones: stats ? (stats.devolucionesAceptadas / (stats.totalDevoluciones || 1)) * 100 : 0,

    // Reporte rápido
    getResumenPeriodo: async (inicio: Date, fin: Date) => {
      const devolucionesPeriodo = devoluciones.filter((d) => {
        const f = toDateSafe(d.createdAt);
        return f >= inicio && f <= fin;
      });

      return {
        periodo: { inicio, fin },
        total: devolucionesPeriodo.length,
        pendientes: devolucionesPeriodo.filter((d) => d.estado === 'PENDIENTE').length,
        aceptadas: devolucionesPeriodo.filter((d) => d.estado === 'ACEPTADA').length,
        rechazadas: devolucionesPeriodo.filter((d) => d.estado === 'RECHAZADA').length,
        cantidadTotal: devolucionesPeriodo.reduce((sum, d) => sum + (Number(d.cantidad ?? 0) || 0), 0),
        porMotivo: MOTIVOS.map((m) => ({
          motivo: m.label,
          cantidad: devolucionesPeriodo.filter((d) => d.motivo === m.id).length,
        })),
      };
    },
  };
};
