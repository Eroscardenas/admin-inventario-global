/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

// app/admin/dashboard/mermas/page.tsx
// ✅ MERMAS (ADMIN) — HISTORIAL VINCULADO A INVENTARIO (movimientos)
// - SIN filtro por tipo
// - Search simple
// - Lista limpia: tipo, producto, tipo de hielo (si aplica), cantidad, fecha, usuario, origen
// - Modal "Detalles" SIEMPRE intenta mostrar el tipo de hielo mermado (MERMA_BOLSA)
//   - Lee tipoHielo / tipoHieloContenido / legacy + soporte batch (items[])
// - Sin campos crudos
//
// ✅ FIX CLAVE (TU BUG):
// - MERMA_BOLSA puede traer bolsaVaciaCodigo=BVxxx como referencia.
//   Antes lo clasificabas como BV y por eso NO mostraba tipo de hielo.
// - Ahora la clasificación prioriza tipo/subtipo sobre heurísticas por códigos.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { db } from '@/lib/firebase/config.client';
import {
  collection,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  type QuerySnapshot,
  type DocumentData,
  type QueryDocumentSnapshot,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';

import {
  AlertTriangle,
  Loader2,
  Search,
  PackageMinus,
  Cuboid,
  ArrowLeft,
  Warehouse,
  Sparkles,
  User,
  Clock,
  Hash,
  Layers,
  Info,
  X,
  Tag,
} from 'lucide-react';

import type { IceType } from '@/lib/utils/types/product.types';
import { ETIQUETAS_TIPO_HIELO, TIPOS_HIELO } from '@/lib/utils/types/product.types';

/* =========================
   Types
========================= */
type Movimiento = {
  id: string;

  tipo?: string;
  subtipo?: string;

  productoCodigo?: string;
  productoNombre?: string;

  bolsaVaciaCodigo?: string; // BVxxx (a veces referencia incluso en MERMA_BOLSA)
  tipoHielo?: string;
  tipoHieloContenido?: string;

  cuartosFuente?: string; // DISPONIBLES/USADOS

  cantidad?: number; // recomendado
  deltaPrincipal?: number; // legacy (NO mostrar)

  creadoPor?: string;
  origen?: string;

  fecha?: any;
  createdAt?: any;

  afectaStock?: boolean;

  // soporte batch: items[]
  items?: Array<Record<string, unknown>>;

  [k: string]: unknown;
};

type MermaKind = 'BOLSA' | 'BV' | 'BARRA';

const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();
const safeNum = (v: unknown, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
const safeIntAbs = (v: unknown) => Math.max(0, Math.floor(Math.abs(safeNum(v, 0))));

const fmtDate = (v: unknown) => {
  try {
    if (!v) return '';
    const maybe = v as any;
    if (typeof maybe?.toDate === 'function') return maybe.toDate().toLocaleString('es-MX');
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-MX');
  } catch {
    return '';
  }
};

const normalizeIceType = (raw: unknown): IceType | null => {
  const v = String(raw ?? '').trim().toUpperCase();
  if (!v) return null;
  return (TIPOS_HIELO as readonly string[]).includes(v) ? (v as IceType) : null;
};

/* =========================
   Merma detection / classify
========================= */
const isMermaMovimiento = (m: Movimiento) => {
  const t = norm(m.tipo);
  const st = norm(m.subtipo);
  const joined = `${t} ${st}`;

  // tu nuevo estándar
  if (t === 'MERMA_BOLSA' || st === 'MERMA_BOLSA') return true;
  if (t === 'MERMA_BV' || st === 'MERMA_BV') return true;
  if (t === 'MERMA_BARRA' || st === 'MERMA_BARRA') return true;

  // legacy (no rompemos)
  if (joined.includes('MERMA')) return true;

  return false;
};

const classifyMermaKind = (m: Movimiento): MermaKind => {
  const t = norm(m.tipo);
  const st = norm(m.subtipo);

  // ✅ PRIORIDAD: lo que diga el movimiento
  if (t === 'MERMA_BARRA' || st === 'MERMA_BARRA') return 'BARRA';
  if (t === 'MERMA_BV' || st === 'MERMA_BV') return 'BV';
  if (t === 'MERMA_BOLSA' || st === 'MERMA_BOLSA') return 'BOLSA';

  const pc = norm(m.productoCodigo);
  const bv = norm(m.bolsaVaciaCodigo);

  // heurística barra
  if (t.includes('BARRA') || st.includes('BARRA') || pc.startsWith('BR')) return 'BARRA';

  // heurística BV
  if (t.includes('BOLSA_VACIA') || st.includes('BOLSA_VACIA')) return 'BV';
  if (pc.startsWith('BV')) return 'BV';

  // ⚠️ fallback por bolsaVaciaCodigo SOLO si no hay nada más
  if (bv.startsWith('BV')) return 'BV';

  return 'BOLSA';
};

/* =========================
   Tipo de hielo (robusto)
========================= */
const getTipoHieloFromAny = (obj: any): IceType | null => {
  if (!obj) return null;

  // directo
  const th1 = normalizeIceType(obj.tipoHielo ?? obj.tipoHieloContenido);
  if (th1) return th1;

  // legacy comunes
  const th2 = normalizeIceType(obj.iceType ?? obj.tipo_hielo ?? obj.hieloTipo ?? obj.tipoHieloMermado);
  if (th2) return th2;

  // nested
  const th3 = normalizeIceType(obj?.meta?.tipoHielo ?? obj?.detalles?.tipoHielo ?? obj?.data?.tipoHielo);
  if (th3) return th3;

  return null;
};

const getTipoHieloMerma = (m: Movimiento): IceType | null => {
  const direct = getTipoHieloFromAny(m);
  if (direct) return direct;

  const items = Array.isArray(m.items) ? m.items : [];
  for (const it of items) {
    const th = getTipoHieloFromAny(it);
    if (th) return th;
  }

  const fallback =
    getTipoHieloFromAny((m as any)?.producto) ??
    getTipoHieloFromAny((m as any)?.payload) ??
    getTipoHieloFromAny((m as any)?.data);

  return fallback ?? null;
};

/* =========================
   Helpers display
========================= */
const getCodigo = (m: Movimiento, kind?: MermaKind) => {
  const k = kind ?? classifyMermaKind(m);

  const pc = String(m.productoCodigo ?? '').trim().toUpperCase();
  const bv = String(m.bolsaVaciaCodigo ?? '').trim().toUpperCase();

  // ✅ FIX: para MERMA_BOLSA mostramos el código de producto (BVxxx), no “referencias raras”
  if (k === 'BV') return bv || pc || '—';
  return pc || bv || '—';
};

const esMaquila = (nombre: unknown) =>
  /maquila/i.test(String(nombre ?? '').trim());

const extractKgFromText = (value: unknown): number | null => {
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (!match) return null;

  const kg = Number(match[1]);
  return Number.isFinite(kg) ? kg : null;
};

const buildNombreBolsaLlena = (nombreBase: unknown) => {
  const nombre = String(nombreBase ?? '').trim();
  const kg = extractKgFromText(nombre);
  const maquila = esMaquila(nombre);

  if (kg != null && kg > 0) {
    return maquila ? `Bolsa llena ${kg}kg MAQUILA` : `Bolsa llena ${kg}kg`;
  }

  return nombre || 'Bolsa llena';
};

const getNombre = (m: Movimiento) => {
  const raw = String(m.productoNombre ?? '').trim() || '—';
  const kind = classifyMermaKind(m);

  // Sólo las mermas de producto lleno se normalizan como "Bolsa llena".
  if (kind === 'BOLSA') return buildNombreBolsaLlena(raw);

  return raw;
};

const getEsMaquila = (m: Movimiento) => {
  if (esMaquila(m.productoNombre)) return true;

  const items = Array.isArray(m.items) ? m.items : [];
  return items.some((it) => esMaquila((it as any)?.productoNombre));
};

const getQty = (m: Movimiento) => safeIntAbs(m.cantidad ?? m.deltaPrincipal ?? 0);

const getFuente = (m: Movimiento) => String(m.cuartosFuente ?? '').trim().toUpperCase();

/* =========================
   UI Components
========================= */
function Badge({
  kind,
  children,
}: {
  kind: 'rose' | 'cyan' | 'violet' | 'amber' | 'emerald' | 'slate';
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    rose: 'bg-rose-500/15 ring-rose-400/30 text-rose-100',
    cyan: 'bg-cyan-500/15 ring-cyan-400/30 text-cyan-100',
    violet: 'bg-violet-500/15 ring-violet-400/30 text-violet-100',
    amber: 'bg-amber-500/15 ring-amber-400/30 text-amber-100',
    emerald: 'bg-emerald-500/15 ring-emerald-400/30 text-emerald-100',
    slate: 'bg-white/10 ring-white/15 text-white/90',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ${map[kind]}`}>
      {children}
    </span>
  );
}

function QtyPill({ qtyAbs }: { qtyAbs: number }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-rose-600/25 to-rose-500/10 ring-1 ring-rose-400/25 px-3 py-2">
      <span className="text-xs text-rose-200/80">MERMA</span>
      <span className="text-lg font-bold text-rose-100 tabular-nums">-{qtyAbs}</span>
    </div>
  );
}

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-3xl items-start justify-center pt-6 md:pt-10">
        <div className="w-full max-h-[90vh] overflow-hidden rounded-3xl bg-gradient-to-br from-gray-950 via-black to-gray-950 ring-1 ring-white/10 shadow-2xl flex flex-col">
          <div className="sticky top-0 z-10 px-5 py-4 border-b border-white/10 bg-black/40">
            <div className="flex justify-between items-center gap-3">
              <h3 className="text-white text-base font-semibold flex items-center gap-2">
                <Info className="h-4 w-4 text-amber-300" />
                {title}
              </h3>
              <button
                onClick={onClose}
                className="rounded-xl bg-white/5 p-2 ring-1 ring-white/10 hover:bg-white/10"
                type="button"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4 text-white/80" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 text-white">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Page
========================= */
export default function MermasPage() {
  const router = useRouter();

  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [loading, setLoading] = useState(false);

  const [qText, setQText] = useState('');

  const [openDetails, setOpenDetails] = useState(false);
  const [selected, setSelected] = useState<Movimiento | null>(null);

  // ✅ Listener de movimientos (solo lectura, inventario ya se ajusta con afectaStock)
  useEffect(() => {
    let unsub: Unsubscribe | null = null;
    let cancelled = false;

    const toRow = (d: QueryDocumentSnapshot<DocumentData>): Movimiento =>
      ({ id: d.id, ...(d.data() as Record<string, unknown>) } as Movimiento);

    const subscribe = (field: 'fecha' | 'createdAt') => {
      setLoading(true);

      const qy = query(collection(db, 'movimientos'), orderBy(field, 'desc'), qLimit(1400));

      unsub = onSnapshot(
        qy,
        (snap: QuerySnapshot<DocumentData>) => {
          if (cancelled) return;
          const rows = snap.docs.map(toRow);
          setMovs(rows.filter(isMermaMovimiento));
          setLoading(false);
        },
        (err: FirestoreError) => {
          if (cancelled) return;

          // fallback si falta índice/field
          if (field === 'fecha') {
            try {
              if (unsub) unsub();
            } catch {}
            subscribe('createdAt');
            return;
          }

          console.error('[movimientos] onSnapshot error:', err);
          setMovs([]);
          setLoading(false);
        },
      );
    };

    subscribe('fecha');

    return () => {
      cancelled = true;
      try {
        if (unsub) unsub();
      } catch {}
    };
  }, []);

  const filtered = useMemo(() => {
    const t = qText.trim().toLowerCase();
    if (!t) return movs;

    return movs.filter((m) => {
      const kind = classifyMermaKind(m);
      const codigo = getCodigo(m, kind).toLowerCase();
      const nombre = getNombre(m).toLowerCase();
      const nombreOriginal = String(m.productoNombre ?? '').toLowerCase();
      const maquila = getEsMaquila(m) ? 'maquila' : '';
      const por = String(m.creadoPor ?? '').toLowerCase();
      const org = String(m.origen ?? '').toLowerCase();

      const th = getTipoHieloMerma(m);
      const thLabel = th ? ETIQUETAS_TIPO_HIELO[th].toLowerCase() : '';

      const fuente = getFuente(m).toLowerCase();

      // nota: no hay filtro por tipo, solo search
      return (
        kind.toLowerCase().includes(t) ||
        codigo.includes(t) ||
        nombre.includes(t) ||
        nombreOriginal.includes(t) ||
        maquila.includes(t) ||
        por.includes(t) ||
        org.includes(t) ||
        thLabel.includes(t) ||
        fuente.includes(t)
      );
    });
  }, [movs, qText]);

  const totals = useMemo(() => {
    let bolsa = 0;
    let bv = 0;
    let barra = 0;

    for (const m of filtered) {
      const qty = getQty(m);
      const kind = classifyMermaKind(m);
      if (kind === 'BARRA') barra += qty;
      else if (kind === 'BV') bv += qty;
      else bolsa += qty;
    }

    return { total: bolsa + bv + barra, bolsa, bv, barra, rows: filtered.length };
  }, [filtered]);

  const open = useCallback((m: Movimiento) => {
    setSelected(m);
    setOpenDetails(true);
  }, []);

  const detailsTitle = useMemo(() => {
    if (!selected) return 'Detalles';
    const kind = classifyMermaKind(selected);
    const codigo = getCodigo(selected, kind);
    const nombre = getNombre(selected);
    const maquila = getEsMaquila(selected);
    return `${kind === 'BARRA' ? 'MERMA BARRA' : kind === 'BV' ? 'MERMA BV' : 'MERMA BOLSA'} · ${nombre}${maquila ? ' · MAQUILA' : ''} · ${codigo}`;
  }, [selected]);

  return (
    <div className="min-h-screen w-full px-6 py-6 bg-gradient-to-br from-gray-900 via-gray-950 to-black">
      <div className="mx-auto max-w-6xl">
        {/* HEADER */}
        <div className="mb-8 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => router.push('/admin/dashboard')}
              className="p-3 bg-gradient-to-br from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 rounded-xl text-gray-400 hover:text-white transition-all duration-300 hover:scale-105 mt-1"
              title="Volver al Dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="p-3 rounded-xl bg-gradient-to-r from-rose-900/60 via-purple-800/60 to-cyan-900/60 backdrop-blur-sm border border-rose-700/30 shadow-lg">
              <PackageMinus className="h-10 w-10 text-rose-300" />
            </div>

            <div>
              <h1 className="text-3xl font-bold text-white bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                Mermas de Inventario
              </h1>
              <p className="text-gray-400 text-sm mt-2 flex items-center gap-2">
                <Info className="h-4 w-4" />
                Historial de bolsas llenas, bolsas vacías y barras
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => router.push('/admin/dashboard/inventario')}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-gray-800 to-gray-900 text-gray-300 rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 hover:text-white transition-all duration-300"
          >
            <Warehouse className="h-5 w-5" />
            Inventario
          </button>
        </div>

        {/* RESUMEN */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="rounded-xl p-4 border border-gray-800/50 bg-gradient-to-br from-slate-900/50 to-slate-800/30 shadow-lg">
            <div className="text-xs text-gray-400">Registros</div>
            <div className="mt-1 text-2xl font-bold text-white tabular-nums">{totals.rows}</div>
          </div>

          <div className="rounded-xl p-4 border border-rose-800/30 bg-gradient-to-br from-rose-900/35 to-rose-800/20 shadow-lg">
            <div className="text-xs text-rose-300">Total mermado</div>
            <div className="mt-1 text-2xl font-bold text-rose-200 tabular-nums">-{totals.total}</div>
          </div>

          <div className="rounded-xl p-4 border border-orange-800/30 bg-gradient-to-br from-orange-900/30 to-orange-800/15 shadow-lg">
            <div className="text-xs text-orange-300">Bolsas llenas</div>
            <div className="mt-1 text-2xl font-bold text-orange-200 tabular-nums">-{totals.bolsa}</div>
          </div>

          <div className="rounded-xl p-4 border border-cyan-800/30 bg-gradient-to-br from-cyan-900/30 to-cyan-800/15 shadow-lg">
            <div className="text-xs text-cyan-300">Bolsas vacías</div>
            <div className="mt-1 text-2xl font-bold text-cyan-200 tabular-nums">-{totals.bv}</div>
          </div>

          <div className="rounded-xl p-4 border border-violet-800/30 bg-gradient-to-br from-violet-900/30 to-violet-800/15 shadow-lg">
            <div className="text-xs text-violet-300">Barra / cuartos</div>
            <div className="mt-1 text-2xl font-bold text-violet-200 tabular-nums">-{totals.barra}</div>
          </div>
        </div>

        {/* BUSCADOR */}
        <div className="mb-6 bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl border border-gray-700/50 shadow-xl p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Search className="h-5 w-5 text-purple-300" />
                Buscar en historial
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Código, producto, tipo de hielo, maquila, usuario u origen.
              </p>
            </div>

            <div className="relative w-full md:w-[440px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                placeholder="Buscar merma..."
                className="w-full pl-10 pr-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 backdrop-blur-sm"
              />
            </div>
          </div>
        </div>

        {/* LIST */}
        <section className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl border border-gray-700/50 shadow-xl overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-700/50 bg-gradient-to-r from-gray-900/60 to-gray-800/40 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Historial de Mermas</h2>
              <p className="mt-1 text-sm text-gray-400">Movimientos que redujeron inventario</p>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-white/60">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
              </div>
            ) : (
              <Badge kind="slate">
                <Sparkles className="h-3.5 w-3.5 text-amber-300" /> Mermas Registradas
              </Badge>
            )}
          </div>

          <div className="p-6">
          {!loading && filtered.length === 0 ? (
            <div className="rounded-xl bg-black/20 p-4 text-sm text-white/60 ring-1 ring-white/10">
              Sin mermas registradas.
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((m) => {
                const kind = classifyMermaKind(m);
                const fecha = fmtDate(m.fecha ?? m.createdAt);

                const codigo = getCodigo(m, kind);
                const nombre = getNombre(m);
                const qtyAbs = getQty(m);
                const isMaquila = getEsMaquila(m);

                const th = kind === 'BOLSA' ? getTipoHieloMerma(m) : null;
                const thLabel = th ? ETIQUETAS_TIPO_HIELO[th] : '';

                const fuente = kind === 'BARRA' ? getFuente(m) : '';

                const badgeKind = kind === 'BARRA' ? 'violet' : kind === 'BV' ? 'cyan' : 'rose';
                const titleIcon =
                  kind === 'BARRA' ? <Cuboid className="h-4 w-4" /> : <PackageMinus className="h-4 w-4" />;
                const title = kind === 'BARRA' ? 'MERMA BARRA' : kind === 'BV' ? 'MERMA BV' : 'MERMA BOLSA';

                return (
                  <div
                    key={m.id}
                    className={`rounded-2xl p-5 border shadow-lg transition-all duration-300 hover:-translate-y-0.5 ${
                      isMaquila
                        ? 'bg-gradient-to-br from-amber-950/20 to-gray-900/30 border-amber-700/30 hover:border-amber-600/40'
                        : 'bg-gradient-to-br from-gray-900/60 to-gray-900/30 border-gray-700/40 hover:border-gray-600/60'
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge kind={badgeKind as any}>
                            {titleIcon}
                            {title}
                          </Badge>

                          {isMaquila ? (
                            <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1 text-[10px] font-black tracking-[0.12em] text-amber-300">
                              MAQUILA
                            </span>
                          ) : null}

                          <Badge kind="amber">
                            <Clock className="h-3.5 w-3.5" />
                            {fecha || '—'}
                          </Badge>

                          {m.creadoPor ? (
                            <Badge kind="emerald">
                              <User className="h-3.5 w-3.5" />
                              {String(m.creadoPor)}
                            </Badge>
                          ) : null}

                          {/* tipo de hielo en lista (solo bolsa llena) */}
                          {kind === 'BOLSA' ? (
                            th ? (
                              <Badge kind="slate">
                                <Tag className="h-3.5 w-3.5" />
                                {thLabel}
                              </Badge>
                            ) : (
                              <Badge kind="amber">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                sin tipo hielo
                              </Badge>
                            )
                          ) : null}

                          {/* fuente para barra */}
                          {kind === 'BARRA' && fuente ? (
                            <Badge kind="slate">
                              <Hash className="h-3.5 w-3.5" />
                              {fuente}
                            </Badge>
                          ) : null}


                          <button
                            type="button"
                            onClick={() => open(m)}
                            className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-1.5 text-xs text-white/80 ring-1 ring-white/10 hover:bg-white/10"
                          >
                            <Info className="h-3.5 w-3.5" />
                            Detalles
                          </button>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                          <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                            <div className="text-xs text-white/50">
                              {kind === 'BOLSA' ? 'Producto lleno' : kind === 'BV' ? 'Bolsa vacía' : 'Barra'}
                            </div>
                            <div className="mt-1 text-sm font-semibold text-white break-words">{nombre}</div>

                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/55">
                              <Badge kind="slate">
                                <Hash className="h-3.5 w-3.5" />
                                <span className="font-mono">{codigo}</span>
                              </Badge>
                            </div>
                          </div>

                          <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                            <div className="text-xs text-white/50">Origen</div>
                            <div className="mt-1 text-sm text-white/80">{m.origen ? String(m.origen) : '—'}</div>
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0">
                        <QtyPill qtyAbs={qtyAbs} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && filtered.length > 0 ? (
            <div className="mt-4 text-xs text-white/50">
              Mostrando: <b className="text-white">{filtered.length}</b>
            </div>
          ) : null}

          {!loading && movs.length === 0 ? (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-400/20">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
              <div className="text-sm text-white/75">
                Si ya hiciste mermas pero aquí no aparece nada, revisa que estés creando movimientos tipo{' '}
                <b>MERMA_BOLSA</b>, <b>MERMA_BV</b> y <b>MERMA_BARRA</b>.
              </div>
            </div>
          ) : null}
          </div>
        </section>
      </div>

      {/* DETAILS MODAL */}
      <Modal
        open={openDetails}
        title={detailsTitle}
        onClose={() => {
          setOpenDetails(false);
          setSelected(null);
        }}
      >
        {!selected ? (
          <div className="text-sm text-white/60">Sin selección.</div>
        ) : (
          (() => {
            const kind = classifyMermaKind(selected);
            const fecha = fmtDate(selected.fecha ?? selected.createdAt);
            const qtyAbs = getQty(selected);

            const codigo = getCodigo(selected, kind);
            const nombre = getNombre(selected);
            const isMaquila = getEsMaquila(selected);

            // tipo de hielo (solo bolsa llena)
            const th = kind === 'BOLSA' ? getTipoHieloMerma(selected) : null;
            const thLabel = th ? ETIQUETAS_TIPO_HIELO[th] : null;

            const fuente = kind === 'BARRA' ? getFuente(selected) : '';
            const origen = selected.origen ? String(selected.origen) : '—';
            const por = selected.creadoPor ? String(selected.creadoPor) : '—';

            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge kind={kind === 'BARRA' ? 'violet' : kind === 'BV' ? 'cyan' : 'rose'}>
                    <Info className="h-3.5 w-3.5" />
                    {kind === 'BARRA' ? 'BARRA (cuartos)' : kind === 'BV' ? 'BOLSA VACÍA' : 'BOLSA LLENA'}
                  </Badge>

                  {isMaquila ? (
                    <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1 text-[10px] font-black tracking-[0.12em] text-amber-300">
                      MAQUILA
                    </span>
                  ) : null}

                  <Badge kind="amber">
                    <Clock className="h-3.5 w-3.5" />
                    {fecha || '—'}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                    <div className="text-xs text-white/50">Cantidad</div>
                    <div className="mt-1 text-2xl font-bold text-rose-100 tabular-nums">-{qtyAbs}</div>
                    <div className="mt-1 text-[11px] text-white/35">Merma</div>
                  </div>

                  <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 md:col-span-2">
                    <div className="text-xs text-white/50">
                      {kind === 'BOLSA' ? 'Producto lleno' : kind === 'BV' ? 'Bolsa vacía' : 'Barra'}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-white break-words">{nombre}</div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/55">
                      <Badge kind="slate">
                        <Hash className="h-3.5 w-3.5" />
                        <span className="font-mono">{codigo}</span>
                      </Badge>

                      {kind === 'BOLSA' ? (
                        thLabel ? (
                          <Badge kind="slate">
                            <Tag className="h-3.5 w-3.5" />
                            Tipo de hielo: <span className="font-semibold">{thLabel}</span>
                          </Badge>
                        ) : (
                          <Badge kind="amber">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Tipo de hielo: <b>NO GUARDADO</b>
                          </Badge>
                        )
                      ) : null}

                      {kind === 'BARRA' && fuente ? (
                        <Badge kind="slate">
                          <Hash className="h-3.5 w-3.5" />
                          Fuente: <span className="font-semibold">{fuente}</span>
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-xs text-white/50">Origen</div>
                  <div className="mt-2 text-sm text-white/80">{origen}</div>
                </div>

                {kind === 'BOLSA' && !thLabel ? (
                  <div className="rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-400/20 text-sm text-white/80">
                    Esta merma no trae <b>tipoHielo</b> (o <b>tipoHieloContenido</b>) en el movimiento (ni en items[]).
                    <br />
                    Para que SIEMPRE aparezca aquí, el movimiento <b>MERMA_BOLSA</b> debe guardar <b>tipoHielo</b>.
                  </div>
                ) : null}
              </div>
            );
          })()
        )}
      </Modal>
    </div>
  );
}