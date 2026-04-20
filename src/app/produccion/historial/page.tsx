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

function metaTipo(tipo?: string) {
  const t = String(tipo ?? '').toUpperCase().trim();

  if (t === 'LLENADO_BOLSA' || t === 'LLENADO') {
    return {
      label: 'Llenado',
      icon: Factory,
      pill: 'bg-cyan-50 text-cyan-800 border-cyan-200',
      iconBox: 'bg-gradient-to-br from-cyan-500 to-cyan-600',
    };
  }
  if (t === 'DEVOLUCION_BOLSA' || t.startsWith('DEVOLUCION')) {
    return {
      label: 'Devolución',
      icon: Undo2,
      pill: 'bg-amber-50 text-amber-800 border-amber-200',
      iconBox: 'bg-gradient-to-br from-amber-500 to-amber-600',
    };
  }
  if (t === 'SALIDA_BOLSA' || t === 'SALIDA' || t.startsWith('VENTA')) {
    return {
      label: 'Salida',
      icon: Truck,
      pill: 'bg-orange-50 text-orange-800 border-orange-200',
      iconBox: 'bg-gradient-to-br from-orange-500 to-orange-600',
    };
  }

  return {
    label: t || 'Movimiento',
    icon: ClipboardList,
    pill: 'bg-gray-50 text-gray-800 border-gray-200',
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
    return m.productoNombre ?? 'Producto';
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-cyan-50 to-blue-50 text-gray-900">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header Premium (mismo feeling que dashboard) */}
        <div className="bg-gradient-to-r from-white to-cyan-50 rounded-3xl border border-cyan-200/50 shadow-xl p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              <div>
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-cyan-600" />
                  <h1 className="text-2xl font-bold text-gray-900">Historial</h1>
                </div>
                <p className="text-gray-600 mt-1 text-sm">
                  Solo tus movimientos: llenados, salidas y devoluciones.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-gray-600">Operario</p>
                <p className="text-lg font-bold text-cyan-700">{userNombre}</p>
                <p className="text-xs text-gray-500 font-mono">{userCodigo}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
                <User className="w-5 h-5 text-white" />
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <CalendarDays className="h-4 w-4 text-cyan-600" />
              Desde:{' '}
              <span className="font-semibold text-gray-900">
                {startDate.toLocaleDateString('es-MX')}
              </span>
            </div>

            <button
              onClick={() => {
                // snapshot ya es realtime; esto es solo UX
                setLoadingRows(true);
                setTimeout(() => setLoadingRows(false), 250);
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-200 bg-white px-4 py-2 text-sm hover:bg-cyan-50 shadow-sm"
            >
              <RefreshCw className="h-4 w-4 text-cyan-700" />
              Refrescar
            </button>
          </div>
        </div>

        {/* Filtros (cards claras) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Search */}
          <div className="lg:col-span-2 bg-white rounded-3xl border border-cyan-200/50 shadow-xl p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl border border-cyan-200 bg-cyan-50 flex items-center justify-center">
                <Search className="h-4 w-4 text-cyan-700" />
              </div>

              <div className="flex-1">
                <input
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder="Buscar por producto, tipo de hielo, motivo, destinatario, máquina…"
                  className="w-full rounded-2xl border border-cyan-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-200 focus:border-cyan-300 transition"
                />
              </div>

              {qText.trim() ? (
                <button
                  onClick={clearSearch}
                  className="inline-flex items-center gap-2 rounded-2xl border border-cyan-200 bg-white px-4 py-3 text-sm hover:bg-cyan-50 transition"
                >
                  <X className="h-4 w-4 text-gray-700" />
                  Limpiar
                </button>
              ) : null}
            </div>
          </div>

          {/* Selects */}
          <div className="bg-white rounded-3xl border border-cyan-200/50 shadow-xl p-4">
            <div className="flex items-center gap-2 mb-3 text-sm text-gray-700">
              <Filter className="h-4 w-4 text-cyan-700" />
              Filtros
            </div>

            <div className="grid grid-cols-2 gap-3">
              <select
                value={tipoFiltro}
                onChange={(e) => setTipoFiltro(e.target.value as any)}
                className="rounded-2xl border border-cyan-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-200"
              >
                <option value="TODOS">Todos</option>
                <option value="LLENADO_BOLSA">Llenados</option>
                <option value="SALIDA_BOLSA">Salidas</option>
                <option value="DEVOLUCION_BOLSA">Devoluciones</option>
              </select>

              <select
                value={rango}
                onChange={(e) => setRango(e.target.value as any)}
                className="rounded-2xl border border-cyan-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-200"
              >
                {RANGOS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
              <CalendarDays className="h-4 w-4 text-cyan-700" />
              Rango:{' '}
              <span className="font-semibold text-gray-900">
                {RANGOS.find((x) => x.id === rango)?.label ?? '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Tabla / Lista */}
        <div className="bg-white rounded-3xl border border-cyan-200/50 shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-cyan-200/40 bg-gradient-to-r from-white to-cyan-50">
            <div className="text-sm text-gray-700">
              {loadingRows ? 'Cargando…' : `${filtered.length} movimiento(s)`}
            </div>
          </div>

          {loadingRows ? (
            <div className="p-12 flex items-center justify-center text-gray-700">
              <Loader2 className="h-5 w-5 animate-spin mr-2 text-cyan-700" />
              Cargando historial…
            </div>
          ) : error ? (
            <div className="p-6">
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
                {error}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-gray-600">No hay movimientos con esos filtros.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map((m) => {
                const meta = metaTipo(m.tipo);
                const Icon = meta.icon;

                const f = toDateSafe(m.createdAt ?? m.fecha);
                const tipoH = displayTipoHielo(m);

                const qty = calcQtyForRow(m);
                const qtyAbs = Math.abs(Number(qty) || 0);

                const title = displayTitle(m);

                return (
                  <div key={m.id} className="px-5 py-5 hover:bg-cyan-50/40 transition">
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

                            <span className="text-gray-900 font-bold truncate max-w-[520px]">
                              {title}
                            </span>

                            {tipoH ? (
                              <span className="text-xs text-gray-600">
                                • {ETIQUETAS_TIPO_HIELO[tipoH] ?? String(tipoH)}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-1 text-sm text-gray-600">
                            <span className="font-mono text-gray-800">{m.productoCodigo ?? '—'}</span>
                            <span className="text-gray-300"> • </span>
                            <span>{formatDT(f)}</span>

                            {m.maquina ? (
                              <>
                                <span className="text-gray-300"> • </span>
                                <span>Máquina: {String(m.maquina)}</span>
                              </>
                            ) : null}

                            {m.ubicacion ? (
                              <>
                                <span className="text-gray-300"> • </span>
                                <span>Ubic: {String(m.ubicacion)}</span>
                              </>
                            ) : null}
                          </div>

                          {(m.destinatario || m.clienteNombre || m.motivo || m.observaciones) ? (
                            <div className="mt-3 text-sm text-gray-700 space-y-1">
                              {m.destinatario ? (
                                <div>
                                  Destino:{' '}
                                  <span className="font-semibold text-gray-900">{m.destinatario}</span>
                                </div>
                              ) : null}
                              {m.clienteNombre ? (
                                <div>
                                  Cliente:{' '}
                                  <span className="font-semibold text-gray-900">{m.clienteNombre}</span>
                                </div>
                              ) : null}
                              {m.motivo ? (
                                <div>
                                  Motivo:{' '}
                                  <span className="font-semibold text-gray-900">{m.motivo}</span>
                                </div>
                              ) : null}
                              {m.observaciones ? (
                                <div className="text-gray-600">{m.observaciones}</div>
                              ) : null}
                            </div>
                          ) : null}

                          {/* Batch items preview (solo para salida batch) */}
                          {getIsSalida(m.tipo) && Array.isArray(m.items) && m.items.length ? (
                            <div className="mt-3 rounded-2xl border border-orange-200 bg-orange-50/40 p-3">
                              <div className="text-xs font-semibold text-orange-800 mb-2">
                                Detalle de items ({m.items.length})
                              </div>
                              <div className="space-y-1">
                                {m.items.slice(0, 6).map((it, idx) => (
                                  <div key={idx} className="text-xs text-gray-700 flex flex-wrap gap-2">
                                    <span className="font-mono text-gray-800">
                                      {it.productoCodigo ?? it.bolsaVaciaCodigo ?? '—'}
                                    </span>
                                    <span className="text-gray-400">•</span>
                                    <span className="font-semibold text-gray-900">
                                      {it.productoNombre ?? 'Bolsa llena'}
                                    </span>
                                    {it.tipoHielo ? (
                                      <>
                                        <span className="text-gray-400">•</span>
                                        <span className="text-gray-700">
                                          {String(it.tipoHielo)}
                                        </span>
                                      </>
                                    ) : null}
                                    <span className="text-gray-400">•</span>
                                    <span className="text-gray-900">
                                      -{Math.abs(Number(it.cantidad ?? 0))}
                                    </span>
                                  </div>
                                ))}
                                {m.items.length > 6 ? (
                                  <div className="text-xs text-gray-600">… y {m.items.length - 6} más</div>
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
                            qty >= 0 ? 'text-emerald-700' : 'text-rose-700',
                          ].join(' ')}
                        >
                          {qty >= 0 ? '+' : '-'}
                          {qtyAbs}
                        </div>

                        {typeof m.principalAnterior === 'number' && typeof m.principalNuevo === 'number' ? (
                          <div className="text-xs text-gray-500">
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
