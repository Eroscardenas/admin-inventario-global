// app/admin/reportes/historial-movimientos/page.tsx
// ✅ FINAL (PROD) — Historial paginado + filtros + export
// ✅ VINCULADO 1:1 con /admin/reportes (incluye productoCodigo)
// ✅ URL Sync: q, origin, from, to, tipos, turnos, hielos, productoCodigo
// ✅ FIX TS7053: IceType guard + label
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuthContext } from '@/context/AuthContext';
import TransactionService from '@/lib/services/transaction.service';

import type { IceType } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO, ETIQUETAS_TIPO_HIELO } from '@/lib/utils/types/product.types';

import type { TurnoType } from '@/lib/utils/types/turno.types';
import type { Movimiento, TipoMovimiento } from '@/lib/utils/types/transaction.types';
import { getMovimientoMeta } from '@/lib/utils/types/transaction.types';

import {
  ArrowLeft,
  Download,
  Filter,
  CalendarDays,
  Search,
  Loader2,
  X,
  FileText,
  Eye,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Package,
} from 'lucide-react';

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

function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8;') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

function asInputDate(d?: Date) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

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

function guessKgFromName(nombre?: string): number | undefined {
  if (!nombre) return undefined;
  const m = nombre.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(kg|kilo|kilos)\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
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

function safeMeta(tipo: TipoMovimiento) {
  try {
    return getMovimientoMeta(tipo);
  } catch {
    return { texto: String(tipo), esEntrada: false };
  }
}

/* ============================================================
  Types
============================================================ */
type OriginFilter = 'TODOS' | 'ADMIN' | 'PRODUCCION';

type FiltersState = {
  q: string;
  productoCodigo?: string; // ✅ VINCULADO con Reportes
  tipos: TipoMovimiento[];
  turnos: TurnoType[];
  hielos: IceType[];
  origin: OriginFilter;
  from?: Date;
  to?: Date;
};

/* ============================================================
  Page
============================================================ */
export default function HistorialMovimientosPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user, loading: authLoading } = useAuthContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<Movimiento[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [filters, setFilters] = useState<FiltersState>(() => {
    const q = sp.get('q') ?? '';
    const origin = ((sp.get('origin') as OriginFilter) || 'TODOS') as OriginFilter;
    const from = parseDateParam(sp.get('from'));
    const to = parseDateParam(sp.get('to'));
    const tipos = parseList(sp.get('tipos')) as TipoMovimiento[];
    const turnos = parseList(sp.get('turnos')) as TurnoType[];
    const hielos = parseList(sp.get('hielos')).filter((h) => isIceType(h)) as IceType[];
    const productoCodigo = sp.get('productoCodigo') || undefined;

    // Default: últimos 14 días si no viene rango
    if (!from && !to) {
      const _to = new Date();
      const _from = new Date();
      _from.setDate(_from.getDate() - 14);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  // Paginación client-side
  const [page, setPage] = useState(1);
  const perPage = 100;

  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Historial: traemos más
      const data = await TransactionService.obtenerMovimientos({ limit: 5000 });
      const normalized = (data ?? []).map((m: any) => ({
        ...m,
        fecha: toDateSafe(m.fecha),
      })) as Movimiento[];
      setRows(normalized);
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando historial');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ✅ URL sync (incluye productoCodigo)
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
    const url = qs ? `/admin/reportes/historial-movimientos?${qs}` : `/admin/reportes/historial-movimientos`;
    window.history.replaceState(null, '', url);
  }, [filters]);

  // Si cambian filtros, resetea página
  useEffect(() => {
    setPage(1);
  }, [
    filters.q,
    filters.origin,
    filters.productoCodigo,
    filters.from,
    filters.to,
    filters.tipos,
    filters.turnos,
    filters.hielos,
  ]);

  // Catálogos
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
  const allHielos = useMemo(() => TIPOS_HIELO as unknown as IceType[], []);

  // ✅ Productos (derivado de movimientos) para selector, igual idea que Reportes
  const productoOptions = useMemo(() => {
    const map = new Map<
      string,
      { codigo: string; nombre: string; tipoProducto?: any; status?: any; kg?: number; count: number }
    >();

    for (const m of rows as any[]) {
      const codigo = String(m?.productoCodigo ?? '').trim();
      if (!codigo) continue;

      const nombre = String(m?.productoNombre ?? codigo);
      const kg = guessKgFromName(nombre);
      const prev = map.get(codigo);

      if (!prev) {
        map.set(codigo, {
          codigo,
          nombre,
          tipoProducto: m?.tipoProducto,
          status: m?.status,
          kg,
          count: 1,
        });
      } else {
        prev.count += 1;
        if (!prev.kg && kg) prev.kg = kg;
        if (!prev.status && m?.status) prev.status = m?.status;
        if (!prev.tipoProducto && m?.tipoProducto) prev.tipoProducto = m?.tipoProducto;
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

      // ✅ Producto (vinculado)
      if (filters.productoCodigo) {
        const pc = String(m.productoCodigo ?? '').trim();
        if (pc !== filters.productoCodigo) return false;
      }

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

      const meta = safeMeta(m.tipo as TipoMovimiento);

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
        m.empleadoAsignadoCodigo ?? '',
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

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pageClamped = Math.min(totalPages, Math.max(1, page));

  const pageItems = useMemo(() => {
    const start = (pageClamped - 1) * perPage;
    const end = start + perPage;
    return filtered.slice(start, end);
  }, [filtered, pageClamped]);

  const clearFilters = () => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 14);
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
  };

  const toggleTipo = (t: TipoMovimiento) =>
    setFilters((p) => ({ ...p, tipos: p.tipos.includes(t) ? p.tipos.filter((x) => x !== t) : [...p.tipos, t] }));

  const toggleTurno = (t: TurnoType) =>
    setFilters((p) => ({ ...p, turnos: p.turnos.includes(t) ? p.turnos.filter((x) => x !== t) : [...p.turnos, t] }));

  const toggleHielo = (t: IceType) =>
    setFilters((p) => ({ ...p, hielos: p.hielos.includes(t) ? p.hielos.filter((x) => x !== t) : [...p.hielos, t] }));

  const onExportCSV = () => {
    const csv = TransactionService.exportarACSV(filtered as any);
    downloadTextFile(
      `historial_movimientos_${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      'text/csv;charset=utf-8;'
    );
  };

  const onExportPDF = () => {
    window.print();
  };

  // ✅ Links con filtros (incluye productoCodigo)
  const buildQSFromFilters = (f: FiltersState) => {
    const params = new URLSearchParams();
    if (f.q) params.set('q', f.q);
    if (f.origin !== 'TODOS') params.set('origin', f.origin);
    if (f.productoCodigo) params.set('productoCodigo', f.productoCodigo);
    if (f.from) params.set('from', toQSDate(f.from));
    if (f.to) params.set('to', toQSDate(f.to));
    if (f.tipos.length) params.set('tipos', f.tipos.join(','));
    if (f.turnos.length) params.set('turnos', f.turnos.join(','));
    if (f.hielos.length) params.set('hielos', f.hielos.join(','));
    return params.toString();
  };

  const goReportes = () => {
    const qs = buildQSFromFilters(filters);
    router.push(qs ? `/admin/reportes?${qs}` : '/admin/reportes');
  };

  const goMonitoreo = () => {
    const qs = buildQSFromFilters(filters);
    router.push(qs ? `/admin/monitoreo?${qs}` : '/admin/monitoreo');
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-4 md:p-6 text-zinc-100">
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          .print-border { border-color: #e5e7eb !important; }
          .print-text-muted { color: #6b7280 !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
        }
      `}</style>

      {/* Header */}
      <div className="no-print mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm hover:bg-zinc-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </button>
          <div>
            <h1 className="text-xl font-bold">Historial de Movimientos</h1>
            <p className="text-xs text-zinc-400">Paginado + filtros + export · vinculado con Reportes/Monitoreo</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={goReportes}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm hover:bg-zinc-800"
            title="Volver a Reportes con los mismos filtros"
          >
            <BarChart3 className="h-4 w-4" />
            Reportes
          </button>

          <button
            onClick={goMonitoreo}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm hover:bg-zinc-800"
            title="Ir a Monitoreo con los mismos filtros"
          >
            <Eye className="h-4 w-4" />
            Monitoreo
          </button>

          <button
            onClick={() => setShowFilters((s) => !s)}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm hover:bg-zinc-800"
          >
            <Filter className="h-4 w-4" />
            {showFilters ? 'Ocultar filtros' : 'Filtros'}
          </button>

          <button
            onClick={onExportCSV}
            disabled={!filtered.length}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            CSV
          </button>

          <button
            onClick={onExportPDF}
            disabled={!filtered.length}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-60"
          >
            <FileText className="h-4 w-4" />
            PDF
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="no-print relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 w-4 h-4" />
        <input
          value={filters.q}
          onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
          placeholder="Buscar: producto, usuario, tipo, motivo, máquina, ubicación..."
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-3 pl-9 pr-3 text-sm outline-none focus:border-zinc-600"
        />
        {filters.q ? (
          <button
            onClick={() => setFilters((p) => ({ ...p, q: '' }))}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-zinc-300 hover:bg-zinc-800"
            title="Limpiar búsqueda"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {/* ✅ Selector de producto (vinculado con Reportes) */}
      <div className="no-print mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 md:col-span-2">
          <div className="flex items-center gap-2 text-sm">
            <Package className="h-4 w-4 text-zinc-300" />
            <span className="font-medium">Producto</span>
          </div>
          <select
            value={filters.productoCodigo ?? ''}
            onChange={(e) => setFilters((p) => ({ ...p, productoCodigo: e.target.value ? e.target.value : undefined }))}
            disabled={loading}
            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm outline-none focus:border-zinc-600 disabled:opacity-60"
          >
            <option value="">📦 Todos los productos</option>
            {productoOptions.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.nombre}
                {typeof p.kg === 'number' ? ` · ${p.kg}kg` : ''} · {p.tipoProducto ?? '—'}
                {p.status ? ` · ${p.status}` : ''} · {p.count} movs
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-xs text-zinc-400">Total filtrado</div>
          <div className="mt-1 text-3xl font-bold text-zinc-100">{total.toLocaleString('es-MX')}</div>
          <div className="mt-1 text-xs text-zinc-500">Paginado: {perPage} por página</div>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters ? (
        <div className="no-print mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <CalendarDays className="w-4 h-4 text-zinc-300" />
              <span className="font-medium">Filtros</span>
            </div>
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
              Reset (14 días)
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-3">
              <p className="text-xs text-zinc-400">Origen</p>
              <select
                value={filters.origin}
                onChange={(e) => setFilters((p) => ({ ...p, origin: e.target.value as any }))}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-600"
              >
                <option value="TODOS">Todos</option>
                <option value="ADMIN">Admin</option>
                <option value="PRODUCCION">Producción</option>
              </select>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-3">
              <p className="text-xs text-zinc-400">Desde</p>
              <input
                type="date"
                value={asInputDate(filters.from)}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    from: e.target.value ? startOfDay(new Date(`${e.target.value}T00:00:00`)) : undefined,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-600"
              />
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-3">
              <p className="text-xs text-zinc-400">Hasta</p>
              <input
                type="date"
                value={asInputDate(filters.to)}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    to: e.target.value ? endOfDay(new Date(`${e.target.value}T00:00:00`)) : undefined,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-600"
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-3">
              <p className="text-xs text-zinc-400">Tipo de movimiento</p>
              <div className="mt-2 flex flex-wrap gap-2 max-h-44 overflow-auto pr-1">
                {allTipos.map((t) => {
                  const active = filters.tipos.includes(t);
                  const meta = safeMeta(t);
                  return (
                    <button
                      key={t}
                      onClick={() => toggleTipo(t)}
                      className={cn(
                        'rounded-xl border px-3 py-1.5 text-xs',
                        active
                          ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                      )}
                    >
                      {meta.texto}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-3">
              <p className="text-xs text-zinc-400">Turno</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {allTurnos.map((t) => {
                  const active = filters.turnos.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => toggleTurno(t)}
                      className={cn(
                        'rounded-xl border px-3 py-1.5 text-xs',
                        active
                          ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                      )}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-3">
              <p className="text-xs text-zinc-400">Tipo de hielo</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {allHielos.map((h) => {
                  const active = filters.hielos.includes(h);
                  return (
                    <button
                      key={h}
                      onClick={() => toggleHielo(h)}
                      className={cn(
                        'rounded-xl border px-3 py-1.5 text-xs',
                        active
                          ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                      )}
                    >
                      {ETIQUETAS_TIPO_HIELO[h] ?? h}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Error */}
      {error ? (
        <div className="mb-4 rounded-2xl border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {/* Table */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 overflow-hidden print-border">
        <div className="no-print flex items-center justify-between border-b border-zinc-800 px-4 py-3 text-xs text-zinc-400">
          <span>
            Total filtrado: <span className="text-zinc-200">{total}</span> · Página{' '}
            <span className="text-zinc-200">{pageClamped}</span> / <span className="text-zinc-200">{totalPages}</span>
          </span>
          <span>Mostrando {perPage} por página</span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1400px] w-full text-sm">
            <thead className="bg-zinc-900/70 text-zinc-300 print-border">
              <tr className="border-b border-zinc-800 print-border">
                <th className="px-4 py-3 text-left font-medium">Fecha</th>
                <th className="px-4 py-3 text-left font-medium">Movimiento</th>
                <th className="px-4 py-3 text-left font-medium">Producto</th>
                <th className="px-4 py-3 text-right font-medium">Cantidad</th>
                <th className="px-4 py-3 text-left font-medium">Hielo</th>
                <th className="px-4 py-3 text-left font-medium">Turno</th>
                <th className="px-4 py-3 text-left font-medium">Máquina</th>
                <th className="px-4 py-3 text-left font-medium">Ubicación</th>
                <th className="px-4 py-3 text-left font-medium">Usuario</th>
                <th className="px-4 py-3 text-left font-medium">Descripción</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-zinc-800 print-border">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-zinc-400">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Cargando historial...
                    </div>
                  </td>
                </tr>
              ) : !pageItems.length ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-zinc-500">
                    No hay movimientos con los filtros actuales.
                  </td>
                </tr>
              ) : (
                pageItems.map((m: any) => {
                  const meta = safeMeta(m.tipo as TipoMovimiento);
                  const fecha = toDateSafe(m.fecha);
                  const cantidad = Math.abs(Number(m.deltaPrincipal ?? m.cantidad ?? 0));
                  const maquina = String(m.maquina ?? '').trim() || '—';
                  const ubicacion = String(m.ubicacion ?? '').trim() || '—';
                  const userLabel = `${m.usuarioNombre ?? ''}`.trim() || m.usuarioCodigo || '—';

                  const descParts: string[] = [];
                  if (m.empleadoAsignadoNombre || m.empleadoAsignadoCodigo) {
                    descParts.push(`Asignado: ${(m.empleadoAsignadoNombre ?? m.empleadoAsignadoCodigo) as string}`);
                  }
                  if (m.destinatario) descParts.push(`Destino: ${m.destinatario}`);
                  if (m.motivo) descParts.push(`Motivo: ${m.motivo}`);
                  if (m.clienteNombre) descParts.push(`Cliente: ${m.clienteNombre}`);
                  if (m.observaciones) descParts.push(String(m.observaciones));
                  const desc = descParts.join(' · ');

                  return (
                    <tr key={m.id ?? m.codigo ?? `${m.tipo}-${String(m.fecha)}`} className="hover:bg-zinc-900/40">
                      <td className="px-4 py-3 text-zinc-200 print-text-muted">{fmtDate(fecha)}</td>

                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-zinc-100">{meta.texto}</span>
                          <span className="text-xs text-zinc-500 print-text-muted">{m.tipo}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-zinc-100">{m.productoNombre ?? '—'}</span>
                          <span className="text-xs text-zinc-500 print-text-muted">{m.productoCodigo ?? '—'}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right text-zinc-100 tabular-nums">
                        {Number.isFinite(cantidad) ? cantidad.toLocaleString('es-MX') : '0'}
                      </td>

                      {/* ✅ FIX TS7053 aplicado */}
                      <td className="px-4 py-3 text-zinc-200">{labelHielo(m.tipoHielo)}</td>

                      <td className="px-4 py-3 text-zinc-200">{m.turno ?? '—'}</td>
                      <td className="px-4 py-3 text-zinc-200">{maquina}</td>
                      <td className="px-4 py-3 text-zinc-200">{ubicacion}</td>

                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-zinc-100">{userLabel}</span>
                          <span className="text-xs text-zinc-500 print-text-muted">{m.usuarioCodigo ?? '—'}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-zinc-300">
                        <div className="max-w-[520px] truncate" title={desc}>
                          {desc || '—'}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && totalPages > 1 ? (
          <div className="no-print flex items-center justify-between border-t border-zinc-800 bg-zinc-950/20 px-4 py-3 text-xs text-zinc-500">
            <span>
              Mostrando {(pageClamped - 1) * perPage + 1}–{Math.min(pageClamped * perPage, total)} de{' '}
              <span className="text-zinc-200">{total}</span>
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pageClamped === 1}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs hover:bg-zinc-800 disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </button>

              <span className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200">
                {pageClamped} / {totalPages}
              </span>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={pageClamped === totalPages}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs hover:bg-zinc-800 disabled:opacity-50"
              >
                Siguiente
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
