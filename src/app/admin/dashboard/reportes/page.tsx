// app/admin/reportes/page.tsx
// ✅ FINAL (PROD) — FIX “Cámara Fría / Stock Lleno” usando agregados del hook
// ✅ FIX PRO: Cantidades de SALIDAS (y entradas) correctas aunque no venga deltaPrincipal/cantidad
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuthContext } from '@/context/AuthContext';
import { useProducts } from '@/lib/hooks/useProducts';
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
  X,
  BarChart3,
  Download,
  ClipboardList,
  History,
  Eye,
  TrendingUp,
  Users,
  Package,
  Snowflake,
  Cuboid,
  ChevronDown,
  ChevronUp,
  Printer,
  FileBarChart,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Database,
  Shield,
  BarChart,
  PieChart,
  Info,
  Warehouse,
} from 'lucide-react';

/* ============================================================
  ✅ CONFIG EMPRESA (edítalo a tu negocio)
============================================================ */
const EMPRESA = {
  nombre: 'Hielos (Tu Empresa)',
  razonSocial: 'Hielos (Razón Social)',
  rfc: 'RFC-XXXXXXX',
  direccion: 'Dirección: Calle, Colonia, Ciudad, Estado, CP',
  telefono: 'Tel: (XXX) XXX-XXXX',
  correo: 'Correo: ventas@tuempresa.com',
  sitio: 'Sitio: tuempresa.com',
  leyenda: 'Reporte interno — Uso exclusivo. Prohibida su reproducción sin autorización.',
};

/* ============================================================
  Helpers
============================================================ */
function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function toDateSafe(v: any): Date {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
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

function fmtDay(d: Date) {
  try {
    return d.toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8;') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function guessKgFromName(nombre?: string): number | undefined {
  if (!nombre) return undefined;
  const m = nombre.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(kg|kilo|kilos)\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function maxOf(arr: number[]) {
  let m = 1;
  for (const n of arr) if (n > m) m = n;
  return m;
}

function asInputDate(d?: Date) {
  if (!d) return '';
  const x = new Date(d);
  return x.toISOString().slice(0, 10);
}

/* ============================================================
  ✅ FIX TS7053 (IceType guard + label)
============================================================ */
function isIceType(v: unknown): v is IceType {
  return typeof v === 'string' && (TIPOS_HIELO as readonly string[]).includes(v);
}

function labelHielo(v: unknown) {
  return isIceType(v) ? ETIQUETAS_TIPO_HIELO[v] : '—';
}

/* ============================================================
  ✅ FIX PRO: Cantidad REAL (entradas/salidas) aunque no venga deltaPrincipal/cantidad
============================================================ */
function toNumberSafe(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n =
    typeof v === 'string'
      ? Number(String(v).trim().replace(',', '.'))
      : Number(v);
  return Number.isFinite(n) ? n : null;
}

function getMovimientoQty(m: any): number {
  // ⚠️ Pon aquí TODOS los campos reales que uses en tus docs de movimientos
  const candidates = [
    m.deltaPrincipal,
    m.cantidad,
    m.qty,
    m.cantidadBolsas,
    m.cantidadBolsa,
    m.cantidadBarra,
    m.cuartosUsados,
    m.cuartos,
    m.unidades,
    m.total,
  ];

  for (const c of candidates) {
    const n = toNumberSafe(c);
    if (n !== null) return n;
  }

  return 0;
}

function safeMeta(tipo: TipoMovimiento) {
  try {
    return getMovimientoMeta(tipo);
  } catch {
    return { texto: String(tipo), esEntrada: false };
  }
}

function getSignedQty(m: any): number {
  // 1) Si deltaPrincipal existe y ya trae signo, respétalo.
  const dp = toNumberSafe(m.deltaPrincipal);
  if (dp !== null) return dp;

  // 2) Si no, firmamos por meta (entrada/salida)
  const tipo = m.tipo as TipoMovimiento;
  const meta = safeMeta(tipo);
  const q = getMovimientoQty(m);

  return meta.esEntrada ? Math.abs(q) : -Math.abs(q);
}

/* ============================================================
  Query helpers
============================================================ */
function parseList(param: string | null): string[] {
  if (!param) return [];
  return param
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDateParam(p: string | null): Date | undefined {
  if (!p) return undefined;
  const d = new Date(p.includes('T') ? p : `${p}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toQSDate(d?: Date) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

/* ============================================================
  Types
============================================================ */
type OriginFilter = 'TODOS' | 'ADMIN' | 'PRODUCCION';

type FiltersState = {
  q: string;
  productoCodigo?: string;
  tipos: TipoMovimiento[];
  turnos: TurnoType[];
  hielos: IceType[];
  origin: OriginFilter;
  from?: Date;
  to?: Date;
};

/* ============================================================
  UI Components
============================================================ */
const StatCard = ({
  title,
  value,
  subtitle,
  icon: Icon,
  gradient,
  iconBg,
  trend,
  onClick,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  gradient: string;
  iconBg: string;
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
      className={cn(
        `bg-gradient-to-br ${gradient} rounded-2xl p-5 border border-gray-800/50 shadow-lg hover:shadow-xl transition-all duration-300`,
        onClick && 'cursor-pointer hover:-translate-y-1 hover:scale-[1.02]'
      )}
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
        <div className={cn('p-3 rounded-xl backdrop-blur-sm ml-4', iconBg)}>
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
  tone?: 'gray' | 'red' | 'green' | 'blue' | 'amber' | 'orange' | 'purple' | 'cyan' | 'emerald';
  icon?: React.ElementType;
  size?: 'sm' | 'md';
}) => {
  const toneClasses = {
    red: 'bg-gradient-to-r from-red-900/40 to-red-800/30 border-red-700/30 text-red-300',
    green: 'bg-gradient-to-r from-green-900/40 to-green-800/30 border-green-700/30 text-green-300',
    blue: 'bg-gradient-to-r from-blue-900/40 to-blue-800/30 border-blue-700/30 text-blue-300',
    amber: 'bg-gradient-to-r from-amber-900/40 to-amber-800/30 border-amber-700/30 text-amber-300',
    orange: 'bg-gradient-to-r from-orange-900/40 to-orange-800/30 border-orange-700/30 text-orange-300',
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

function getIceCfg(tipo: IceType): { color: string; icon: React.ElementType; label: string } {
  const map: Partial<Record<IceType, { color: string; icon: React.ElementType; label: string }>> = {
    BARRA: { color: 'bg-gradient-to-r from-purple-600 to-purple-700', icon: Cuboid, label: 'Barra' },
    ROLITO: { color: 'bg-gradient-to-r from-blue-800 to-blue-900', icon: Snowflake, label: 'Rolito' },
    FRAPPE: { color: 'bg-gradient-to-r from-pink-800 to-pink-900', icon: Snowflake, label: 'Frappé' },
    GOURMET: { color: 'bg-gradient-to-r from-sky-600 to-sky-700', icon: Snowflake, label: 'Gourmet' },
    ENFRIAR: { color: 'bg-gradient-to-r from-blue-600 to-blue-700', icon: Snowflake, label: 'Enfriar' },
  };

  return (
    map[tipo] ?? {
      color: 'bg-gradient-to-r from-gray-600 to-gray-700',
      icon: Snowflake,
      label: ETIQUETAS_TIPO_HIELO?.[tipo] ?? String(tipo),
    }
  );
}

const IceTypeBadge = ({
  tipo,
  size = 'md',
  showIcon = true,
}: {
  tipo: IceType;
  size?: 'sm' | 'md';
  showIcon?: boolean;
}) => {
  const cfg = getIceCfg(tipo);
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
  PDF Helpers (serio)
============================================================ */
function printAsPDF(title: string) {
  const prevTitle = document.title;
  document.title = title;
  window.print();
  setTimeout(() => {
    document.title = prevTitle;
  }, 250);
}

/* ============================================================
  Page
============================================================ */
export default function ReportesPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user, loading: authLoading, adminSession, productionSession } = useAuthContext();

  // ✅ Stock agregado desde hook
  const {
    loading: productsLoading,
    products,
    stockLlenoPorProducto,
    stockLlenoTotalPorTipo,
    stockLlenoTotalGeneral,
  } = useProducts() as any;

  const esAdmin = !!adminSession;
  const esProduccion = !!productionSession;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Movimiento[]>([]);
  const [showFilters, setShowFilters] = useState(true);
  const [showCharts, setShowCharts] = useState(true);
  const [selectedDateRange, setSelectedDateRange] = useState<'7dias' | '30dias' | 'custom'>('7dias');

  const printRef = useRef<HTMLDivElement | null>(null);

  const [filters, setFilters] = useState<FiltersState>(() => {
    const q = sp.get('q') ?? '';
    const origin = ((sp.get('origin') as OriginFilter) || 'TODOS') as OriginFilter;
    const from = parseDateParam(sp.get('from'));
    const to = parseDateParam(sp.get('to'));
    const tipos = parseList(sp.get('tipos')) as TipoMovimiento[];
    const turnos = parseList(sp.get('turnos')) as TurnoType[];
    const hielosRaw = parseList(sp.get('hielos'));
    const hielos = hielosRaw.filter((h) => isIceType(h)) as IceType[];
    const productoCodigo = sp.get('productoCodigo') || undefined;

    if (!from && !to) {
      const _to = new Date();
      const _from = new Date();
      _from.setDate(_from.getDate() - 7);
      return {
        q,
        productoCodigo,
        tipos,
        turnos,
        hielos,
        origin,
        from: startOfDay(_from),
        to: endOfDay(_to),
      };
    }

    return {
      q,
      productoCodigo,
      tipos,
      turnos,
      hielos,
      origin,
      from: from ? startOfDay(from) : undefined,
      to: to ? endOfDay(to) : undefined,
    };
  });

  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await TransactionService.obtenerMovimientos({ limit: 2500 });
      const normalized = (data ?? []).map((m: any) => ({
        ...m,
        fecha: toDateSafe(m.fecha),
      })) as Movimiento[];
      setRows(normalized);
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando movimientos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Mantener filtros en URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.origin && filters.origin !== 'TODOS') params.set('origin', filters.origin);
    if (filters.productoCodigo) params.set('productoCodigo', filters.productoCodigo);
    if (filters.from) params.set('from', toQSDate(filters.from));
    if (filters.to) params.set('to', toQSDate(filters.to));
    if (filters.tipos.length) params.set('tipos', filters.tipos.join(','));
    if (filters.turnos.length) params.set('turnos', filters.turnos.join(','));
    if (filters.hielos.length) params.set('hielos', filters.hielos.join(','));

    const qs = params.toString();
    const url = qs ? `/admin/reportes?${qs}` : `/admin/reportes`;
    window.history.replaceState(null, '', url);
  }, [filters]);

  const allTipos = useMemo(() => {
    const keys = Object.keys((TransactionService as any).obtenerUIInfo ?? {}).filter(Boolean) as TipoMovimiento[];
    return keys.length
      ? keys
      : ([
          'CREACION_BARRA',
          'CREACION_BOLSA_VACIA',
          'ASIGNACION_BOLSA',
          'LLENADO_BOLSA',
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
        ] as TipoMovimiento[]);
  }, []);

  const allTurnos = useMemo(() => (['MATUTINO', 'VESPERTINO', 'NOCTURNO'] as TurnoType[]), []);
  const allHielos = useMemo(() => (TIPOS_HIELO as unknown as IceType[]) ?? ([] as IceType[]), []);

  const productoOptions = useMemo(() => {
    const map = new Map<
      string,
      { codigo: string; nombre: string; tipoProducto?: any; status?: any; kg?: number; count: number }
    >();
    for (const m of rows as any[]) {
      const codigo = String(m?.productoCodigo ?? '').trim();
      if (!codigo) continue;
      const kg = guessKgFromName(m?.productoNombre);
      const prev = map.get(codigo);
      if (!prev) {
        map.set(codigo, {
          codigo,
          nombre: m?.productoNombre ?? codigo,
          tipoProducto: m?.tipoProducto,
          status: m?.status,
          kg,
          count: 1,
        });
      } else {
        prev.count += 1;
        if (!prev.kg && kg) prev.kg = kg;
        if (!prev.status && m?.status) prev.status = m?.status;
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();

    const inRange = (d: Date) => {
      const t = d.getTime();
      if (filters.from) {
        const f = startOfDay(filters.from).getTime();
        if (t < f) return false;
      }
      if (filters.to) {
        const tt = endOfDay(filters.to).getTime();
        if (t > tt) return false;
      }
      return true;
    };

    return (rows as any[]).filter((m) => {
      const fecha = toDateSafe(m.fecha);
      if (!inRange(fecha)) return false;

      const productoCodigo = String(m.productoCodigo ?? '').trim();
      if (filters.productoCodigo && productoCodigo !== filters.productoCodigo) return false;

      if (filters.tipos.length && !filters.tipos.includes(m.tipo)) return false;
      if (filters.turnos.length && !filters.turnos.includes(m.turno)) return false;

      if (filters.hielos.length) {
        const h = m.tipoHielo;
        if (!isIceType(h)) return false;
        if (!filters.hielos.includes(h)) return false;
      }

      if (filters.origin !== 'TODOS') {
        const o = String(m.origen ?? '').toUpperCase();
        const isAdminLike = o === 'ADMIN' || String(m.usuarioCodigo ?? '').toLowerCase() === 'admin';
        if (filters.origin === 'ADMIN' && !isAdminLike) return false;
        if (filters.origin === 'PRODUCCION' && isAdminLike) return false;
      }

      if (!q) return true;

      const tipo = m.tipo as TipoMovimiento;
      const meta = safeMeta(tipo);

      return [
        m.codigo,
        m.tipo,
        meta.texto,
        m.productoNombre,
        m.productoCodigo,
        m.tipoProducto,
        m.status ?? '',
        m.tipoHielo ?? '',
        m.turno,
        m.usuarioNombre,
        m.usuarioCodigo,
        m.empleadoAsignadoNombre ?? '',
        m.clienteNombre ?? '',
        m.motivo ?? '',
        m.destinatario ?? '',
        m.observaciones ?? '',
        m.maquina ?? '',
        m.ubicacion ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, filters]);

  const kpis = useMemo(() => {
    let total = filtered.length;
    let entradas = 0;
    let salidas = 0;
    let mermas = 0;
    let ventas = 0;
    let devoluciones = 0;
    let llenados = 0;
    let asignaciones = 0;
    let totalCantidadAbs = 0;

    for (const m of filtered as any[]) {
      const signed = getSignedQty(m);
      const qtyAbs = Math.abs(signed);

      totalCantidadAbs += qtyAbs;

      if (signed >= 0) entradas += qtyAbs;
      else salidas += qtyAbs;

      const tipo = m.tipo as TipoMovimiento;
      if (tipo === 'MERMA_BOLSA' || tipo === 'MERMA_BARRA') mermas += 1;
      if (tipo === 'VENTA_BOLSA' || tipo === 'VENTA_BARRA') ventas += 1;
      if (tipo === 'DEVOLUCION_BOLSA' || tipo === 'DEVOLUCION_BARRA') devoluciones += 1;
      if (tipo === 'LLENADO_BOLSA' || tipo === 'LLENADO_MANUAL') llenados += 1;
      if (tipo === 'ASIGNACION_BOLSA') asignaciones += 1;
    }

    return {
      total,
      entradas,
      salidas,
      mermas,
      ventas,
      devoluciones,
      llenados,
      asignaciones,
      totalCantidadAbs,
      promedioPorMovimiento: total > 0 ? totalCantidadAbs / total : 0,
    };
  }, [filtered]);

  const byTipo = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of filtered as any[]) {
      const t = m.tipo as TipoMovimiento;
      map[t] = (map[t] ?? 0) + 1;
    }
    return Object.entries(map)
      .map(([tipo, count]) => ({
        tipo: tipo as TipoMovimiento,
        label: safeMeta(tipo as TipoMovimiento).texto,
        value: count,
      }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  const byDia = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of filtered as any[]) {
      const d = startOfDay(toDateSafe(m.fecha));
      const key = d.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([key, count]) => ({ key, day: new Date(key + 'T00:00:00'), value: count }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [filtered]);

  const byHielo = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of filtered as any[]) {
      const h = m.tipoHielo;
      if (!isIceType(h)) continue;
      map[h] = (map[h] ?? 0) + 1;
    }
    return Object.entries(map)
      .map(([h, count]) => ({ hielo: h as IceType, label: labelHielo(h), value: count }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  const maxTipo = useMemo(() => maxOf(byTipo.map((x) => x.value)), [byTipo]);
  const maxDia = useMemo(() => maxOf(byDia.map((x) => x.value)), [byDia]);
  const maxHielo = useMemo(() => maxOf(byHielo.map((x) => x.value)), [byHielo]);

  const hasAnyFilter =
    !!filters.q ||
    !!filters.productoCodigo ||
    filters.tipos.length > 0 ||
    filters.turnos.length > 0 ||
    filters.hielos.length > 0 ||
    filters.origin !== 'TODOS' ||
    !!filters.from ||
    !!filters.to;

  const clearFilters = () => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);
    setFilters({
      q: '',
      productoCodigo: undefined,
      tipos: [],
      turnos: [],
      hielos: [],
      origin: 'TODOS',
      from: startOfDay(from),
      to: endOfDay(to),
    });
    setSelectedDateRange('7dias');
  };

  const toggleTipo = (t: TipoMovimiento) =>
    setFilters((p) => ({ ...p, tipos: p.tipos.includes(t) ? p.tipos.filter((x) => x !== t) : [...p.tipos, t] }));

  const toggleTurno = (t: TurnoType) =>
    setFilters((p) => ({ ...p, turnos: p.turnos.includes(t) ? p.turnos.filter((x) => x !== t) : [...p.turnos, t] }));

  const toggleHielo = (t: IceType) =>
    setFilters((p) => ({ ...p, hielos: p.hielos.includes(t) ? p.hielos.filter((x) => x !== t) : [...p.hielos, t] }));

  const printableTitle = useMemo(() => {
    const from = filters.from ? fmtDay(filters.from) : '—';
    const to = filters.to ? fmtDay(filters.to) : '—';
    return `Reporte de Movimientos (${from} → ${to})`;
  }, [filters.from, filters.to]);

  const onExportCSV = () => {
    const csv = TransactionService.exportarACSV(filtered as any);
    downloadTextFile(
      `reporte_movimientos_${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      'text/csv;charset=utf-8;'
    );
  };

  const onExportPDF = () => {
    printAsPDF(`${EMPRESA.nombre} - ${printableTitle}`);
  };

  const sparkPoints = useMemo(() => {
    const last = byDia.slice(-30);
    return last.map((p) => ({ xLabel: p.key.slice(5), value: p.value }));
  }, [byDia]);

  const goMonitoreo = () => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.origin !== 'TODOS') params.set('origin', filters.origin);
    if (filters.from) params.set('from', toQSDate(filters.from));
    if (filters.to) params.set('to', toQSDate(filters.to));
    if (filters.tipos.length) params.set('tipos', filters.tipos.join(','));
    if (filters.turnos.length) params.set('turnos', filters.turnos.join(','));
    if (filters.hielos.length) params.set('hielos', filters.hielos.join(','));
    if (filters.productoCodigo) params.set('productoCodigo', filters.productoCodigo);

    const qs = params.toString();
    router.push(qs ? `/admin/monitoreo?${qs}` : '/admin/monitoreo');
  };

  const goHistorial = () => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.origin !== 'TODOS') params.set('origin', filters.origin);
    if (filters.from) params.set('from', toQSDate(filters.from));
    if (filters.to) params.set('to', toQSDate(filters.to));
    if (filters.tipos.length) params.set('tipos', filters.tipos.join(','));
    if (filters.turnos.length) params.set('turnos', filters.turnos.join(','));
    if (filters.hielos.length) params.set('hielos', filters.hielos.join(','));
    if (filters.productoCodigo) params.set('productoCodigo', filters.productoCodigo);

    const qs = params.toString();
    router.push(qs ? `/admin/reportes/historial-movimientos?${qs}` : `/admin/reportes/historial-movimientos`);
  };

  const quickDateRange = (range: '7dias' | '30dias' | 'custom') => {
    setSelectedDateRange(range);
    const to = new Date();
    const from = new Date();

    if (range === '7dias') from.setDate(from.getDate() - 7);
    else if (range === '30dias') from.setDate(from.getDate() - 30);

    if (range !== 'custom') {
      setFilters((prev) => ({
        ...prev,
        from: startOfDay(from),
        to: endOfDay(to),
      }));
    }
  };

  /* ============================================================
    ✅ SNAPSHOT CÁMARA FRÍA (STOCK) — FIX PRO (AGREGADOS)
  ============================================================ */
  const camaraSnapshot = useMemo(() => {
    const items =
      (stockLlenoPorProducto ?? []).flatMap((p: any) => {
        return (p.tipos ?? []).map((t: any) => ({
          key: `${p.bolsaVaciaCodigo}-${t.tipoHielo}`,
          bolsaVaciaCodigo: p.bolsaVaciaCodigo,
          productoNombre: p.productoNombre,
          pesoKg: p.pesoKg,
          tipoHielo: t.tipoHielo,
          stockActual: Number(t.stockActual ?? 0),
          stockMinimo: Number(t.stockMinimo ?? 0),
          stockMaximo: Number(t.stockMaximo ?? 0),
        }));
      }) ?? [];

    const totalBolsas = Number(stockLlenoTotalGeneral ?? 0);

    const porTipo = (TIPOS_HIELO ?? []).map((h) => ({
      tipoHielo: h,
      label: ETIQUETAS_TIPO_HIELO[h],
      total: Number(stockLlenoTotalPorTipo?.[h] ?? 0),
    }));

    const detalle = items
      .filter((x: any) => (TIPOS_HIELO as readonly string[]).includes(String(x.tipoHielo)))
      .sort((a: any, b: any) => {
        const an = String(a.productoNombre ?? '').localeCompare(String(b.productoNombre ?? ''));
        if (an !== 0) return an;
        return String(a.tipoHielo).localeCompare(String(b.tipoHielo));
      });

    // Barras opcional
    const list = (products as any[]) ?? [];
    const isCamara = (p: any) => String(p?.ubicacion ?? '').toUpperCase() === 'CAMARA_FRIA';
    const barrasCamara = list.filter((p) => {
      const tipoProd = String(p?.tipoProducto ?? p?.tipo ?? '').toUpperCase();
      return isCamara(p) && (tipoProd.includes('BARRA') || tipoProd === 'BARRA');
    });

    const barrasAgg = barrasCamara
      .map((b) => {
        const nombre = String(b?.nombre ?? b?.productoNombre ?? '—');
        const codigo = String(b?.codigo ?? b?.productoCodigo ?? '—');
        const tipoHielo = isIceType(b?.tipoHielo) ? (b.tipoHielo as IceType) : undefined;
        const cuartosDisp = Number(b?.cuartosDisponibles ?? 0);
        const cuartosTot = Number(b?.cuartosTotales ?? 0);
        return { nombre, codigo, tipoHielo, cuartosDisp, cuartosTot };
      })
      .sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''));

    const totalCuartosDisp = barrasAgg.reduce((acc, x) => acc + (Number(x.cuartosDisp) || 0), 0);

    return {
      loaded: !productsLoading,
      totalBolsas,
      porTipo,
      detalle,
      barrasAgg,
      totalCuartosDisp,
    };
  }, [productsLoading, products, stockLlenoPorProducto, stockLlenoTotalPorTipo, stockLlenoTotalGeneral]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-950 to-black p-4 md:p-6">
      {/* PRINT CSS */}
      <style>{`
        .print-only { display: none; }
        @media print {
          @page { size: A4; margin: 14mm; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          html, body {
            background: #ffffff !important;
            color: #111827 !important;
            font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Helvetica Neue";
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-clean {
            background: #ffffff !important;
            color: #111827 !important;
            box-shadow: none !important;
            border-color: #E5E7EB !important;
          }
          .pdf-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
          }
          .pdf-table th, .pdf-table td {
            border: 1px solid #E5E7EB;
            padding: 6px 8px;
            vertical-align: top;
          }
          .pdf-table th {
            background: #F3F4F6;
            color: #111827;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .02em;
            font-size: 10px;
          }
          .pdf-muted { color: #6B7280 !important; }
          .pdf-title { font-size: 18px; font-weight: 800; }
          .pdf-subtitle { font-size: 12px; font-weight: 600; color: #374151; }
          .pdf-small { font-size: 10px; }
          .pdf-section { margin-top: 12px; }
          .pdf-hr { height: 1px; background: #E5E7EB; margin: 10px 0; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          .avoid-break { page-break-inside: avoid; }
        }
      `}</style>

      <div className="max-w-7xl mx-auto">
        {/* HEADER */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8 no-print">
          <div className="flex items-start gap-4">
            <button
              onClick={() => router.push('/admin/dashboard')}
              disabled={loading}
              className="p-3 bg-gradient-to-br from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 rounded-xl text-gray-400 hover:text-white disabled:opacity-50 transition-all duration-300 hover:scale-105 mt-1"
              title="Volver al Dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="p-3 rounded-xl bg-gradient-to-r from-purple-900/60 via-indigo-800/60 to-blue-900/60 backdrop-blur-sm border border-purple-800/30 shadow-lg">
              <FileBarChart className="h-10 w-10 text-purple-300" />
            </div>

            <div>
              <h1 className="text-3xl font-bold text-white bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                Sistema de Reportes
              </h1>
              <p className="text-gray-400 text-sm mt-2 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Movimientos + Stock (agregado) de bolsas llenas
              </p>
              {(esAdmin || esProduccion) && (
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                  <Shield className="h-3.5 w-3.5" />
                  Sesión actual: {esAdmin ? 'ADMIN' : 'PRODUCCIÓN'}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={goMonitoreo}
              disabled={loading}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-700/80 to-blue-800/80 text-white rounded-xl font-medium hover:from-blue-800 hover:to-blue-900 disabled:opacity-50 flex items-center transition-all duration-300 hover:shadow-lg hover:shadow-blue-900/20"
              title="Ir a Monitoreo con los mismos filtros"
            >
              <Eye className="h-5 w-5 mr-2" />
              Monitoreo
            </button>

            <button
              onClick={load}
              disabled={loading}
              className="p-3 bg-gradient-to-br from-gray-800 to-gray-900 text-gray-300 hover:text-white rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 flex items-center disabled:opacity-50 transition-all duration-300"
              title="Recargar datos"
            >
              <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={onExportPDF}
              disabled={!filtered.length && !camaraSnapshot.loaded}
              className="px-5 py-2.5 bg-gradient-to-r from-purple-700/80 to-purple-800/80 text-white rounded-xl font-medium hover:from-purple-800 hover:to-purple-900 disabled:opacity-50 flex items-center transition-all duration-300 hover:shadow-lg hover:shadow-purple-900/20"
              title="Exportar PDF (Guardar como PDF)"
            >
              <Printer className="h-5 w-5 mr-2" />
              PDF
            </button>
          </div>
        </div>

        {/* PDF ONLY */}
        <div className="print-only print-clean">
          <div className="avoid-break">
            <div className="flex items-start justify-between">
              <div>
                <div className="pdf-title">{EMPRESA.nombre}</div>
                <div className="pdf-subtitle">{EMPRESA.razonSocial}</div>
                <div className="pdf-small pdf-muted mt-1">{EMPRESA.rfc}</div>
                <div className="pdf-small pdf-muted">{EMPRESA.direccion}</div>
                <div className="pdf-small pdf-muted">
                  {EMPRESA.telefono} · {EMPRESA.correo}
                </div>
                <div className="pdf-small pdf-muted">{EMPRESA.sitio}</div>
              </div>

              <div style={{ textAlign: 'right' as any }}>
                <div className="pdf-title" style={{ fontSize: 14 }}>
                  REPORTE
                </div>
                <div className="pdf-subtitle">{printableTitle}</div>
                <div className="pdf-small pdf-muted mt-1">Generado: {fmtDate(new Date())}</div>
                <div className="pdf-small pdf-muted">
                  Usuario: {String((user as any)?.email ?? (user as any)?.uid ?? '—')}
                </div>
                <div className="pdf-small pdf-muted">Sesión: {esAdmin ? 'ADMIN' : esProduccion ? 'PRODUCCIÓN' : '—'}</div>
              </div>
            </div>

            <div className="pdf-hr" />

            {/* Resumen */}
            <div className="pdf-section avoid-break">
              <div className="pdf-subtitle" style={{ fontSize: 12, fontWeight: 800 }}>
                Resumen
              </div>
              <table className="pdf-table" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>Movs</th>
                    <th>Entradas</th>
                    <th>Salidas</th>
                    <th>Ventas</th>
                    <th>Mermas</th>
                    <th>Llenados</th>
                    <th>Promedio qty/mov</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{kpis.total}</td>
                    <td>{kpis.entradas}</td>
                    <td>{kpis.salidas}</td>
                    <td>{kpis.ventas}</td>
                    <td>{kpis.mermas}</td>
                    <td>{kpis.llenados}</td>
                    <td>{Math.round(kpis.promedioPorMovimiento)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Stock agregado */}
            <div className="pdf-section">
              <div className="pdf-subtitle" style={{ fontSize: 12, fontWeight: 800 }}>
                Stock (Agregado) — Bolsas Llenas
              </div>

              <table className="pdf-table" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>Total bolsas llenas</th>
                    {TIPOS_HIELO.map((h) => (
                      <th key={h}>{ETIQUETAS_TIPO_HIELO[h]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{camaraSnapshot.totalBolsas}</td>
                    {TIPOS_HIELO.map((h) => (
                      <td key={h}>{Number(stockLlenoTotalPorTipo?.[h] ?? 0)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>

              {/* Barras opcional */}
              <div className="pdf-section">
                <div className="pdf-subtitle" style={{ fontSize: 11, fontWeight: 800 }}>
                  Barras (Opcional) — Cuartos disponibles
                </div>
                <table className="pdf-table" style={{ marginTop: 6 }}>
                  <thead>
                    <tr>
                      <th>Tipo Hielo</th>
                      <th>Producto</th>
                      <th>Código</th>
                      <th style={{ width: 110 }}>Cuartos Disp.</th>
                      <th style={{ width: 110 }}>Cuartos Tot.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {camaraSnapshot.barrasAgg.length ? (
                      camaraSnapshot.barrasAgg.map((b: any) => (
                        <tr key={`${b.codigo}|${b.nombre}`}>
                          <td>{b.tipoHielo ? labelHielo(b.tipoHielo) : '—'}</td>
                          <td>{b.nombre}</td>
                          <td>{b.codigo}</td>
                          <td>{b.cuartosDisp}</td>
                          <td>{b.cuartosTot}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="pdf-muted">
                          Sin datos de barras por ubicación.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Movimientos (PDF) */}
            <div className="pdf-section">
              <div className="pdf-subtitle" style={{ fontSize: 12, fontWeight: 800 }}>
                Movimientos (Detalle)
              </div>
              <div className="pdf-small pdf-muted">Mostrando {filtered.length} movimientos filtrados.</div>

              <table className="pdf-table" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Producto</th>
                    <th>Código</th>
                    <th>Qty</th>
                    <th>Hielo</th>
                    <th>Turno</th>
                    <th>Usuario</th>
                    <th>Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length ? (
                    (filtered as any[]).slice(0, 900).map((m: any) => {
                      const tipo = m.tipo as TipoMovimiento;
                      const meta = safeMeta(tipo);
                      const fecha = toDateSafe(m.fecha);

                      const signed = getSignedQty(m);
                      const qtyAbs = Math.abs(signed);
                      const qtyPrint = `${signed < 0 ? '−' : '+'}${qtyAbs}`;

                      const userLabel = `${m.usuarioNombre ?? ''}`.trim() || m.usuarioCodigo || '—';
                      const notas =
                        (m.observaciones && String(m.observaciones).trim()) ||
                        (m.motivo && `Motivo: ${m.motivo}`) ||
                        (m.destinatario && `Destino: ${m.destinatario}`) ||
                        (m.clienteNombre && `Cliente: ${m.clienteNombre}`) ||
                        '';

                      return (
                        <tr key={m.id ?? m.codigo ?? `${m.tipo}-${m.fecha}`}>
                          <td>{fmtDate(fecha)}</td>
                          <td>{meta.texto}</td>
                          <td>{m.productoNombre ?? '—'}</td>
                          <td>{m.productoCodigo ?? '—'}</td>
                          <td>{qtyPrint}</td>
                          <td>{m.tipoHielo && isIceType(m.tipoHielo) ? labelHielo(m.tipoHielo) : '—'}</td>
                          <td>{m.turno ?? '—'}</td>
                          <td>{userLabel}</td>
                          <td>{notas || '—'}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="pdf-muted">
                        Sin movimientos para el rango seleccionado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {filtered.length > 900 && (
                <div className="pdf-small pdf-muted" style={{ marginTop: 6 }}>
                  Nota: el PDF muestra los primeros 900 movimientos para evitar archivos enormes. Usa CSV si necesitas todo.
                </div>
              )}
            </div>

            <div className="pdf-hr" />
            <div className="pdf-small pdf-muted">{EMPRESA.leyenda}</div>
          </div>
        </div>

        {/* UI NORMAL */}
        {error && (
          <div className="no-print mb-6 bg-red-900/20 border border-red-800/40 rounded-xl p-4 text-red-200">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8 no-print">
          <StatCard
            title="Movimientos Totales"
            value={kpis.total}
            subtitle="Filtrados"
            icon={ClipboardList}
            gradient="from-blue-900/40 to-blue-800/30"
            iconBg="bg-blue-900/30"
          />
          <StatCard
            title="Entradas"
            value={kpis.entradas}
            subtitle="Cantidad total (+)"
            icon={TrendingUpIcon}
            gradient="from-green-900/40 to-green-800/30"
            iconBg="bg-green-900/30"
          />
          <StatCard
            title="Salidas"
            value={kpis.salidas}
            subtitle="Cantidad total (−)"
            icon={TrendingDownIcon}
            gradient="from-red-900/40 to-red-800/30"
            iconBg="bg-red-900/30"
          />
          <StatCard
            title="Llenados"
            value={kpis.llenados}
            subtitle="Eventos"
            icon={Package}
            gradient="from-purple-900/40 to-purple-800/30"
            iconBg="bg-purple-900/30"
          />
        </div>

        {/* Cámara fría */}
        <div className="no-print bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-6 mb-8 border border-gray-700/50 shadow-xl">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-emerald-900/40 to-emerald-800/30 rounded-lg">
                <Warehouse className="h-6 w-6 text-emerald-300" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Cámara Fría</h2>
                <p className="text-sm text-gray-400 mt-1">Bolsas llenas (stock agregado) + barras (opcional)</p>
              </div>
            </div>
          </div>

          {productsLoading && !camaraSnapshot.loaded ? (
            <div className="flex items-center gap-3 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              Cargando stock...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-gray-900/35 rounded-xl border border-gray-700/30 p-4">
                  <div className="text-xs text-gray-400">Total bolsas llenas</div>
                  <div className="text-3xl font-bold text-white">
                    {camaraSnapshot.totalBolsas.toLocaleString('es-MX')}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Stock agregado</div>
                </div>

                {camaraSnapshot.porTipo.map((t: any) => (
                  <div key={t.tipoHielo} className="bg-gray-900/35 rounded-xl border border-gray-700/30 p-4">
                    <div className="text-xs text-gray-400">{t.label}</div>
                    <div className="text-3xl font-bold text-white">{t.total.toLocaleString('es-MX')}</div>
                    <div className="text-xs text-gray-500 mt-1">Llenas</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Filtros */}
        <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-6 mb-8 border border-gray-700/50 shadow-xl no-print">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-blue-900/40 to-blue-800/30 rounded-lg">
                  <Filter className="h-5 w-5 text-blue-300" />
                </div>
                Filtros de Reportes
              </h3>
              <p className="text-sm text-gray-400 mt-1">Personaliza el análisis de movimientos</p>
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

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2">
              <div className="relative group">
                <Search className="absolute left-4 top-3.5 h-5 w-5 text-gray-500 group-focus-within:text-blue-500 transition-colors" />
                <input
                  value={filters.q}
                  onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
                  placeholder="Buscar movimientos, productos, usuarios, códigos..."
                  disabled={loading}
                  className="w-full pl-12 pr-10 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm transition-all duration-300"
                />
                {filters.q && (
                  <button
                    onClick={() => setFilters((p) => ({ ...p, q: '' }))}
                    className="absolute right-3 top-3.5 text-gray-500 hover:text-gray-400"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <select
                value={filters.productoCodigo ?? ''}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, productoCodigo: e.target.value ? e.target.value : undefined }))
                }
                disabled={loading}
                className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
              >
                <option value="">📦 Todos los productos</option>
                {productoOptions.map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.nombre}
                    {typeof p.kg === 'number' ? ` · ${p.kg}kg` : ''} · {p.tipoProducto}
                    {p.status ? ` · ${p.status}` : ''} · {p.count} movs
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <div className="bg-gradient-to-r from-gray-900/50 to-gray-800/40 rounded-xl px-4 py-3.5 flex items-center justify-center backdrop-blur-sm flex-1">
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
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {(['7dias', '30dias', 'custom'] as const).map((range) => (
                      <button
                        key={range}
                        onClick={() => quickDateRange(range)}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                          selectedDateRange === range
                            ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-900/30'
                            : 'bg-gray-900/50 text-gray-400 hover:bg-gray-800/70 hover:text-gray-300'
                        }`}
                      >
                        {range === '7dias' ? '7 días' : range === '30dias' ? '30 días' : 'Personalizado'}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={asInputDate(filters.from)}
                      onChange={(e) =>
                        setFilters((p) => ({
                          ...p,
                          from: e.target.value ? startOfDay(new Date(`${e.target.value}T00:00:00`)) : undefined,
                        }))
                      }
                      className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white"
                    />
                    <input
                      type="date"
                      value={asInputDate(filters.to)}
                      onChange={(e) =>
                        setFilters((p) => ({
                          ...p,
                          to: e.target.value ? endOfDay(new Date(`${e.target.value}T00:00:00`)) : undefined,
                        }))
                      }
                      className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Tipo de Movimiento</label>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1">
                    {allTipos.slice(0, 10).map((t) => {
                      const meta = safeMeta(t);
                      const active = filters.tipos.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() => toggleTipo(t)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                            active
                              ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg shadow-purple-900/30'
                              : 'bg-gray-900/50 text-gray-400 hover:bg-gray-800/70 hover:text-gray-300'
                          }`}
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
                        >
                          {t === 'MATUTINO' ? '🌅 Matutino' : t === 'VESPERTINO' ? '🌇 Vespertino' : '🌙 Nocturno'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Origen</label>
                  <div className="flex flex-wrap gap-2">
                    {(['TODOS', 'ADMIN', 'PRODUCCION'] as const).map((origin) => (
                      <button
                        key={origin}
                        onClick={() => setFilters((p) => ({ ...p, origin }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                          filters.origin === origin
                            ? 'bg-gradient-to-r from-gray-600 to-gray-700 text-white shadow-lg shadow-gray-900/30'
                            : 'bg-gray-900/50 text-gray-400 hover:bg-gray-800/70 hover:text-gray-300'
                        }`}
                      >
                        {origin}
                      </button>
                    ))}
                  </div>
                  {(esAdmin || esProduccion) && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                      <Shield className="h-3.5 w-3.5" />
                      Sesión actual: {esAdmin ? 'ADMIN' : 'PRODUCCIÓN'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Charts */}
        <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-6 mb-8 border border-gray-700/50 shadow-xl no-print">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-purple-900/40 to-purple-800/30 rounded-lg">
                <PieChart className="h-6 w-6 text-purple-300" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Análisis Estadístico</h2>
                <p className="text-sm text-gray-400 mt-1">Distribución y tendencias de movimientos</p>
              </div>
            </div>
            <button
              onClick={() => setShowCharts(!showCharts)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800/50 rounded-lg transition-all duration-300"
            >
              {showCharts ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>

          {showCharts && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Tendencia */}
              <div className="bg-gradient-to-br from-gray-900/40 to-gray-800/30 rounded-xl p-5 border border-gray-700/30">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-blue-400" />
                    <h3 className="font-medium text-white">Tendencia Diaria</h3>
                  </div>
                  <span className="text-xs text-gray-400">Últimos 30 días</span>
                </div>

                <div className="relative h-48 bg-gray-900/30 rounded-lg p-4">
                  <div className="absolute inset-0 flex items-end">
                    {sparkPoints.map((point, index) => {
                      const height = maxDia ? (point.value / maxDia) * 100 : 0;
                      return (
                        <div key={index} className="flex-1 flex flex-col items-center justify-end mx-0.5">
                          <div
                            className="w-full bg-gradient-to-t from-blue-600 to-cyan-500 rounded-t-sm transition-all duration-300 hover:opacity-80"
                            style={{ height: `${height}%`, minHeight: '2px' }}
                            title={`${point.xLabel}: ${point.value} movimientos`}
                          />
                          <div className="text-[10px] text-gray-500 mt-1">{point.xLabel}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
                  <span>Pico: {maxDia} movs</span>
                  <span>Total: {sparkPoints.reduce((acc, p) => acc + p.value, 0)}</span>
                </div>
              </div>

              {/* Por Tipo */}
              <div className="bg-gradient-to-br from-gray-900/40 to-gray-800/30 rounded-xl p-5 border border-gray-700/30">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <BarChart className="h-5 w-5 text-green-400" />
                    <h3 className="font-medium text-white">Por Tipo</h3>
                  </div>
                  <span className="text-xs text-gray-400">Top 10</span>
                </div>

                <div className="space-y-3">
                  {byTipo.slice(0, 10).map((item) => {
                    const percentage = maxTipo ? (item.value / maxTipo) * 100 : 0;
                    return (
                      <div key={item.tipo} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-300 truncate">{item.label}</span>
                          <span className="text-sm font-medium text-white">{item.value}</span>
                        </div>
                        <div className="h-2 bg-gray-800/50 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-green-600 to-emerald-500 rounded-full transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Por Hielo */}
              <div className="bg-gradient-to-br from-gray-900/40 to-gray-800/30 rounded-xl p-5 border border-gray-700/30">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Snowflake className="h-5 w-5 text-cyan-400" />
                    <h3 className="font-medium text-white">Por Tipo de Hielo</h3>
                  </div>
                  <span className="text-xs text-gray-400">{byHielo.length} tipos</span>
                </div>

                <div className="space-y-3">
                  {byHielo.map((item) => {
                    const percentage = maxHielo ? (item.value / maxHielo) * 100 : 0;
                    return (
                      <div key={item.hielo} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <IceTypeBadge tipo={item.hielo} size="sm" />
                            <span className="text-sm text-gray-300">{item.label}</span>
                          </div>
                          <span className="text-sm font-medium text-white">{item.value}</span>
                        </div>
                        <div className="h-2 bg-gray-800/50 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-600 to-blue-500 rounded-full transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tabla Movimientos */}
        <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl overflow-hidden border border-gray-700/50 shadow-xl no-print">
          <div className="px-6 py-5 border-b border-gray-700/50 bg-gradient-to-r from-gray-900/60 to-gray-800/40">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                  <div className="p-2.5 bg-gradient-to-br from-emerald-900/40 to-emerald-800/30 rounded-lg">
                    <Database className="h-6 w-6 text-emerald-300" />
                  </div>
                  Detalle de Movimientos
                </h2>
                <p className="text-gray-400 text-sm mt-1">Tabla completa con análisis detallado</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="bg-gray-900/50 backdrop-blur-sm rounded-lg px-4 py-2">
                  <span className="text-sm text-gray-300">
                    Mostrando: <span className="font-bold text-white">{filtered.length}</span> de{' '}
                    <span className="font-bold">{rows.length}</span>
                  </span>
                </div>
                <button
                  onClick={goHistorial}
                  className="px-4 py-2 bg-gradient-to-r from-gray-800 to-gray-900 text-gray-300 rounded-lg font-medium hover:from-gray-700 hover:to-gray-800 hover:text-white transition-all duration-300"
                  title="Ver historial paginado"
                >
                  <History className="h-4 w-4 mr-2 inline" />
                  Historial
                </button>
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
                <p className="mt-6 text-gray-400 font-medium text-lg">Cargando reportes...</p>
                <p className="text-sm text-gray-600 mt-2">Analizando datos estadísticos</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="max-w-md mx-auto">
                <FileBarChart className="h-24 w-24 text-gray-700 mx-auto mb-4 opacity-50" />
                <h3 className="text-xl font-bold text-gray-300 mb-2">No se encontraron movimientos</h3>
                <p className="text-gray-500 mb-6">
                  {hasAnyFilter ? 'No hay movimientos que coincidan con los filtros actuales' : 'Esperando actividad del sistema...'}
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={load}
                    className="px-5 py-2.5 bg-gradient-to-r from-gray-800 to-gray-900 text-gray-300 rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 hover:text-white transition-all duration-300"
                  >
                    <RefreshCw className="h-4 w-4 mr-2 inline" />
                    Recargar
                  </button>
                  {hasAnyFilter && (
                    <button
                      onClick={clearFilters}
                      className="px-5 py-2.5 bg-gradient-to-r from-blue-700/80 to-blue-800/80 text-white rounded-xl font-medium hover:from-blue-800 hover:to-blue-900 transition-all duration-300"
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
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Turno</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Usuario</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Descripción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/20">
                  {(filtered as any[]).map((m: any) => {
                    const tipo = m.tipo as TipoMovimiento;
                    const meta = safeMeta(tipo);
                    const fecha = toDateSafe(m.fecha);

                    const signed = getSignedQty(m);
                    const cantidadAbs = Math.abs(signed);
                    const isSalida = signed < 0;

                    const desc =
                      (m.observaciones && String(m.observaciones).trim()) ||
                      (m.motivo && `Motivo: ${m.motivo}`) ||
                      (m.destinatario && `Destino: ${m.destinatario}`) ||
                      (m.clienteNombre && `Cliente: ${m.clienteNombre}`) ||
                      '';

                    const userLabel = `${m.usuarioNombre ?? ''}`.trim() || m.usuarioCodigo || '—';

                    const pillToneMov =
                      String(m.tipo).includes('VENTA')
                        ? 'green'
                        : String(m.tipo).includes('MERMA')
                        ? 'red'
                        : String(m.tipo).includes('CREACION')
                        ? 'blue'
                        : String(m.tipo).includes('LLENADO')
                        ? 'purple'
                        : 'gray';

                    const pillToneTurno =
                      m.turno === 'MATUTINO'
                        ? 'amber'
                        : m.turno === 'VESPERTINO'
                        ? 'orange'
                        : m.turno === 'NOCTURNO'
                        ? 'blue'
                        : 'gray';

                    return (
                      <tr
                        key={m.id ?? m.codigo ?? `${m.tipo}-${m.fecha}`}
                        className="hover:bg-gray-800/30 transition-all duration-200"
                      >
                        <td className="px-6 py-5">
                          <div className="text-sm text-white">{fmtDate(fecha)}</div>
                          <div className="text-xs text-gray-400">{m.turno ?? '—'}</div>
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <Pill tone={pillToneMov as any}>{meta.texto}</Pill>
                            <div className="text-xs text-gray-400 mt-1">{m.tipo}</div>
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <span className="font-medium text-white">{m.productoNombre ?? '—'}</span>
                            <span className="text-xs text-gray-400">{m.productoCodigo ?? '—'}</span>
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <div className={cn('text-2xl font-bold', isSalida ? 'text-red-400' : 'text-green-400')}>
                            {(isSalida ? '−' : '+') + cantidadAbs.toLocaleString('es-MX')}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            raw: {String(m.deltaPrincipal ?? m.cantidad ?? m.qty ?? '—')}
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          {m.tipoHielo && isIceType(m.tipoHielo) ? (
                            <IceTypeBadge tipo={m.tipoHielo} size="sm" />
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        <td className="px-6 py-5">
                          <Pill tone={pillToneTurno as any}>{m.turno || '—'}</Pill>
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-gray-400" />
                            <span className="text-sm text-white">{userLabel}</span>
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <div className="text-sm text-gray-300 max-w-[460px] truncate" title={desc}>
                            {desc || '—'}
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
        <div className="mt-8 pt-6 border-t border-gray-800/50 no-print">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => router.push('/admin/dashboard')}
                disabled={loading}
                className="px-5 py-2.5 bg-gradient-to-r from-gray-800 to-gray-900 text-gray-300 rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 hover:text-white disabled:opacity-50 flex items-center transition-all duration-300"
              >
                <ArrowLeft className="h-5 w-5 mr-2" />
                Volver al Panel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
