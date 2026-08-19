/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/context/AuthContext';

import { useProductionStock } from '@/lib/hooks/useProductionStock';
import { FaltantesService } from '@/lib/services/faltante.service';

import type { BolsaProduct, IceType } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO, ETIQUETAS_TIPO_HIELO } from '@/lib/utils/types/product.types';

import {
  Package,
  Clock,
  Factory,
  Truck,
  LogOut,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  PlusCircle,
  ClipboardList,
  X,
  Send,
  Search,
  Boxes,
  Paperclip,
  Link,
  BarChart3,
  Snowflake,
  ShieldCheck,
  Calendar,
  Target,
  TrendingUp,
  Layers,
  Zap,
  RefreshCw,
  Gauge,
} from 'lucide-react';

const safeNum = (n: any, f = 0) => (Number.isFinite(Number(n)) ? Number(n) : f);
const pct = (v: number, m: number) => (m > 0 ? Math.min(100, (v / m) * 100) : 0);

const normTipo = (v: any): IceType | null => {
  const s = String(v ?? '').trim().toUpperCase();
  return (TIPOS_HIELO as readonly string[]).includes(s) ? (s as IceType) : null;
};

function getTiposConfigurados(bv: BolsaProduct): IceType[] {
  const buckets: any[] = [];

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
    const t = normTipo(x);
    if (t) buckets.push(t);
  });

  const normalized = buckets
    .map((x) => normTipo(x))
    .filter((x): x is IceType => Boolean(x));

  return Array.from(new Set<IceType>(normalized));
}

function esBolsaMaquila(bv: BolsaProduct): boolean {
  const nombre = String((bv as any).nombre ?? '').trim().toLowerCase();
  const categoria = String((bv as any).categoria ?? '').trim().toLowerCase();
  const tipo = String((bv as any).tipo ?? '').trim().toLowerCase();

  return nombre.includes('maquila') || categoria.includes('maquila') || tipo.includes('maquila');
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <div className="p-1.5 bg-emerald-500/20 rounded-full border border-emerald-500/30 shadow-lg shadow-emerald-500/10">
      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
    </div>
  ) : (
    <div className="p-1.5 bg-pink-500/20 rounded-full border border-pink-500/30 shadow-lg shadow-pink-500/10">
      <XCircle className="h-5 w-5 text-pink-400" />
    </div>
  );
}

type FaltanteTipo = 'BOLSAS' | 'GRAPAS' | 'HILAZA' | 'OTRO';

const FALTANTE_TIPOS: Array<{
  key: FaltanteTipo;
  label: string;
  icon: React.ElementType;
  helper?: string;
  color: string;
  gradient: string;
}> = [
  { key: 'BOLSAS', label: 'Bolsas', icon: Boxes, helper: 'Elige la bolsa (kg) que hace falta.', color: 'bg-cyan-500', gradient: 'from-cyan-600 to-blue-600' },
  { key: 'GRAPAS', label: 'Grapas', icon: Paperclip, helper: 'Reporta grapas para el sellado.', color: 'bg-blue-500', gradient: 'from-blue-600 to-indigo-600' },
  { key: 'HILAZA', label: 'Hilaza', icon: Link, helper: 'Reporta hilaza para amarres/empaque.', color: 'bg-indigo-500', gradient: 'from-indigo-600 to-purple-600' },
  { key: 'OTRO', label: 'Otro', icon: ClipboardList, helper: 'Describe el insumo faltante.', color: 'bg-slate-500', gradient: 'from-slate-600 to-slate-700' },
];

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
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={onClose} aria-hidden="true" />

      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-slate-900 rounded-3xl shadow-2xl border border-slate-700/80 animate-in slide-in-from-bottom-4 duration-300 overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-slate-700/80 bg-gradient-to-r from-slate-900 via-cyan-900/30 to-slate-900">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl shadow-lg shadow-cyan-500/30">
                <ClipboardList className="w-5 h-5 text-white" />
              </div>

              <div>
                <h3 className="font-bold text-white text-lg tracking-tight">{title}</h3>
                <p className="text-sm text-slate-400 mt-0.5">Reporta insumos faltantes al administrador</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-800 transition-all duration-200 text-slate-400 hover:text-white"
              aria-label="Cerrar"
              type="button"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 max-h-[70vh] overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}

type CarouselCard = {
  key: string;
  codigo: string;
  nombre: string;
  pesoKg?: number;
  tipoHielo: IceType;
  actual: number;
  min: number;
  max: number;
  ok: boolean;
  totalProducto: number;
  vaciasFisicas: number;
  esMaquila: boolean;
};

export default function ProductionDashboardPage() {
  const router = useRouter();
  const { productionSession, isProductionLoggedIn, loading, logoutProduction } = useAuthContext();

  const [time, setTime] = useState(new Date());

  const turno = useMemo(() => {
    const hour = time.getHours();
    if (hour >= 6 && hour < 14) return 'Matutino';
    if (hour >= 14 && hour < 22) return 'Vespertino';
    return 'Nocturno';
  }, [time]);

  const getTurnoColor = () => {
    const hour = time.getHours();
    if (hour >= 6 && hour < 14) return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
    if (hour >= 14 && hour < 22) return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
  };

  const isTransporte = productionSession?.role === 'TRANSPORTE' || productionSession?.role === 'CHOFER';

  useEffect(() => {
    if (loading) return;

    if (!isProductionLoggedIn || !productionSession) {
      router.replace('/login?mode=empleado');
      return;
    }

    if (isTransporte) router.replace('/transporte/dashboard');
  }, [loading, isProductionLoggedIn, productionSession, isTransporte, router]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const { bolsasVacias, stockLlenoPorProducto, loading: stockLoading, error: stockError } = useProductionStock();

  const bolsasVaciasOptions = useMemo(() => {
    const arr = [...(bolsasVacias ?? [])];

    arr.sort((a: any, b: any) => {
      const ak = safeNum((a as any).pesoKg, 0);
      const bk = safeNum((b as any).pesoKg, 0);

      if (ak !== bk) return ak - bk;

      const an = String((a as any).nombre ?? '').toLowerCase();
      const bn = String((b as any).nombre ?? '').toLowerCase();

      return an.localeCompare(bn);
    });

    return arr;
  }, [bolsasVacias]);

  const carouselCards = useMemo<CarouselCard[]>(() => {
    const cards: CarouselCard[] = [];

    for (const p of stockLlenoPorProducto ?? []) {
      const bv = (bolsasVacias ?? []).find((x) => String(x.codigo) === String(p.bolsaVaciaCodigo));
      if (!bv) continue;

      const tiposEnStock = Array.from(
        new Set(
          (p.tipos ?? [])
            .map((x: any) => normTipo(x?.tipoHielo))
            .filter((x): x is IceType => Boolean(x)),
        ),
      );

      if (!tiposEnStock.length) continue;

      const cfg = getTiposConfigurados(bv);
      const tiposPermitidos = cfg.length ? tiposEnStock.filter((t) => cfg.includes(t)) : tiposEnStock;

      if (!tiposPermitidos.length) continue;

      const byTipo = new Map<IceType, { stockActual: number; stockMinimo: number; stockMaximo: number }>();

      for (const row of p.tipos ?? []) {
        const tipo = normTipo(row?.tipoHielo);
        if (!tipo) continue;
        if (!tiposPermitidos.includes(tipo)) continue;

        const prev = byTipo.get(tipo) ?? { stockActual: 0, stockMinimo: 0, stockMaximo: 0 };

        byTipo.set(tipo, {
          stockActual: prev.stockActual + safeNum(row?.stockActual, 0),
          stockMinimo: Math.max(prev.stockMinimo, safeNum(row?.stockMinimo, 0)),
          stockMaximo: Math.max(prev.stockMaximo, safeNum(row?.stockMaximo, 0)),
        });
      }

      for (const [tipo, agg] of byTipo.entries()) {
        const min = safeNum(agg.stockMinimo, 0);
        const max = safeNum(agg.stockMaximo, 0);
        const actual = safeNum(agg.stockActual, 0);

        cards.push({
          key: `${String(p.bolsaVaciaCodigo)}-${String(tipo)}`,
          codigo: String(p.bolsaVaciaCodigo),
          nombre: String(p.productoNombre ?? 'Producto'),
          pesoKg: (p as any).pesoKg != null ? safeNum((p as any).pesoKg, 0) : undefined,
          tipoHielo: tipo,
          actual,
          min,
          max,
          ok: actual >= min,
          totalProducto: safeNum((p as any).totalLlenas, 0),
          vaciasFisicas: safeNum((p as any).bolsasVaciasDisponibles, 0),
          esMaquila: esBolsaMaquila(bv),
        });
      }
    }

    cards.sort((a, b) => {
      const ak = safeNum(a.pesoKg ?? 0, 0);
      const bk = safeNum(b.pesoKg ?? 0, 0);

      if (ak !== bk) return ak - bk;
      if (a.tipoHielo !== b.tipoHielo) return String(a.tipoHielo).localeCompare(String(b.tipoHielo));

      return String(a.nombre).localeCompare(String(b.nombre));
    });

    return cards;
  }, [stockLlenoPorProducto, bolsasVacias]);

  const [faltanteOpen, setFaltanteOpen] = useState(false);
  const [faltanteTipo, setFaltanteTipo] = useState<FaltanteTipo>('BOLSAS');

  const [bolsaSearch, setBolsaSearch] = useState('');
  const [bolsaCodigo, setBolsaCodigo] = useState<string>('');

  const [cantidad, setCantidad] = useState<number>(1);
  const [otroTexto, setOtroTexto] = useState<string>('');
  const [nota, setNota] = useState<string>('');

  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const resetFaltanteForm = () => {
    setFaltanteTipo('BOLSAS');
    setBolsaSearch('');
    setBolsaCodigo('');
    setCantidad(1);
    setOtroTexto('');
    setNota('');
    setToast(null);
  };

  const bolsasFiltradas = useMemo(() => {
    const q = bolsaSearch.trim().toLowerCase();
    if (!q) return bolsasVaciasOptions;

    return bolsasVaciasOptions.filter((bv: any) => {
      const codigo = String(bv.codigo ?? '').toLowerCase();
      const nombre = String(bv.nombre ?? '').toLowerCase();
      const kg = String(bv.pesoKg ?? '').toLowerCase();

      return codigo.includes(q) || nombre.includes(q) || kg.includes(q);
    });
  }, [bolsaSearch, bolsasVaciasOptions]);

  const selectedBV = useMemo(() => {
    return (bolsasVaciasOptions ?? []).find((x: any) => x.codigo === bolsaCodigo) ?? null;
  }, [bolsaCodigo, bolsasVaciasOptions]);

  const canSend = useMemo(() => {
    if (!productionSession) return false;
    if (!Number.isFinite(Number(cantidad)) || Number(cantidad) <= 0) return false;

    if (faltanteTipo === 'BOLSAS') return Boolean(bolsaCodigo);
    if (faltanteTipo === 'OTRO') return otroTexto.trim().length >= 3;

    return true;
  }, [productionSession, cantidad, faltanteTipo, bolsaCodigo, otroTexto]);

  const handleSendFaltante = async () => {
    if (!productionSession) return;

    if (!canSend) {
      setToast({ type: 'err', msg: 'Completa la información antes de enviar.' });
      return;
    }

    try {
      setSending(true);
      setToast(null);

      await FaltantesService.reportar({
        tipo: faltanteTipo,
        cantidad: Number(cantidad),

        bolsa:
          faltanteTipo === 'BOLSAS' && selectedBV
            ? {
                codigo: selectedBV.codigo,
                nombre: (selectedBV as any).nombre ?? '',
                pesoKg: safeNum((selectedBV as any).pesoKg, 0),
              }
            : null,

        otro: faltanteTipo === 'OTRO' ? otroTexto.trim() : null,
        nota: nota.trim() || null,

        reportadoPor: {
          codigo: productionSession.codigo,
          nombre: productionSession.nombre,
          role: productionSession.role,
        },

        origen: 'produccion/dashboard',
      });

      setToast({ type: 'ok', msg: '✓ Faltante enviado. El administrador ya lo puede ver.' });

      setTimeout(() => {
        setFaltanteOpen(false);
        resetFaltanteForm();
      }, 1200);
    } catch (e: any) {
      setToast({ type: 'err', msg: e?.message ?? 'No se pudo enviar el faltante.' });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-950 via-cyan-950/50 to-blue-950">
        <div className="text-center">
          <div className="relative mx-auto w-20 h-20">
            <div className="absolute inset-0 border-4 border-slate-700/50 rounded-full" />
            <div className="absolute inset-0 border-4 border-cyan-400 rounded-full border-t-transparent animate-spin" />
            <div className="absolute inset-0 border-4 border-transparent border-t-blue-400 rounded-full animate-spin-slow" />
          </div>
          <p className="mt-6 text-white font-semibold text-lg">Cargando sesión...</p>
          <p className="text-sm text-cyan-300/70 mt-2">Preparando tu experiencia</p>
        </div>
      </div>
    );
  }

  if (!productionSession) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950/30">
      {/* Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-cyan-950/80 to-blue-950/80 shadow-2xl border-b border-white/5">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-cyan-400/5 blur-3xl" />
        <div className="absolute top-16 -left-24 h-96 w-96 rounded-full bg-blue-500/5 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />

        <div className="relative container mx-auto px-4 py-8 md:py-10">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-start gap-5">
              <div className="w-16 h-16 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 backdrop-blur-xl rounded-2xl flex items-center justify-center border border-cyan-500/30 shadow-2xl shadow-cyan-500/10">
                <Snowflake className="w-8 h-8 text-cyan-300" />
              </div>

              <div className="flex-1">
                <h1 className="text-2xl md:text-4xl font-bold text-white tracking-tight">
                  Bienvenido,{' '}
                  <span className="bg-gradient-to-r from-cyan-200 to-blue-200 bg-clip-text text-transparent">
                    {productionSession.nombre}
                  </span>
                </h1>

                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 backdrop-blur-xl text-white border border-white/10">
                    {isTransporte ? (
                      <>
                        <Truck className="w-4 h-4 text-cyan-300" />
                        <span className="text-sm font-medium">Transporte</span>
                      </>
                    ) : (
                      <>
                        <Factory className="w-4 h-4 text-cyan-300" />
                        <span className="text-sm font-medium">Producción</span>
                      </>
                    )}
                  </div>

                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 backdrop-blur-xl text-white border border-white/10">
                    <Clock className="w-4 h-4 text-cyan-300" />
                    <span className="text-sm font-medium font-mono">
                      {time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>

                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border backdrop-blur-sm ${getTurnoColor()}`}>
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm font-medium">Turno: {turno}</span>
                  </div>

                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 backdrop-blur-xl border border-white/10">
                    <ShieldCheck className="w-4 h-4 text-cyan-300" />
                    <span className="font-mono text-sm text-white/80">{productionSession.codigo}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                onClick={() => setFaltanteOpen(true)}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-600 hover:to-blue-700 transition-all duration-300 shadow-xl shadow-cyan-500/20 hover:shadow-cyan-500/40 hover:-translate-y-0.5 font-semibold"
                type="button"
              >
                <PlusCircle className="w-5 h-5" />
                Reportar faltante
              </button>

              <button
                onClick={() => {
                  logoutProduction();
                  router.replace('/login?mode=empleado');
                }}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-white/5 backdrop-blur-xl text-white/80 hover:bg-white/10 hover:text-white transition-all duration-300 border border-white/10 hover:border-white/20"
                type="button"
              >
                <LogOut className="w-5 h-5" />
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 -mt-6 pb-10 relative z-10">
        <div className="mb-8">
          <div className="bg-slate-900/70 backdrop-blur-md rounded-[2rem] shadow-2xl shadow-slate-950/50 p-6 md:p-8 border border-slate-700/50">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl shadow-lg shadow-cyan-500/20">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>

                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Resumen de Stock</h2>
                  <p className="text-sm text-slate-400 mt-0.5">Inventario en tiempo real por producto</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-300 bg-slate-800/50 px-4 py-2 rounded-full font-medium border border-slate-700/50">
                  {carouselCards.length} {carouselCards.length === 1 ? 'producto' : 'productos'}
                </span>
                <button className="p-2 rounded-xl hover:bg-slate-800/50 transition-all duration-200 text-slate-400 hover:text-cyan-400">
                  <RefreshCw className="w-5 h-5" />
                </button>
              </div>
            </div>

            {(stockLoading || stockError) && (
              <div className="bg-gradient-to-r from-slate-800/50 to-cyan-900/30 rounded-2xl p-6 border border-slate-700/50">
                {stockLoading && (
                  <div className="flex items-center justify-center gap-3">
                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-cyan-400 border-t-transparent" />
                    <span className="text-slate-300 font-medium">Cargando información de stock...</span>
                  </div>
                )}

                {stockError && (
                  <div className="flex items-center gap-3 text-amber-400 bg-amber-500/10 rounded-xl p-4 border border-amber-500/20">
                    <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Error al cargar el stock</p>
                      <p className="text-sm mt-1 text-amber-300/80">{stockError}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!stockLoading && !stockError && carouselCards.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                {carouselCards.map((c) => (
                  <div
                    key={c.key}
                    className="group relative overflow-hidden bg-gradient-to-br from-slate-800/80 via-slate-900/80 to-cyan-900/30 rounded-2xl border border-slate-700/50 p-6 shadow-xl hover:shadow-2xl hover:shadow-cyan-500/10 hover:-translate-y-1 transition-all duration-300 hover:border-cyan-500/30"
                  >
                    {/* Glow Effect */}
                    <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-400/5 blur-2xl group-hover:bg-cyan-400/15 transition-all duration-500" />
                    <div className="absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-blue-400/5 blur-2xl group-hover:bg-blue-400/10 transition-all duration-500" />

                    {/* Header */}
                    <div className="relative flex items-start justify-between gap-3 mb-5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 mb-2">
                          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center border border-cyan-500/20 flex-shrink-0">
                            <Snowflake className="w-5 h-5 text-cyan-300" />
                          </div>

                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className="font-bold text-white truncate">
                              {c.pesoKg ?? '—'}kg
                            </span>
                            <span className="text-sm text-slate-400 truncate">
                              · {ETIQUETAS_TIPO_HIELO[c.tipoHielo]}
                            </span>

                            {c.esMaquila && (
                              <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-black tracking-[0.1em] text-amber-400 shadow-sm flex-shrink-0">
                                MAQUILA
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="font-medium text-slate-300 truncate">{c.nombre}</span>
                          <span className="text-slate-600">·</span>
                          <span className="font-mono text-slate-500">{c.codigo}</span>
                        </div>
                      </div>

                      <StatusIcon ok={c.ok} />
                    </div>

                    {/* Stock Bar */}
                    <div className="relative mb-5 bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
                      <div className="flex justify-between text-xs mb-2.5">
                        <span className="text-slate-400 font-medium">Stock actual</span>
                        <span className="font-bold text-white">
                          {c.actual} / {c.max}
                        </span>
                      </div>

                      <div className="h-2.5 bg-slate-700/50 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            c.ok
                              ? 'bg-gradient-to-r from-cyan-400 to-blue-500'
                              : 'bg-gradient-to-r from-amber-400 to-orange-400'
                          }`}
                          style={{ width: `${pct(c.actual, c.max)}%` }}
                        />
                      </div>

                      <div className="flex justify-between mt-2 text-xs text-slate-500">
                        <span>0</span>
                        <span className="font-medium text-slate-400">{Math.round(pct(c.actual, c.max))}%</span>
                        <span>{c.max}</span>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="relative grid grid-cols-3 gap-3 mb-4">
                      <div className="text-center p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                        <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 mb-1">
                          <Target className="w-3.5 h-3.5" />
                          <span>Mínimo</span>
                        </div>
                        <div className="text-lg font-bold text-white">{c.min}</div>
                      </div>

                      <div className="text-center p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                        <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 mb-1">
                          <TrendingUp className="w-3.5 h-3.5" />
                          <span>Máximo</span>
                        </div>
                        <div className="text-lg font-bold text-white">{c.max}</div>
                      </div>

                      <div
                        className={`text-center p-3 rounded-xl border ${
                          c.ok
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : 'bg-pink-500/10 border-pink-500/30 text-pink-400'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1.5 text-xs mb-1">
                          <Zap className="w-3.5 h-3.5" />
                          <span>Estado</span>
                        </div>
                        <div className="text-lg font-bold">{c.ok ? 'OK' : 'BAJO'}</div>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="relative bg-slate-800/30 rounded-xl p-3 border border-slate-700/50">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400 flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5" />
                          Total producto:
                        </span>
                        <span className="font-bold text-white">{c.totalProducto} unidades</span>
                      </div>
                      <div className="flex items-center justify-between text-xs mt-1 pt-1 border-t border-slate-700/50">
                        <span className="text-slate-500 flex items-center gap-1.5">
                          <Package className="w-3.5 h-3.5" />
                          Bolsas vacías:
                        </span>
                        <span className="font-medium text-slate-300">{c.vaciasFisicas}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!carouselCards.length && !stockLoading && !stockError && (
              <div className="text-center py-16">
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                  <Package className="w-10 h-10 text-cyan-400" />
                </div>

                <h3 className="text-xl font-semibold text-white mb-2">No hay datos disponibles</h3>
                <p className="text-slate-400 max-w-sm mx-auto">
                  No hay stock lleno para mostrar en este momento. Intenta refrescar más tarde.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Faltante Modal */}
      <Modal
        open={faltanteOpen}
        title="Reportar faltante"
        onClose={() => {
          setFaltanteOpen(false);
          resetFaltanteForm();
        }}
      >
        <div className="space-y-6">
          <div>
            <p className="text-sm font-semibold text-white mb-4">¿Qué hace falta?</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {FALTANTE_TIPOS.map((t) => {
                const Icon = t.icon;
                const active = faltanteTipo === t.key;

                return (
                  <button
                    key={t.key}
                    onClick={() => setFaltanteTipo(t.key)}
                    className={[
                      'flex flex-col items-center gap-2.5 p-4 rounded-2xl border-2 text-sm transition-all duration-200',
                      active
                        ? `bg-gradient-to-br ${t.gradient} text-white border-transparent shadow-lg shadow-cyan-500/20 scale-[1.02]`
                        : 'bg-slate-800/50 text-slate-300 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600 hover:shadow-lg hover:-translate-y-0.5',
                    ].join(' ')}
                    type="button"
                  >
                    <div className={`p-2.5 rounded-xl ${active ? 'bg-white/20' : t.color} shadow-sm`}>
                      <Icon className={`w-5 h-5 ${active ? 'text-white' : 'text-white'}`} />
                    </div>

                    <span className="font-semibold">{t.label}</span>
                  </button>
                );
              })}
            </div>

            <p className="text-sm text-slate-300 mt-4 bg-cyan-500/10 rounded-xl p-3.5 border border-cyan-500/20 flex items-start gap-2">
              <span className="text-cyan-400 mt-0.5">💡</span>
              {FALTANTE_TIPOS.find((x) => x.key === faltanteTipo)?.helper}
            </p>
          </div>

          {faltanteTipo === 'BOLSAS' && (
            <div className="bg-gradient-to-br from-cyan-500/10 to-blue-500/5 border border-cyan-500/20 rounded-2xl p-5 space-y-4">
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-cyan-400">
                  <Search className="w-5 h-5" />
                </div>

                <input
                  value={bolsaSearch}
                  onChange={(e) => setBolsaSearch(e.target.value)}
                  placeholder="Buscar bolsa por código, nombre o kg..."
                  className="w-full pl-12 pr-4 py-3.5 rounded-xl border border-cyan-500/20 bg-slate-800/50 text-white text-sm outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40 transition-all duration-200 placeholder:text-slate-500"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-white mb-2 block">Bolsa faltante</label>

                <select
                  value={bolsaCodigo}
                  onChange={(e) => setBolsaCodigo(e.target.value)}
                  className="w-full px-4 py-3.5 rounded-xl border border-cyan-500/20 bg-slate-800/50 text-white text-sm outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40 transition-all duration-200 appearance-none cursor-pointer"
                >
                  <option value="" className="text-slate-400 bg-slate-900">Selecciona una bolsa...</option>

                  {bolsasFiltradas.map((bv: any) => (
                    <option key={bv.codigo} value={bv.codigo} className="bg-slate-900">
                      {(bv.pesoKg ?? '—')}kg · {bv.nombre ?? 'Bolsa'} · {bv.codigo}
                    </option>
                  ))}
                </select>

                {!!bolsaCodigo && !!selectedBV && (
                  <div className="mt-3 p-3.5 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-xl border border-cyan-500/20">
                    <p className="text-sm text-cyan-300 font-medium">
                      Seleccionada: <span className="font-bold text-white">{(selectedBV as any).nombre ?? 'Bolsa'}</span>
                    </p>
                    <p className="text-xs text-cyan-400/70 mt-1">
                      {safeNum((selectedBV as any).pesoKg, 0)}kg · Código: <span className="font-mono font-semibold text-white/80">{selectedBV.codigo}</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {faltanteTipo === 'OTRO' && (
            <div>
              <label className="text-sm font-semibold text-white mb-2 block">¿Qué faltó?</label>

              <input
                value={otroTexto}
                onChange={(e) => setOtroTexto(e.target.value)}
                placeholder="Ej. Cinta, etiquetas, gasolina, etc."
                className="w-full px-4 py-3.5 rounded-xl border border-cyan-500/20 bg-slate-800/50 text-white text-sm outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40 transition-all duration-200 placeholder:text-slate-500"
              />

              <p className="text-xs text-cyan-400/70 mt-2">Describe con al menos 3 caracteres.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-white mb-2 block">Cantidad</label>

              <div className="relative">
                <input
                  type="number"
                  min={1}
                  value={cantidad}
                  onChange={(e) => setCantidad(Number(e.target.value))}
                  className="w-full px-4 py-3.5 rounded-xl border border-cyan-500/20 bg-slate-800/50 text-white text-sm outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40 transition-all duration-200"
                />

                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-cyan-400 text-sm font-medium">unidades</div>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-white mb-2 block">Nota (opcional)</label>

              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Ej. Urgente para el turno..."
                className="w-full px-4 py-3.5 rounded-xl border border-cyan-500/20 bg-slate-800/50 text-white text-sm outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40 transition-all duration-200 placeholder:text-slate-500"
              />
            </div>
          </div>

          {toast && (
            <div
              className={[
                'text-sm rounded-xl border p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4 duration-200',
                toast.type === 'ok'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-pink-500/10 border-pink-500/30 text-pink-300',
              ].join(' ')}
            >
              {toast.type === 'ok' ? (
                <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0 text-pink-400" />
              )}

              <div className="flex-1 font-medium">{toast.msg}</div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 sm:justify-end pt-4 border-t border-slate-700/50">
            <button
              type="button"
              onClick={() => {
                setFaltanteOpen(false);
                resetFaltanteForm();
              }}
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-slate-800/50 border-2 border-slate-700/50 text-slate-300 hover:bg-slate-800 hover:border-slate-600 transition-all duration-200 font-semibold"
              disabled={sending}
            >
              <X className="w-4 h-4" />
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleSendFaltante}
              disabled={!canSend || sending}
              className={[
                'inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-white transition-all duration-200 font-semibold shadow-lg',
                !canSend || sending
                  ? 'bg-slate-700/50 cursor-not-allowed shadow-none text-slate-400'
                  : 'bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-700 hover:to-blue-800 hover:shadow-xl hover:shadow-cyan-500/20 hover:-translate-y-0.5',
              ].join(' ')}
            >
              {sending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Enviar reporte
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}