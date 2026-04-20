'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuthContext } from '@/context/AuthContext';

// ✅ OJO: tu service real es mermas.service.ts (plural) según lo que acabas de dejar
import { MermasService } from '@/lib/services/merma.service';

import type { IceType } from '@/lib/utils/types/product.types';
import type { TurnoType } from '@/lib/utils/types/turno.types';

// =====================================================
// Tipos (hook-level) — compatibles con UI
// =====================================================
export type MermaTipoProducto = 'BOLSA' | 'BARRA' | 'BOLSA_VACIA';
export type MermaEstado = 'ACTIVA' | 'ELIMINADA';

// ✅ para barra, define de dónde se descuenta
export type CuartosFuente = 'DISPONIBLES' | 'USADOS';

export interface Merma {
  id?: string;
  codigo: string;

  productoCodigo: string;
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
  turno: TurnoType;

  afectaStock: boolean;

  // bolsa vacía (cantidad BV)
  stockAnterior?: number;
  stockNuevo?: number;

  // bolsa llena por tipo
  stockHieloAnterior?: number;
  stockHieloNuevo?: number;

  // barra (cuartos)
  cuartosAnteriores?: number;
  cuartosNuevos?: number;

  // auditoría barra
  cuartosFuente?: CuartosFuente;

  estado?: MermaEstado;

  // legacy flags (ya no se usan, pero no rompen)
  cancelada?: boolean;
  canceladaPor?: string;
  motivoCancelacion?: string;
  canceladaAt?: unknown;
}

export interface MermaRequest {
  productoCodigo: string;
  productoNombre: string;
  tipoProducto: MermaTipoProducto;

  // ✅ BOLSA (LLENA) requiere tipoHielo (o lo autocalcula service)
  tipoHielo?: IceType;

  cantidad: number;
  motivo: string;
  motivoDetallado?: string;

  // ✅ barra
  cuartosFuente?: CuartosFuente;

  // ✅ BOLSA LLENA: por si tu UI manda “BVxxx” aquí (recomendado)
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

// ✅ Resumen rápido local (tipado) — lo que usa tu UI
export interface MermaResumen {
  totalMermas: number;
  totalCantidad: number;
  valorEstimadoPerdido: number;
  porcentajeConStockAfectado: string;
  promedioDiario: number; // últimos 30 días (en días con actividad)
}

// =====================================================
// Constantes UI (ajusta labels si quieres)
// =====================================================
export const MOTIVOS_MERMA = [
  { id: 'ROTO', label: 'Producto roto/dañado' },
  { id: 'CADUCADO', label: 'Producto caducado' },
  { id: 'DERRAMADO', label: 'Hielo derramado' },
  { id: 'CALIDAD', label: 'Problema de calidad' },
  { id: 'DESCARTE', label: 'Descartado por producción' },
  { id: 'INVENTARIO', label: 'Diferencia en inventario' },
  { id: 'OTRO', label: 'Otro motivo' },
] as const;

export const TIPOS_PRODUCTO_MERMA: Array<{ id: MermaTipoProducto; label: string }> = [
  { id: 'BOLSA', label: 'Bolsa Llena' },
  { id: 'BARRA', label: 'Barra (Cuartos)' },
  { id: 'BOLSA_VACIA', label: 'Bolsa Vacía' },
];

export interface MermaFilters {
  fechaInicio?: Date;
  fechaFin?: Date;
  empleadoCodigo?: string;
  productoCodigo?: string;
  tipoProducto?: MermaTipoProducto;
  motivo?: string;
  limit?: number;
}

// =====================================================
// Helpers (sin any implícitos)
// =====================================================
const toDateSafe = (v: unknown): Date => {
  if (!v) return new Date();
  if (v instanceof Date) return v;

  // Firestore Timestamp-like
  const maybe = v as { toDate?: () => Date; seconds?: number };
  if (typeof maybe?.toDate === 'function') return maybe.toDate();
  if (typeof maybe?.seconds === 'number') return new Date(maybe.seconds * 1000);

  const d = new Date(v as any);
  return Number.isFinite(d.getTime()) ? d : new Date();
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const safeNum = (v: unknown, fallback = 0) => {
  const n = Number(v as any);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeTipoProducto = (v: unknown): MermaTipoProducto => {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'BARRA') return 'BARRA';
  if (s === 'BOLSA_VACIA' || s === 'VACIA') return 'BOLSA_VACIA';
  return 'BOLSA';
};

const normalizeCuartosFuente = (v: unknown): CuartosFuente | undefined => {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'USADOS') return 'USADOS';
  if (s === 'DISPONIBLES') return 'DISPONIBLES';
  return undefined;
};

const normalizeHielo = (v: unknown): IceType | undefined => {
  const s = String(v ?? '').trim().toUpperCase();
  return s ? (s as IceType) : undefined;
};

const normalizeMerma = (raw: unknown): Merma => {
  const m = (raw ?? {}) as Partial<Merma> & Record<string, unknown>;

  return {
    ...(m as Merma),

    tipoProducto: normalizeTipoProducto(m.tipoProducto),
    tipoHielo: m.tipoHielo ? normalizeHielo(m.tipoHielo) : undefined,

    cantidad: safeNum(m.cantidad, 0),
    afectaStock: Boolean(m.afectaStock),

    createdAt: toDateSafe(m.createdAt),
    updatedAt: toDateSafe(m.updatedAt),

    canceladaAt: m.canceladaAt ?? undefined,
    cuartosFuente: normalizeCuartosFuente(m.cuartosFuente),

    stockAnterior: m.stockAnterior != null ? safeNum(m.stockAnterior, 0) : undefined,
    stockNuevo: m.stockNuevo != null ? safeNum(m.stockNuevo, 0) : undefined,

    stockHieloAnterior: m.stockHieloAnterior != null ? safeNum(m.stockHieloAnterior, 0) : undefined,
    stockHieloNuevo: m.stockHieloNuevo != null ? safeNum(m.stockHieloNuevo, 0) : undefined,

    cuartosAnteriores: m.cuartosAnteriores != null ? safeNum(m.cuartosAnteriores, 0) : undefined,
    cuartosNuevos: m.cuartosNuevos != null ? safeNum(m.cuartosNuevos, 0) : undefined,
  };
};

const normalizeArray = (list: unknown): Merma[] => {
  const arr = Array.isArray(list) ? list : [];
  return arr.map(normalizeMerma);
};

type UsuarioActivo = {
  id: string; // usamos codigo/uid
  nombre: string;
  email?: string;
  rol: 'ADMIN' | 'PRODUCCION';
};

// =====================================================
// Hook
// =====================================================
export const useMermas = (initialFilters?: MermaFilters) => {
  const { productionSession, adminSession } = useAuthContext();

  const getUsuarioActivo = useCallback((): UsuarioActivo | null => {
    // ✅ mermas = admin por regla
    if (adminSession) {
      const a = adminSession as unknown as { id?: string; codigo?: string; nombre?: string; email?: string };
      return {
        id: String(a?.codigo ?? a?.id ?? `ADMIN-${Date.now()}`),
        nombre: String(a?.nombre ?? 'Administrador'),
        email: a?.email ? String(a.email) : undefined,
        rol: 'ADMIN',
      };
    }

    // compat: producción
    if (productionSession) {
      const p = productionSession as unknown as { id?: string; codigo?: string; nombre?: string; email?: string };
      return {
        id: String(p?.codigo ?? p?.id ?? `EMP-${Date.now()}`),
        nombre: String(p?.nombre ?? 'Producción'),
        email: p?.email ? String(p.email) : undefined,
        rol: 'PRODUCCION',
      };
    }

    return null;
  }, [productionSession, adminSession]);

  const usuario = useMemo(() => getUsuarioActivo(), [getUsuarioActivo]);

  const [mermas, setMermas] = useState<Merma[]>([]);
  const [filters, setFilters] = useState<MermaFilters>(initialFilters || {});
  const [stats, setStats] = useState<MermaStats | null>(null);

  const [loading, setLoading] = useState({
    all: false,
    stats: false,
    registro: false,
    eliminacion: false,
    filtrado: false,
  });

  const [error, setError] = useState<string | null>(null);

  const estaCargando = useMemo(() => Object.values(loading).some(Boolean), [loading]);
  const limpiarError = useCallback(() => setError(null), []);

  // =====================================================
  // CARGAS
  // =====================================================
  const cargarMermas = useCallback(
    async (customFilters?: MermaFilters) => {
      try {
        setLoading((p) => ({ ...p, all: true }));
        setError(null);

        const filtrosCombinados: MermaFilters = { ...filters, ...(customFilters || {}) };
        if (customFilters) setFilters(filtrosCombinados);

        const data = await MermasService.obtenerMermas(filtrosCombinados as any);
        const normal = normalizeArray(data);
        setMermas(normal);

        return normal;
      } catch (err: unknown) {
        const msg = (err as { message?: string })?.message ?? 'Error al cargar mermas';
        setError(msg);
        throw err;
      } finally {
        setLoading((p) => ({ ...p, all: false }));
      }
    },
    [filters],
  );

  const cargarMermasRecientes = useCallback(async (limiteN: number = 20) => {
    try {
      setLoading((p) => ({ ...p, all: true }));
      setError(null);

      const data = await MermasService.obtenerMermasRecientes(limiteN);
      const normal = normalizeArray(data);
      setMermas(normal);

      return normal;
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Error al cargar mermas recientes';
      setError(msg);
      throw err;
    } finally {
      setLoading((p) => ({ ...p, all: false }));
    }
  }, []);

  const cargarEstadisticas = useCallback(async (fechaInicio?: Date, fechaFin?: Date) => {
    try {
      setLoading((p) => ({ ...p, stats: true }));
      setError(null);

      const s = await MermasService.obtenerEstadisticasMermas(fechaInicio, fechaFin);

      const normalized: MermaStats = {
        ...(s as MermaStats),
        ultimaActualizacion: toDateSafe((s as any)?.ultimaActualizacion),
      };

      setStats(normalized);
      return normalized;
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Error al cargar estadísticas';
      setError(msg);
      throw err;
    } finally {
      setLoading((p) => ({ ...p, stats: false }));
    }
  }, []);

  // =====================================================
  // OPERACIONES
  // =====================================================
  const registrarMerma = useCallback(
    async (request: MermaRequest): Promise<{ exito: boolean; mensaje: string; codigoMerma?: string }> => {
      if (!usuario) throw new Error('Usuario no autenticado');

      try {
        setLoading((p) => ({ ...p, registro: true }));
        setError(null);

        const tipo = normalizeTipoProducto(request?.tipoProducto);
        const cantidad = Math.max(0, Math.floor(Number(request?.cantidad ?? 0)));

        const productoCodigo = String(request?.productoCodigo ?? '').trim();
        const productoNombre = String(request?.productoNombre ?? '').trim();
        const motivo = String(request?.motivo ?? '').trim();

        if (!productoCodigo) throw new Error('productoCodigo requerido');
        if (!productoNombre) throw new Error('productoNombre requerido');
        if (!cantidad || cantidad <= 0) throw new Error('cantidad inválida');
        if (!motivo) throw new Error('motivo requerido');

        const motivoDetallado = request.motivoDetallado?.trim() ? request.motivoDetallado.trim() : undefined;

        // 🔥 IMPORTANTE: tu service YA NO usa afectaStock/afectaCuartosUsados (merma siempre resta)
        const reqFinal: MermaRequest =
          tipo === 'BARRA'
            ? {
                productoCodigo,
                productoNombre,
                tipoProducto: 'BARRA',
                cantidad,
                motivo,
                motivoDetallado,
                cuartosFuente: request.cuartosFuente ?? 'DISPONIBLES',
              }
            : tipo === 'BOLSA'
              ? {
                  productoCodigo,
                  productoNombre,
                  tipoProducto: 'BOLSA',
                  cantidad,
                  motivo,
                  motivoDetallado,
                  tipoHielo: request.tipoHielo ? (normalizeHielo(request.tipoHielo) as IceType) : undefined,
                  bolsaVaciaCodigo: request.bolsaVaciaCodigo ? String(request.bolsaVaciaCodigo).trim() : undefined,
                }
              : {
                  productoCodigo,
                  productoNombre,
                  tipoProducto: 'BOLSA_VACIA',
                  cantidad,
                  motivo,
                  motivoDetallado,
                };

        // ✅ Service espera (request, empleadoCodigo, empleadoNombre)
        const res = await MermasService.registrarMerma(reqFinal as any, usuario.id, usuario.nombre);

        // refresca lista
        await cargarMermasRecientes(30);

        return res as any;
      } catch (err: unknown) {
        const msg = (err as { message?: string })?.message ?? 'Error al registrar merma';
        setError(msg);
        throw err;
      } finally {
        setLoading((p) => ({ ...p, registro: false }));
      }
    },
    [usuario, cargarMermasRecientes],
  );

  // ⛔ tu service deshabilitó cancelación: este método ahora solo devuelve error claro
  const eliminarMerma = useCallback(
    async (_codigoMerma: string, _motivoCancelacion: string): Promise<{ exito: boolean; mensaje: string }> => {
      try {
        setLoading((p) => ({ ...p, eliminacion: true }));
        setError(null);
        await MermasService.cancelarMerma();
        return { exito: false, mensaje: 'Cancelación deshabilitada' };
      } catch (err: unknown) {
        const msg =
          (err as { message?: string })?.message ??
          'Cancelación deshabilitada: la merma NO tiene devuelta.';
        setError(msg);
        throw err;
      } finally {
        setLoading((p) => ({ ...p, eliminacion: false }));
      }
    },
    [],
  );

  const obtenerMermaPorCodigo = useCallback(async (codigo: string): Promise<Merma | null> => {
    try {
      setError(null);
      if (!codigo) return null;
      const data = await MermasService.obtenerMermaPorCodigo(codigo);
      return data ? normalizeMerma(data) : null;
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Error al obtener merma';
      setError(msg);
      throw err;
    }
  }, []);

  // =====================================================
  // FILTRADO (server)
  // =====================================================
  const actualizarFiltros = useCallback(
    async (nuevosFiltros: MermaFilters) => {
      try {
        setLoading((p) => ({ ...p, filtrado: true }));
        setError(null);

        const filtrosCombinados: MermaFilters = { ...filters, ...nuevosFiltros };
        setFilters(filtrosCombinados);

        const data = await MermasService.obtenerMermas(filtrosCombinados as any);
        const normal = normalizeArray(data);
        setMermas(normal);

        return normal;
      } catch (err: unknown) {
        const msg = (err as { message?: string })?.message ?? 'Error al aplicar filtros';
        setError(msg);
        throw err;
      } finally {
        setLoading((p) => ({ ...p, filtrado: false }));
      }
    },
    [filters],
  );

  const actualizarFiltro = useCallback(
    async (key: keyof MermaFilters, value: unknown) => {
      const nuevos: MermaFilters = { ...filters, [key]: value as any };
      return await actualizarFiltros(nuevos);
    },
    [filters, actualizarFiltros],
  );

  const limpiarFiltros = useCallback(async () => {
    setFilters({});
    return await cargarMermasRecientes(20);
  }, [cargarMermasRecientes]);

  // =====================================================
  // FILTRADO (local)
  // =====================================================
  const filtrarMermasLocal = useCallback(
    (filtrosLocales: {
      busqueda?: string;
      tipoProducto?: MermaTipoProducto;
      motivo?: string;
      afectaStock?: boolean;
      fechaInicio?: Date;
      fechaFin?: Date;
    }) => {
      if (!mermas.length) return [];

      const q = filtrosLocales.busqueda ? String(filtrosLocales.busqueda).toLowerCase() : '';

      const start = filtrosLocales.fechaInicio ? startOfDay(filtrosLocales.fechaInicio) : undefined;
      const end = filtrosLocales.fechaFin ? filtrosLocales.fechaFin : undefined;

      return mermas.filter((m) => {
        // cancelada legacy
        if ((m as any).cancelada) return false;

        if (q) {
          const ok =
            (m.productoNombre ?? '').toLowerCase().includes(q) ||
            (m.motivo ?? '').toLowerCase().includes(q) ||
            String(m.tipoHielo ?? '').toLowerCase().includes(q) ||
            (m.registradoPorNombre ?? '').toLowerCase().includes(q) ||
            (m.codigo ?? '').toLowerCase().includes(q) ||
            (m.productoCodigo ?? '').toLowerCase().includes(q);
          if (!ok) return false;
        }

        if (filtrosLocales.tipoProducto && m.tipoProducto !== filtrosLocales.tipoProducto) return false;
        if (filtrosLocales.motivo && m.motivo !== filtrosLocales.motivo) return false;

        // afectaStock siempre true ahora, pero si lo filtran, lo respetamos
        if (filtrosLocales.afectaStock !== undefined && m.afectaStock !== filtrosLocales.afectaStock) return false;

        if (start && m.createdAt < start) return false;
        if (end && m.createdAt > end) return false;

        return true;
      });
    },
    [mermas],
  );

  // =====================================================
  // Resumen rápido (local)
  // =====================================================
  const resumen: MermaResumen = useMemo(() => {
    const activos = mermas.filter((m) => !(m as any).cancelada);

    const totalMermas = activos.length;
    const totalCantidad = activos.reduce((sum, m) => sum + (Number(m.cantidad ?? 0) || 0), 0);

    const valorEstimadoPerdido = activos.reduce((sum, m) => {
      let unit = 0;
      if (m.tipoProducto === 'BARRA') unit = 100;
      else if (m.tipoProducto === 'BOLSA') unit = 30;
      else unit = 5;
      return sum + unit * (Number(m.cantidad ?? 0) || 0);
    }, 0);

    const porcentajeConStockAfectado =
      totalMermas > 0 ? ((activos.filter((m) => m.afectaStock).length / totalMermas) * 100).toFixed(1) + '%' : '0%';

    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - 29);

    const inWindow = activos.filter((m) => m.createdAt >= startOfDay(since));
    const uniqueDays = new Set(inWindow.map((m) => startOfDay(m.createdAt).getTime()));
    const daysCount = Math.max(1, uniqueDays.size);

    const totalCantidadWindow = inWindow.reduce((s, m) => s + (Number(m.cantidad ?? 0) || 0), 0);
    const promedioDiario = totalCantidadWindow / daysCount;

    return {
      totalMermas,
      totalCantidad,
      valorEstimadoPerdido,
      porcentajeConStockAfectado,
      promedioDiario,
    };
  }, [mermas]);

  const mermasPorDia = useMemo(() => {
    const map = new Map<string, number>();

    mermas
      .filter((m) => !(m as any).cancelada)
      .forEach((m) => {
        const key = m.createdAt.toISOString().split('T')[0];
        map.set(key, (map.get(key) ?? 0) + (Number(m.cantidad ?? 0) || 0));
      });

    return Array.from(map.entries())
      .map(([fecha, cantidad]) => ({ fecha, cantidad }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [mermas]);

  const topProductos = useMemo(() => {
    const map = new Map<string, number>();

    mermas
      .filter((m) => !(m as any).cancelada)
      .forEach((m) => {
        const k = m.productoNombre ?? 'SIN_NOMBRE';
        map.set(k, (map.get(k) ?? 0) + (Number(m.cantidad ?? 0) || 0));
      });

    return Array.from(map.entries())
      .map(([nombre, cantidad]) => ({ nombre, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);
  }, [mermas]);

  const topEmpleados = useMemo(() => {
    const map = new Map<string, { nombre: string; cantidad: number }>();

    mermas
      .filter((m) => !(m as any).cancelada)
      .forEach((m) => {
        const key = m.registradoPorCodigo ?? 'SIN_CODIGO';
        const cur = map.get(key);
        if (cur) cur.cantidad += Number(m.cantidad ?? 0) || 0;
        else map.set(key, { nombre: m.registradoPorNombre ?? 'SIN_NOMBRE', cantidad: Number(m.cantidad ?? 0) || 0 });
      });

    return Array.from(map.entries())
      .map(([codigo, v]) => ({ codigo, nombre: v.nombre, cantidad: v.cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);
  }, [mermas]);

  // =====================================================
  // Export CSV
  // =====================================================
  const exportarACSV = useCallback(() => {
    try {
      const list = mermas.filter((m) => !(m as any).cancelada);
      if (list.length === 0) throw new Error('No hay mermas para exportar');

      const encabezados = [
        'Código',
        'Fecha',
        'Producto',
        'Código Producto',
        'Tipo Producto',
        'Tipo Hielo',
        'Cantidad',
        'Motivo',
        'Detalle Motivo',
        'Registrado Por',
        'Turno',
        'Afecta Stock',
        'Stock Anterior',
        'Stock Nuevo',
        'Stock Hielo Anterior',
        'Stock Hielo Nuevo',
        'Cuartos Anteriores',
        'Cuartos Nuevos',
        'Cuartos Fuente',
      ];

      const filas = list.map((m) => [
        m.codigo,
        m.createdAt?.toLocaleString('es-MX') ?? '',
        m.productoNombre,
        m.productoCodigo,
        m.tipoProducto,
        m.tipoHielo ?? 'N/A',
        String(m.cantidad ?? 0),
        m.motivo,
        m.motivoDetallado ?? '',
        m.registradoPorNombre,
        m.turno,
        m.afectaStock ? 'Sí' : 'No',
        m.stockAnterior != null ? String(m.stockAnterior) : 'N/A',
        m.stockNuevo != null ? String(m.stockNuevo) : 'N/A',
        m.stockHieloAnterior != null ? String(m.stockHieloAnterior) : 'N/A',
        m.stockHieloNuevo != null ? String(m.stockHieloNuevo) : 'N/A',
        m.cuartosAnteriores != null ? String(m.cuartosAnteriores) : 'N/A',
        m.cuartosNuevos != null ? String(m.cuartosNuevos) : 'N/A',
        m.cuartosFuente ?? 'N/A',
      ]);

      const contenidoCSV = [
        encabezados.join(','),
        ...filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      const blob = new Blob([contenidoCSV], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `mermas_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      return true;
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Error al exportar CSV';
      setError(msg);
      return false;
    }
  }, [mermas]);

  // =====================================================
  // Permisos
  // =====================================================
  const puedeRegistrarLocal = !!usuario && usuario.rol === 'ADMIN';
  const puedeVerTodas = !!adminSession;
  const puedeVerEstadisticas = !!adminSession;

  // =====================================================
  // Init load
  // =====================================================
  useEffect(() => {
    const init = async () => {
      if (!usuario) return;

      try {
        setError(null);
        await cargarMermasRecientes(20);
      } catch (e: unknown) {
        setError((e as { message?: string })?.message ?? 'Error al inicializar mermas');
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id]);

  return {
    // datos
    mermas,
    filters,
    stats,
    usuario,

    // estados
    loading,
    estaCargando,
    error,

    // resumen
    resumen,
    mermasPorDia,
    topProductos,
    topEmpleados,

    // constantes
    MOTIVOS: MOTIVOS_MERMA,
    TIPOS_PRODUCTO: TIPOS_PRODUCTO_MERMA,

    // operaciones
    registrarMerma,
    eliminarMerma, // (lanza error porque cancelación está deshabilitada)
    obtenerMermaPorCodigo,

    // cargas
    cargarMermas,
    cargarMermasRecientes,
    cargarEstadisticas,
    recargar: cargarMermas,

    // filtros
    actualizarFiltros,
    actualizarFiltro,
    limpiarFiltros,
    filtrarMermasLocal,

    // export
    exportarACSV,
    limpiarError,

    // permisos
    puedeRegistrar: puedeRegistrarLocal,
    puedeVerTodas,
    puedeVerEstadisticas,
    esAdmin: !!adminSession,
    esProduccion: !!productionSession,
    estaAutenticado: !!usuario,
  };
};