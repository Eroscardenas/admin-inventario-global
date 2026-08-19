/* eslint-disable @typescript-eslint/no-explicit-any */


'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { useAuthContext } from '@/context/AuthContext';
import { useProducts } from '@/lib/hooks/useProducts';

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

import type {
  BolsaProduct,
  IceType,
  StockPorHieloConfig,
  ProductStatus,
  BarraProduct,
} from '@/lib/utils/types/product.types';
import { TIPOS_HIELO, ETIQUETAS_TIPO_HIELO } from '@/lib/utils/types/product.types';

import ActualizarCuartosBarraModal from '@/app/admin/dashboard/inventario/ActualizarCuartosBarraModal';

// ✅ Tu service real
import { MermasService } from '@/lib/services/merma.service';

import {
  ArrowLeft,
  RefreshCw,
  Droplets,
  BadgeCheck,
  PlusCircle,
  Settings,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Cuboid,
  Loader2,
  Warehouse,
  Package,
  BarChart3,
  Info,
  Snowflake,
  Database,
  Plus,
  RotateCcw,
  Pencil,
  ToggleLeft,
  ToggleRight,
  MinusCircle,
} from 'lucide-react';

/* ================= helpers ================= */
const safeNum = (n: unknown, f = 0) => (Number.isFinite(Number(n)) ? Number(n) : f);
const safeInt0 = (n: unknown, f = 0) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return f;
  const i = Math.floor(v);
  return i < 0 ? f : i;
};
const safePosInt = (n: unknown, f = 1) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return f;
  const i = Math.floor(v);
  return i <= 0 ? f : i;
};
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const pct = (v: number, m: number) => (m > 0 ? Math.min(100, (v / m) * 100) : 0);

const normalizeIceType = (raw: unknown): IceType | null => {
  const v = String(raw ?? '').trim().toUpperCase();
  if (!v) return null;
  return (TIPOS_HIELO as readonly string[]).includes(v) ? (v as IceType) : null;
};

const buildNombreBolsaLlena = (pesoKg: number, nombreBV?: string) => {
  const kg = safeNum(pesoKg, 0);
  const nombreBolsaVacia = String(nombreBV ?? '').trim();
  const esMaquila = /maquila/i.test(nombreBolsaVacia);

  if (kg <= 0) {
    return esMaquila ? 'Bolsa llena MAQUILA' : 'Bolsa llena';
  }

  return esMaquila
    ? `Bolsa llena ${kg}kg MAQUILA`
    : `Bolsa llena ${kg}kg`;
};

const esBolsaMaquila = (nombreBV: unknown) => /maquila/i.test(String(nombreBV ?? '').trim());

/**
 * Reglas VISUALES del catálogo de cámara fría.
 * No cambian Firestore ni la lógica de stock.
 *
 * Se muestran:
 * - Todas las configuraciones con stock > 0
 * - Aunque estén en 0:
 *   3kg ROLITO
 *   5kg ROLITO normal
 *   5kg ROLITO maquila
 *   5kg GOURMET
 *   10kg ENFRIAR
 *   15kg ROLITO
 *   15kg FRAPPE
 *   20kg BARRA
 */
const mantenerConfiguracionEnCero = (opts: {
  pesoKg: number;
  tipoHielo: IceType;
  esMaquila: boolean;
}) => {
  const kg = safeNum(opts.pesoKg, 0);
  const tipo = opts.tipoHielo;

  if (kg === 3 && tipo === 'ROLITO') return true;

  if (kg === 5 && tipo === 'ROLITO') {
    // Aplica tanto a la bolsa normal como a la de maquila.
    return true;
  }

  if (kg === 5 && tipo === 'GOURMET') return true;
  if (kg === 10 && tipo === 'ENFRIAR') return true;
  if (kg === 15 && (tipo === 'ROLITO' || tipo === 'FRAPPE')) return true;
  if (kg === 20 && tipo === 'BARRA') return true;

  return false;
};

const debeMostrarConfiguracion = (opts: {
  stockActual: number;
  pesoKg: number;
  tipoHielo: IceType;
  esMaquila: boolean;
}) => {
  if (safeNum(opts.stockActual, 0) > 0) return true;

  return mantenerConfiguracionEnCero({
    pesoKg: opts.pesoKg,
    tipoHielo: opts.tipoHielo,
    esMaquila: opts.esMaquila,
  });
};

function extractKgFromNombre(nombre: unknown): number | null {
  const s = String(nombre ?? '');
  const m = s.match(/(\d+)\s?kg/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * ✅ detecta tipos configurados aunque el doc traiga tipo suelto
 */
function getTiposConfigurados(bv: BolsaProduct): IceType[] {
  const buckets: unknown[] = [];

  const a = (bv as any).configuracionAdmin?.tiposHieloConfigurados;
  if (Array.isArray(a) && a.length) buckets.push(...a);

  const b = (bv as any).configuracionEspecifica?.tiposHieloHabilitados;
  if (Array.isArray(b) && b.length) buckets.push(...b);

  const c = (bv as any).tiposHieloPermitidos;
  if (Array.isArray(c) && c.length) buckets.push(...c);

  const single1 = (bv as any).tipoHielo;
  const single2 = (bv as any).iceType;
  const single3 = (bv as any).tipoHieloContenido;
  const single4 = (bv as any).tipo;
  [single1, single2, single3, single4].forEach((x) => {
    const n = normalizeIceType(x);
    if (n) buckets.push(n);
  });

  const normalized = buckets.map((x) => normalizeIceType(x)).filter(Boolean) as IceType[];
  const uniq = Array.from(new Set<IceType>(normalized));

  return uniq.length ? uniq : ([...TIPOS_HIELO] as IceType[]);
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <div className="p-1.5 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 rounded-lg">
      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    </div>
  ) : (
    <div className="p-1.5 bg-gradient-to-br from-rose-500/20 to-rose-600/10 rounded-lg">
      <XCircle className="h-4 w-4 text-rose-400" />
    </div>
  );
}

const IceTypeChip = ({ tipo }: { tipo: IceType }) => {
  const getIceTypeColor = (type: IceType) => {
    const colors: Record<IceType, string> = {
      BARRA: 'bg-gradient-to-r from-purple-600 to-purple-700',
      ROLITO: 'bg-gradient-to-r from-blue-800 to-blue-900',
      FRAPPE: 'bg-gradient-to-r from-pink-800 to-pink-900',
      GOURMET: 'bg-gradient-to-r from-sky-700 to-sky-800',
      ENFRIAR: 'bg-gradient-to-r from-blue-600 to-blue-700',
    };
    return colors[type] || 'bg-gradient-to-r from-gray-600 to-gray-700';
  };

  return (
    <span
      className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs ${getIceTypeColor(
        tipo,
      )} text-white shadow-md`}
    >
      {tipo === 'BARRA' ? (
        <Cuboid className="h-3 w-3 mr-1.5" />
      ) : (
        <Snowflake className="h-3 w-3 mr-1.5" />
      )}
      {ETIQUETAS_TIPO_HIELO[tipo]}
    </span>
  );
};

/* ================= MODAL ================= */
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
      className="fixed inset-0 z-50 bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-xl items-start justify-center pt-6 md:pt-10">
        <div className="w-full max-h-[90vh] overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800/50 shadow-2xl flex flex-col">
          <div className="sticky top-0 z-10 px-6 py-4 border-b border-gray-800 bg-gradient-to-r from-gray-900 to-gray-800/80">
            <div className="flex justify-between items-center gap-3">
              <h3 className="text-white text-lg font-semibold flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-400" />
                {title}
              </h3>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors duration-300 p-2 hover:bg-gray-800/50 rounded-lg"
                type="button"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 text-white">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * ✅ normaliza cuartos para UI
 */
function computeCuartosUI(raw: { tot: number; cuartosDisponibles?: unknown; cuartosUsados?: unknown }) {
  const tot = Math.max(0, Math.floor(Number(raw.tot ?? 0)));
  const rd = Number(raw.cuartosDisponibles);
  const ru = Number(raw.cuartosUsados);

  const hasD = Number.isFinite(rd);
  const hasU = Number.isFinite(ru);

  let disponibles = tot;

  if (hasD && hasU) {
    const d = clamp(Math.floor(rd), 0, tot);
    const u = clamp(Math.floor(ru), 0, tot);

    const errCorrect = Math.abs(u - (tot - d));
    const errSwapped = Math.abs(d - (tot - u));

    disponibles = errSwapped < errCorrect ? u : d;
  } else if (hasD) {
    disponibles = clamp(Math.floor(rd), 0, tot);
  } else if (hasU) {
    const usados = clamp(Math.floor(ru), 0, tot);
    disponibles = clamp(tot - usados, 0, tot);
  } else {
    disponibles = tot;
  }

  const usados = clamp(tot - disponibles, 0, tot);

  return { tot, disponibles, usados };
}


/* ================= page ================= */
type Movimiento = {
  id: string;
  tipo?: string;
  subtipo?: string;
  bolsaVaciaCodigo?: string;
  productoCodigo?: string;
  productoNombre?: string;
  tipoHielo?: string;
  tipoHieloContenido?: string;
  cantidad?: number;
  deltaPrincipal?: number;
  afectaStock?: boolean;
  fecha?: unknown;
  createdAt?: unknown;
  [k: string]: unknown;
};

type MermaTipoProducto = 'BOLSA' | 'BARRA' | 'BOLSA_VACIA';
type CuartosFuente = 'DISPONIBLES' | 'USADOS';

// ✅ Razones preset (lo que pediste)
const MERMA_RAZONES_PRESET = [
  { value: 'DIFERENCIA_INVENTARIO', label: 'Diferencia de inventario' },
  { value: 'PRODUCTO_DERRAMADO', label: 'Producto derramado' },
  { value: 'BOLSA_ROTA', label: 'Bolsa rota' },
  { value: 'MALA_CALIDAD', label: 'Mala calidad' },
  { value: 'CONTAMINACION', label: 'Contaminación' },
  { value: 'DESHIELO', label: 'Se derritió / deshielo' },
  { value: 'MERMA_OPERATIVA', label: 'Merma operativa' },
  { value: 'OTRO', label: 'Otro (especificar)' },
] as const;

type MermaRazonPreset = (typeof MERMA_RAZONES_PRESET)[number]['value'];

export default function InventarioAdminPage() {
  const router = useRouter();
  const { user } = useAuthContext();

  // 🔥 ojo: el hook ya trae BV robustas (por BVxxx) y stockLlenoPorProducto
  const { bolsasVacias, barras, actions, loading, reload, stockLlenoPorProducto } = useProducts();

  /* ===== feedback ===== */
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* =========================================================
     ✅ MOVIMIENTOS (para ajustar UI)
  ========================================================= */
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [movLoading, setMovLoading] = useState(false);

  useEffect(() => {
    const MOVS = 'movimientos';

    let unsub: Unsubscribe | null = null;
    let cancelled = false;

    const toRow = (d: QueryDocumentSnapshot<DocumentData>): Movimiento =>
      ({ id: d.id, ...(d.data() as Record<string, unknown>) } as Movimiento);

    const subscribe = (field: 'fecha' | 'createdAt') => {
      setMovLoading(true);

      const qy = query(collection(db, MOVS), orderBy(field, 'desc'), qLimit(1500));

      unsub = onSnapshot(
        qy,
        (snap: QuerySnapshot<DocumentData>) => {
          if (cancelled) return;
          const rows = snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => toRow(d));
          setMovimientos(rows);
          setMovLoading(false);
        },
        (err: FirestoreError) => {
          if (cancelled) return;

          // fallback fecha -> createdAt
          if (field === 'fecha') {
            try {
              if (unsub) unsub();
            } catch {}
            subscribe('createdAt');
            return;
          }

          console.error('[movimientos] onSnapshot error:', err);
          setMovimientos([]);
          setMovLoading(false);
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

  // =========================================================
  // ✅ Resolver BV desde movimiento (robusto)
  // =========================================================
  const resolveBVCodigoFromMovimiento = useCallback(
    (m: Movimiento): string => {
      const bv1 = String((m as any)?.bolsaVaciaCodigo ?? '')
        .trim()
        .toUpperCase();
      if (/^BV/.test(bv1)) return bv1;

      const pc = String((m as any)?.productoCodigo ?? '')
        .trim()
        .toUpperCase();
      if (/^BV/.test(pc)) return pc;

      // fallback por kg en nombre
      const kg = extractKgFromNombre((m as any)?.productoNombre);
      if (!kg) return '';

      const bv = (bolsasVacias ?? []).find((x: any) => Number(x?.pesoKg) === kg);
      return bv?.codigo ? String(bv.codigo).trim().toUpperCase() : '';
    },
    [bolsasVacias],
  );

  /**
   * ✅ Deltas por reglas (UI) PARA BOLSAS LLENAS (stockPorHielo)
   * ✅ NO DUPLICAR: si afectaStock:true -> skip
   * 🔥 FIX: merma/salida NUNCA suman
   */
  const deltasByKey = useMemo(() => {
    const out: Record<string, number> = {};
    const bump = (k: string, v: number) => {
      if (!k) return;
      if (!Number.isFinite(v) || v === 0) return;
      out[k] = (out[k] ?? 0) + v;
    };

    for (const m of movimientos ?? []) {
      if ((m as any)?.afectaStock === true) continue;

      const tipoRaw = String(m?.tipo ?? '').trim().toUpperCase();
      const subtipoRaw = String(m?.subtipo ?? '').trim().toUpperCase();

      const bvCodigo = resolveBVCodigoFromMovimiento(m);
      if (!bvCodigo) continue;

      const th = normalizeIceType((m as any)?.tipoHielo ?? (m as any)?.tipoHieloContenido);
      if (!th) continue;

      // cantidad/delta
      const rawCantidad = safeNum((m as any)?.cantidad, 0);
      const rawDelta = safeNum((m as any)?.deltaPrincipal, 0);

      const signed = rawDelta !== 0 ? rawDelta : rawCantidad;
      const absQty = Math.max(0, Math.floor(Math.abs(signed)));
      if (absQty <= 0) continue;

      const isCancel = tipoRaw.includes('CANCEL') || subtipoRaw.includes('CANCEL');
      const isMerma = !isCancel && (tipoRaw.includes('MERMA') || subtipoRaw.includes('MERMA'));
      const isSalida = tipoRaw.includes('SALIDA') || subtipoRaw.includes('SALIDA');
      const isDevol = tipoRaw.includes('DEVOL') || subtipoRaw.includes('DEVOL');

      const isLlenado =
        subtipoRaw === 'BOLSA_VACIA_A_STOCK_LLENO' ||
        subtipoRaw === 'BA_A_BL' ||
        subtipoRaw.includes('LLENADO') ||
        tipoRaw.includes('CONVERSION') ||
        tipoRaw.includes('PRODUCCION');

      const key = `${bvCodigo}__${th}`;

      if (isMerma || isSalida) {
        bump(key, -absQty);
        continue;
      }

      if (isDevol || isCancel || isLlenado) {
        bump(key, +absQty);
        continue;
      }

      // desconocido => NO tocar (evita sumas raras)
    }

    return out;
  }, [movimientos, resolveBVCodigoFromMovimiento]);

  /**
   * ✅ stockLlenoPorProductoUI (hook + deltas)
   * ✅ BARRA aquí ES bolsas llenas tipo BARRA (NO cuartos)
   */
  const stockLlenoPorProductoUI = useMemo(() => {
    const base = (stockLlenoPorProducto ?? []).map((p: any) => {
      const bvCodigo = String(p?.bolsaVaciaCodigo ?? '').trim().toUpperCase();

      const tipos = (p?.tipos ?? []).map((t: any) => {
        const th = normalizeIceType(t?.tipoHielo);
        if (!th) return t;

        const key = `${bvCodigo}__${th}`;
        const delta = safeNum(deltasByKey[key], 0);

        const stockBase = safeNum(t?.stockActual, 0);
        const stockNext = Math.max(0, safeInt0(stockBase + delta, 0));

        return {
          ...t,
          tipoHielo: th,
          stockActual: stockNext,
          _deltaUI: delta,
        };
      });

      const totalTipos = tipos.reduce((s: number, t: any) => {
        const th = normalizeIceType(t?.tipoHielo);
        if (!th) return s;
        return s + safeNum(t?.stockActual, 0);
      }, 0);

      return {
        ...p,
        bolsaVaciaCodigo: bvCodigo,
        tipos,
        totalLlenas: Number.isFinite(Number(totalTipos)) ? totalTipos : safeNum(p?.totalLlenas, 0),
      };
    });

    return base;
  }, [stockLlenoPorProducto, deltasByKey]);

  const stockLlenoTotalPorTipoUI = useMemo(() => {
    const out: Record<IceType, number> = {
      ROLITO: 0,
      FRAPPE: 0,
      GOURMET: 0,
      ENFRIAR: 0,
      BARRA: 0,
    };

    for (const p of stockLlenoPorProductoUI ?? []) {
      for (const t of (p as any)?.tipos ?? []) {
        const th = normalizeIceType(t?.tipoHielo);
        if (!th) continue;
        out[th] += safeNum(t?.stockActual, 0);
      }
    }

    return out;
  }, [stockLlenoPorProductoUI]);

  // ✅ total general (incluye BARRA bolsas tipo BARRA)
  const stockLlenoTotalGeneralUI = useMemo(() => {
    return (
      safeNum(stockLlenoTotalPorTipoUI.ROLITO, 0) +
      safeNum(stockLlenoTotalPorTipoUI.FRAPPE, 0) +
      safeNum(stockLlenoTotalPorTipoUI.GOURMET, 0) +
      safeNum(stockLlenoTotalPorTipoUI.ENFRIAR, 0) +
      safeNum(stockLlenoTotalPorTipoUI.BARRA, 0)
    );
  }, [stockLlenoTotalPorTipoUI]);

  // =======================
  // ✅ CÁMARA FRÍA — PRESENTACIONES REALES
  //    Visual solamente:
  //    - separa cada BV/presentación
  //    - distingue NORMAL / MAQUILA
  //    - oculta configuraciones en 0 salvo las permitidas
  // =======================
  const camaraPorPresentacion = useMemo(() => {
    const rows: Array<{
      key: string;
      codigoBV: string;
      nombreBV: string;
      nombreLleno: string;
      esMaquila: boolean;
      kg: number;
      tipos: Array<{
        tipoHielo: IceType;
        stockActual: number;
      }>;
      total: number;
    }> = [];

    for (const p of stockLlenoPorProductoUI ?? []) {
      const codigoBV = String((p as any)?.bolsaVaciaCodigo ?? '').trim().toUpperCase();
      if (!codigoBV) continue;

      const bv = (bolsasVacias ?? []).find(
        (x: any) => String(x?.codigo ?? '').trim().toUpperCase() === codigoBV,
      );
      if (!bv) continue;

      const kg = safeNum((p as any)?.pesoKg ?? (bv as any)?.pesoKg, 0);
      if (!(kg > 0)) continue;

      const nombreBV = String((p as any)?.productoNombre ?? (bv as any)?.nombre ?? '').trim();
      const esMaquila = esBolsaMaquila(nombreBV);
      const nombreLleno = buildNombreBolsaLlena(kg, nombreBV);

      const tipos = ((p as any)?.tipos ?? [])
        .map((t: any) => {
          const tipoHielo = normalizeIceType(t?.tipoHielo);
          if (!tipoHielo) return null;

          const stockActual = Math.max(0, safeInt0(t?.stockActual, 0));

          if (
            !debeMostrarConfiguracion({
              stockActual,
              pesoKg: kg,
              tipoHielo,
              esMaquila,
            })
          ) {
            return null;
          }

          return {
            tipoHielo,
            stockActual,
          };
        })
        .filter(Boolean) as Array<{
        tipoHielo: IceType;
        stockActual: number;
      }>;

      // Si esta presentación no tiene ningún tipo relevante, no se muestra.
      if (tipos.length === 0) continue;

      const total = tipos.reduce((sum, item) => sum + safeNum(item.stockActual, 0), 0);

      rows.push({
        key: codigoBV,
        codigoBV,
        nombreBV,
        nombreLleno,
        esMaquila,
        kg,
        tipos,
        total,
      });
    }

    return rows.sort((a, b) => {
      if (a.kg !== b.kg) return a.kg - b.kg;
      if (a.esMaquila !== b.esMaquila) return a.esMaquila ? 1 : -1;
      return a.codigoBV.localeCompare(b.codigoBV);
    });
  }, [stockLlenoPorProductoUI, bolsasVacias]);

  /* =========================================================
     ✅ SAFE CALLS (actions)
  ========================================================= */
  const crearBarraSafe = async (payload: {
    nombre: string;
    cantidad: number;
    creadoPor?: string;
    peso?: number;
    stockMinimo?: number;
    stockMaximo?: number;
  }) => {
    const fn: any = (actions as any)?.crearBarra;
    if (typeof fn !== 'function') throw new Error('actions.crearBarra no está disponible');

    if (fn.length >= 2) {
      return await fn(
        payload.nombre,
        payload.cantidad,
        payload.creadoPor ?? (user?.email ?? 'admin'),
        payload.peso,
        payload.stockMinimo,
        payload.stockMaximo,
      );
    }

    return await fn({
      nombre: payload.nombre,
      cantidad: payload.cantidad,
      creadoPor: payload.creadoPor ?? (user?.email ?? 'admin'),
      peso: payload.peso,
      stockMinimo: payload.stockMinimo,
      stockMaximo: payload.stockMaximo,
    });
  };

  const actualizarCuartosDesdeBarrasSafe = async (payload: { codigo: string; barrasFisicas: number }) => {
    const fn: any = (actions as any)?.actualizarCuartosDesdeBarras;
    if (typeof fn !== 'function') throw new Error('actions.actualizarCuartosDesdeBarras no está disponible');
    if (fn.length >= 2) return await fn(payload.codigo, payload.barrasFisicas);
    return await fn(payload);
  };

  const agregarProduccionBarraSafe = async (payload: {
    codigo: string;
    barrasProducidas: number;
    usuario?: string;
    observaciones?: string;
  }) => {
    const fn: any = (actions as any)?.agregarProduccionBarra;
    if (typeof fn !== 'function') throw new Error('actions.agregarProduccionBarra no está disponible');
    return await fn(payload);
  };

  const llenarStockDesdeBVSafe = async (payload: {
    bolsaVaciaCodigo: string;
    tipoHielo: IceType;
    cantidad: number;
    usuarioCodigo: string;
    usuarioNombre: string;
    origen: 'ADMIN';
    barraOrigenCodigo?: string;
    maquina?: string;
  }) => {
    const a1: any = (actions as any)?.llenarStockDesdeBolsaVacia;
    if (typeof a1 === 'function') return await a1(payload);

    const a2: any = (actions as any)?.llenarDesdeAdminStockPorHielo;
    if (typeof a2 === 'function') {
      const obs = `Llenado Admin · Máquina ${payload.maquina ?? ''}`.trim();
      return await a2({
        codigoBolsaVacia: payload.bolsaVaciaCodigo,
        tipoHielo: payload.tipoHielo,
        cantidad: payload.cantidad,
        usuario: payload.usuarioNombre,
        observaciones: obs,
        barraOrigenCodigo: payload.barraOrigenCodigo,
      });
    }

    const a3: any = (actions as any)?.simularLlenadoBolsa;
    if (typeof a3 === 'function') {
      return await a3({
        codigoBolsa: payload.bolsaVaciaCodigo,
        tipoHielo: payload.tipoHielo,
        cantidad: payload.cantidad,
        usuarioNombre: payload.usuarioNombre,
        barraOrigenCodigo: payload.barraOrigenCodigo,
      });
    }

    throw new Error(
      'No existe acción para llenar stock desde BV (llenarStockDesdeBolsaVacia / llenarDesdeAdminStockPorHielo)',
    );
  };

  const actualizarConfigStockPorHieloSafe = async (payload: {
    codigoProducto: string;
    stockPorHielo: Record<IceType, StockPorHieloConfig>;
    status: ProductStatus;
  }) => {
    const fn: any = (actions as any)?.actualizarConfigStockPorHielo;
    if (typeof fn !== 'function') throw new Error('actions.actualizarConfigStockPorHielo no está disponible');
    return await fn(payload);
  };

  /* =========================================================
     ✅ BARRA -> AUTO-LLENADO
  ========================================================= */
  const [autoFillBarra, setAutoFillBarra] = useState(true);

  const pickBVForBarra = useMemo(() => {
    const list = (bolsasVacias ?? [])
      .filter((bv: any) => getTiposConfigurados(bv as BolsaProduct).includes('BARRA'))
      .map((bv: any) => ({
        codigo: String(bv.codigo ?? '').trim().toUpperCase(),
        nombre: String(bv.nombre ?? 'BV'),
        cantidad: Math.max(0, Math.floor(safeNum(bv.cantidad, 0))),
        pesoKg: safeNum(bv.pesoKg, 0),
      }))
      .filter((x) => x.codigo);

    list.sort((a, b) => b.cantidad - a.cantidad);
    return list[0] ?? null;
  }, [bolsasVacias]);

  const autoFillFromBarra = async (opts: { barraCodigo: string; cuartos: number; maquina?: string }) => {
    if (!autoFillBarra) return { filled: 0, leftover: opts.cuartos };

    const cuartos = Math.max(0, Math.floor(opts.cuartos));
    if (cuartos <= 0) return { filled: 0, leftover: 0 };

    const bv = pickBVForBarra;
    if (!bv) return { filled: 0, leftover: cuartos };

    const maxFill = Math.max(0, Math.min(cuartos, bv.cantidad));
    if (maxFill <= 0) return { filled: 0, leftover: cuartos };

    await llenarStockDesdeBVSafe({
      bolsaVaciaCodigo: bv.codigo,
      tipoHielo: 'BARRA',
      cantidad: maxFill,
      usuarioCodigo: user?.email ?? 'ADMIN',
      usuarioNombre: user?.email ?? 'Admin',
      origen: 'ADMIN',
      barraOrigenCodigo: opts.barraCodigo,
      maquina: opts.maquina ?? 'M1',
    });

    return { filled: maxFill, leftover: cuartos - maxFill, bvCodigo: bv.codigo, bvNombre: bv.nombre };
  };

  /* =======================
     BARRAS UI + CUARTOS (tot/disp/usados)
  ======================= */
  const barrasUI = useMemo(() => {
    return (barras ?? [])
      .map((b: any) => {
        const cantidad = Math.max(0, Math.floor(safeNum(b?.cantidad, 0)));
        const cuartosTotales = Math.max(0, Math.floor(safeNum(b?.cuartosTotales, cantidad * 4)));

        const { disponibles, usados } = computeCuartosUI({
          tot: cuartosTotales,
          cuartosDisponibles: b?.cuartosDisponibles,
          cuartosUsados: b?.cuartosUsados,
        });

        return {
          ...b,
          codigo: String(b?.codigo ?? '').trim(),
          nombre: String(b?.nombre ?? 'Barra'),
          cantidad,
          cuartosTotales,
          cuartosDisponibles: disponibles,
          cuartosUsados: usados,
          stockMaximo: safeNum(b?.stockMaximo, 0),
          stockMinimo: safeNum(b?.stockMinimo, 0),
        };
      })
      .filter((b: any) => b.codigo)
      .sort((a: any, b: any) => String(a.codigo).localeCompare(String(b.codigo)));
  }, [barras]);

  // ✅ VISUAL ÚNICAMENTE:
  // La sección "Barras" toma como referencia el stock actual de tipo BARRA
  // que ya se muestra en Cámara Fría.
  // Ejemplo: 298 cuartos de barra = 74.50 barras.
  // NO modifica Firestore ni la lógica de producción/consumo.
  const cuartosBarraVisual = useMemo(
    () => Math.max(0, safeNum(stockLlenoTotalPorTipoUI.BARRA, 0)),
    [stockLlenoTotalPorTipoUI],
  );

  const barrasCompletasVisual = useMemo(
    () => cuartosBarraVisual / 4,
    [cuartosBarraVisual],
  );

  const barrasDisponibles = useMemo(() => {
    return (barrasUI ?? [])
      .map((b: any) => ({
        codigo: String(b?.codigo ?? ''),
        nombre: String(b?.nombre ?? 'Barra'),
        cuartosTotales: safeNum(b?.cuartosTotales, 0),
        cuartosDisponibles: safeNum(b?.cuartosDisponibles, 0),
        cuartosUsados: safeNum(b?.cuartosUsados, 0),
      }))
      .filter((b: any) => b.codigo)
      .sort((a: any, b: any) => a.codigo.localeCompare(b.codigo));
  }, [barrasUI]);

  /* =======================
     MODAL cuartos (tu modal)
  ======================= */
  const [openCuartos, setOpenCuartos] = useState(false);
  const [barraSel, setBarraSel] = useState<BarraProduct | null>(null);

  const openCuartosModal = (b: BarraProduct) => {
    setOkMsg(null);
    setErrMsg(null);
    setBarraSel(b);
    setOpenCuartos(true);
  };

  /* =======================
     Modal producción (SUMA) + AUTOFILL
  ======================= */
  const [openProd, setOpenProd] = useState(false);
  const [barraProd, setBarraProd] = useState<BarraProduct | null>(null);
  const [prodCount, setProdCount] = useState<number | ''>('');

  const openProduccionModal = (b: BarraProduct) => {
    setOkMsg(null);
    setErrMsg(null);
    setBarraProd(b);
    setProdCount('');
    setOpenProd(true);
  };

  const submitProduccion = async () => {
    if (!barraProd) return;

    const n = prodCount === '' ? 0 : Math.floor(Number(prodCount));
    if (!Number.isFinite(n) || n <= 0) return setErrMsg('Ingresa cuántas barras produjiste (>= 1)');

    const barraCodigo = String((barraProd as any).codigo ?? '').trim();
    if (!barraCodigo) return setErrMsg('Barra inválida (sin código)');

    try {
      setBusy(true);

      await agregarProduccionBarraSafe({
        codigo: barraCodigo,
        barrasProducidas: n,
        usuario: user?.email ?? 'ADMIN',
        observaciones: 'Producción registrada desde Inventario (Admin)',
      });

      const cuartos = n * 4;
      let msgExtra = '';
      if (autoFillBarra) {
        try {
          const r = await autoFillFromBarra({ barraCodigo, cuartos, maquina: 'M1' });
          if (r.filled > 0) {
            msgExtra =
              ` · Auto-llenado BARRA: +${r.filled} bolsas (BV ${r.bvCodigo})` +
              (r.leftover > 0 ? ` · quedaron ${r.leftover} cuartos disponibles` : '');
          } else {
            msgExtra = ' · Auto-llenado BARRA: no se pudo (sin BV BARRA o sin bolsas vacías)';
          }
        } catch (e: any) {
          msgExtra = ` · Auto-llenado BARRA falló: ${e?.message ?? 'error'}`;
        }
      }

      setOkMsg(`✅ Producción registrada: +${n} barras = +${cuartos} cuartos (${barraCodigo})${msgExtra}`);
      setOpenProd(false);
      setBarraProd(null);
      setProdCount('');
      await reload();
    } catch (e: any) {
      setErrMsg(`❌ Error: ${e?.message ?? 'No se pudo registrar producción'}`);
    } finally {
      setBusy(false);
    }
  };

  /* =======================
     ALTA DE BARRA
  ======================= */
  const [openAltaBarra, setOpenAltaBarra] = useState(false);
  const [barraForm, setBarraForm] = useState({
    nombre: '',
    barrasFisicas: '' as number | '',
  });

  const submitAltaBarra = async () => {
    setOkMsg(null);
    setErrMsg(null);

    const nombre = String(barraForm.nombre ?? '').trim();
    const barrasFisicas =
      barraForm.barrasFisicas === '' ? 0 : Math.max(0, Math.floor(Number(barraForm.barrasFisicas)));

    if (!nombre) return setErrMsg('Nombre requerido');

    try {
      setBusy(true);

      const creada = await crearBarraSafe({
        nombre,
        cantidad: barrasFisicas,
        creadoPor: user?.email ?? 'admin',
      });

      const codigoCreado = (creada as any)?.codigo ? String((creada as any).codigo).trim() : '';
      if (!codigoCreado) {
        setOpenAltaBarra(false);
        setBarraForm({ nombre: '', barrasFisicas: '' });
        await reload();
        return setOkMsg(`✅ Barra creada: ${nombre} (sin código devuelto, revisa service)`);
      }

      if (barrasFisicas > 0) {
        await actualizarCuartosDesdeBarrasSafe({
          codigo: codigoCreado,
          barrasFisicas,
        });
      }

      let msgExtra = '';
      const cuartosIniciales = barrasFisicas * 4;
      if (autoFillBarra && cuartosIniciales > 0) {
        try {
          const r = await autoFillFromBarra({ barraCodigo: codigoCreado, cuartos: cuartosIniciales, maquina: 'M1' });
          if (r.filled > 0) {
            msgExtra =
              ` · Auto-llenado BARRA: +${r.filled} bolsas (BV ${r.bvCodigo})` +
              (r.leftover > 0 ? ` · quedaron ${r.leftover} cuartos disponibles` : '');
          } else {
            msgExtra = ' · Auto-llenado BARRA: no se pudo (sin BV BARRA o sin bolsas vacías)';
          }
        } catch (e: any) {
          msgExtra = ` · Auto-llenado BARRA falló: ${e?.message ?? 'error'}`;
        }
      }

      setOpenAltaBarra(false);
      setBarraForm({ nombre: '', barrasFisicas: '' });

      setOkMsg(
        `✅ Barra creada: ${codigoCreado} · ${nombre} (${barrasFisicas} barras = ${cuartosIniciales} cuartos)${msgExtra}`,
      );
      await reload();
    } catch (e: any) {
      setErrMsg(`❌ Error: ${e?.message ?? 'No se pudo crear la barra'}`);
    } finally {
      setBusy(false);
    }
  };

  const syncBarraFisica = async (b: BarraProduct) => {
    setOkMsg(null);
    setErrMsg(null);

    const sugeridas = Math.max(0, Math.floor(Number((b as any).cantidad ?? 0)));
    const input = prompt(
      `¿Cuántas barras completas hay en inventario físico?\n\n` +
        `Código: ${String((b as any).codigo)}\n` +
        `Actual en sistema: ${sugeridas} barras\n` +
        `1 barra = 4 cuartos`,
      String(sugeridas),
    );
    if (input === null) return;

    const barrasFisicas = Math.floor(Number(input));
    if (!Number.isFinite(barrasFisicas) || barrasFisicas < 0) {
      setErrMsg('Número inválido de barras físicas');
      return;
    }

    try {
      setBusy(true);
      await actualizarCuartosDesdeBarrasSafe({
        codigo: String((b as any).codigo),
        barrasFisicas,
      });
      setOkMsg(
        `✅ Barra sincronizada (SET): ${String((b as any).codigo)} = ${barrasFisicas} barras (${barrasFisicas * 4} cuartos)`,
      );
      await reload();
    } catch (e: any) {
      setErrMsg(`❌ Error: ${e?.message ?? 'No se pudo sincronizar'}`);
    } finally {
      setBusy(false);
    }
  };

  /* =======================
     LLENADO desde BV
  ======================= */
  const [savingFill, setSavingFill] = useState(false);
  const [openFill, setOpenFill] = useState(false);
  const [fillTarget, setFillTarget] = useState<BolsaProduct | null>(null);
  const [fillTipo, setFillTipo] = useState<IceType>('ROLITO');
  const [fillCantidad, setFillCantidad] = useState<number | ''>('');
  const [fillBarraCodigo, setFillBarraCodigo] = useState<string>('');
  const [fillMaquina, setFillMaquina] = useState<'M1' | 'M2' | 'M3' | 'Maquina Prueba' | 'KLYR'>('M1');

  const openFillModal = (b: BolsaProduct) => {
    setOkMsg(null);
    setErrMsg(null);

    const tiposCfg = getTiposConfigurados(b);
    const first = tiposCfg[0] ?? 'ROLITO';

    setFillTarget(b);
    setFillTipo(first);

    setFillCantidad('');
    setFillBarraCodigo('');
    setFillMaquina('M1');
    setOpenFill(true);
  };

  const submitFill = async () => {
    if (!fillTarget) return;

    setOkMsg(null);
    setErrMsg(null);

    if (fillCantidad === '') return setErrMsg('Ingresa una cantidad válida.');

    const cantidad = safePosInt(fillCantidad, 1);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return setErrMsg('Cantidad inválida');

    const maxBV = Math.floor(Number((fillTarget as any).cantidad ?? 0));
    if (maxBV > 0 && cantidad > maxBV) {
      return setErrMsg(`No puedes llenar más que las bolsas vacías disponibles. Disponibles: ${maxBV}`);
    }

    const tipoNorm = normalizeIceType(fillTipo) ?? fillTipo;

    if (tipoNorm === 'BARRA') {
      if (!fillBarraCodigo) return setErrMsg('Selecciona la barra origen.');
      const br = barrasDisponibles.find((b) => b.codigo === fillBarraCodigo);
      if (!br) return setErrMsg('La barra seleccionada no es válida.');
      if (safeNum(br.cuartosDisponibles, 0) < cantidad) {
        return setErrMsg(`La barra no tiene cuartos suficientes. Disponibles: ${safeNum(br.cuartosDisponibles, 0)}`);
      }
    }

    try {
      setSavingFill(true);

      await llenarStockDesdeBVSafe({
        bolsaVaciaCodigo: String((fillTarget as any).codigo),
        tipoHielo: tipoNorm,
        cantidad,
        usuarioCodigo: user?.email ?? 'ADMIN',
        usuarioNombre: user?.email ?? 'Admin',
        origen: 'ADMIN',
        barraOrigenCodigo: tipoNorm === 'BARRA' ? fillBarraCodigo : undefined,
        maquina: fillMaquina,
      });

      const peso = safeNum((fillTarget as any).pesoKg, 0);
      setOkMsg(
        `✅ Llenado registrado: +${cantidad} · ${peso}kg · ${ETIQUETAS_TIPO_HIELO[tipoNorm]} · Máquina ${fillMaquina}`,
      );
      setOpenFill(false);
      await reload();
    } catch (e: any) {
      setErrMsg(`❌ Error: ${e?.message ?? 'Error llenando stock'}`);
    } finally {
      setSavingFill(false);
    }
  };

  /* =======================
     CONFIG min/max
  ======================= */
  const [openCfg, setOpenCfg] = useState(false);
  const [cfgTarget, setCfgTarget] = useState<{
    codigoBolsaVacia: string;
    productoNombre: string;
    pesoKg?: number;
    tipoHielo: IceType;
    min: number;
    max: number;
  } | null>(null);

  const openConfigModal = (c: {
    codigo: string;
    nombre: string;
    pesoKg?: number;
    tipoHielo: IceType;
    min: number;
    max: number;
  }) => {
    setOkMsg(null);
    setErrMsg(null);

    setCfgTarget({
      codigoBolsaVacia: c.codigo,
      productoNombre: c.nombre,
      pesoKg: c.pesoKg,
      tipoHielo: c.tipoHielo,
      min: safeNum(c.min, 0),
      max: safeNum(c.max, 0),
    });
    setOpenCfg(true);
  };

  const submitConfig = async () => {
    if (!cfgTarget) return;

    setOkMsg(null);
    setErrMsg(null);

    const stockMinimo = Math.max(0, safeNum(cfgTarget.min, 0));
    const stockMaximo = Math.max(stockMinimo, safeNum(cfgTarget.max, 0));

    const bv = (bolsasVacias ?? []).find((b) => (b as any).codigo === cfgTarget.codigoBolsaVacia);
    if (!bv) return setErrMsg(`❌ Producto ${cfgTarget.codigoBolsaVacia} no encontrado`);

    const nuevoStockPorHielo: Record<IceType, StockPorHieloConfig> = {
      ...(bv as any).stockPorHielo,
    };

    (TIPOS_HIELO as readonly IceType[]).forEach((t) => {
      if (!nuevoStockPorHielo[t]) {
        nuevoStockPorHielo[t] = {
          stockMinimo: 0,
          stockMaximo: 0,
          stockActual: 0,
          ultimaActualizacion: new Date(),
        } as any;
      }
    });

    const tipoNorm = normalizeIceType(cfgTarget.tipoHielo) ?? cfgTarget.tipoHielo;
    const prev = nuevoStockPorHielo[tipoNorm];

    nuevoStockPorHielo[tipoNorm] = {
      ...prev,
      stockMinimo,
      stockMaximo,
      ultimaActualizacion: new Date(),
    } as any;

    try {
      await actualizarConfigStockPorHieloSafe({
        codigoProducto: (bv as any).codigo,
        stockPorHielo: nuevoStockPorHielo,
        status: (bv as any).status as ProductStatus,
      });

      setOkMsg(
        `✅ Configuración guardada: ${buildNombreBolsaLlena(
          safeNum(cfgTarget.pesoKg, 0),
          String((bv as any).nombre ?? cfgTarget.productoNombre ?? ''),
        )} · ${ETIQUETAS_TIPO_HIELO[tipoNorm]}`,
      );
      setOpenCfg(false);
      await reload();
    } catch (e: any) {
      setErrMsg(`❌ Error: ${e?.message ?? 'Error guardando configuración'}`);
    }
  };

  /* =======================
     MERMAS (DESDE INVENTARIO)
  ======================= */
  const [openMerma, setOpenMerma] = useState(false);
  const [mermaTarget, setMermaTarget] = useState<{
    tipoProducto: MermaTipoProducto;
    // BOLSA LLENA
    bolsaVaciaCodigo?: string;
    tipoHielo?: IceType;
    pesoKg?: number;
    // BOLSA_VACIA
    bvNombre?: string;
    bvDisponibles?: number;
    // BARRA
    barraCodigo?: string;
    barraNombre?: string;
    barraDisp?: number;
    barraUsados?: number;
  } | null>(null);

  const [mermaCantidad, setMermaCantidad] = useState<number | ''>('');
  const [mermaRazonPreset, setMermaRazonPreset] = useState<MermaRazonPreset>('DIFERENCIA_INVENTARIO');
  const [mermaMotivo, setMermaMotivo] = useState('DIFERENCIA_INVENTARIO');
  const [mermaMotivoDet, setMermaMotivoDet] = useState('');
  const [mermaCuartosFuente, setMermaCuartosFuente] = useState<CuartosFuente>('DISPONIBLES');

  const openMermaModal = (payload: Exclude<typeof mermaTarget, null>) => {
    setOkMsg(null);
    setErrMsg(null);
    setMermaTarget(payload);
    setMermaCantidad('');

    // ✅ default razón
    setMermaRazonPreset('DIFERENCIA_INVENTARIO');
    setMermaMotivo('DIFERENCIA_INVENTARIO');

    setMermaMotivoDet('');
    setMermaCuartosFuente('DISPONIBLES');
    setOpenMerma(true);
  };

  const submitMerma = async () => {
    if (!mermaTarget) return;

    const cant = mermaCantidad === '' ? 0 : Math.floor(Number(mermaCantidad));
    if (!Number.isFinite(cant) || cant <= 0) return setErrMsg('Cantidad inválida');

    const empleadoCodigo = String(user?.email ?? 'ADMIN').trim().toUpperCase();
    const empleadoNombre = String(user?.email ?? 'Admin').trim() || 'Admin';

    try {
      setBusy(true);
      setErrMsg(null);
      setOkMsg(null);

      // ✅ Validaciones por tipo antes de llamar service
      if (mermaTarget.tipoProducto === 'BOLSA') {
        if (!mermaTarget.bolsaVaciaCodigo) throw new Error('BV inválida');
        if (!mermaTarget.tipoHielo) throw new Error('tipoHielo inválido');

        // validación stock actual en UI para evitar mermar más de lo que hay
        const bv = String(mermaTarget.bolsaVaciaCodigo).trim().toUpperCase();
        const th = mermaTarget.tipoHielo as IceType;
        const p = (stockLlenoPorProductoUI ?? []).find((x: any) => String(x?.bolsaVaciaCodigo ?? '') === bv);
        const t = p?.tipos?.find((z: any) => normalizeIceType(z?.tipoHielo) === th);
        const actual = safeInt0(t?.stockActual, 0);
        if (actual < cant) throw new Error(`Stock insuficiente. Actual: ${actual}, Merma: ${cant}`);
      }

      if (mermaTarget.tipoProducto === 'BOLSA_VACIA') {
        if (!mermaTarget.bolsaVaciaCodigo) throw new Error('BV inválida');
        const disp = Math.max(0, Math.floor(safeNum(mermaTarget.bvDisponibles, 0)));
        if (disp < cant) throw new Error(`BV insuficiente. Disponible: ${disp}, Merma: ${cant}`);
      }

      if (mermaTarget.tipoProducto === 'BARRA') {
        if (!mermaTarget.barraCodigo) throw new Error('Barra inválida');
        const disp = Math.max(0, Math.floor(safeNum(mermaTarget.barraDisp, 0)));
        const usados = Math.max(0, Math.floor(safeNum(mermaTarget.barraUsados, 0)));
        const pool = mermaCuartosFuente === 'USADOS' ? usados : disp;
        if (pool < cant) {
          const label = mermaCuartosFuente === 'USADOS' ? 'usados' : 'disponibles';
          throw new Error(`Cuartos insuficientes (${label}). Disponible: ${pool}, Merma: ${cant}`);
        }
      }

      const motivoFinal = String(mermaMotivo || '').trim();
      if (!motivoFinal) throw new Error('Motivo requerido');

      // ✅ Construir request exacto para tu MermasService
      if (mermaTarget.tipoProducto === 'BOLSA') {
        const bv = String(mermaTarget.bolsaVaciaCodigo).trim().toUpperCase();
        const th = mermaTarget.tipoHielo as IceType;
        const bvOrigen = (bolsasVacias ?? []).find(
          (x: any) => String(x?.codigo ?? '').trim().toUpperCase() === bv,
        );
        const nombre = buildNombreBolsaLlena(
          safeNum(mermaTarget.pesoKg, 0),
          String((bvOrigen as any)?.nombre ?? ''),
        );

        await MermasService.registrarMerma(
          {
            productoCodigo: bv,
            productoNombre: nombre,
            tipoProducto: 'BOLSA',
            tipoHielo: th,
            cantidad: cant,
            motivo: motivoFinal,
            motivoDetallado: mermaMotivoDet.trim() || undefined,
            bolsaVaciaCodigo: bv,
          },
          empleadoCodigo,
          empleadoNombre,
        );

        setOkMsg(`✅ Merma aplicada: -${cant} bolsas llenas · ${bv} · ${ETIQUETAS_TIPO_HIELO[th]} · ${motivoFinal}`);
      } else if (mermaTarget.tipoProducto === 'BOLSA_VACIA') {
        const bv = String(mermaTarget.bolsaVaciaCodigo).trim().toUpperCase();
        const nombre = String(mermaTarget.bvNombre ?? 'Bolsa vacía').trim();

        await MermasService.registrarMerma(
          {
            productoCodigo: bv,
            productoNombre: nombre,
            tipoProducto: 'BOLSA_VACIA',
            cantidad: cant,
            motivo: motivoFinal,
            motivoDetallado: mermaMotivoDet.trim() || undefined,
          },
          empleadoCodigo,
          empleadoNombre,
        );

        setOkMsg(`✅ Merma aplicada: -${cant} bolsas vacías · ${bv} · ${motivoFinal}`);
      } else {
        const br = String(mermaTarget.barraCodigo).trim().toUpperCase();
        const nombre = String(mermaTarget.barraNombre ?? 'Barra').trim();

        await MermasService.registrarMerma(
          {
            productoCodigo: br,
            productoNombre: nombre,
            tipoProducto: 'BARRA',
            cantidad: cant,
            motivo: motivoFinal,
            motivoDetallado: mermaMotivoDet.trim() || undefined,
            cuartosFuente: mermaCuartosFuente,
          } as any,
          empleadoCodigo,
          empleadoNombre,
        );

        setOkMsg(`✅ Merma aplicada: -${cant} cuartos (${mermaCuartosFuente}) · ${br} · ${motivoFinal}`);
      }

      setOpenMerma(false);
      await reload();
    } catch (e: any) {
      setErrMsg(`❌ ${e?.message ?? 'No se pudo aplicar la merma'}`);
    } finally {
      setBusy(false);
    }
  };

  /* ===== Carrusel global (stock por producto+tipo) ===== */
  const carouselCards = useMemo(() => {
    return (stockLlenoPorProductoUI ?? []).flatMap((p: any) => {
      const codigoBV = String(p?.bolsaVaciaCodigo ?? '').trim().toUpperCase();
      const bv = (bolsasVacias ?? []).find((x: any) => String(x.codigo).trim().toUpperCase() === codigoBV);
      if (!bv) return [];

      const tiposCfgSet = new Set(getTiposConfigurados(bv));

      return (p.tipos ?? [])
        .map((t: any) => {
          const tipoNorm = normalizeIceType(t?.tipoHielo);
          if (!tipoNorm) return null;
          if (!tiposCfgSet.has(tipoNorm)) return null;

          const min = safeNum(t?.stockMinimo, 0);
          const max = safeNum(t?.stockMaximo, 0);
          const actual = safeNum(t?.stockActual, 0);

          const pesoKg = safeNum(p?.pesoKg ?? (bv as any).pesoKg, 0);
          const nombreBV = String(p?.productoNombre ?? (bv as any).nombre ?? '').trim();
          const esMaquila = esBolsaMaquila(nombreBV);

          if (
            !debeMostrarConfiguracion({
              stockActual: actual,
              pesoKg,
              tipoHielo: tipoNorm,
              esMaquila,
            })
          ) {
            return null;
          }

          const ok = actual > min;
          const nombreNeutral = buildNombreBolsaLlena(pesoKg, nombreBV);

          return {
            key: `${codigoBV}-${String(tipoNorm)}`,
            codigo: codigoBV,
            nombre: nombreNeutral,
            nombreBV,
            esMaquila,
            pesoKg,
            tipoHielo: tipoNorm,
            actual,
            min,
            max,
            ok,
            totalProducto: safeNum(p?.totalLlenas, 0),
            vaciasFisicas: safeNum(p?.bolsasVaciasDisponibles ?? (bv as any).cantidad, 0),
          };
        })
        .filter(Boolean) as any[];
    });
  }, [stockLlenoPorProductoUI, bolsasVacias]);

  /* =======================
     RENDER
  ======================= */
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-950 to-black p-4 md:p-6">
      {/* HEADER */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
        <div className="flex items-start gap-4">
          <button
            onClick={() => router.push('/admin/dashboard')}
            className="p-3 bg-gradient-to-br from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 rounded-xl text-gray-400 hover:text-white transition-all duration-300 hover:scale-105 mt-1"
            title="Volver al Dashboard"
            type="button"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="p-3 rounded-xl bg-gradient-to-r from-purple-900/60 via-blue-800/60 to-cyan-900/60 backdrop-blur-sm border border-purple-700/30 shadow-lg">
            <Warehouse className="h-10 w-10 text-purple-300" />
          </div>

          <div>
            <h1 className="text-3xl font-bold text-white bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              Inventario
            </h1>
            <p className="text-gray-400 text-sm mt-2 flex items-center gap-2">
              <Info className="h-4 w-4" />
              Cámara fría · Bolsas llenas · Bolsas vacías · Barras (cuartos)
              {movLoading ? <span className="text-gray-500">· leyendo movimientos…</span> : null}
            </p>

            {/* ✅ TOGGLE: auto-llenado barra */}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setAutoFillBarra((s) => !s)}
                className={`px-4 py-2 rounded-xl border flex items-center gap-2 transition ${
                  autoFillBarra
                    ? 'bg-emerald-900/25 border-emerald-700/30 text-emerald-200'
                    : 'bg-gray-900/30 border-gray-700/40 text-gray-200'
                }`}
                title="Auto-llenado: al producir barras intenta llenar bolsas tipo BARRA automáticamente"
              >
                {autoFillBarra ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
                Auto-llenado BARRA
              </button>
              {autoFillBarra && pickBVForBarra ? (
                <div className="text-xs text-gray-400">
                  BV usada: <span className="text-gray-200 font-mono">{pickBVForBarra.codigo}</span> ·{' '}
                  {pickBVForBarra.nombre} · vacías {pickBVForBarra.cantidad}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <button
            onClick={() => {
              setOkMsg(null);
              setErrMsg(null);
              reload();
            }}
            className="px-5 py-2.5 bg-gradient-to-br from-gray-800 to-gray-900 text-gray-300 hover:text-white rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 flex items-center transition-all duration-300"
            title="Recargar datos"
            type="button"
          >
            <RefreshCw className={`h-5 w-5 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Recargar
          </button>

          <button
            onClick={() => {
              setOkMsg(null);
              setErrMsg(null);
              setOpenAltaBarra(true);
            }}
            className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl font-medium hover:from-purple-700 hover:to-purple-800 flex items-center transition-all shadow-lg"
            type="button"
          >
            <Plus className="h-5 w-5 mr-2" />
            Nueva barra
          </button>
        </div>
      </div>

      {/* FEEDBACK */}
      {(okMsg || errMsg) && (
        <div className="mb-6">
          {okMsg && (
            <div className="bg-gradient-to-r from-emerald-900/40 to-emerald-800/30 border border-emerald-700/30 rounded-2xl p-5 backdrop-blur-sm shadow-lg">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-gradient-to-br from-emerald-800/40 to-emerald-700/30 rounded-xl">
                  <CheckCircle2 className="h-7 w-7 text-emerald-300" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-white text-lg">Operación exitosa</h3>
                  <p className="text-emerald-300 mt-1">{okMsg}</p>
                </div>
              </div>
            </div>
          )}
          {errMsg && (
            <div className="mt-3 bg-gradient-to-r from-rose-900/40 to-rose-800/30 border border-rose-700/30 rounded-2xl p-5 backdrop-blur-sm shadow-lg">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-gradient-to-br from-rose-800/40 to-rose-700/30 rounded-xl">
                  <AlertTriangle className="h-7 w-7 text-rose-300" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-white text-lg">Error</h3>
                  <p className="text-rose-300 mt-1">{errMsg}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* LOADING */}
      {loading && (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="relative">
              <div className="h-20 w-20 rounded-full border-4 border-gray-800 border-t-blue-500 animate-spin mx-auto" />
              <Loader2 className="h-16 w-16 animate-spin text-blue-500 mx-auto absolute top-2 left-2" />
            </div>
            <p className="mt-8 text-gray-400 font-medium text-lg">Cargando inventario...</p>
            <p className="text-sm text-gray-600 mt-2">Sincronizando datos del almacén</p>
          </div>
        </div>
      )}

      {!loading && (
        <>
          {/* ================= CÁMARA FRÍA (RESUMEN) ================= */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-blue-900/40 to-blue-800/30 rounded-lg">
                  <Snowflake className="h-6 w-6 text-blue-300" />
                </div>
                Cámara fría (bolsas llenas)
              </h2>

              <div className="bg-gray-900/50 backdrop-blur-sm rounded-lg px-4 py-2 text-sm text-gray-300 space-x-4">
                <span>
                  Total general:{' '}
                  <span className="font-bold text-white tabular-nums">{stockLlenoTotalGeneralUI}</span>
                </span>
              </div>
            </div>

            {/* Totales por tipo (incluye BARRA bolsas) */}
            <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
              {(['ROLITO', 'FRAPPE', 'GOURMET', 'ENFRIAR', 'BARRA'] as IceType[]).map((t) => (
                <div
                  key={t}
                  className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-5 border border-gray-700/50 shadow-xl"
                >
                  <div className="flex items-center justify-between">
                    <IceTypeChip tipo={t} />
                    <div className="text-2xl font-bold text-white tabular-nums">
                      {safeNum(stockLlenoTotalPorTipoUI[t], 0)}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mt-2">Total bolsas llenas por tipo</div>
                </div>
              ))}
            </div>

            {/* Inventario por presentación */}
            <div className="bg-gray-900/30 border border-gray-800/50 rounded-2xl p-5">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-5">
                <div>
                  <div className="text-sm font-semibold text-gray-200">
                    Inventario disponible por presentación
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Sólo se muestran existencias reales y las configuraciones operativas que deben permanecer visibles en cero.
                  </div>
                </div>

                <div className="text-xs text-gray-500">
                  NORMAL y MAQUILA se contabilizan por separado
                </div>
              </div>

              {camaraPorPresentacion.length === 0 ? (
                <div className="rounded-xl border border-gray-800 bg-gray-950/30 p-6 text-center text-gray-400">
                  No hay presentaciones con stock disponible.
                </div>
              ) : (
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {camaraPorPresentacion.map((row) => (
                    <div
                      key={row.key}
                      className={`relative overflow-hidden rounded-2xl border p-5 shadow-lg ${
                        row.esMaquila
                          ? 'border-amber-700/30 bg-gradient-to-br from-amber-950/20 via-gray-900/30 to-gray-950/20'
                          : 'border-gray-700/50 bg-gradient-to-br from-gray-800/30 to-gray-900/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xl font-bold text-white">{row.kg}kg</span>

                            {row.esMaquila ? (
                              <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold tracking-wide text-amber-300">
                                MAQUILA
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-slate-500/20 bg-slate-500/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-slate-300">
                                NORMAL
                              </span>
                            )}
                          </div>

                          <div className="mt-2 truncate text-sm font-medium text-gray-200">
                            {row.nombreLleno}
                          </div>

                          <div className="mt-1 text-xs text-gray-500">
                            Bolsa origen:{' '}
                            <span className="font-mono text-gray-300">{row.codigoBV}</span>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[11px] uppercase tracking-wide text-gray-500">Total</div>
                          <div
                            className={`text-3xl font-bold tabular-nums ${
                              row.total > 0 ? 'text-white' : 'text-gray-500'
                            }`}
                          >
                            {row.total}
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 space-y-2">
                        {row.tipos.map((item) => (
                          <div
                            key={`${row.codigoBV}-${item.tipoHielo}`}
                            className="flex items-center justify-between gap-3 rounded-xl border border-gray-800/60 bg-gray-950/30 px-3 py-2.5"
                          >
                            <div className="min-w-0">
                              <IceTypeChip tipo={item.tipoHielo} />
                            </div>

                            <div
                              className={`text-lg font-bold tabular-nums ${
                                item.stockActual > 0 ? 'text-white' : 'text-gray-500'
                              }`}
                            >
                              {item.stockActual}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ================= BARRAS (cuartos) ================= */}
          <section className="mb-8">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                  <div className="p-2.5 bg-gradient-to-br from-pink-900/40 to-pink-800/30 rounded-lg">
                    <Database className="h-6 w-6 text-pink-300" />
                  </div>
                  Barras
                </h2>
                <p className="mt-2 text-xs text-gray-500">
                  Vista equivalente del stock actual de cuartos de barra.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 min-w-[320px]">
                <div className="rounded-xl border border-purple-800/30 bg-purple-950/20 px-4 py-3">
                  <div className="text-[11px] text-gray-400">Barras completas</div>
                  <div className="mt-1 text-2xl font-bold text-white tabular-nums">
                    {barrasCompletasVisual.toFixed(2)}
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-800/30 bg-emerald-950/15 px-4 py-3">
                  <div className="text-[11px] text-gray-400">Cuartos de barra</div>
                  <div className="mt-1 text-2xl font-bold text-emerald-300 tabular-nums">
                    {cuartosBarraVisual}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {barrasUI.length === 0 ? (
                <div className="md:col-span-2 xl:col-span-3 bg-gray-900/30 border border-gray-800/50 rounded-2xl p-6 text-gray-400">
                  No hay barras registradas. Dale <span className="text-orange-200 font-semibold">Nueva barra</span> para
                  darlas de alta.
                </div>
              ) : (
                barrasUI.map((b: any) => {

                  return (
                    <div
                      key={b.codigo}
                      className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-5 border border-gray-700/50 shadow-xl"
                    >
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <IceTypeChip tipo="BARRA" />
                            <span className="text-sm text-gray-300">
                              <span className="font-mono text-gray-200">{b.codigo}</span>
                            </span>
                          </div>
                          <div className="text-white font-semibold mt-2">{b.nombre}</div>
                        </div>

                        <div className="flex flex-col gap-2 items-end">
                          <button
                            type="button"
                            onClick={() => openProduccionModal(b as BarraProduct)}
                            className="px-3 py-2 rounded-xl bg-emerald-900/25 text-emerald-200 hover:bg-emerald-900/40 border border-emerald-700/30 transition flex items-center gap-2"
                            title="Agregar producción (SUMA)"
                            disabled={busy}
                          >
                            <Plus className="h-4 w-4" />
                            Producción
                          </button>

                          <button
                            type="button"
                            onClick={() => openCuartosModal(b as BarraProduct)}
                            className="px-3 py-2 rounded-xl bg-orange-900/30 text-orange-200 hover:bg-orange-900/45 border border-orange-700/30 transition flex items-center gap-2"
                            title="Ajustar cuartos"
                            disabled={busy}
                          >
                            <Pencil className="h-4 w-4" />
                            Ajustar
                          </button>

                          <button
                            type="button"
                            onClick={() => syncBarraFisica(b as BarraProduct)}
                            className="px-3 py-2 rounded-xl bg-blue-900/25 text-blue-200 hover:bg-blue-900/40 border border-blue-700/30 transition flex items-center gap-2"
                            title="Sincronizar por conteo físico (SET)"
                            disabled={busy}
                          >
                            <RotateCcw className="h-4 w-4" />
                            Sync físico
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-purple-800/30 bg-purple-950/20 p-4">
                          <div className="text-[11px] text-gray-400">Barras completas</div>
                          <div className="mt-1 text-3xl font-bold text-white tabular-nums">
                            {barrasCompletasVisual.toFixed(2)}
                          </div>
                        </div>

                        <div className="rounded-xl border border-emerald-800/30 bg-emerald-950/15 p-4">
                          <div className="text-[11px] text-gray-400">Cuartos de barra</div>
                          <div className="mt-1 text-3xl font-bold text-emerald-300 tabular-nums">
                            {cuartosBarraVisual}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* ================= CARRUSEL GLOBAL: STOCK por PRODUCTO+TIPO ================= */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-purple-900/40 to-purple-800/30 rounded-lg">
                  <BadgeCheck className="h-6 w-6 text-purple-300" />
                </div>
                Stock por Producto y Tipo (bolsas llenas)
              </h2>
              <div className="bg-gray-900/50 backdrop-blur-sm rounded-lg px-4 py-2">
                <span className="text-sm text-gray-300">
                  Configuraciones: <span className="font-bold text-white">{carouselCards.length}</span>
                </span>
              </div>
            </div>

            <div className="flex gap-4 overflow-x-auto pb-4">
              {carouselCards.length === 0 ? (
                <div className="w-full bg-gray-900/30 border border-gray-800/50 rounded-2xl p-6 text-gray-400">
                  No hay stock configurado aún. Llena stock desde una BV para que aparezca aquí.
                </div>
              ) : (
                carouselCards.map((c: any) => (
                  <div
                    key={c.key}
                    className="min-w-[420px] bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-5 border border-gray-700/50 shadow-xl hover:shadow-2xl transition-all duration-300"
                  >
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="font-semibold text-white text-lg">{safeNum(c.pesoKg, 0)}kg</span>
                          <IceTypeChip tipo={c.tipoHielo} />
                          {c.esMaquila ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              MAQUILA
                            </span>
                          ) : null}
                        </div>
                        <p className="text-white font-medium">{c.nombre}</p>
                        <p className="text-xs text-gray-400 mt-1">BV: {c.codigo}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            openConfigModal({
                              codigo: c.codigo,
                              nombre: c.nombre,
                              pesoKg: c.pesoKg,
                              tipoHielo: c.tipoHielo,
                              min: c.min,
                              max: c.max,
                            })
                          }
                          className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-900/40 rounded-xl transition-all duration-300 hover:scale-110"
                          title="Configurar stock"
                          type="button"
                        >
                          <Settings className="h-5 w-5" />
                        </button>
                        <StatusIcon ok={!!c.ok} />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-sm text-gray-300 mb-2">
                          <span>Stock actual</span>
                          <span className="font-bold text-white">
                            {safeNum(c.actual, 0)} / {safeNum(c.max, 0)}
                          </span>
                        </div>
                        <div className="h-2.5 bg-gray-800/50 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              c.ok
                                ? 'bg-gradient-to-r from-purple-500 to-violet-400'
                                : 'bg-gradient-to-r from-red-500 to-red-400'
                            }`}
                            style={{ width: `${pct(safeNum(c.actual, 0), safeNum(c.max, 0))}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-gray-400 mt-1">
                          <span>Mínimo: {safeNum(c.min, 0)}</span>
                          <span>Máximo: {safeNum(c.max, 0)}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-gray-900/30 rounded-lg p-3">
                          <div className="text-xs text-gray-400">Total llenas</div>
                          <div className="font-bold text-white text-xl">{safeNum(c.totalProducto, 0)}</div>
                        </div>
                        <div className="bg-gray-900/30 rounded-lg p-3">
                          <div className="text-xs text-gray-400">Vacías físicas</div>
                          <div
                            className={`font-bold text-xl ${
                              safeNum(c.vaciasFisicas, 0) > 0 ? 'text-purple-400' : 'text-red-400'
                            }`}
                          >
                            {safeNum(c.vaciasFisicas, 0)}
                          </div>
                        </div>
                      </div>

                      {/* ✅ MERMA BOLSA LLENA */}
                      <button
                        type="button"
                        onClick={() =>
                          openMermaModal({
                            tipoProducto: 'BOLSA',
                            bolsaVaciaCodigo: String(c.codigo).trim().toUpperCase(),
                            tipoHielo: c.tipoHielo,
                            pesoKg: safeNum(c.pesoKg, 0),
                          })
                        }
                        className="w-full px-4 py-3 bg-red-900/25 border border-red-700/30 text-red-200 rounded-xl hover:bg-red-900/40 flex items-center justify-center gap-2"
                        disabled={busy}
                      >
                        <MinusCircle className="h-5 w-5" />
                        Merma bolsas llenas
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ================= BOLSAS VACÍAS ================= */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-cyan-900/40 to-cyan-800/30 rounded-lg">
                  <Droplets className="h-6 w-6 text-cyan-300" />
                </div>
                Bolsas Vacías Disponibles
              </h2>
              <div className="bg-gray-900/50 backdrop-blur-sm rounded-lg px-4 py-2">
                <span className="text-sm text-gray-300">
                  Total: <span className="font-bold text-white">{(bolsasVacias ?? []).length}</span> productos
                </span>
              </div>
            </div>

            <div className="flex gap-4 overflow-x-auto pb-4">
              {(bolsasVacias ?? []).map((bv: any) => {
                const tiposCfg = getTiposConfigurados(bv);
                const cantidad = safeInt0(bv.cantidad, 0);
                const pesoKg = safeNum(bv.pesoKg, 0);

                return (
                  <div
                    key={String(bv.codigo ?? Math.random())}
                    className="min-w-[340px] bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-5 border border-gray-700/50 shadow-xl hover:shadow-2xl transition-all duration-300"
                  >
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="p-2.5 bg-gradient-to-br from-cyan-800/40 to-cyan-700/30 rounded-lg">
                          <Package className="h-5 w-5 text-cyan-300" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-white">{String(bv.nombre ?? 'Bolsa vacía')}</p>
                            {esBolsaMaquila(bv.nombre) ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                MAQUILA
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-gray-400">Código: {String(bv.codigo ?? '—')}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between bg-gray-900/30 rounded-lg p-3">
                        <div>
                          <div className="text-xs text-gray-400">Vacías disponibles</div>
                          <div className={`text-2xl font-bold ${cantidad > 0 ? 'text-cyan-300' : 'text-red-400'}`}>
                            {cantidad}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-400">Peso</div>
                          <div className="text-lg font-bold text-white">{pesoKg}kg</div>
                        </div>
                      </div>
                    </div>

                    <div className="mb-4">
                      <div className="text-xs text-gray-400 mb-2">Tipos de hielo permitidos</div>
                      <div className="flex flex-wrap gap-1.5">
                        {tiposCfg.map((t) => (
                          <IceTypeChip key={t} tipo={t} />
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openFillModal(bv)}
                        className="w-full px-4 py-3 bg-gradient-to-r from-cyan-700/80 to-cyan-800/80 text-white rounded-xl font-medium hover:from-cyan-800 hover:to-cyan-900 flex items-center justify-center transition-all duration-300 hover:shadow-lg hover:shadow-cyan-900/20"
                        disabled={cantidad === 0}
                        type="button"
                      >
                        <PlusCircle className="h-5 w-5 mr-2" />
                        {cantidad === 0 ? 'Sin stock' : 'Llenar stock'}
                      </button>

                      {/* ✅ MERMA BOLSA VACÍA */}
                      <button
                        onClick={() =>
                          openMermaModal({
                            tipoProducto: 'BOLSA_VACIA',
                            bolsaVaciaCodigo: String(bv.codigo).trim().toUpperCase(),
                            bvNombre: String(bv.nombre ?? 'Bolsa vacía'),
                            bvDisponibles: cantidad,
                          })
                        }
                        className="w-full px-4 py-3 bg-red-900/25 border border-red-700/30 text-red-200 rounded-xl hover:bg-red-900/40 flex items-center justify-center gap-2"
                        disabled={busy || cantidad === 0}
                        type="button"
                        title="Merma de bolsas vacías (RESTA cantidad)"
                      >
                        <MinusCircle className="h-5 w-5" />
                        Merma BV
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* ================= MODAL: PRODUCCIÓN (SUMA) ================= */}
      <Modal
        open={openProd}
        title="Agregar producción de barras (SUMA)"
        onClose={() => {
          if (busy) return;
          setOpenProd(false);
        }}
      >
        {!barraProd ? (
          <div className="text-gray-300">No hay barra seleccionada.</div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-emerald-700/30 bg-emerald-900/15 p-4">
              <div className="text-white font-semibold flex items-center gap-2">
                <Cuboid className="h-5 w-5 text-emerald-300" />
                {String((barraProd as any).nombre ?? 'Barra')} ·{' '}
                <span className="font-mono">{String((barraProd as any).codigo)}</span>
              </div>
              <div className="mt-2 text-sm text-emerald-200/80">
                Esto <b>SUMA</b> barras y cuartos: <b>+N barras</b> ⇒ <b>+N×4 cuartos</b>.
              </div>
              {autoFillBarra && (
                <div className="mt-2 text-xs text-emerald-200/70">
                  Auto-llenado BARRA activado: intentará convertir esos cuartos en bolsas llenas BARRA (descuenta BV).
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">Barras producidas *</label>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={prodCount}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') return setProdCount('');
                  const n = Math.floor(Number(raw));
                  if (!Number.isFinite(n) || n <= 0) return setProdCount('');
                  setProdCount(n);
                }}
                className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                placeholder="Ej: 8"
                disabled={busy}
              />
              <div className="mt-2 text-xs text-gray-400">
                Cuartos que se agregarán:{' '}
                <span className="text-white font-bold">
                  {(prodCount === '' ? 0 : Math.max(0, Math.floor(Number(prodCount)))) * 4}
                </span>
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-800/50">
              <button
                type="button"
                onClick={() => setOpenProd(false)}
                disabled={busy}
                className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitProduccion}
                disabled={busy || prodCount === ''}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Plus className="h-5 w-5" />
                    Registrar producción
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ================= MODAL: ALTA DE BARRA ================= */}
      <Modal
        open={openAltaBarra}
        title="Nueva Barra (alta de inventario)"
        onClose={() => {
          if (busy) return;
          setOpenAltaBarra(false);
        }}
      >
        <div className="space-y-5">
          <div>
            <label className="block text-sm text-gray-300 mb-2">Nombre *</label>
            <input
              value={barraForm.nombre}
              onChange={(e) => setBarraForm((s) => ({ ...s, nombre: e.target.value }))}
              className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
              placeholder="Ej: Barra estándar"
              disabled={busy}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-2">Barras físicas (opcional)</label>
            <input
              type="number"
              min={0}
              value={barraForm.barrasFisicas}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') return setBarraForm((s) => ({ ...s, barrasFisicas: '' }));
                const n = Math.max(0, Math.floor(Number(raw)));
                if (!Number.isFinite(n)) return;
                setBarraForm((s) => ({ ...s, barrasFisicas: n }));
              }}
              className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
              placeholder="Ej: 10"
              disabled={busy}
            />
            <div className="mt-2 text-xs text-gray-400">
              Se guardará como cuartos totales:{' '}
              <b>{(barraForm.barrasFisicas === '' ? 0 : Number(barraForm.barrasFisicas)) * 4}</b>
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-800/50">
            <button
              type="button"
              onClick={() => setOpenAltaBarra(false)}
              disabled={busy}
              className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submitAltaBarra}
              disabled={busy || !barraForm.nombre.trim()}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Plus className="h-5 w-5" />
                  Crear barra
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* ================= MODAL: LLENAR STOCK ================= */}
      <Modal
        open={openFill}
        title="Llenar stock desde Bolsa Vacía"
        onClose={() => {
          if (savingFill) return;
          setOpenFill(false);
        }}
      >
        {!fillTarget ? (
          <div className="text-gray-300">No hay BV seleccionada.</div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-cyan-700/30 bg-cyan-900/10 p-4">
              <div className="text-white font-semibold">
                {String((fillTarget as any).nombre ?? 'Bolsa vacía')} ·{' '}
                <span className="font-mono">{String((fillTarget as any).codigo)}</span>
              </div>
              <div className="mt-2 text-sm text-cyan-200/80">
                Vacías disponibles: <b>{Math.floor(Number((fillTarget as any).cantidad ?? 0))}</b>
              </div>
              <div className="mt-2 text-xs text-cyan-100/70">
                Se registrará como:{' '}
                <b className="text-cyan-100">
                  {buildNombreBolsaLlena(
                    safeNum((fillTarget as any).pesoKg, 0),
                    String((fillTarget as any).nombre ?? ''),
                  )}
                </b>
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">Tipo de hielo</label>
              <select
                value={fillTipo}
                onChange={(e) => setFillTipo((normalizeIceType(e.target.value) ?? 'ROLITO') as IceType)}
                className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
              >
                {getTiposConfigurados(fillTarget).map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETAS_TIPO_HIELO[t]}
                  </option>
                ))}
              </select>
            </div>

            {fillTipo === 'BARRA' && (
              <div>
                <label className="block text-sm text-gray-300 mb-2">Barra origen (para consumir cuartos)</label>
                <select
                  value={fillBarraCodigo}
                  onChange={(e) => setFillBarraCodigo(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
                >
                  <option value="">— selecciona —</option>
                  {barrasDisponibles.map((b) => (
                    <option key={b.codigo} value={b.codigo}>
                      {b.codigo} · {b.nombre} · disp {b.cuartosDisponibles}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-300 mb-2">Cantidad</label>
              <input
                type="number"
                min={1}
                value={fillCantidad}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') return setFillCantidad('');
                  const n = Math.floor(Number(raw));
                  if (!Number.isFinite(n) || n <= 0) return;
                  setFillCantidad(n);
                }}
                className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
                placeholder="Ej: 20"
                disabled={savingFill}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">Máquina</label>
              <select
                value={fillMaquina}
                onChange={(e) => setFillMaquina(e.target.value as any)}
                className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
              >
                <option value="M1">M1</option>
                <option value="M2">M2</option>
                <option value="M3">M3</option>
                <option value="Maquina Prueba">Máquina Prueba</option>
                <option value="KLYR">KLYR</option>
              </select>
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-800/50">
              <button
                type="button"
                onClick={() => setOpenFill(false)}
                disabled={savingFill}
                className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitFill}
                disabled={savingFill || fillCantidad === ''}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-700 hover:to-cyan-800 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {savingFill ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <PlusCircle className="h-5 w-5" />
                    Registrar llenado
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ================= MODAL: CONFIG MIN/MAX ================= */}
      <Modal
        open={openCfg}
        title="Configurar stock mínimo/máximo"
        onClose={() => {
          if (busy) return;
          setOpenCfg(false);
        }}
      >
        {!cfgTarget ? (
          <div className="text-gray-300">Sin configuración seleccionada.</div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-blue-700/30 bg-blue-900/10 p-4">
              <div className="text-white font-semibold">
                {cfgTarget.productoNombre} · <span className="font-mono">{cfgTarget.codigoBolsaVacia}</span>
              </div>
              <div className="mt-2 text-sm text-blue-200/80">
                Tipo: <b>{ETIQUETAS_TIPO_HIELO[cfgTarget.tipoHielo]}</b>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-300 mb-2">Mínimo</label>
                <input
                  type="number"
                  min={0}
                  value={cfgTarget.min}
                  onChange={(e) =>
                    setCfgTarget((s) => (s ? { ...s, min: Math.max(0, Number(e.target.value || 0)) } : s))
                  }
                  className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">Máximo</label>
                <input
                  type="number"
                  min={0}
                  value={cfgTarget.max}
                  onChange={(e) =>
                    setCfgTarget((s) => (s ? { ...s, max: Math.max(0, Number(e.target.value || 0)) } : s))
                  }
                  className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-800/50">
              <button
                type="button"
                onClick={() => setOpenCfg(false)}
                disabled={busy}
                className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitConfig}
                disabled={busy}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Settings className="h-5 w-5" />
                    Guardar
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ================= MODAL: MERMA (3 tipos + fuente cuartos) ================= */}
      <Modal
        open={openMerma}
        title="Registrar Merma (RESTA)"
        onClose={() => {
          if (busy) return;
          setOpenMerma(false);
        }}
      >
        {!mermaTarget ? (
          <div className="text-gray-300">Sin elemento seleccionado.</div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-red-700/30 bg-red-900/10 p-4">
              <div className="text-white font-semibold">
                {mermaTarget.tipoProducto === 'BOLSA' && (
                  <>
                    Bolsa llena · <span className="font-mono">{mermaTarget.bolsaVaciaCodigo}</span> ·{' '}
                    <b>{mermaTarget.tipoHielo ? ETIQUETAS_TIPO_HIELO[mermaTarget.tipoHielo] : '—'}</b>
                  </>
                )}
                {mermaTarget.tipoProducto === 'BOLSA_VACIA' && (
                  <>
                    Bolsa vacía · <span className="font-mono">{mermaTarget.bolsaVaciaCodigo}</span> ·{' '}
                    {String(mermaTarget.bvNombre ?? '')}
                  </>
                )}
                {mermaTarget.tipoProducto === 'BARRA' && (
                  <>
                    Barra · <span className="font-mono">{mermaTarget.barraCodigo}</span> ·{' '}
                    {String(mermaTarget.barraNombre ?? '')}
                  </>
                )}
              </div>

              {mermaTarget.tipoProducto === 'BARRA' && (
                <div className="mt-2 text-sm text-red-200/80">
                  Cuartos disponibles: <b>{Math.floor(safeNum(mermaTarget.barraDisp, 0))}</b> · usados:{' '}
                  <b>{Math.floor(safeNum(mermaTarget.barraUsados, 0))}</b>
                </div>
              )}
              {mermaTarget.tipoProducto === 'BOLSA_VACIA' && (
                <div className="mt-2 text-sm text-red-200/80">
                  BV disponibles: <b>{Math.floor(safeNum(mermaTarget.bvDisponibles, 0))}</b>
                </div>
              )}
            </div>

            {/* ✅ Fuente SOLO para barra */}
            {mermaTarget.tipoProducto === 'BARRA' && (
              <div>
                <label className="block text-sm text-gray-300 mb-2">Fuente de cuartos</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMermaCuartosFuente('DISPONIBLES')}
                    className={`px-4 py-3 rounded-xl border ${
                      mermaCuartosFuente === 'DISPONIBLES'
                        ? 'bg-emerald-900/25 border-emerald-700/30 text-emerald-200'
                        : 'bg-gray-900/30 border-gray-700/40 text-gray-200'
                    }`}
                  >
                    DISPONIBLES
                  </button>
                  <button
                    type="button"
                    onClick={() => setMermaCuartosFuente('USADOS')}
                    className={`px-4 py-3 rounded-xl border ${
                      mermaCuartosFuente === 'USADOS'
                        ? 'bg-amber-900/25 border-amber-700/30 text-amber-200'
                        : 'bg-gray-900/30 border-gray-700/40 text-gray-200'
                    }`}
                  >
                    USADOS
                  </button>
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  El service restará <b>cuartosDisponibles</b> o <b>cuartosUsados</b> según lo que elijas.
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-300 mb-2">Cantidad a mermar *</label>
              <input
                type="number"
                min={1}
                value={mermaCantidad}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') return setMermaCantidad('');
                  const n = Math.floor(Number(raw));
                  if (!Number.isFinite(n) || n <= 0) return;
                  setMermaCantidad(n);
                }}
                className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
                placeholder="Ej: 10"
                disabled={busy}
              />
            </div>

            {/* ✅ Razón preset + OTRO editable */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-300">Razón de merma *</label>

              <select
                value={mermaRazonPreset}
                onChange={(e) => {
                  const v = e.target.value as MermaRazonPreset;
                  setMermaRazonPreset(v);
                  setMermaMotivo(v === 'OTRO' ? '' : v);
                }}
                className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
                disabled={busy}
              >
                {MERMA_RAZONES_PRESET.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>

              {mermaRazonPreset === 'OTRO' && (
                <input
                  value={mermaMotivo}
                  onChange={(e) => setMermaMotivo(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
                  placeholder="Escribe el motivo…"
                  disabled={busy}
                />
              )}

              <div className="text-xs text-gray-400">
                Se guardará como <b>motivo</b> en la merma/movimiento.
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">Detalle (opcional)</label>
              <input
                value={mermaMotivoDet}
                onChange={(e) => setMermaMotivoDet(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white"
                placeholder="Ej: Se reventó bolsa al cargar"
                disabled={busy}
              />
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-800/50">
              <button
                type="button"
                onClick={() => setOpenMerma(false)}
                disabled={busy}
                className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitMerma}
                disabled={busy || mermaCantidad === '' || !String(mermaMotivo || '').trim()}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Aplicando...
                  </>
                ) : (
                  <>
                    <MinusCircle className="h-5 w-5" />
                    Aplicar Merma
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ================= MODAL AJUSTAR CUARTOS (tu modal) ================= */}
      {barraSel && (
        <ActualizarCuartosBarraModal
          isOpen={openCuartos}
          onClose={() => setOpenCuartos(false)}
          barra={barraSel}
          usuarioNombre={user?.email ?? 'Admin'}
          onSuccess={() => {
            reload();
            setOkMsg('✅ Barra actualizada.');
          }}
        />
      )}
    </div>
  );
}