'use client';

// app/admin/dashboard/monitoreo/page.tsx
// ✅ PRODUCTION READY (para desplegar)
// ✅ FIX CLAVE: este Monitoreo **sí incluye** movimientos tipo "SALIDA_BOLSA" (y cualquier tipo string legacy)
// - Filtros/tipos a `string[]` (no solo TipoMovimiento) para que no se “pierdan” los nuevos tipos.
// - `getMovimientoMetaSafe()` para que NO truene si el tipo no existe en tu enum/meta.
// - Soporta batch (items[]) y SALIDA_BOLSA en tabla y modal.
// - ✅ FIX TS extra: Maquina/Ubicación como `string` (para no romper si MaquinaId/UbicacionId no incluye valores nuevos).
// - ✅ FALLBACK: si TransactionService falla, carga directo de Firestore.
// - ✅ Fallback de orderBy: intenta 'fecha' y si truena usa 'createdAt' (por compat).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuthContext } from '@/context/AuthContext';
import { useProducts } from '@/lib/hooks/useProducts';

import { db } from '@/lib/firebase/config.client';

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  where,
  Timestamp,
  writeBatch,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';

import TransactionService from '@/lib/services/transaction.service';

import type { IceType } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO, ETIQUETAS_TIPO_HIELO } from '@/lib/utils/types/product.types';

import type { TurnoType } from '@/lib/utils/types/turno.types';
import type { Movimiento, TipoMovimiento } from '@/lib/utils/types/transaction.types';
import { getMovimientoMeta } from '@/lib/utils/types/transaction.types';

import {
  ArrowLeft,
  RefreshCw,
  Search,
  Filter,
  Loader2,
  Trash2,
  X,
  ClipboardList,
  Eraser,
  User,
  Snowflake,
  Package,
  Cuboid,
  ThermometerSnowflake,
  Eye,
  BarChart,
  Activity,
  Database,
  Thermometer,
  Zap,
  ChevronUp,
  ChevronDown,
  Monitor,
  Warehouse,
  AlertTriangle,
  Radio,
  RadioTower,
} from 'lucide-react';

/* ============================================================
  Helpers UI
============================================================ */
function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function fmtDate(d: Date) {
  try {
    return d.toLocaleString('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}

function toDateSafe(v: any): Date {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v?.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function guessKgFromName(nombre?: string): number | undefined {
  if (!nombre) return undefined;
  const m = nombre.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(kg|kilo|kilos)\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

const safeNum = (n: any, f = 0) => (Number.isFinite(Number(n)) ? Number(n) : f);

/** ✅ NUEVO: resolver actor (quién registró) con fallbacks admin/producción/legacy + flag missing */
function getActor(m: any): { label: string; codigo?: string; missing: boolean } {
  const usuarioNombre = String(m?.usuarioNombre ?? '').trim();
  const usuarioCodigo = String(m?.usuarioCodigo ?? '').trim();

  const empleadoNombre =
    String(m?.empleadoNombre ?? '').trim() ||
    String(m?.empleadoAsignadoNombre ?? '').trim(); // compat

  const empleadoCodigo =
    String(m?.empleadoCodigo ?? '').trim() ||
    String(m?.empleadoAsignadoCodigo ?? '').trim() ||
    String(m?.empleado ?? '').trim(); // legacy

  if (usuarioNombre) return { label: usuarioNombre, codigo: usuarioCodigo || undefined, missing: false };
  if (usuarioCodigo) return { label: usuarioCodigo, codigo: usuarioCodigo || undefined, missing: false };

  if (empleadoNombre) return { label: empleadoNombre, codigo: empleadoCodigo || undefined, missing: false };
  if (empleadoCodigo) return { label: empleadoCodigo, codigo: empleadoCodigo || undefined, missing: false };

  return { label: 'SIN USUARIO', codigo: undefined, missing: true };
}

/** ✅ determinar si un movimiento cuenta como SALIDA */
function isSalidaMovimiento(tipo?: string): boolean {
  const t = String(tipo ?? '').toUpperCase();
  return (
    t.includes('SALIDA_BOLSA') ||
    t.includes('VENTA') ||
    t.includes('MERMA') ||
    t.includes('DEVOLUCION') ||
    t.includes('SALIDA') ||
    t.includes('TRANSFERENCIA_SALIDA')
  );
}

/** ✅ FIX: meta safe cuando el tipo NO existe en transaction.types (ej: SALIDA_BOLSA) */
function getMovimientoMetaSafe(tipo: string) {
  const t = String(tipo ?? '').toUpperCase().trim();

  try {
    return getMovimientoMeta(t as TipoMovimiento);
  } catch {
    // fallback
  }

  if (t === 'SALIDA_BOLSA' || t === 'SALIDA') return { texto: 'Salida', color: 'gray' } as any;
  if (t.startsWith('VENTA')) return { texto: 'Venta', color: 'green' } as any;
  if (t.startsWith('MERMA')) return { texto: 'Merma', color: 'red' } as any;
  if (t.startsWith('DEVOLUCION')) return { texto: 'Devolución', color: 'amber' } as any;
  if (t.startsWith('LLENADO')) return { texto: 'Llenado', color: 'purple' } as any;
  if (t.startsWith('ASIGNACION')) return { texto: 'Asignación', color: 'blue' } as any;

  return { texto: t || 'Movimiento', color: 'gray' } as any;
}

/** ✅ cantidad (soporta batch items[]) */
function getCantidadMovimiento(m: any): number {
  if (typeof m?.deltaPrincipal === 'number') return Math.abs(m.deltaPrincipal);

  if (Array.isArray(m?.items) && m.items.length) {
    const sumDelta = m.items.reduce((acc: number, it: any) => acc + (Number(it?.delta) || 0), 0);
    if (sumDelta !== 0) return Math.abs(sumDelta);

    const sumQty = m.items.reduce((acc: number, it: any) => acc + (Number(it?.cantidad) || 0), 0);
    return Math.abs(sumQty);
  }

  if (typeof m?.cantidad === 'number') return Math.abs(m.cantidad);

  return 0;
}

/** ✅ signo para colorear (salidas en rojo aunque se muestre abs) */
function getDeltaSign(m: any): number {
  if (typeof m?.deltaPrincipal === 'number') return m.deltaPrincipal;

  if (Array.isArray(m?.items) && m.items.length) {
    const sumDelta = m.items.reduce((acc: number, it: any) => acc + (Number(it?.delta) || 0), 0);
    if (sumDelta !== 0) return sumDelta;
    if (isSalidaMovimiento(m?.tipo)) return -1;
  }

  if (isSalidaMovimiento(m?.tipo)) return -1;

  return 1;
}

/* ============================================================
  UI Components
============================================================ */
const StatCard = ({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  trend,
  onClick,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
  trend?: { value: number; type: 'up' | 'down' | 'neutral' };
  onClick?: () => void;
}) => {
  const trendColor =
    trend?.type === 'up' ? 'text-green-400' : trend?.type === 'down' ? 'text-red-400' : 'text-gray-400';
  const trendBg =
    trend?.type === 'up'
      ? 'from-green-900/20 to-green-800/10'
      : trend?.type === 'down'
      ? 'from-red-900/20 to-red-800/10'
      : 'from-gray-900/20 to-gray-800/10';

  return (
    <div
      className={`bg-gradient-to-br ${color} rounded-2xl p-5 border border-gray-800/50 shadow-lg hover:shadow-xl transition-all duration-300 ${
        onClick ? 'cursor-pointer hover:-translate-y-1 hover:scale-[1.02]' : ''
      }`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-white/90 font-medium">{title}</p>
            {trend && (
              <span className={`text-xs px-2.5 py-1 rounded-full bg-gradient-to-r ${trendBg} ${trendColor}`}>
                {trend.type === 'up' ? '↗' : trend.type === 'down' ? '↘' : '•'} {trend.value}%
              </span>
            )}
          </div>
          <p className="text-3xl font-bold text-white mb-1">
            {typeof value === 'number' ? value.toLocaleString('es-MX') : value}
          </p>
          {subtitle && <p className="text-xs text-white/70 opacity-90">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-xl ${color.split(' ')[1]} bg-opacity-30 backdrop-blur-sm ml-4`}>
          <Icon className="h-7 w-7 text-white" />
        </div>
      </div>
    </div>
  );
};

const Pill = ({
  children,
  tone = 'gray',
  icon: Icon,
  size = 'md',
}: {
  children: React.ReactNode;
  tone?: 'gray' | 'red' | 'green' | 'blue' | 'amber' | 'purple' | 'cyan' | 'emerald';
  icon?: React.ElementType;
  size?: 'sm' | 'md';
}) => {
  const toneClasses = {
    red: 'bg-gradient-to-r from-red-900/40 to-red-800/30 border-red-700/30 text-red-300',
    green: 'bg-gradient-to-r from-green-900/40 to-green-800/30 border-green-700/30 text-green-300',
    blue: 'bg-gradient-to-r from-blue-900/40 to-blue-800/30 border-blue-700/30 text-blue-300',
    amber: 'bg-gradient-to-r from-amber-900/40 to-amber-800/30 border-amber-700/30 text-amber-300',
    purple: 'bg-gradient-to-r from-purple-900/40 to-purple-800/30 border-purple-700/30 text-purple-300',
    cyan: 'bg-gradient-to-r from-cyan-900/40 to-cyan-800/30 border-cyan-700/30 text-cyan-300',
    emerald: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/30 border-emerald-700/30 text-emerald-300',
    gray: 'bg-gradient-to-r from-gray-900/40 to-gray-800/30 border-gray-700/30 text-gray-300',
  };

  const sizeClasses = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';

  return (
    <span
      className={`inline-flex items-center ${sizeClasses} ${toneClasses[tone]} rounded-full border backdrop-blur-sm shadow-md`}
    >
      {Icon && <Icon className="h-3.5 w-3.5 mr-1.5" />}
      {children}
    </span>
  );
};

const IceTypeBadge = ({
  tipo,
  size = 'md',
  showIcon = true,
}: {
  tipo: IceType;
  size?: 'sm' | 'md';
  showIcon?: boolean;
}) => {
  const configs: Record<IceType, { color: string; icon: React.ElementType; label: string }> = {
    BARRA: { color: 'bg-gradient-to-r from-purple-600 to-purple-700', icon: Cuboid, label: 'Barra' },
    ROLITO: { color: 'bg-gradient-to-r from-blue-800 to-blue-900', icon: Snowflake, label: 'Rolito' },
    FRAPPE: { color: 'bg-gradient-to-r from-pink-800 to-pink-900', icon: Snowflake, label: 'Frappé' },
    GOURMET: { color: 'bg-gradient-to-r from-sky-600 to-sky-700', icon: Snowflake, label: 'Gourmet' },
    ENFRIAR: { color: 'bg-gradient-to-r from-blue-600 to-blue-700', icon: Thermometer, label: 'Enfriar' },
  };

  const cfg = configs[tipo];
  const Icon = cfg.icon;
  const sizeClasses = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';

  return (
    <span className={`inline-flex items-center ${sizeClasses} ${cfg.color} text-white rounded-full shadow-md`}>
      {showIcon && <Icon className="h-3.5 w-3.5 mr-1.5" />}
      {cfg.label}
    </span>
  );
};

/* ============================================================
  Firestore config
============================================================ */
const COLECCION_MOVIMIENTOS = 'movimientos';
const movimientosCol = collection(db, COLECCION_MOVIMIENTOS);

/* ============================================================
  Page
============================================================ */
type OriginFilter = 'TODOS' | 'ADMIN' | 'PRODUCCION';
type MaquinaFilter = 'TODAS' | string;
type UbicacionFilter = 'TODAS' | string;

type FiltersState = {
  q: string;
  tipos: string[];
  turnos: TurnoType[];
  hielos: IceType[];
  origin: OriginFilter;
  from?: Date;
  to?: Date;
  maquina: MaquinaFilter;
  ubicacion: UbicacionFilter;
};

/* ============================================================
  Tipos UI Cámara Fría
============================================================ */
type CamaraTipo = {
  tipoHielo: IceType;
  stockActual: number;
};

type CamaraProducto = {
  codigo: string;
  nombre: string;
  pesoKg?: number;
  tipos: CamaraTipo[];
  total: number;
};

/* ============================================================
  Helpers snapshot normalize
============================================================ */
function normalizeMovDoc(d: QueryDocumentSnapshot<DocumentData>) {
  const data = d.data() as any;
  return {
    id: d.id,
    ...data,
    fecha: toDateSafe(data.fecha ?? data.createdAt ?? data.updatedAt),
  } as any;
}

async function fetchMovsFirestore(limit = 800) {
  // intenta orderBy fecha, si truena (campo inexistente o index) intenta createdAt
  const tryFields = ['fecha', 'createdAt'] as const;
  for (const field of tryFields) {
    try {
      const qy = query(movimientosCol, orderBy(field, 'desc'), qLimit(limit));
      const snap = await getDocs(qy);
      return snap.docs.map(normalizeMovDoc);
    } catch (e) {
      // next fallback
    }
  }
  // último recurso: sin orderBy (no ideal) -> trae pocos, pero no rompe deploy
  const snap = await getDocs(query(movimientosCol, qLimit(limit)));
  return snap.docs.map(normalizeMovDoc);
}

export default function MonitoreoPage() {
  const router = useRouter();
  const { user, loading: authLoading, adminSession, productionSession } = useAuthContext();

  const {
    bolsasVacias,
    stockLlenoPorProducto,
    stockLlenoTotalPorTipo,
    stockLlenoTotalGeneral,
    loading: productsLoading,
    reload: reloadProducts,
  } = useProducts();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<(Movimiento & any)[]>([]);
  const [showFilters, setShowFilters] = useState(true);
  const [showCamaraFria, setShowCamaraFria] = useState(true);
  const [realtimeActive, setRealtimeActive] = useState(true);
  const [selectedMovimiento, setSelectedMovimiento] = useState<(Movimiento & any) | null>(null);

  const [filters, setFilters] = useState<FiltersState>({
    q: '',
    tipos: [],
    turnos: [],
    hielos: [],
    origin: 'TODOS',
    maquina: 'TODAS',
    ubicacion: 'TODAS',
  });

  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  /** ✅ bloquear scroll del body al abrir modal */
  useEffect(() => {
    if (!selectedMovimiento) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [selectedMovimiento]);

  /* ============================================================
    ✅ REALTIME LISTENER
  ============================================================ */
  useEffect(() => {
    if (!realtimeActive) return;

    setLoading(true);
    setError(null);

    // fallback orderBy: primero fecha, si falla reintenta createdAt
    let unsub: (() => void) | null = null;
    let cancelled = false;

    const subscribe = (field: 'fecha' | 'createdAt') => {
      const qy = query(movimientosCol, orderBy(field, 'desc'), qLimit(800));
      unsub = onSnapshot(
        qy,
        (snap) => {
          if (cancelled) return;
          const list = snap.docs.map(normalizeMovDoc);
          setRows(list);
          setLoading(false);
        },
        (err) => {
          if (cancelled) return;
          if (field === 'fecha') {
            try {
              unsub?.();
            } catch {}
            subscribe('createdAt');
            return;
          }
          console.error('Monitoreo snapshot error:', err);
          setError(err?.message ?? 'Error cargando movimientos');
          setLoading(false);
        }
      );
    };

    subscribe('fecha');

    return () => {
      cancelled = true;
      try {
        unsub?.();
      } catch {}
    };
  }, [realtimeActive]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // intenta tu service (si existe)
      const data = await TransactionService.obtenerMovimientos?.({ limit: 800 });
      if (Array.isArray(data) && data.length) {
        const normalized = data.map((m: any) => ({ ...m, fecha: toDateSafe(m.fecha ?? m.createdAt) })) as any[];
        setRows(normalized);
      } else {
        // fallback Firestore
        const fs = await fetchMovsFirestore(800);
        setRows(fs);
      }
    } catch (e: any) {
      // fallback Firestore si truena service
      try {
        const fs = await fetchMovsFirestore(800);
        setRows(fs);
      } catch (e2: any) {
        setError(e2?.message ?? e?.message ?? 'Error cargando movimientos');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // si apagas realtime, carga una vez manual
  useEffect(() => {
    if (!realtimeActive) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeActive]);

  /* ============================================================
    Catálogos UI
  ============================================================ */
  const allTipos = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((m) => m?.tipo && set.add(String(m.tipo)));
    set.add('SALIDA_BOLSA');

    const arr = Array.from(set);

    return arr.length
      ? arr.sort((a, b) => (getMovimientoMetaSafe(a).texto || a).localeCompare(getMovimientoMetaSafe(b).texto || b))
      : [
          'CREACION_BARRA',
          'CREACION_BOLSA_VACIA',
          'ASIGNACION_BOLSA',
          'LLENADO_BOLSA',
          'SALIDA_BOLSA',
          'VENTA_BOLSA',
          'VENTA_BARRA',
          'DEVOLUCION_BOLSA',
          'DEVOLUCION_BARRA',
          'MERMA_BOLSA',
          'MERMA_BARRA',
          'USO_CUARTOS_BARRA',
          'AJUSTE_STOCK',
          'CONFIG_STOCK_GLOBAL_HIELO',
          'LLENADO_MANUAL',
          'ACTUALIZACION_STOCK',
        ];
  }, [rows]);

  const allTurnos = useMemo(() => (['MATUTINO', 'VESPERTINO', 'NOCTURNO'] as TurnoType[]), []);
  const allHielos = useMemo(() => TIPOS_HIELO as unknown as IceType[], []);

  // ✅ string[] para no romper si tu union MaquinaId cambia
  const allMaquinas = useMemo(() => ['M1', 'M2', 'M3'] as string[], []);
  const allUbicaciones = useMemo(() => ['CAMARA_FRIA'] as string[], []);

  const getOrigenMov = (m: any): 'ADMIN' | 'PRODUCCION' => {
    const o = String((m as any).origen ?? '').toUpperCase();
    if (o === 'ADMIN') return 'ADMIN';
    if (o === 'PRODUCCION') return 'PRODUCCION';

    const isAdminLike = String((m as any).usuarioCodigo ?? '').toLowerCase() === 'admin';
    return isAdminLike ? 'ADMIN' : 'PRODUCCION';
  };

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();

    const inDateRange = (d: Date) => {
      const t = d.getTime();
      if (filters.from) {
        const start = new Date(filters.from);
        start.setHours(0, 0, 0, 0);
        if (t < start.getTime()) return false;
      }
      if (filters.to) {
        const end = new Date(filters.to);
        end.setHours(23, 59, 59, 999);
        if (t > end.getTime()) return false;
      }
      return true;
    };

    return rows.filter((m: any) => {
      const fecha = toDateSafe((m as any).fecha);
      if (!inDateRange(fecha)) return false;

      if (filters.tipos.length && !filters.tipos.includes(String(m.tipo))) return false;
      if (filters.turnos.length && !filters.turnos.includes((m as any).turno)) return false;

      if (filters.hielos.length) {
        const tipoH = (m as any).tipoHielo;
        const items = Array.isArray((m as any).items) ? (m as any).items : [];

        const matchDirect = tipoH && filters.hielos.includes(tipoH);
        const matchItems = items.some((it: any) => it?.tipoHielo && filters.hielos.includes(it.tipoHielo));

        if (!matchDirect && !matchItems) return false;
      }

      if (filters.origin !== 'TODOS') {
        const origen = getOrigenMov(m);
        if (filters.origin === 'ADMIN' && origen !== 'ADMIN') return false;
        if (filters.origin === 'PRODUCCION' && origen !== 'PRODUCCION') return false;
      }

      if (filters.maquina !== 'TODAS') {
        const maq = String((m as any).maquina ?? '').toUpperCase();
        if (maq !== String(filters.maquina).toUpperCase()) return false;
      }

      if (filters.ubicacion !== 'TODAS') {
        const ub = String((m as any).ubicacion ?? '').toUpperCase();
        if (ub !== String(filters.ubicacion).toUpperCase()) return false;
      }

      if (!q) return true;

      const meta = getMovimientoMetaSafe(String(m.tipo));

      const itemsText = Array.isArray((m as any).items)
        ? (m as any).items
            .map((it: any) =>
              [
                it?.productoCodigo,
                it?.productoNombre,
                it?.bolsaVaciaCodigo,
                it?.tipoHielo,
                it?.cantidad,
                it?.delta,
              ]
                .map((x) => String(x ?? ''))
                .join(' ')
            )
            .join(' | ')
        : '';

      return [
        (m as any).codigo,
        (m as any).tipo,
        meta?.texto,
        (m as any).productoNombre,
        (m as any).productoCodigo,
        (m as any).tipoProducto,
        (m as any).tipoHielo ?? '',
        (m as any).turno,
        (m as any).usuarioNombre,
        (m as any).usuarioCodigo,
        (m as any).empleadoNombre ?? '',
        (m as any).empleadoCodigo ?? '',
        (m as any).empleadoAsignadoNombre ?? '',
        (m as any).empleadoAsignadoCodigo ?? '',
        (m as any).clienteNombre ?? '',
        (m as any).motivo ?? '',
        (m as any).destinatario ?? '',
        (m as any).observaciones ?? '',
        (m as any).maquina ?? '',
        (m as any).ubicacion ?? '',
        itemsText,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, filters]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const hoy = new Date();

    const movimientosHoy = filtered.filter((m: any) => {
      const fecha = toDateSafe(m.fecha);
      return fecha.toDateString() === hoy.toDateString();
    });

    const porTipo = filtered.reduce<Record<string, number>>((acc, m: any) => {
      const t = String(m.tipo ?? '—');
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});

    const ultimaHora = filtered.filter((m: any) => {
      const fecha = toDateSafe(m.fecha);
      const unaHoraAtras = new Date(Date.now() - 60 * 60 * 1000);
      return fecha > unaHoraAtras;
    }).length;

    const salidasSinUsuario = filtered.filter((m: any) => {
      const actor = getActor(m);
      return isSalidaMovimiento(m?.tipo) && actor.missing;
    }).length;

    return {
      total,
      porTipo,
      hoy: movimientosHoy.length,
      ultimaHora,
      salidasSinUsuario,
    };
  }, [filtered]);

  const hasAnyFilter =
    !!filters.q ||
    filters.tipos.length > 0 ||
    filters.turnos.length > 0 ||
    filters.hielos.length > 0 ||
    filters.origin !== 'TODOS' ||
    !!filters.from ||
    !!filters.to ||
    filters.maquina !== 'TODAS' ||
    filters.ubicacion !== 'TODAS';

  const toggleTipo = (t: string) => {
    setFilters((p) => {
      const has = p.tipos.includes(t);
      return { ...p, tipos: has ? p.tipos.filter((x) => x !== t) : [...p.tipos, t] };
    });
  };

  const toggleTurno = (t: TurnoType) => {
    setFilters((p) => {
      const has = p.turnos.includes(t);
      return { ...p, turnos: has ? p.turnos.filter((x) => x !== t) : [...p.turnos, t] };
    });
  };

  const toggleHielo = (t: IceType) => {
    setFilters((p) => {
      const has = p.hielos.includes(t);
      return { ...p, hielos: has ? p.hielos.filter((x) => x !== t) : [...p.hielos, t] };
    });
  };

  const setMaquina = (m: MaquinaFilter) => setFilters((p) => ({ ...p, maquina: m }));
  const setUbicacion = (u: UbicacionFilter) => setFilters((p) => ({ ...p, ubicacion: u }));

  const clearFilters = () => {
    setFilters({
      q: '',
      tipos: [],
      turnos: [],
      hielos: [],
      origin: 'TODOS',
      from: undefined,
      to: undefined,
      maquina: 'TODAS',
      ubicacion: 'TODAS',
    });
  };

  const deleteMovimiento = useCallback(async (id?: string) => {
    if (!id) return;
    const ok = window.confirm('¿Eliminar este movimiento? Esto lo borra de Firestore.');
    if (!ok) return;
    await deleteDoc(doc(db, COLECCION_MOVIMIENTOS, id));
  }, []);

  const limpiar4Semanas = useCallback(async () => {
    const ok = window.confirm('¿Eliminar movimientos con más de 28 días?');
    if (!ok) return;

    setLoading(true);
    setError(null);

    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 28);
      const cutoffTs = Timestamp.fromDate(cutoff);

      while (true) {
        const qy = query(movimientosCol, where('fecha', '<', cutoffTs), orderBy('fecha', 'asc'), qLimit(450));
        const snap = await getDocs(qy);
        if (snap.empty) break;

        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();

        if (snap.size < 450) break;
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error limpiando movimientos');
    } finally {
      setLoading(false);
    }
  }, []);

  const camaraFriaPorProducto = useMemo<CamaraProducto[]>(() => {
    return (stockLlenoPorProducto ?? [])
      .map((p: any) => {
        const bv = (bolsasVacias ?? []).find((x: any) => String(x.codigo) === String(p.bolsaVaciaCodigo));
        const pesoKg = p.pesoKg ?? bv?.pesoKg ?? guessKgFromName(p.productoNombre);

        const tipos: CamaraTipo[] = (p.tipos ?? [])
          .filter((t: any) => TIPOS_HIELO.includes(t.tipoHielo))
          .map((t: any) => ({
            tipoHielo: t.tipoHielo,
            stockActual: safeNum(t.stockActual, 0),
          }))
          .sort((a: any, b: any) => String(a.tipoHielo).localeCompare(String(b.tipoHielo)));

        const total = tipos.reduce((acc: number, t: any) => acc + safeNum(t.stockActual, 0), 0);

        return {
          codigo: String(p.bolsaVaciaCodigo ?? ''),
          nombre: String(p.productoNombre ?? bv?.nombre ?? ''),
          pesoKg,
          tipos,
          total,
        };
      })
      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  }, [stockLlenoPorProducto, bolsasVacias]);

  const reloadAll = async () => {
    await Promise.allSettled([load(), Promise.resolve().then(() => reloadProducts())]);
  };

  const verDetalleMovimiento = (m: any) => setSelectedMovimiento(m);

  const sessionLabel = adminSession ? 'ADMIN' : productionSession ? 'PRODUCCIÓN' : '—';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-950 to-black p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
          <div className="flex items-start gap-4">
            <button
              onClick={() => router.back()}
              disabled={loading || productsLoading}
              className="p-3 bg-gradient-to-br from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 rounded-xl text-gray-400 hover:text-white disabled:opacity-50 transition-all duration-300 hover:scale-105 mt-1"
              title="Volver"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="p-3 rounded-xl bg-gradient-to-r from-cyan-900/60 via-blue-800/60 to-purple-900/60 backdrop-blur-sm border border-cyan-800/30 shadow-lg">
              <Monitor className="h-10 w-10 text-cyan-300" />
            </div>

            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-bold text-white bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  Sistema de Monitoreo
                </h1>
                <Pill tone={adminSession ? 'blue' : productionSession ? 'purple' : 'gray'} size="sm">
                  {sessionLabel}
                </Pill>
                <Pill tone={realtimeActive ? 'emerald' : 'gray'} size="sm" icon={realtimeActive ? RadioTower : Radio}>
                  {realtimeActive ? 'Realtime' : 'Manual'}
                </Pill>
              </div>

              <p className="text-gray-400 text-sm mt-2 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Monitoreo de movimientos e inventario
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => router.push('/admin/dashboard/inventario')}
                  className="px-3 py-2 bg-white/5 text-white/80 rounded-xl ring-1 ring-white/10 hover:bg-white/10 transition"
                >
                  <Warehouse className="h-4 w-4 inline mr-2" />
                  Inventario
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/admin/dashboard/mermas')}
                  className="px-3 py-2 bg-white/5 text-white/80 rounded-xl ring-1 ring-white/10 hover:bg-white/10 transition"
                >
                  <AlertTriangle className="h-4 w-4 inline mr-2" />
                  Mermas
                </button>
              </div>

              {error && (
                <div className="mt-3 text-sm text-red-300 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={reloadAll}
              disabled={loading || productsLoading}
              className="px-4 py-3 bg-gradient-to-br from-gray-800 to-gray-900 text-gray-300 hover:text-white rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 flex items-center gap-2 disabled:opacity-50 transition-all duration-300"
              title="Recargar datos"
            >
              <RefreshCw className={`h-5 w-5 ${loading || productsLoading ? 'animate-spin' : ''}`} />
              Recargar
            </button>

            <button
              onClick={() => setRealtimeActive((v) => !v)}
              className={cn(
                'px-4 py-3 rounded-xl font-medium border transition-all duration-300 flex items-center gap-2',
                realtimeActive
                  ? 'bg-emerald-900/20 border-emerald-700/30 text-emerald-300 hover:bg-emerald-900/30'
                  : 'bg-gray-900/60 border-gray-700/40 text-gray-300 hover:bg-gray-800/60 hover:text-white'
              )}
              title="Alternar modo realtime"
            >
              {realtimeActive ? <RadioTower className="h-5 w-5" /> : <Radio className="h-5 w-5" />}
              {realtimeActive ? 'Realtime ON' : 'Realtime OFF'}
            </button>

            {!showCamaraFria && (
              <button
                onClick={() => setShowCamaraFria(true)}
                className="px-4 py-3 bg-cyan-900/20 border border-cyan-700/30 text-cyan-300 rounded-xl hover:bg-cyan-900/30 transition-all duration-300 flex items-center gap-2"
                title="Mostrar cámara fría"
              >
                <Warehouse className="h-5 w-5" />
                Cámara fría
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          <StatCard
            title="Total Movimientos"
            value={stats.total}
            subtitle="Filtrados"
            icon={ClipboardList}
            color="from-blue-900/40 to-blue-800/30"
          />
          <StatCard
            title="Movimientos Hoy"
            value={stats.hoy}
            subtitle="Actividad diaria"
            icon={Activity}
            color="from-green-900/40 to-green-800/30"
          />
          <StatCard
            title="Última Hora"
            value={stats.ultimaHora}
            subtitle="Actividad reciente"
            icon={Zap}
            color="from-amber-900/40 to-amber-800/30"
          />
          <StatCard
            title="Bolsas Llenas"
            value={safeNum(stockLlenoTotalGeneral, 0)}
            subtitle="En cámara fría"
            icon={Package}
            color="from-purple-900/40 to-purple-800/30"
          />
          <StatCard
            title="Tipos Activos"
            value={Object.keys(stats.porTipo).length}
            subtitle="Diversidad operativa"
            icon={BarChart}
            color="from-cyan-900/40 to-cyan-800/30"
          />
          <StatCard
            title="Salidas sin usuario"
            value={stats.salidasSinUsuario}
            subtitle="VENTA / MERMA / DEVOLUCIÓN"
            icon={AlertTriangle}
            color="from-red-900/40 to-red-800/30"
          />
        </div>

        {/* Panel Cámara Fría */}
        {showCamaraFria && (
          <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-6 mb-8 border border-gray-700/50 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-cyan-900/40 to-cyan-800/30 rounded-lg">
                  <Warehouse className="h-6 w-6 text-cyan-300" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Cámara Fría - Inventario Actual</h2>
                  <p className="text-sm text-gray-400 mt-1">Stock de bolsas llenas por tipo de hielo</p>
                </div>
              </div>
              <button
                onClick={() => setShowCamaraFria(false)}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800/50 rounded-lg transition-all duration-300"
                title="Ocultar"
              >
                <ChevronUp className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <div className="bg-gradient-to-br from-blue-900/30 to-blue-800/20 rounded-xl p-4 border border-blue-700/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-blue-300">Total Bolsas</p>
                    <p className="mt-2 text-2xl font-bold text-white">
                      {safeNum(stockLlenoTotalGeneral, 0).toLocaleString('es-MX')}
                    </p>
                  </div>
                  <Package className="h-5 w-5 text-blue-300" />
                </div>
              </div>

              {TIPOS_HIELO.map((t) => {
                const val = safeNum((stockLlenoTotalPorTipo as any)?.[t], 0);
                const isBarra = t === 'BARRA';
                return (
                  <div
                    key={t}
                    className="bg-gradient-to-br from-gray-900/30 to-gray-800/20 rounded-xl p-4 border border-gray-700/30"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-300">{ETIQUETAS_TIPO_HIELO[t]}</p>
                        <p className="mt-2 text-xl font-bold text-white">{val.toLocaleString('es-MX')}</p>
                      </div>
                      {isBarra ? (
                        <Cuboid className="h-5 w-5 text-purple-300" />
                      ) : (
                        <Snowflake className="h-5 w-5 text-blue-300" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {productsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-cyan-500 mx-auto mb-3" />
                  <p className="text-gray-400">Cargando inventario de cámara fría...</p>
                </div>
              </div>
            ) : !camaraFriaPorProducto.length ? (
              <div className="text-center py-8">
                <ThermometerSnowflake className="h-16 w-16 text-gray-700 mx-auto mb-4 opacity-50" />
                <p className="text-gray-400">No hay productos en cámara fría</p>
              </div>
            ) : (
              <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-700/30">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-medium text-gray-300">Productos en Cámara Fría</p>
                  <Pill tone="cyan">
                    <Database className="h-3.5 w-3.5 mr-1.5" />
                    {camaraFriaPorProducto.length} productos
                  </Pill>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {camaraFriaPorProducto.slice(0, 6).map((p) => (
                    <div
                      key={p.codigo}
                      className="bg-gradient-to-br from-gray-900/40 to-gray-800/30 rounded-xl p-4 border border-gray-700/30"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <p className="font-medium text-white truncate">{p.nombre}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {p.codigo} · {p.pesoKg ?? '—'}kg
                          </p>
                        </div>
                        <span className="px-2.5 py-1 bg-gradient-to-r from-cyan-900/30 to-cyan-800/20 text-cyan-300 text-xs rounded-full">
                          {p.total} total
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {p.tipos.map((t) => (
                          <div key={t.tipoHielo} className="flex items-center bg-gray-900/50 rounded-lg px-3 py-1.5">
                            <IceTypeBadge tipo={t.tipoHielo} size="sm" showIcon={false} />
                            <span className="ml-2 text-white font-bold">{t.stockActual}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {camaraFriaPorProducto.length > 6 && (
                  <div className="mt-4 text-center">
                    <button
                      onClick={() => reloadProducts()}
                      className="text-cyan-400 hover:text-cyan-300 text-sm flex items-center justify-center gap-2 mx-auto"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Ver todos los productos ({camaraFriaPorProducto.length})
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Filtros */}
        <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-6 mb-8 border border-gray-700/50 shadow-xl">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-blue-900/40 to-blue-800/30 rounded-lg">
                  <Filter className="h-5 w-5 text-blue-300" />
                </div>
                Filtros de Movimientos
              </h3>
              <p className="text-sm text-gray-400 mt-1">Filtra los movimientos por diferentes criterios</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`px-4 py-2.5 bg-gray-900/70 border rounded-xl flex items-center gap-2 transition-all duration-300 ${
                  showFilters
                    ? 'border-blue-500 bg-gradient-to-r from-blue-900/20 to-blue-800/10 text-blue-300'
                    : 'border-gray-700/50 text-gray-400 hover:text-white hover:border-gray-600'
                }`}
              >
                <Filter className="h-4 w-4" />
                {showFilters ? 'Ocultar' : 'Mostrar'}
              </button>

              {hasAnyFilter && (
                <button
                  onClick={clearFilters}
                  className="px-4 py-2.5 bg-gradient-to-r from-gray-800 to-gray-900 text-gray-300 rounded-xl hover:from-gray-700 hover:to-gray-800 hover:text-white transition-all duration-300"
                >
                  <X className="h-4 w-4 mr-2 inline" />
                  Limpiar
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
            <div className="lg:col-span-2">
              <div className="relative group">
                <Search className="absolute left-4 top-3.5 h-5 w-5 text-gray-500 group-focus-within:text-blue-500 transition-colors" />
                <input
                  value={filters.q}
                  onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
                  placeholder="Buscar movimientos, productos, usuarios..."
                  disabled={loading}
                  className="w-full pl-12 pr-10 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm transition-all duration-300"
                />
                {filters.q && (
                  <button
                    onClick={() => setFilters((p) => ({ ...p, q: '' }))}
                    className="absolute right-3 top-3.5 text-gray-500 hover:text-gray-400"
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <select
                value={filters.origin}
                onChange={(e) => setFilters((p) => ({ ...p, origin: e.target.value as OriginFilter }))}
                disabled={loading}
                className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
              >
                <option value="TODOS">📍 Todos los orígenes</option>
                <option value="ADMIN">👨‍💼 Solo Admin</option>
                <option value="PRODUCCION">🏭 Solo Producción</option>
              </select>
            </div>

            <div>
              <select
                value={filters.ubicacion}
                onChange={(e) => setUbicacion(e.target.value as UbicacionFilter)}
                disabled={loading}
                className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
              >
                <option value="TODAS">📦 Todas las ubicaciones</option>
                {allUbicaciones.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 lg:col-span-2">
              <button
                onClick={limpiar4Semanas}
                disabled={loading}
                className="px-4 py-3.5 bg-gradient-to-r from-red-900/20 to-red-800/10 text-red-400 border border-red-700/30 rounded-xl hover:from-red-800/20 hover:to-red-700/10 hover:text-red-300 transition-all duration-300 flex-1 disabled:opacity-50"
                title="Limpiar movimientos antiguos"
                type="button"
              >
                <Eraser className="h-5 w-5" />
              </button>

              <div className="bg-gradient-to-r from-gray-900/50 to-gray-800/40 rounded-xl px-4 py-3.5 flex items-center justify-center backdrop-blur-sm">
                <div className="text-center">
                  <div className="text-lg font-bold text-white">{filtered.length}</div>
                  <div className="text-xs text-gray-400">filtrados</div>
                </div>
              </div>
            </div>
          </div>

          {showFilters && (
            <div className="mt-6 p-5 bg-gray-900/30 rounded-xl border border-gray-700/30 animate-in fade-in duration-300">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Rango de Fechas</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <input
                        type="date"
                        value={filters.from ? new Date(filters.from).toISOString().slice(0, 10) : ''}
                        onChange={(e) =>
                          setFilters((p) => ({
                            ...p,
                            from: e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined,
                          }))
                        }
                        className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <input
                        type="date"
                        value={filters.to ? new Date(filters.to).toISOString().slice(0, 10) : ''}
                        onChange={(e) =>
                          setFilters((p) => ({
                            ...p,
                            to: e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined,
                          }))
                        }
                        className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Tipo de Movimiento</label>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1">
                    {allTipos.map((t) => {
                      const meta = getMovimientoMetaSafe(t);
                      const active = filters.tipos.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() => toggleTipo(t)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                            active
                              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-900/30'
                              : 'bg-gray-900/50 text-gray-400 hover:bg-gray-800/70 hover:text-gray-300'
                          }`}
                          title={t}
                          type="button"
                        >
                          {meta.texto}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Tipo de Hielo</label>
                  <div className="flex flex-wrap gap-2">
                    {allHielos.map((h) => {
                      const active = filters.hielos.includes(h);
                      return (
                        <button
                          key={h}
                          onClick={() => toggleHielo(h)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                            active
                              ? 'bg-gradient-to-r from-cyan-600 to-cyan-700 text-white shadow-lg shadow-cyan-900/30'
                              : 'bg-gray-900/50 text-gray-400 hover:bg-gray-800/70 hover:text-gray-300'
                          }`}
                          type="button"
                        >
                          {ETIQUETAS_TIPO_HIELO[h] ?? h}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Turno</label>
                  <div className="grid grid-cols-3 gap-2">
                    {allTurnos.map((t) => {
                      const active = filters.turnos.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() => toggleTurno(t)}
                          className={`py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                            active
                              ? 'bg-gradient-to-r from-amber-600 to-amber-700 text-white shadow-lg shadow-amber-900/30'
                              : 'bg-gray-900/50 text-gray-400 hover:bg-gray-800/70 hover:text-gray-300'
                          }`}
                          type="button"
                        >
                          {t === 'MATUTINO' ? '🌅 Matutino' : t === 'VESPERTINO' ? '🌇 Vespertino' : '🌙 Nocturno'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Máquina</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setMaquina('TODAS')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                        filters.maquina === 'TODAS'
                          ? 'bg-gradient-to-r from-gray-600 to-gray-700 text-white shadow-lg shadow-gray-900/30'
                          : 'bg-gray-900/50 text-gray-400 hover:bg-gray-800/70 hover:text-gray-300'
                      }`}
                      type="button"
                    >
                      Todas
                    </button>
                    {allMaquinas.map((m) => {
                      const active = String(filters.maquina).toUpperCase() === String(m).toUpperCase();
                      return (
                        <button
                          key={m}
                          onClick={() => setMaquina(m)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                            active
                              ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg shadow-purple-900/30'
                              : 'bg-gray-900/50 text-gray-400 hover:bg-gray-800/70 hover:text-gray-300'
                          }`}
                          type="button"
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tabla Movimientos */}
        <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl overflow-hidden border border-gray-700/50 shadow-xl">
          <div className="px-6 py-5 border-b border-gray-700/50 bg-gradient-to-r from-gray-900/60 to-gray-800/40">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                  <div className="p-2.5 bg-gradient-to-br from-emerald-900/40 to-emerald-800/30 rounded-lg">
                    <Activity className="h-6 w-6 text-emerald-300" />
                  </div>
                  Movimientos
                </h2>
                <p className="text-gray-400 text-sm mt-1">Monitoreo completo de transacciones</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="bg-gray-900/50 backdrop-blur-sm rounded-lg px-4 py-2">
                  <span className="text-sm text-gray-300">
                    Mostrando: <span className="font-bold text-white">{filtered.length}</span> de{' '}
                    <span className="font-bold">{rows.length}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="relative">
                  <div className="h-16 w-16 rounded-full border-4 border-gray-800 border-t-blue-500 animate-spin mx-auto" />
                  <Loader2 className="h-14 w-14 animate-spin text-blue-500 mx-auto absolute top-1 left-1" />
                </div>
                <p className="mt-6 text-gray-400 font-medium text-lg">Cargando movimientos...</p>
                <p className="text-sm text-gray-600 mt-2">Sincronizando con Firestore</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="max-w-md mx-auto">
                <div className="relative">
                  <ClipboardList className="h-24 w-24 text-gray-700 mx-auto mb-4 opacity-50" />
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-800/20 to-transparent rounded-full" />
                </div>
                <h3 className="text-xl font-bold text-gray-300 mb-2">No se encontraron movimientos</h3>
                <p className="text-gray-500 mb-6">
                  {hasAnyFilter ? 'No hay movimientos que coincidan con los filtros actuales' : 'Esperando actividad del sistema...'}
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={reloadAll}
                    className="px-5 py-2.5 bg-gradient-to-r from-gray-800 to-gray-900 text-gray-300 rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 hover:text-white transition-all duration-300"
                    type="button"
                  >
                    <RefreshCw className="h-4 w-4 mr-2 inline" />
                    Recargar
                  </button>
                  {hasAnyFilter && (
                    <button
                      onClick={clearFilters}
                      className="px-5 py-2.5 bg-gradient-to-r from-blue-700/80 to-blue-800/80 text-white rounded-xl font-medium hover:from-blue-800 hover:to-blue-900 transition-all duration-300"
                      type="button"
                    >
                      <X className="h-4 w-4 mr-2 inline" />
                      Limpiar Filtros
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700/30">
                <thead className="bg-gray-900/50 backdrop-blur-sm">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Fecha</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Movimiento</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Producto</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Cantidad</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Hielo</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Usuario</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/20">
                  {filtered.map((m: any) => {
                    const meta = getMovimientoMetaSafe(String(m.tipo));
                    const fecha = toDateSafe(m.fecha);

                    const cantidad = getCantidadMovimiento(m);
                    const deltaSign = getDeltaSign(m);

                    const actor = getActor(m);
                    const esSalida = isSalidaMovimiento(m.tipo);
                    const faltaActorEnSalida = esSalida && actor.missing;

                    const isBatch = Array.isArray(m.items) && m.items.length;
                    const productoTitle = isBatch
                      ? `Batch (${m.batchCount ?? m.items.length} items)`
                      : (m.productoNombre ?? '—');
                    const productoCodigo = isBatch ? '—' : (m.productoCodigo ?? '—');

                    const tipoHielo = !isBatch && m.tipoHielo ? (m.tipoHielo as IceType) : undefined;

                    return (
                      <tr
                        key={m.id ?? m.codigo}
                        className={cn(
                          'transition-all duration-200',
                          faltaActorEnSalida ? 'bg-red-900/10 hover:bg-red-900/15' : 'hover:bg-gray-800/30'
                        )}
                      >
                        <td className="px-6 py-5">
                          <div className="text-sm text-white">{fmtDate(fecha)}</div>
                          <div className="text-xs text-gray-400">{m.turno ?? '—'}</div>
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <Pill
                              tone={
                                String(m.tipo ?? '').toUpperCase().includes('VENTA')
                                  ? 'green'
                                  : String(m.tipo ?? '').toUpperCase().includes('MERMA')
                                  ? 'red'
                                  : String(m.tipo ?? '').toUpperCase().includes('CREACION')
                                  ? 'blue'
                                  : String(m.tipo ?? '').toUpperCase().includes('LLENADO')
                                  ? 'purple'
                                  : String(m.tipo ?? '').toUpperCase().includes('SALIDA')
                                  ? 'amber'
                                  : 'gray'
                              }
                            >
                              {meta.texto}
                            </Pill>
                            <div className="text-xs text-gray-400 mt-1">{String(m.tipo ?? '')}</div>
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <span className="font-medium text-white">{productoTitle}</span>
                            <span className="text-xs text-gray-400">{productoCodigo}</span>
                            {isBatch ? (
                              <span className="text-[11px] text-gray-500 mt-1">
                                items: {m.items.length}
                              </span>
                            ) : null}
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <div className={`text-2xl font-bold ${deltaSign < 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {cantidad.toLocaleString('es-MX')}
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          {tipoHielo ? (
                            <IceTypeBadge tipo={tipoHielo} size="sm" />
                          ) : (
                            <span className="text-gray-400">{isBatch ? '— (batch)' : '—'}</span>
                          )}
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            <User className={cn('h-4 w-4', faltaActorEnSalida ? 'text-red-300' : 'text-gray-400')} />
                            {faltaActorEnSalida ? (
                              <Pill tone="red" size="sm">
                                ⚠ SIN USUARIO
                              </Pill>
                            ) : (
                              <span className="text-sm text-white">
                                {actor.label}
                                {actor.codigo && actor.codigo !== actor.label ? (
                                  <span className="text-gray-400"> ({actor.codigo})</span>
                                ) : null}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex gap-2">
                            <button
                              onClick={() => verDetalleMovimiento(m)}
                              className="p-2.5 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-xl transition-all duration-300 hover:scale-110"
                              title="Ver detalle"
                              type="button"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => deleteMovimiento(m.id)}
                              className="p-2.5 text-red-400 hover:text-red-300 hover:bg-red-900/40 rounded-xl transition-all duration-300 hover:scale-110"
                              title="Eliminar movimiento"
                              type="button"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-gray-800/50">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/admin/dashboard')}
                disabled={loading}
                className="px-5 py-2.5 bg-gradient-to-r from-gray-800 to-gray-900 text-gray-300 rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 hover:text-white disabled:opacity-50 flex items-center transition-all duration-300"
                type="button"
              >
                <ArrowLeft className="h-5 w-5 mr-2" />
                Volver al Panel
              </button>
            </div>

            {!showCamaraFria && (
              <button
                onClick={() => setShowCamaraFria(true)}
                className="px-5 py-2.5 bg-cyan-900/20 border border-cyan-700/30 text-cyan-300 rounded-xl hover:bg-cyan-900/30 transition-all duration-300 flex items-center gap-2"
                type="button"
              >
                <ChevronDown className="h-5 w-5" />
                Mostrar cámara fría
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ✅ MODAL DETALLE (SCROLL FIX + SOPORTA SALIDA_BOLSA BATCH) */}
      {selectedMovimiento && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="h-full w-full overflow-y-auto p-4">
            <div className="min-h-full flex items-start justify-center py-6">
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl w-full max-w-2xl border border-gray-700/50 shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-gray-700/50 sticky top-0 bg-gradient-to-br from-gray-800 to-gray-900 z-10">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-gradient-to-br from-blue-900/40 to-blue-800/30 rounded-lg">
                        <Eye className="h-6 w-6 text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white">Detalle de Movimiento</h3>
                        <p className="text-sm text-gray-400 mt-1">{(selectedMovimiento as any).codigo ?? selectedMovimiento.id}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedMovimiento(null)}
                      className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-all duration-300"
                      title="Cerrar"
                      type="button"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="p-6 max-h-[75vh] overflow-y-auto overscroll-contain">
                  {(() => {
                    const mov = selectedMovimiento as any;
                    const actor = getActor(mov);
                    const esSalida = isSalidaMovimiento(mov?.tipo);
                    const faltaActorEnSalida = esSalida && actor.missing;

                    const meta = getMovimientoMetaSafe(String(mov.tipo));
                    const fecha = fmtDate(toDateSafe(mov.fecha));
                    const cant = getCantidadMovimiento(mov).toLocaleString('es-MX');
                    const deltaSign = getDeltaSign(mov);

                    const isBatch = Array.isArray(mov.items) && mov.items.length;

                    return (
                      <>
                        {faltaActorEnSalida && (
                          <div className="mb-6 bg-red-900/20 border border-red-700/30 rounded-xl p-4">
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="h-5 w-5 text-red-300 mt-0.5" />
                              <div>
                                <div className="text-red-200 font-semibold">FALTA “QUIÉN REGISTRÓ”</div>
                                <div className="text-sm text-red-200/80 mt-1">
                                  Este movimiento es una salida (venta/merma/devolución/salida bolsa) y llegó sin usuario/empleado.
                                  Debe validarse al momento de guardar el movimiento.
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-4 mb-6">
                          <div className="bg-gray-900/30 p-4 rounded-xl">
                            <div className="text-xs text-gray-400 uppercase">Tipo de Movimiento</div>
                            <div className="mt-2">
                              <Pill tone="blue">{meta.texto}</Pill>
                            </div>
                            <div className="text-sm text-gray-400 mt-1">{String(mov.tipo ?? '')}</div>
                          </div>

                          <div className="bg-gray-900/30 p-4 rounded-xl">
                            <div className="text-xs text-gray-400 uppercase">Fecha</div>
                            <div className="mt-2 text-white font-medium">{fecha}</div>
                            <div className="text-sm text-gray-400 mt-1">Turno: {mov.turno || '—'}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-6">
                          <div className="bg-gray-900/30 p-4 rounded-xl">
                            <div className="text-xs text-gray-400 uppercase">Producto</div>
                            <div className="mt-2 text-white font-medium">
                              {isBatch ? `Batch (${mov.batchCount ?? mov.items.length} items)` : (mov.productoNombre ?? '—')}
                            </div>
                            <div className="text-sm text-gray-400 mt-1">{isBatch ? '—' : (mov.productoCodigo ?? '—')}</div>
                          </div>

                          <div className="bg-gray-900/30 p-4 rounded-xl">
                            <div className="text-xs text-gray-400 uppercase">Cantidad</div>
                            <div className={`mt-2 text-2xl font-bold ${deltaSign < 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {cant}
                            </div>
                          </div>
                        </div>

                        {mov.tipoHielo && !isBatch && (
                          <div className="mb-6 bg-gray-900/30 p-4 rounded-xl">
                            <div className="text-xs text-gray-400 uppercase mb-2">Tipo de Hielo</div>
                            <IceTypeBadge tipo={mov.tipoHielo as IceType} />
                          </div>
                        )}

                        {isBatch && (
                          <div className="mb-6 bg-gray-900/30 p-4 rounded-xl">
                            <div className="text-xs text-gray-400 uppercase mb-2">Items (batch)</div>
                            <div className="space-y-2">
                              {mov.items.slice(0, 12).map((it: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between gap-4 bg-gray-950/30 border border-gray-700/30 rounded-lg px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm text-white truncate">{it.productoNombre ?? 'Bolsa llena'}</div>
                                    <div className="text-xs text-gray-400 font-mono">
                                      {it.productoCodigo ?? it.bolsaVaciaCodigo ?? '—'} · {String(it.tipoHielo ?? '—')}
                                    </div>
                                  </div>
                                  <div className="text-sm font-bold text-red-300">
                                    -{Math.abs(Number(it.cantidad ?? it.delta ?? 0))}
                                  </div>
                                </div>
                              ))}
                              {mov.items.length > 12 ? (
                                <div className="text-xs text-gray-400">… y {mov.items.length - 12} más</div>
                              ) : null}
                            </div>
                          </div>
                        )}

                        <div className="bg-gray-900/30 p-4 rounded-xl mb-6">
                          <div className="text-xs text-gray-400 uppercase mb-2">Información Adicional</div>
                          <div className="space-y-2">
                            <div className="flex justify-between gap-4">
                              <span className="text-sm text-gray-400">Registró:</span>
                              <span className={cn('text-right', faltaActorEnSalida ? 'text-red-200 font-semibold' : 'text-white')}>
                                {actor.label}
                                {actor.codigo && actor.codigo !== actor.label ? (
                                  <span className="text-gray-400"> ({actor.codigo})</span>
                                ) : null}
                              </span>
                            </div>

                            <div className="flex justify-between gap-4">
                              <span className="text-sm text-gray-400">Máquina:</span>
                              <span className="text-white text-right">{mov.maquina || '—'}</span>
                            </div>

                            <div className="flex justify-between gap-4">
                              <span className="text-sm text-gray-400">Ubicación:</span>
                              <span className="text-white text-right">{mov.ubicacion || '—'}</span>
                            </div>

                            {mov.clienteNombre ? (
                              <div className="flex justify-between gap-4">
                                <span className="text-sm text-gray-400">Cliente:</span>
                                <span className="text-white text-right">{String(mov.clienteNombre)}</span>
                              </div>
                            ) : null}

                            {mov.origen ? (
                              <div className="flex justify-between gap-4">
                                <span className="text-sm text-gray-400">Origen:</span>
                                <span className="text-white text-right">{String(mov.origen)}</span>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {(mov.observaciones || mov.motivo || mov.destinatario) && (
                          <div className="bg-gray-900/30 p-4 rounded-xl">
                            <div className="text-xs text-gray-400 uppercase mb-2">Observaciones / Motivo</div>
                            {mov.destinatario ? (
                              <div className="text-sm text-gray-300 mb-2">
                                Destinatario: <span className="text-white">{String(mov.destinatario)}</span>
                              </div>
                            ) : null}
                            <div className="text-white break-words">{mov.observaciones || mov.motivo || '—'}</div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}