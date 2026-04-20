// lib/hooks/useProductionStock.ts ✅ FINAL (BV + BARRAS + tolerante a legacy + evita NaN)
'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config.client';

import type { BolsaProduct, IceType, StockPorHieloConfig, BarraProduct } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO } from '@/lib/utils/types/product.types';

/* ================= helpers ================= */
const norm = (v: any) => String(v ?? '').trim().toUpperCase();

const safeNum = (v: any, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const toDateSafe = (v: any): Date => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate(); // Timestamp
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date() : d;
};

const ensureStockPorHieloCompleto = (
  stockPorHielo?: Record<IceType, StockPorHieloConfig> | any,
): Record<IceType, StockPorHieloConfig> => {
  const out = {} as Record<IceType, StockPorHieloConfig>;

  (TIPOS_HIELO as readonly IceType[]).forEach((t) => {
    const cfg = stockPorHielo?.[t];
    out[t] = {
      stockMinimo: safeNum(cfg?.stockMinimo, 0),
      stockMaximo: safeNum(cfg?.stockMaximo, 0),
      stockActual: safeNum(cfg?.stockActual, 0),
      ultimaActualizacion: cfg?.ultimaActualizacion ? toDateSafe(cfg.ultimaActualizacion) : new Date(),
      configAdmin: cfg?.configAdmin,
    };
  });

  return out;
};

const isBVLikeDoc = (data: any) => {
  // ✅ tolerante a variantes / legacy
  const status = norm(data?.status);
  const tipo = norm(data?.tipo);
  const tipoProducto = norm(data?.tipoProducto);

  const hasStock = !!data?.stockPorHielo && typeof data.stockPorHielo === 'object';

  // casos válidos:
  if (status === 'VACIA') return true;
  if (tipoProducto === 'BOLSA_VACIA') return true;
  if (tipo === 'BOLSA_VACIA') return true;

  // legacy común: sin status pero con stockPorHielo (BV manejada por agregados)
  if (!status && hasStock) return true;

  return false;
};

/**
 * ✅ CORE FIX (igual que Admin):
 * - DB a veces queda al revés: cuartosDisponibles=CONSUMIDOS y cuartosUsados=RESTANTES
 * Detectamos y corregimos.
 */
function computeCuartosUI(raw: { tot: number; cuartosDisponibles?: any; cuartosUsados?: any }) {
  const tot = Math.max(0, Math.floor(Number(raw.tot ?? 0)));
  const rd = Number(raw.cuartosDisponibles);
  const ru = Number(raw.cuartosUsados);

  const hasD = Number.isFinite(rd);
  const hasU = Number.isFinite(ru);

  let disponibles: number;

  if (hasD && hasU) {
    const d = clamp(Math.floor(rd), 0, tot);
    const u = clamp(Math.floor(ru), 0, tot);

    // si u == (tot - d) entonces DB está invertido => "disponibles" es u (restante)
    if (Math.abs(u - (tot - d)) <= 0) {
      disponibles = u;
    } else {
      disponibles = d;
    }
  } else if (hasD) {
    disponibles = clamp(Math.floor(rd), 0, tot);
  } else if (hasU) {
    const usados = clamp(Math.floor(ru), 0, tot);
    disponibles = clamp(tot - usados, 0, tot);
  } else {
    disponibles = tot;
  }

  const consumidos = clamp(tot - disponibles, 0, tot);

  return { tot, disponibles, consumidos };
}

/* ================= tipos derivados ================= */
export interface StockLlenoPorTipo {
  tipoHielo: IceType;
  stockActual: number;
  stockMinimo: number;
  stockMaximo: number;
  ultimaActualizacion?: Date;
}

export interface StockLlenoPorProducto {
  bolsaVaciaCodigo: string;
  productoNombre: string;
  pesoKg?: number;
  tipos: StockLlenoPorTipo[];
  totalLlenas: number;
  bolsasVaciasDisponibles: number; // BV.cantidad
}

export function useProductionStock() {
  const [bolsasVacias, setBolsasVacias] = useState<BolsaProduct[]>([]);
  const [barras, setBarras] = useState<BarraProduct[]>([]);

  const [loadingBV, setLoadingBV] = useState(true);
  const [loadingBarras, setLoadingBarras] = useState(true);

  const [error, setError] = useState<string | null>(null);

  // ✅ BV: SOLO tipo==BOLSA (evita perder BV por status inconsistente)
  const qBv = useMemo(() => {
    return query(collection(db, 'productos'), where('tipo', '==', 'BOLSA'));
  }, []);

  // ✅ Barras pueden estar en:
  // (A) colección "barras"
  // (B) colección "productos" con tipo == "BARRA"
  // Escuchamos AMBAS y unificamos por codigo (cubre tus variantes sin romper nada)
  const qBarrasProductos = useMemo(() => {
    return query(collection(db, 'productos'), where('tipo', '==', 'BARRA'));
  }, []);

  useEffect(() => {
    setLoadingBV(true);
    setError(null);

    const unsub = onSnapshot(
      qBv,
      (snap) => {
        const list = snap.docs
          .map((d) => {
            const data = d.data() as any;
            if (!isBVLikeDoc(data)) return null;

            const stockPorHielo = ensureStockPorHieloCompleto(data.stockPorHielo);

            const codigo = norm(data.codigo ?? d.id); // normaliza para match estable
            const nombre = String(data.nombre ?? 'Producto');

            const bv: BolsaProduct = {
              codigo,
              nombre,
              tipo: 'BOLSA',
              status: 'VACIA', // forzamos BV en UI
              cantidad: safeNum(data.cantidad, 0),
              pesoKg: data.pesoKg != null ? safeNum(data.pesoKg, 0) : undefined,
              tiposHieloPermitidos: Array.isArray(data.tiposHieloPermitidos) ? data.tiposHieloPermitidos : [],
              stockPorHielo,
              configuracionAdmin: data.configuracionAdmin,
              configuracionEspecifica: data.configuracionEspecifica,
              creadoPor: data.creadoPor ?? '',
              fechaCreacion: toDateSafe(data.fechaCreacion),
              ultimaModificacion: toDateSafe(data.ultimaModificacion),
              historico: Array.isArray(data.historico)
                ? data.historico.map((h: any) => ({ ...h, fecha: toDateSafe(h.fecha) }))
                : [],
            } as any;

            return bv;
          })
          .filter(Boolean) as BolsaProduct[];

        list.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));

        setBolsasVacias(list);
        setLoadingBV(false);
      },
      (err) => {
        console.error('useProductionStock BV snapshot error:', err);
        setError(err.message ?? 'Error cargando stock');
        setLoadingBV(false);
      },
    );

    return () => unsub();
  }, [qBv]);

  useEffect(() => {
    setLoadingBarras(true);
    setError(null);

    // A) colección "barras"
    const unsubA = onSnapshot(
      query(collection(db, 'barras')),
      (snap) => {
        const listA = snap.docs
          .map((d) => {
            const data = d.data() as any;
            const codigo = String(data?.codigo ?? d.id).trim();
            if (!codigo) return null;

            const cantidad = Math.max(0, Math.floor(safeNum(data?.cantidad, 0)));
            const cuartosTotales = Math.max(0, Math.floor(safeNum(data?.cuartosTotales, cantidad * 4)));

            const ui = computeCuartosUI({
              tot: cuartosTotales,
              cuartosDisponibles: data?.cuartosDisponibles,
              cuartosUsados: data?.cuartosUsados,
            });

            const barra: BarraProduct = {
              ...(data as any),
              codigo,
              nombre: String(data?.nombre ?? 'Barra'),
              tipo: 'BARRA' as any,
              cantidad,
              cuartosTotales: ui.tot,
              cuartosDisponibles: ui.disponibles,
              cuartosUsados: ui.consumidos, // consumidos (UI)
              fechaCreacion: toDateSafe(data?.fechaCreacion),
              ultimaModificacion: toDateSafe(data?.ultimaModificacion),
            } as any;

            return barra;
          })
          .filter(Boolean) as BarraProduct[];

        // guardamos temporalmente, la unificación final la hacemos abajo
        setBarras((prev) => {
          // reemplaza solo las barras que vienen de A manteniendo lo que venga de B
          // pero como no tenemos marca de origen, mejor unificamos con Map por codigo
          const map = new Map<string, BarraProduct>();
          [...prev, ...listA].forEach((b: any) => map.set(String(b.codigo), b));
          return Array.from(map.values()).sort((x, y) => String(x.codigo).localeCompare(String(y.codigo)));
        });

        setLoadingBarras(false);
      },
      (err) => {
        // si tu proyecto no tiene colección "barras", esto puede fallar por rules/permiso
        // NO reventamos: dejamos que la otra fuente (productos tipo BARRA) cubra.
        console.warn('useProductionStock barras(collection) snapshot warn:', err);
        setLoadingBarras(false);
      },
    );

    // B) productos tipo == BARRA
    const unsubB = onSnapshot(
      qBarrasProductos,
      (snap) => {
        const listB = snap.docs
          .map((d) => {
            const data = d.data() as any;

            const codigo = String(data?.codigo ?? d.id).trim();
            if (!codigo) return null;

            const cantidad = Math.max(0, Math.floor(safeNum(data?.cantidad, 0)));
            const cuartosTotales = Math.max(0, Math.floor(safeNum(data?.cuartosTotales, cantidad * 4)));

            const ui = computeCuartosUI({
              tot: cuartosTotales,
              cuartosDisponibles: data?.cuartosDisponibles,
              cuartosUsados: data?.cuartosUsados,
            });

            const barra: BarraProduct = {
              ...(data as any),
              codigo,
              nombre: String(data?.nombre ?? 'Barra'),
              tipo: 'BARRA' as any,
              cantidad,
              cuartosTotales: ui.tot,
              cuartosDisponibles: ui.disponibles,
              cuartosUsados: ui.consumidos, // consumidos (UI)
              fechaCreacion: toDateSafe(data?.fechaCreacion),
              ultimaModificacion: toDateSafe(data?.ultimaModificacion),
            } as any;

            return barra;
          })
          .filter(Boolean) as BarraProduct[];

        setBarras((prev) => {
          const map = new Map<string, BarraProduct>();
          [...prev, ...listB].forEach((b: any) => map.set(String(b.codigo), b));
          return Array.from(map.values()).sort((x, y) => String(x.codigo).localeCompare(String(y.codigo)));
        });

        setLoadingBarras(false);
      },
      (err) => {
        console.error('useProductionStock barras(productos tipo=BARRA) snapshot error:', err);
        // no bloquea BV
        setLoadingBarras(false);
      },
    );

    return () => {
      unsubA();
      unsubB();
    };
  }, [qBarrasProductos]);

  const totalCuartosDisponibles = useMemo(() => {
    return (barras ?? []).reduce((s: number, b: any) => s + safeNum(b?.cuartosDisponibles, 0), 0);
  }, [barras]);

  const stockLlenoPorProducto = useMemo<StockLlenoPorProducto[]>(() => {
    return bolsasVacias.map((bv) => {
      const stock = ensureStockPorHieloCompleto((bv as any).stockPorHielo);

      const tipos: StockLlenoPorTipo[] = (TIPOS_HIELO as readonly IceType[]).map((t) => {
        const cfg = stock[t];

        // 👇 IMPORTANTE: aquí NO sobreescribimos BARRA.
        // Lo correcto es que la UI (producción) use totalCuartosDisponibles cuando tipoHielo === 'BARRA'
        // para que sea consistente con Admin, sin “contaminar” stockPorHielo guardado.
        return {
          tipoHielo: t,
          stockActual: safeNum(cfg?.stockActual, 0),
          stockMinimo: safeNum(cfg?.stockMinimo, 0),
          stockMaximo: safeNum(cfg?.stockMaximo, 0),
          ultimaActualizacion: cfg?.ultimaActualizacion ? toDateSafe(cfg.ultimaActualizacion) : undefined,
        };
      });

      const totalLlenas = tipos.reduce((s, x) => s + safeNum(x.stockActual, 0), 0);

      return {
        bolsaVaciaCodigo: norm((bv as any).codigo),
        productoNombre: (bv as any).nombre ?? 'Producto',
        pesoKg: (bv as any).pesoKg,
        tipos,
        totalLlenas,
        bolsasVaciasDisponibles: safeNum((bv as any).cantidad, 0),
      };
    });
  }, [bolsasVacias]);

  // (Opcional) totales listos por si los quieres en Producción
  const stockLlenoTotalPorTipo = useMemo<Record<IceType, number>>(() => {
    const out = {} as Record<IceType, number>;
    (TIPOS_HIELO as readonly IceType[]).forEach((t) => (out[t] = 0));

    for (const p of stockLlenoPorProducto) {
      for (const t of p.tipos) {
        out[t.tipoHielo] = safeNum(out[t.tipoHielo], 0) + safeNum(t.stockActual, 0);
      }
    }
    return out;
  }, [stockLlenoPorProducto]);

  const stockLlenoTotalGeneral = useMemo(() => {
    let s = 0;
    (TIPOS_HIELO as readonly IceType[]).forEach((t) => (s += safeNum(stockLlenoTotalPorTipo[t], 0)));
    return s;
  }, [stockLlenoTotalPorTipo]);

  const loading = loadingBV || loadingBarras;

  return {
    bolsasVacias,
    barras,
    totalCuartosDisponibles,

    stockLlenoPorProducto,
    stockLlenoTotalPorTipo,
    stockLlenoTotalGeneral,

    loading,
    error,
  };
}