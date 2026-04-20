'use client';

// app/admin/cargas/page.tsx
// ✅ FINAL (PROD) — CARGAS = SOLO TRANSPORTE (SINCRONIZADO CON SALIDAS BATCH)
// - Incluye:
//   (A) SALIDAS a transporte: salidaSubtipo === 'ENTREGA_TRANSPORTE' (incluye batch con items[])
//   (B) DEVOLUCIONES: tipo incluye DEVOLUCION (aunque NO tenga salidaSubtipo) (single o batch)
// - Si el movimiento trae items[] => EXPANDE a 1 fila por item (BV+tipo+cantidad)
// - Si no trae items[] => 1 fila normal (single)
// - Muestra: producto, tipo de hielo, unidades, transporte/destino, BV/código, usuario, notas
// - Query realtime: orderBy(createdAt desc) + limit + filtrado en memoria
// - FIX cantidad robusta: detecta deltaPrincipal/cantidad/qty/unidades/etc (y también por item)

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuthContext } from '@/context/AuthContext';
import { db } from '@/lib/firebase/config.client';

import { collection, onSnapshot, orderBy, query, limit as qLimit } from 'firebase/firestore';

import type { IceType } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO, ETIQUETAS_TIPO_HIELO } from '@/lib/utils/types/product.types';

import {
  ArrowLeft,
  Truck,
  Search,
  Filter,
  RefreshCw,
  Loader2,
  Calendar,
  User,
  AlertTriangle,
  BarChart3,
  TrendingUp,
  RotateCcw,
  MinusCircle,
  PackageCheck,
} from 'lucide-react';

/* =========================
  Helpers
========================= */
const safeStr = (v: unknown, fallback = '—') => {
  const s = String(v ?? '').trim();
  return s ? s : fallback;
};

const toNumberSafe = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(String(v).trim().replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : null;
};

const safeNum = (n: unknown, f = 0) => {
  const x = toNumberSafe(n);
  return x === null ? f : x;
};

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (v && typeof v === 'object' && typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;

  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const formatMX = (d: Date | null) => {
  if (!d) return '—';
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
};

const isIceType = (v: unknown): v is IceType => (TIPOS_HIELO as readonly string[]).includes(String(v));

type MovTipo = string;
type SalidaSubtipo = string;

function getQty(d: any): number {
  // ✅ cantidad robusta: toma el primer campo numérico válido
  const candidates = [
    d.deltaPrincipal,
    d.cantidad,
    d.qty,
    d.unidades,
    d.units,
    d.total,
    d.cantidadBolsas,
    d.cantidadBolsa,
  ];
  for (const c of candidates) {
    const n = toNumberSafe(c);
    if (n !== null) return n;
  }
  return 0;
}

// ✅ para items[] (batch)
function getQtyFromItem(it: any): number {
  const candidates = [it?.cantidad, it?.qty, it?.unidades, it?.units, it?.total, it?.deltaPrincipal, it?.delta];
  for (const c of candidates) {
    const n = toNumberSafe(c);
    if (n !== null) return n;
  }
  return 0;
}

function getTipoHieloFromItemOrDoc(it: any, d: any): IceType | undefined {
  if (isIceType(it?.tipoHielo)) return it.tipoHielo as IceType;
  if (isIceType(d?.tipoHielo)) return d.tipoHielo as IceType;
  return undefined;
}

function getProductoNombreFromItemOrDoc(it: any, d: any): string {
  return safeStr(it?.productoNombre ?? d?.productoNombre ?? d?.nombreProducto ?? d?.productName ?? d?.nombre ?? '—');
}

function getProductoCodigoFromItemOrDoc(it: any, d: any): string {
  return safeStr(it?.productoCodigo ?? d?.productoCodigo ?? d?.codigoProducto ?? d?.productCode ?? d?.codigo ?? d?.productId ?? '—');
}

function getBvCodigoFromItemOrDoc(it: any, d: any): string {
  return safeStr(it?.bolsaVaciaCodigo ?? it?.bvCodigo ?? d?.bolsaVaciaCodigo ?? d?.bvCodigo ?? d?.bolsaCodigo ?? d?.referencia ?? '—');
}

function getTransporteLabel(d: any, esDevolucion: boolean) {
  const t = safeStr(
    d.destinatario ??
      d.transporte ??
      d.destino ??
      d.destinoTransporte ??
      d.ruta ??
      d.unidad ??
      d.vehiculo ??
      d.placas ??
      d.chofer ??
      '',
    ''
  );
  if (t) return t;
  return esDevolucion ? 'TRANSPORTE (devolución)' : '—';
}

function isSalidaATransporte(d: any) {
  const salidaSubtipo = String(d.salidaSubtipo ?? d.subtipoSalida ?? d.subtipo ?? '').toUpperCase();
  return salidaSubtipo === 'ENTREGA_TRANSPORTE';
}

function isDevolucion(d: any) {
  const tipo = String(d.tipo ?? d.tipoMovimiento ?? d.action ?? '').toUpperCase();
  return tipo.includes('DEVOLUCION');
}

const inferTone = (d: any) => {
  if (isDevolucion(d)) return 'emerald';
  return 'amber';
};

const inferLabel = (d: any) => {
  if (isDevolucion(d)) return 'Devolución';
  return 'Salida a transporte';
};

/* =========================
  UI Components
========================= */
const StatCard = ({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
}) => {
  return (
    <div className={`bg-gradient-to-br ${color} rounded-2xl p-5 border border-gray-800/50 shadow-lg`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-white/90 font-medium">{title}</p>
          <p className="text-3xl font-bold text-white mt-2">
            {typeof value === 'number' ? value.toLocaleString('es-MX') : value}
          </p>
          {subtitle && <p className="text-xs text-white/70 mt-2">{subtitle}</p>}
        </div>
        <div className="p-3 rounded-xl bg-gray-900/30 backdrop-blur-sm ml-4">
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
  tone?: 'gray' | 'amber' | 'emerald';
  icon?: React.ElementType;
  size?: 'sm' | 'md';
}) => {
  const toneClasses: Record<string, string> = {
    amber: 'bg-gradient-to-r from-amber-900/40 to-amber-800/30 border-amber-700/30 text-amber-300',
    emerald: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/30 border-emerald-700/30 text-emerald-300',
    gray: 'bg-gradient-to-r from-gray-900/40 to-gray-800/30 border-gray-700/30 text-gray-300',
  };

  const sizeClasses = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';
  const cls = toneClasses[tone] ?? toneClasses.gray;

  return (
    <span className={`inline-flex items-center ${sizeClasses} ${cls} rounded-full border backdrop-blur-sm shadow-md`}>
      {Icon && <Icon className="h-3.5 w-3.5 mr-1.5" />}
      {children}
    </span>
  );
};

const IceTypeBadge = ({ tipo, size = 'md' }: { tipo: IceType; size?: 'sm' | 'md' }) => {
  const sizeClasses = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';
  return (
    <span
      className={`inline-flex items-center ${sizeClasses} bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-full shadow-md`}
    >
      <PackageCheck className="h-3.5 w-3.5 mr-1.5" />
      {ETIQUETAS_TIPO_HIELO[tipo] ?? tipo}
    </span>
  );
};

/* =========================
  Tipos UI
========================= */
type CargaRow = {
  id: string;
  createdAt: Date | null;

  // Clasificación UI
  kind: 'SALIDA_TRANSPORTE' | 'DEVOLUCION';
  tipo: MovTipo;
  salidaSubtipo?: SalidaSubtipo;

  // Actor
  usuarioNombre: string;
  usuarioCodigo: string;

  // Transporte destino
  destinatario: string;

  // Producto / stock (bolsa llena)
  productoNombre: string;
  productoCodigo: string;

  // BV / referencia si existe
  bolsaVaciaCodigo: string;

  // Hielo
  tipoHielo?: IceType;

  // Unidades
  unidades: number;

  // Extra
  observaciones?: string;

  raw: any;
};

type MovFilter = 'TODOS' | 'SALIDAS' | 'DEVOLUCIONES';

export default function CargasAdminPage() {
  const router = useRouter();
  const { isAdmin } = useAuthContext() as any;

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CargaRow[]>([]);
  const [err, setErr] = useState<string>('');

  const [qText, setQText] = useState('');
  const [fTransporte, setFTransporte] = useState<string>('TODOS');
  const [fMov, setFMov] = useState<MovFilter>('TODOS');

  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (isAdmin === false) router.replace('/admin/dashboard');
  }, [isAdmin, router]);

  // ✅ Fuente: movimientos (realtime)
  useEffect(() => {
    setLoading(true);
    setErr('');

    const ref = collection(db, 'movimientos');
    const qy = query(ref, orderBy('createdAt', 'desc'), qLimit(1200));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: CargaRow[] = [];

        snap.forEach((docSnap) => {
          const d = docSnap.data() as any;

          const tipoRaw = d.tipo ?? d.tipoMovimiento ?? d.action ?? '';
          const tipo: MovTipo = safeStr(tipoRaw, '');

          const salidaTransporte = isSalidaATransporte(d);
          const devolucion = isDevolucion(d);

          // ✅ SOLO: salidas transporte + devoluciones
          if (!salidaTransporte && !devolucion) return;

          const createdAt = toDate(d.createdAt ?? d.created_at ?? d.fecha ?? d.timestamp);
          const salidaSubtipo = safeStr(d.salidaSubtipo ?? d.subtipoSalida ?? d.subtipo ?? '', '') as SalidaSubtipo;

          const destinatario = getTransporteLabel(d, devolucion);

          const usuarioNombre = safeStr(
            d.usuarioNombre ?? d.registradoPorNombre ?? d.empleadoAsignadoNombre ?? d.userName ?? d.actorName,
            '—'
          );
          const usuarioCodigo = safeStr(
            d.usuarioCodigo ?? d.registradoPorCodigo ?? d.empleadoAsignadoCodigo ?? d.userCodigo ?? d.actorCode,
            '—'
          );

          const observaciones = safeStr(d.observaciones ?? d.nota ?? d.comentario ?? d.detalle ?? '', '');
          const obs = observaciones && observaciones !== '—' ? observaciones : undefined;

          const kind: CargaRow['kind'] = devolucion ? 'DEVOLUCION' : 'SALIDA_TRANSPORTE';

          // ✅ BATCH: si viene items[] => 1 fila por item
          const itemsArr = Array.isArray(d.items) ? d.items : [];
          if (itemsArr.length) {
            itemsArr.forEach((it: any, idx: number) => {
              const productoNombre = getProductoNombreFromItemOrDoc(it, d);
              const productoCodigo = getProductoCodigoFromItemOrDoc(it, d);
              const bolsaVaciaCodigo = getBvCodigoFromItemOrDoc(it, d);
              const tipoHielo = getTipoHieloFromItemOrDoc(it, d);

              const unidades = Math.abs(getQtyFromItem(it));

              rows.push({
                id: `${docSnap.id}__${idx}`,
                createdAt,
                kind,
                tipo,
                salidaSubtipo: salidaSubtipo || undefined,
                usuarioNombre,
                usuarioCodigo,
                destinatario,
                productoNombre,
                productoCodigo,
                bolsaVaciaCodigo,
                tipoHielo,
                unidades,
                observaciones: obs,
                raw: d,
              });
            });

            return;
          }

          // ✅ SINGLE: como antes
          const productoCodigo = safeStr(
            d.productoCodigo ?? d.codigoProducto ?? d.productCode ?? d.codigo ?? d.productId ?? '—'
          );

          const productoNombre = safeStr(
            d.productoNombre ?? d.nombreProducto ?? d.productName ?? d.nombre ?? '—',
            '—'
          );

          const bolsaVaciaCodigo = safeStr(d.bolsaVaciaCodigo ?? d.bvCodigo ?? d.bolsaCodigo ?? d.referencia ?? '—');

          const tipoHielo = isIceType(d.tipoHielo) ? (d.tipoHielo as IceType) : undefined;

          const unidades = Math.abs(getQty(d));

          rows.push({
            id: docSnap.id,
            createdAt,
            kind,
            tipo,
            salidaSubtipo: salidaSubtipo || undefined,
            usuarioNombre,
            usuarioCodigo,
            destinatario,
            productoNombre,
            productoCodigo,
            bolsaVaciaCodigo,
            tipoHielo,
            unidades,
            observaciones: obs,
            raw: d,
          });
        });

        setItems(rows);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setErr('No se pudo cargar Cargas desde movimientos (realtime). Revisa permisos/índices.');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [refreshTick]);

  const transportes = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      const t = safeStr(it.destinatario, '');
      if (t && t !== '—') set.add(t);
    }
    return ['TODOS', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'es'))];
  }, [items]);

  const filtered = useMemo(() => {
    const q = qText.trim().toLowerCase();

    return items.filter((it) => {
      if (fTransporte !== 'TODOS' && it.destinatario !== fTransporte) return false;

      if (fMov === 'SALIDAS' && it.kind !== 'SALIDA_TRANSPORTE') return false;
      if (fMov === 'DEVOLUCIONES' && it.kind !== 'DEVOLUCION') return false;

      if (!q) return true;

      const hay = `${it.kind} ${it.tipo} ${it.productoNombre} ${it.productoCodigo} ${it.bolsaVaciaCodigo} ${it.destinatario} ${it.usuarioNombre} ${it.usuarioCodigo} ${it.tipoHielo ?? ''} ${it.salidaSubtipo ?? ''}`
        .toLowerCase()
        .includes(q);

      return hay;
    });
  }, [items, qText, fTransporte, fMov]);

  const totals = useMemo(() => {
    const totalMovs = filtered.length;
    const totalUnidades = filtered.reduce((acc, it) => acc + safeNum(it.unidades, 0), 0);

    const salidas = filtered.filter((x) => x.kind === 'SALIDA_TRANSPORTE').length;
    const devols = filtered.filter((x) => x.kind === 'DEVOLUCION').length;

    return { totalMovs, totalUnidades, salidas, devols };
  }, [filtered]);

  const hasAnyFilter = !!qText || fTransporte !== 'TODOS' || fMov !== 'TODOS';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-950 to-black p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
          <div className="flex items-start gap-4">
            <button
              onClick={() => router.push('/admin/dashboard')}
              disabled={loading}
              className="p-3 bg-gradient-to-br from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 rounded-xl text-gray-400 hover:text-white disabled:opacity-50 transition-all duration-300 hover:scale-105"
              title="Volver al Dashboard"
              type="button"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="p-3 rounded-xl bg-gradient-to-r from-amber-900/30 via-orange-800/20 to-amber-900/20 backdrop-blur-sm border border-amber-800/30 shadow-lg">
              <Truck className="h-10 w-10 text-amber-300" />
            </div>

            <div>
              <h1 className="text-3xl font-bold text-white bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                Cargas (Transporte)
              </h1>
              <p className="text-gray-400 text-sm mt-2 flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Solo Salidas a Transporte + Devoluciones (Batch OK)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={() => setRefreshTick((x) => x + 1)}
              disabled={loading}
              className="p-3 bg-gradient-to-br from-gray-800 to-gray-900 text-gray-300 hover:text-white rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 flex items-center disabled:opacity-50 transition-all duration-300"
              title="Recargar datos"
              type="button"
            >
              <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-8">
          <StatCard title="Movimientos" value={totals.totalMovs} subtitle="Filtrados" icon={BarChart3} color="from-blue-900/40 to-blue-800/30" />
          <StatCard title="Unidades" value={totals.totalUnidades} subtitle="Suma de unidades" icon={PackageCheck} color="from-green-900/40 to-green-800/30" />
          <StatCard title="Salidas" value={totals.salidas} subtitle="ENTREGA_TRANSPORTE" icon={TrendingUp} color="from-red-900/40 to-red-800/30" />
          <StatCard title="Devoluciones" value={totals.devols} subtitle="DEVOLUCION_*" icon={RotateCcw} color="from-emerald-900/40 to-emerald-800/30" />
        </div>

        {/* Filtros */}
        <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-6 mb-8 border border-gray-700/50 shadow-xl">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-amber-900/40 to-amber-800/30 rounded-lg">
                  <Filter className="h-5 w-5 text-amber-300" />
                </div>
                Filtros
              </h3>
              <p className="text-sm text-gray-400 mt-1">Busca por producto, BV, hielo, transporte o usuario</p>
            </div>

            {hasAnyFilter && (
              <button
                onClick={() => {
                  setQText('');
                  setFTransporte('TODOS');
                  setFMov('TODOS');
                }}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-700/70 to-amber-800/70 text-white hover:from-amber-800 hover:to-amber-900 transition-all duration-300 text-sm font-medium"
                type="button"
              >
                Limpiar filtros
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
            <div className="lg:col-span-3">
              <div className="relative group">
                <Search className="absolute left-4 top-3.5 h-5 w-5 text-gray-500 group-focus-within:text-amber-500 transition-colors" />
                <input
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder="Buscar producto, BV, hielo, transporte, usuario..."
                  disabled={loading}
                  className="w-full pl-12 pr-10 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent backdrop-blur-sm transition-all duration-300"
                />
                {qText && (
                  <button
                    onClick={() => setQText('')}
                    className="absolute right-3 top-3.5 text-gray-500 hover:text-gray-400"
                    title="Limpiar búsqueda"
                    type="button"
                  >
                    <MinusCircle className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="lg:col-span-2">
              <select
                value={fTransporte}
                onChange={(e) => setFTransporte(e.target.value)}
                disabled={loading}
                className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent backdrop-blur-sm"
              >
                {transportes.map((t) => (
                  <option key={t} value={t} className="bg-gray-900">
                    {t === 'TODOS' ? '🚚 Todos los transportes' : `🚛 ${t}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-1">
              <select
                value={fMov}
                onChange={(e) => setFMov(e.target.value as MovFilter)}
                disabled={loading}
                className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent backdrop-blur-sm"
              >
                <option value="TODOS" className="bg-gray-900">
                  Todos
                </option>
                <option value="SALIDAS" className="bg-gray-900">
                  Salidas
                </option>
                <option value="DEVOLUCIONES" className="bg-gray-900">
                  Devoluciones
                </option>
              </select>
            </div>
          </div>

          {err && (
            <div className="mt-4 bg-gradient-to-r from-red-900/20 to-red-800/10 border border-red-700/30 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-300 mt-0.5" />
                <div>
                  <div className="text-red-200 font-semibold">Error de carga</div>
                  <div className="text-sm text-red-200/80 mt-1">{err}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tabla */}
        <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl overflow-hidden border border-gray-700/50 shadow-xl">
          <div className="px-6 py-5 border-b border-gray-700/50 bg-gradient-to-r from-gray-900/60 to-gray-800/40">
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-amber-900/40 to-amber-800/30 rounded-lg">
                <Calendar className="h-6 w-6 text-amber-300" />
              </div>
              Historial de Cargas (Transporte)
            </h2>
            <p className="text-sm text-gray-500 mt-2">
              Mostrando <span className="text-white font-semibold">{filtered.length}</span> de{' '}
              <span className="text-gray-300 font-semibold">{items.length}</span>
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="relative">
                  <div className="h-16 w-16 rounded-full border-4 border-gray-800 border-t-amber-500 animate-spin mx-auto" />
                  <Loader2 className="h-14 w-14 animate-spin text-amber-500 mx-auto absolute top-1 left-1" />
                </div>
                <p className="mt-6 text-gray-400 font-medium text-lg">Cargando movimientos...</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Truck className="h-24 w-24 text-gray-700 mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-bold text-gray-300 mb-2">No se encontraron movimientos</h3>
              <p className="text-gray-500 mb-6">No hay resultados con los filtros actuales.</p>
              <button
                onClick={() => setRefreshTick((x) => x + 1)}
                className="px-5 py-2.5 bg-gradient-to-r from-gray-800 to-gray-900 text-gray-300 rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 hover:text-white transition-all duration-300"
                type="button"
              >
                <RefreshCw className="h-4 w-4 mr-2 inline" />
                Recargar
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700/30">
                <thead className="bg-gray-900/50 backdrop-blur-sm">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Fecha</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Tipo</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Producto (Bolsa llena)</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Código</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">BV</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Hielo</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Unidades</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Transporte</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Registró</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Notas</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-700/20">
                  {filtered.map((m) => {
                    const devol = m.kind === 'DEVOLUCION';
                    const tone = inferTone(m.raw);
                    const label = inferLabel(m.raw);

                    const Icon = devol ? RotateCcw : Truck;

                    const userLabel =
                      m.usuarioNombre !== '—'
                        ? m.usuarioNombre
                        : m.usuarioCodigo !== '—'
                        ? `Empleado ${m.usuarioCodigo}`
                        : '—';

                    return (
                      <tr key={m.id} className="hover:bg-gray-800/30 transition-all duration-200">
                        <td className="px-6 py-5">
                          <div className="text-sm text-white">{formatMX(m.createdAt)}</div>
                          <div className="text-xs text-gray-400">{safeStr(m.salidaSubtipo, '') || '—'}</div>
                        </td>

                        <td className="px-6 py-5">
                          <Pill tone={tone as any} icon={Icon as any} size="sm">
                            {label}
                          </Pill>
                          <div className="text-xs text-gray-500 mt-1">{safeStr(m.tipo, '—')}</div>
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <span className="font-medium text-white">{m.productoNombre}</span>
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <Pill tone="gray" size="sm">
                            {m.productoCodigo}
                          </Pill>
                        </td>

                        <td className="px-6 py-5">
                          <Pill tone="gray" size="sm">
                            {m.bolsaVaciaCodigo}
                          </Pill>
                        </td>

                        <td className="px-6 py-5">
                          {m.tipoHielo ? (
                            <IceTypeBadge tipo={m.tipoHielo} size="sm" />
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        <td className="px-6 py-5">
                          <div className="text-2xl font-bold text-amber-300">
                            {safeNum(m.unidades, 0).toLocaleString('es-MX')}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            raw: {safeStr(m.raw?.deltaPrincipal ?? m.raw?.cantidad ?? m.raw?.qty ?? m.raw?.unidades ?? '—')}
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <Pill tone="amber" icon={Truck} size="sm">
                            {m.destinatario}
                          </Pill>
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-gray-400" />
                            <span className="text-sm text-white">{userLabel}</span>
                          </div>
                          {m.usuarioCodigo !== '—' && m.usuarioNombre !== m.usuarioCodigo ? (
                            <div className="text-xs text-gray-400 mt-1">{m.usuarioCodigo}</div>
                          ) : null}
                        </td>

                        <td className="px-6 py-5">
                          <div className="text-sm text-gray-300 max-w-[280px] truncate" title={m.observaciones}>
                            {m.observaciones || '—'}
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
        </div>
      </div>
    </div>
  );
}