/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @typescript-eslint/no-explicit-any */
// app/produccion/historial/page.tsx  ✅ PRODUCCIÓN: Historial por usuario (llenados + salidas + devoluciones)
// ✅ FIX: ahora también muestra SALIDA legacy ("SALIDA", "VENTA...") y LLENADO/DEVOLUCIÓN legacy
// ✅ PLUS: si el movimiento es batch (SALIDA_BOLSA con items[]), muestra "Salida (N items)" y suma total
// ✅ MISMO DISEÑO (CLARO) que dashboard

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuthContext } from '@/context/AuthContext';
import { db } from '@/lib/firebase/config.client';

import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  limit as qLimit,
  Timestamp,
} from 'firebase/firestore';

import { ETIQUETAS_TIPO_HIELO, type IceType } from '@/lib/utils/types/product.types';

// lucide
import {
  ArrowLeft,
  RefreshCw,
  Search,
  Filter,
  Loader2,
  CalendarDays,
  User,
  Factory,
  Undo2,
  Truck,
  ClipboardList,
  X,
  Snowflake,
} from 'lucide-react';

/**
 * Tu colección global de movimientos (ProductionService.COLECCION_MOVIMIENTOS)
 */
const MOVS_COLLECTION = 'movimientos';

/**
 * Tipos que queremos ver en producción
 * - NOTA: tú guardas "SALIDA_BOLSA" en production.service.ts pero no existe en TipoMovimiento.
 * - Para no romper TS, manejamos estos strings tal cual en UI.
 */
type TipoHistorial = 'LLENADO_BOLSA' | 'SALIDA_BOLSA' | 'DEVOLUCION_BOLSA';

/**
 * Movimiento "flexible": soporta tu Movimiento fuerte y tus movimientos legacy
 */
type MovRow = {
  id: string;

  tipo?: string;
  origen?: 'ADMIN' | 'PRODUCCION' | string;

  usuarioCodigo?: string;
  usuarioNombre?: string;

  productoCodigo?: string;
  productoNombre?: string;
  tipoProducto?: string;

  tipoHielo?: IceType | string;
  status?: string;

  deltaPrincipal?: number;
  principalAnterior?: number;
  principalNuevo?: number;

  motivo?: string;
  destinatario?: string;
  clienteNombre?: string;

  maquina?: string | null;
  ubicacion?: string | null;

  observaciones?: string;

  createdAt?: any;
  fecha?: any;

  // legacy
  cantidad?: number;
  devueltoPorCodigo?: string;
  devueltoPorNombre?: string;

  // batch (salida)
  batch?: boolean;
  batchCount?: number;
  items?: Array<{
    bolsaVaciaCodigo?: string;
    productoCodigo?: string;
    productoNombre?: string;
    tipoHielo?: IceType | string;
    cantidad?: number;
    delta?: number;
    anterior?: number;
    nuevo?: number;
  }>;

  [k: string]: any;
};

function toDateSafe(v: any): Date {
  if (!v) return new Date(0);
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v?.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function formatDT(d: Date) {
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const esMaquila = (nombre: unknown) =>
  /maquila/i.test(String(nombre ?? '').trim());

const extractKg = (nombre: unknown): number | null => {
  const match = String(nombre ?? '').match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (!match) return null;
  const kg = Number(match[1]);
  return Number.isFinite(kg) ? kg : null;
};

const buildNombreLlenoDesdeMovimiento = (m: {
  productoNombre?: unknown;
  productoCodigo?: unknown;
  tipoHielo?: unknown;
}) => {
  const nombre = String(m?.productoNombre ?? '').trim();
  const kg = extractKg(nombre);
  const maquila = esMaquila(nombre);

  if (kg != null && kg > 0) {
    return maquila ? `Bolsa llena ${kg}kg MAQUILA` : `Bolsa llena ${kg}kg`;
  }

  return nombre || String(m?.productoCodigo ?? 'Producto');
};

const buildNombreLlenoDesdeItem = (it: {
  productoNombre?: unknown;
  productoCodigo?: unknown;
  bolsaVaciaCodigo?: unknown;
}) => {
  const nombre = String(it?.productoNombre ?? '').trim();
  const kg = extractKg(nombre);
  const maquila = esMaquila(nombre);

  if (kg != null && kg > 0) {
    return maquila ? `Bolsa llena ${kg}kg MAQUILA` : `Bolsa llena ${kg}kg`;
  }

  return nombre || String(it?.productoCodigo ?? it?.bolsaVaciaCodigo ?? 'Bolsa llena');
};

function metaTipo(tipo?: string) {
  const t = String(tipo ?? '').toUpperCase().trim();

  if (t === 'LLENADO_BOLSA' || t === 'LLENADO') {
    return {
      label: 'Llenado',
      icon: Factory,
      pill: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
      iconBox: 'bg-gradient-to-br from-cyan-500 to-cyan-600',
    };
  }
  if (t === 'DEVOLUCION_BOLSA' || t.startsWith('DEVOLUCION')) {
    return {
      label: 'Devolución',
      icon: Undo2,
      pill: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      iconBox: 'bg-gradient-to-br from-amber-500 to-amber-600',
    };
  }
  if (t === 'SALIDA_BOLSA' || t === 'SALIDA' || t.startsWith('VENTA')) {
    return {
      label: 'Salida',
      icon: Truck,
      pill: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
      iconBox: 'bg-gradient-to-br from-orange-500 to-orange-600',
    };
  }

  return {
    label: t || 'Movimiento',
    icon: ClipboardList,
    pill: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    iconBox: 'bg-gradient-to-br from-slate-500 to-slate-600',
  };
}

const RANGOS = [
  { id: '7', label: '7 días', days: 7 },
  { id: '30', label: '30 días', days: 30 },
  { id: '90', label: '90 días', days: 90 },
] as const;

export default function ProduccionHistorialPage() {
  const router = useRouter();
  const { productionSession, isProductionLoggedIn, loading } = useAuthContext() as any;

  // ------- guard: solo producción -------
  useEffect(() => {
    if (loading) return;
    if (!isProductionLoggedIn || !productionSession) router.replace('/login?mode=empleado');
  }, [loading, isProductionLoggedIn, productionSession, router]);

  const userCodigo = useMemo(() => {
    const c = (productionSession as any)?.codigo ?? (productionSession as any)?.id ?? '';
    return String(c || '').trim();
  }, [productionSession]);

  const userNombre = useMemo(() => {
    const n = (productionSession as any)?.nombre ?? 'Producción';
    return String(n || 'Producción');
  }, [productionSession]);

  // ------- filtros UI -------
  const [qText, setQText] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState<'TODOS' | TipoHistorial>('TODOS');
  const [rango, setRango] = useState<(typeof RANGOS)[number]['id']>('30');

  const [loadingRows, setLoadingRows] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MovRow[]>([]);

  const startDate = useMemo(() => {
    const cfg = RANGOS.find((r) => r.id === rango) ?? RANGOS[1];
    const d = new Date();
    d.setDate(d.getDate() - cfg.days);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [rango]);

  // ------- query realtime -------
  useEffect(() => {
    if (!userCodigo) return;

    setLoadingRows(true);
    setError(null);

    const qs: any[] = [
      where('origen', '==', 'PRODUCCION'),
      where('usuarioCodigo', '==', userCodigo),
      where('createdAt', '>=', Timestamp.fromDate(startDate)),
      orderBy('createdAt', 'desc'),
      qLimit(250),
    ];

    const qref = query(collection(db, MOVS_COLLECTION), ...qs);

    const unsub = onSnapshot(
      qref,
      (snap) => {
        const list: MovRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setRows(list);
        setLoadingRows(false);
      },
      (e) => {
        console.error('historial snapshot error:', e);
        setError(e?.message ?? 'Error cargando historial.');
        setLoadingRows(false);
      }
    );

    return () => unsub();
  }, [userCodigo, startDate]);

  // ------- helpers UI (batch/qty/title) -------
  const getIsSalida = (tipo?: string) => {
    const t = String(tipo ?? '').toUpperCase().trim();
    return t === 'SALIDA_BOLSA' || t === 'SALIDA' || t.startsWith('VENTA');
  };

  const getIsDevolucion = (tipo?: string) => {
    const t = String(tipo ?? '').toUpperCase().trim();
    return t === 'DEVOLUCION_BOLSA' || t.startsWith('DEVOLUCION');
  };

  const getIsLlenado = (tipo?: string) => {
    const t = String(tipo ?? '').toUpperCase().trim();
    return t === 'LLENADO_BOLSA' || t === 'LLENADO';
  };

  const calcQtyForRow = (m: MovRow) => {
    // 1) si viene deltaPrincipal, úsalo
    if (typeof m.deltaPrincipal === 'number') return m.deltaPrincipal;

    // 2) si es batch salida, sumamos items:
    if (getIsSalida(m.tipo) && Array.isArray(m.items) && m.items.length) {
      // preferimos delta (negativo) si existe; si no, cantidad como negativo
      const sumDelta = m.items.reduce((acc, it) => acc + (Number(it?.delta) || 0), 0);
      if (sumDelta !== 0) return sumDelta;

      const sumQty = m.items.reduce((acc, it) => acc + (Number(it?.cantidad) || 0), 0);
      return -Math.abs(sumQty);
    }

    // 3) legacy cantidad
    if (typeof m.cantidad === 'number') return m.cantidad;

    // 4) nada
    return 0;
  };

  const displayTitle = (m: MovRow) => {
    // batch salida: título humano
    if (getIsSalida(m.tipo) && Array.isArray(m.items) && m.items.length) {
      const n = m.batchCount ?? m.items.length;
      return `Salida (${n} item${n === 1 ? '' : 's'})`;
    }

    return buildNombreLlenoDesdeMovimiento(m);
  };

  const displayTipoHielo = (m: MovRow): IceType | undefined => {
    // Si es batch, no hay tipo único; no mostramos bullet.
    if (getIsSalida(m.tipo) && Array.isArray(m.items) && m.items.length) return undefined;
    return (m.tipoHielo as IceType) || undefined;
  };

  // ------- filtrado local -------
  const filtered = useMemo(() => {
    const text = qText.trim().toLowerCase();

    return rows.filter((r) => {
      const t = String(r.tipo ?? '').toUpperCase().trim();

      if (tipoFiltro !== 'TODOS') {
        // filtro estricto por el tipo seleccionado (solo los valores del select)
        if (t !== tipoFiltro) return false;
      } else {
        // ✅ FIX IMPORTANTE:
        // por defecto también aceptamos legacy:
        // - LLENADO
        // - DEVOLUCION*
        // - SALIDA / VENTA*
        const ok = getIsLlenado(t) || getIsDevolucion(t) || getIsSalida(t);
        if (!ok) return false;
      }

      if (!text) return true;

      // Para batch salidas, también indexamos contenido de items
      const itemsText =
        Array.isArray(r.items) && r.items.length
          ? r.items
              .map((it) =>
                [
                  it?.productoCodigo,
                  it?.productoNombre,
                  buildNombreLlenoDesdeItem(it),
                  it?.bolsaVaciaCodigo,
                  it?.tipoHielo,
                  it?.cantidad,
                ]
                  .map((x) => String(x ?? '').toLowerCase())
                  .join(' ')
              )
              .join(' | ')
          : '';

      const hay = [
        r.codigo,
        r.productoCodigo,
        r.productoNombre,
        buildNombreLlenoDesdeMovimiento(r),
        r.tipoHielo,
        r.motivo,
        r.destinatario,
        r.clienteNombre,
        r.observaciones,
        r.maquina,
        r.ubicacion,
        itemsText,
      ]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' | ');

      return hay.includes(text);
    });
  }, [rows, qText, tipoFiltro]);

  const clearSearch = () => setQText('');

  if (loading || !productionSession) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950/30">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header Premium */}
        <div className="bg-slate-900/70 backdrop-blur-md rounded-3xl border border-slate-700/50 shadow-2xl shadow-slate-950/50 p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-600 hover:to-blue-700 shadow-lg shadow-cyan-500/20 transition-all duration-300 hover:-translate-y-0.5"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              <div>
                <div className="flex items-center gap-2">
                  <Snowflake className="h-5 w-5 text-cyan-300" />
                  <h1 className="text-2xl font-bold text-white tracking-tight">Historial</h1>
                </div>
                <p className="text-slate-400 mt-1 text-sm">
                  Solo tus movimientos: llenados, salidas y devoluciones.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-slate-400">Operario</p>
                <p className="text-lg font-bold text-cyan-300">{userNombre}</p>
                <p className="text-xs text-slate-500 font-mono">{userCodigo}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-2xl flex items-center justify-center border border-cyan-500/30 shadow-lg">
                <User className="w-5 h-5 text-cyan-300" />
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <CalendarDays className="h-4 w-4 text-cyan-400" />
              Desde:{' '}
              <span className="font-semibold text-white">
                {startDate.toLocaleDateString('es-MX')}
              </span>
            </div>

            <button
              onClick={() => {
                // snapshot ya es realtime; esto es solo UX
                setLoadingRows(true);
                setTimeout(() => setLoadingRows(false), 250);
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-700/50 bg-slate-800/50 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-all shadow-sm"
            >
              <RefreshCw className="h-4 w-4 text-cyan-400" />
              Refrescar
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Search */}
          <div className="lg:col-span-2 bg-slate-900/70 backdrop-blur-md rounded-3xl border border-slate-700/50 shadow-2xl shadow-slate-950/50 p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 flex items-center justify-center">
                <Search className="h-4 w-4 text-cyan-400" />
              </div>

              <div className="flex-1">
                <input
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder="Buscar por producto, tipo de hielo, motivo, destinatario, máquina…"
                  className="w-full rounded-2xl border border-slate-700/50 bg-slate-800/50 text-white placeholder:text-slate-500 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40 transition"
                />
              </div>

              {qText.trim() ? (
                <button
                  onClick={clearSearch}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-700/50 bg-slate-800/50 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition"
                >
                  <X className="h-4 w-4" />
                  Limpiar
                </button>
              ) : null}
            </div>
          </div>

          {/* Selects */}
          <div className="bg-slate-900/70 backdrop-blur-md rounded-3xl border border-slate-700/50 shadow-2xl shadow-slate-950/50 p-4">
            <div className="flex items-center gap-2 mb-3 text-sm text-slate-400">
              <Filter className="h-4 w-4 text-cyan-400" />
              Filtros
            </div>

            <div className="grid grid-cols-2 gap-3">
              <select
                value={tipoFiltro}
                onChange={(e) => setTipoFiltro(e.target.value as any)}
                className="rounded-2xl border border-slate-700/50 bg-slate-800/50 text-white px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40"
              >
                <option value="TODOS">Todos</option>
                <option value="LLENADO_BOLSA">Llenados</option>
                <option value="SALIDA_BOLSA">Salidas</option>
                <option value="DEVOLUCION_BOLSA">Devoluciones</option>
              </select>

              <select
                value={rango}
                onChange={(e) => setRango(e.target.value as any)}
                className="rounded-2xl border border-slate-700/50 bg-slate-800/50 text-white px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40"
              >
                {RANGOS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              <CalendarDays className="h-4 w-4 text-cyan-400" />
              Rango:{' '}
              <span className="font-semibold text-white">
                {RANGOS.find((x) => x.id === rango)?.label ?? '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Tabla / Lista */}
        <div className="bg-slate-900/70 backdrop-blur-md rounded-3xl border border-slate-700/50 shadow-2xl shadow-slate-950/50 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50 bg-gradient-to-r from-slate-900 via-cyan-900/30 to-slate-900">
            <div className="text-sm text-slate-400">
              {loadingRows ? 'Cargando…' : `${filtered.length} movimiento(s)`}
            </div>
          </div>

          {loadingRows ? (
            <div className="p-12 flex items-center justify-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2 text-cyan-400" />
              Cargando historial…
            </div>
          ) : error ? (
            <div className="p-6">
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300">
                {error}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-slate-400">No hay movimientos con esos filtros.</div>
          ) : (
            <div className="divide-y divide-slate-700/50">
              {filtered.map((m) => {
                const meta = metaTipo(m.tipo);
                const Icon = meta.icon;

                const f = toDateSafe(m.createdAt ?? m.fecha);
                const tipoH = displayTipoHielo(m);

                const qty = calcQtyForRow(m);
                const qtyAbs = Math.abs(Number(qty) || 0);

                const title = displayTitle(m);
                const rowEsMaquila =
                  esMaquila(m.productoNombre) ||
                  (Array.isArray(m.items) && m.items.some((it) => esMaquila(it?.productoNombre)));

                return (
                  <div key={m.id} className="px-5 py-5 hover:bg-slate-800/30 transition">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div
                          className={`h-11 w-11 rounded-2xl shadow-lg flex items-center justify-center ${meta.iconBox}`}
                        >
                          <Icon className="h-5 w-5 text-white" />
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${meta.pill}`}>
                              {meta.label}
                            </span>

                            <span className="text-white font-bold truncate max-w-[520px]">
                              {title}
                            </span>

                            {rowEsMaquila ? (
                              <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black tracking-[0.12em] text-amber-400">
                                MAQUILA
                              </span>
                            ) : null}

                            {tipoH ? (
                              <span className="text-xs text-slate-400">
                                • {ETIQUETAS_TIPO_HIELO[tipoH] ?? String(tipoH)}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-1 text-sm text-slate-400">
                            <span className="font-mono text-slate-300">{m.productoCodigo ?? '—'}</span>
                            <span className="text-slate-600"> • </span>
                            <span>{formatDT(f)}</span>

                            {m.maquina ? (
                              <>
                                <span className="text-slate-600"> • </span>
                                <span>Máquina: {String(m.maquina)}</span>
                              </>
                            ) : null}

                            {m.ubicacion ? (
                              <>
                                <span className="text-slate-600"> • </span>
                                <span>Ubic: {String(m.ubicacion)}</span>
                              </>
                            ) : null}
                          </div>

                          {(m.destinatario || m.clienteNombre || m.motivo || m.observaciones) ? (
                            <div className="mt-3 text-sm text-slate-300 space-y-1">
                              {m.destinatario ? (
                                <div>
                                  Destino:{' '}
                                  <span className="font-semibold text-white">{m.destinatario}</span>
                                </div>
                              ) : null}
                              {m.clienteNombre ? (
                                <div>
                                  Cliente:{' '}
                                  <span className="font-semibold text-white">{m.clienteNombre}</span>
                                </div>
                              ) : null}
                              {m.motivo ? (
                                <div>
                                  Motivo:{' '}
                                  <span className="font-semibold text-white">{m.motivo}</span>
                                </div>
                              ) : null}
                              {m.observaciones ? (
                                <div className="text-slate-400">{m.observaciones}</div>
                              ) : null}
                            </div>
                          ) : null}

                          {/* Batch items preview (solo para salida batch) */}
                          {getIsSalida(m.tipo) && Array.isArray(m.items) && m.items.length ? (
                            <div className="mt-3 rounded-2xl border border-orange-500/30 bg-orange-500/10 p-3">
                              <div className="text-xs font-semibold text-orange-300 mb-2">
                                Detalle de items ({m.items.length})
                              </div>
                              <div className="space-y-1">
                                {m.items.slice(0, 6).map((it, idx) => (
                                  <div key={idx} className="text-xs text-slate-300 flex flex-wrap gap-2">
                                    <span className="font-mono text-slate-400">
                                      {it.productoCodigo ?? it.bolsaVaciaCodigo ?? '—'}
                                    </span>
                                    <span className="text-slate-600">•</span>
                                    <span className="font-semibold text-white">
                                      {buildNombreLlenoDesdeItem(it)}
                                    </span>
                                    {esMaquila(it.productoNombre) ? (
                                      <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black tracking-[0.1em] text-amber-400">
                                        MAQUILA
                                      </span>
                                    ) : null}
                                    {it.tipoHielo ? (
                                      <>
                                        <span className="text-slate-600">•</span>
                                        <span className="text-slate-400">
                                          {String(it.tipoHielo)}
                                        </span>
                                      </>
                                    ) : null}
                                    <span className="text-slate-600">•</span>
                                    <span className="text-rose-400">
                                      -{Math.abs(Number(it.cantidad ?? 0))}
                                    </span>
                                  </div>
                                ))}
                                {m.items.length > 6 ? (
                                  <div className="text-xs text-slate-500">… y {m.items.length - 6} más</div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <div
                          className={[
                            'text-lg font-bold',
                            qty >= 0 ? 'text-emerald-400' : 'text-rose-400',
                          ].join(' ')}
                        >
                          {qty >= 0 ? '+' : '-'}
                          {qtyAbs}
                        </div>

                        {typeof m.principalAnterior === 'number' && typeof m.principalNuevo === 'number' ? (
                          <div className="text-xs text-slate-500">
                            {m.principalAnterior} → {m.principalNuevo}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}