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
  ChevronRight,
  BarChart3,
  Thermometer,
  Droplets,
} from 'lucide-react';

/* ================= helpers ================= */
const safeNum = (n: any, f = 0) => (Number.isFinite(Number(n)) ? Number(n) : f);
const pct = (v: number, m: number) => (m > 0 ? Math.min(100, (v / m) * 100) : 0);

const normTipo = (v: any): IceType | null => {
  const s = String(v ?? '').trim().toUpperCase();
  return (TIPOS_HIELO as readonly string[]).includes(s) ? (s as IceType) : null;
};


/**
 * ✅ ANTI-CARDS FANTASMA:
 * - Detecta tipos configurados aunque BV venga legacy
 * - Si NO hay config, regresa [] (NO "TIPOS_HIELO"), así no inventa tarjetas
 */
function getTiposConfigurados(bv: BolsaProduct): IceType[] {
  const buckets: any[] = [];

  const a = (bv as any).configuracionAdmin?.tiposHieloConfigurados;
  if (Array.isArray(a) && a.length) buckets.push(...a);

  const b = (bv as any).configuracionEspecifica?.tiposHieloHabilitados;
  if (Array.isArray(b) && b.length) buckets.push(...b);

  const c = (bv as any).tiposHieloPermitidos;
  if (Array.isArray(c) && c.length) buckets.push(...c);

  // legacy: tipo suelto
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

  return Array.from(new Set<IceType>(normalized)); // ✅ si no hay config => []
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <div className="p-1.5 bg-cyan-100 rounded-full">
      <CheckCircle2 className="h-5 w-5 text-cyan-600" />
    </div>
  ) : (
    <div className="p-1.5 bg-purple-100 rounded-full">
      <XCircle className="h-5 w-5 text-purple-600" />
    </div>
  );
}

/* ================== Reportar faltante (UI) ================== */
type FaltanteTipo = 'BOLSAS' | 'GRAPAS' | 'HILAZA' | 'OTRO';

const FALTANTE_TIPOS: Array<{
  key: FaltanteTipo;
  label: string;
  icon: React.ElementType;
  helper?: string;
  color: string;
}> = [
  { key: 'BOLSAS', label: 'Bolsas', icon: Boxes, helper: 'Elige la bolsa (kg) que hace falta.', color: 'bg-cyan-500' },
  {
    key: 'GRAPAS',
    label: 'Grapas',
    icon: Paperclip,
    helper: 'Reporta grapas para el sellado.',
    color: 'bg-purple-500',
  },
  { key: 'HILAZA', label: 'Hilaza', icon: Link, helper: 'Reporta hilaza para amarres/empaque.', color: 'bg-indigo-500' },
  { key: 'OTRO', label: 'Otro', icon: ClipboardList, helper: 'Describe el insumo faltante.', color: 'bg-gray-500' },
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
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 animate-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-lg">
                <ClipboardList className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-lg">{title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">Reporta insumos faltantes al administrador</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-50 transition-all duration-200"
              aria-label="Cerrar"
              type="button"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          <div className="p-6 max-h-[70vh] overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ================== tipos UI (evita any) ================== */
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
    if (hour >= 6 && hour < 14) return 'bg-cyan-100 text-cyan-800 border-cyan-200';
    if (hour >= 14 && hour < 22) return 'bg-purple-100 text-purple-800 border-purple-200';
    return 'bg-indigo-100 text-indigo-800 border-indigo-200';
  };

  const isTransporte = productionSession?.role === 'TRANSPORTE' || productionSession?.role === 'CHOFER';

  // ✅ Gate simple
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

  // ✅ SOLO 1 listener para BV / stockPorHielo
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

  // ✅ CARDS ANTI-FANTASMA:
  // - NO inventa tipos si BV no tiene config
  // - dedupe por tipo
  // - muestra productos reales aunque estén en 0
  // - respeta config BV si existe (si no, usa SOLO p.tipos)
  const carouselCards = useMemo<CarouselCard[]>(() => {
    const cards: CarouselCard[] = [];

    for (const p of stockLlenoPorProducto ?? []) {
      const bv = (bolsasVacias ?? []).find((x) => String(x.codigo) === String(p.bolsaVaciaCodigo));
      if (!bv) continue;

      // Tipos reales (solo lo que venga en p.tipos)
      const tiposEnStock = Array.from(
        new Set(
          (p.tipos ?? [])
            .map((x: any) => normTipo(x?.tipoHielo))
            .filter((x): x is IceType => Boolean(x)),
        ),
      );

      if (!tiposEnStock.length) continue;

      // Tipos permitidos por config BV (si existe)
      const cfg = getTiposConfigurados(bv);
      const tiposPermitidos = cfg.length ? tiposEnStock.filter((t) => cfg.includes(t)) : tiposEnStock;
      if (!tiposPermitidos.length) continue;

      // Consolidar por tipo (si p.tipos trae duplicados)
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

        // ✅ Stock real actual del hook.
        // Para BARRA NO usamos cuartos usados, acumulados históricos ni listeners extra.
        // Si el stock real viene en 0, la tarjeta SÍ se muestra como 0.
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
        });
      }
    }

    // orden estable
    cards.sort((a, b) => {
      const ak = safeNum(a.pesoKg ?? 0, 0);
      const bk = safeNum(b.pesoKg ?? 0, 0);
      if (ak !== bk) return ak - bk;
      if (a.tipoHielo !== b.tipoHielo) return String(a.tipoHielo).localeCompare(String(b.tipoHielo));
      return String(a.nombre).localeCompare(String(b.nombre));
    });

    return cards;
  }, [stockLlenoPorProducto, bolsasVacias]);

  /* ================== Estado: Reportar faltante ================== */
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
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 to-cyan-50">
        <div className="text-center">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-cyan-100 rounded-full"></div>
            <div className="absolute top-0 left-0 w-16 h-16 border-4 border-cyan-500 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <p className="mt-6 text-gray-700 font-medium">Cargando sesión...</p>
          <p className="text-sm text-cyan-600 mt-2">Espera un momento</p>
        </div>
      </div>
    );
  }

  if (!productionSession) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-cyan-50">
      {/* Header con gradiente azul/cyan */}
      <div className="bg-gradient-to-r from-cyan-600 via-cyan-500 to-blue-500 shadow-lg">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center border border-white/30 shadow-lg">
                <Droplets className="w-8 h-8 text-white" />
              </div>

              <div className="flex-1">
                <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
                  Bienvenido, <span className="text-white/95">{productionSession.nombre}</span>
                </h1>

                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/20 backdrop-blur-sm text-white border border-white/30">
                    {isTransporte ? (
                      <>
                        <Truck className="w-4 h-4" />
                        <span className="text-sm font-medium">Transporte</span>
                      </>
                    ) : (
                      <>
                        <Factory className="w-4 h-4" />
                        <span className="text-sm font-medium">Producción</span>
                      </>
                    )}
                  </div>

                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/20 backdrop-blur-sm text-white border border-white/30">
                    <Clock className="w-4 h-4" />
                    <span className="text-sm font-medium">
                      {time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border ${getTurnoColor()}`}>
                    <span className="text-sm font-medium">Turno: {turno}</span>
                  </div>
                </div>

                <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-white/10 backdrop-blur-sm rounded-lg">
                  <span className="text-sm text-white/90">Código:</span>
                  <span className="font-mono font-bold text-white">{productionSession.codigo}</span>
                </div>
              </div>
            </div>

            {/* Acciones */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                onClick={() => setFaltanteOpen(true)}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white text-cyan-700 hover:bg-gray-50 transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5 font-semibold"
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
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-all duration-200 border border-white/30 hover:border-white/40"
                type="button"
              >
                <LogOut className="w-5 h-5" />
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="container mx-auto px-4 -mt-6 pb-10">
        <div className="mb-8">
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-lg">
                  <BarChart3 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Resumen de Stock</h2>
                  <p className="text-sm text-gray-500 mt-0.5">Stock real actual por producto configurado</p>
                </div>
              </div>
              <div className="text-sm text-cyan-600 font-medium">
                {carouselCards.length} {carouselCards.length === 1 ? 'tarjeta' : 'tarjetas'}
              </div>
            </div>

            {(stockLoading || stockError) && (
              <div className="bg-gradient-to-r from-gray-50 to-cyan-50 rounded-xl p-6 border border-gray-200">
                {stockLoading && (
                  <div className="flex items-center justify-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-cyan-500 border-t-transparent"></div>
                    <span className="text-gray-600 font-medium">Cargando información de stock...</span>
                  </div>
                )}
                {stockError && (
                  <div className="flex items-center gap-3 text-purple-700 bg-purple-50 rounded-xl p-4">
                    <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Error al cargar el stock</p>
                      <p className="text-sm mt-1">{stockError}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!stockLoading && !stockError && carouselCards.length > 0 && (
              <div className="relative">
                <div className="flex gap-4 overflow-x-auto pb-6 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
                  {carouselCards.map((c) => (
                    <div
                      key={c.key}
                      className="min-w-[320px] bg-gradient-to-b from-white to-cyan-50 border border-cyan-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1 flex-1"
                    >
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Thermometer className="w-4 h-4 text-cyan-500" />
                            <span className="font-bold text-gray-900">
                              {c.pesoKg ?? '—'}kg · {ETIQUETAS_TIPO_HIELO[c.tipoHielo]}
                            </span>
                          </div>
                          <div className="text-xs text-cyan-600 bg-cyan-50 rounded-lg px-2 py-1 inline-block">
                            {c.nombre} · {c.codigo}
                          </div>
                        </div>
                        <StatusIcon ok={c.ok} />
                      </div>

                      {/* Barra de progreso */}
                      <div className="mb-4">
                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                          <span>Stock actual</span>
                          <span className="font-semibold text-gray-900">
                            {c.actual} / {c.max}
                          </span>
                        </div>
                        <div className="h-2.5 bg-cyan-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              c.ok
                                ? 'bg-gradient-to-r from-cyan-500 to-cyan-600'
                                : 'bg-gradient-to-r from-purple-500 to-purple-600'
                            }`}
                            style={{ width: `${pct(c.actual, c.max)}%` }}
                          />
                        </div>
                      </div>

                      {/* Indicadores */}
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="text-center p-3 bg-cyan-50 rounded-xl border border-cyan-200">
                          <div className="text-xs text-cyan-600 mb-1">Mínimo</div>
                          <div className="text-lg font-bold text-gray-900">{c.min}</div>
                        </div>
                        <div className="text-center p-3 bg-cyan-50 rounded-xl border border-cyan-200">
                          <div className="text-xs text-cyan-600 mb-1">Máximo</div>
                          <div className="text-lg font-bold text-gray-900">{c.max}</div>
                        </div>
                        <div
                          className={`text-center p-3 rounded-xl border ${
                            c.ok ? 'bg-cyan-50 border-cyan-200 text-cyan-800' : 'bg-purple-50 border-purple-200 text-purple-800'
                          }`}
                        >
                          <div className="text-xs mb-1">Estado</div>
                          <div className="text-lg font-bold">{c.ok ? 'OK' : 'BAJO'}</div>
                        </div>
                      </div>

                      {/* Información adicional */}
                      <div className="bg-gradient-to-r from-cyan-50 to-white rounded-xl p-3 border border-cyan-200">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-cyan-600">Total producto:</span>
                          <span className="font-bold text-gray-900">{c.totalProducto} unidades</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 bg-gradient-to-l from-white to-transparent flex items-center justify-center">
                  <ChevronRight className="w-5 h-5 text-cyan-400" />
                </div>
              </div>
            )}

            {!carouselCards.length && !stockLoading && !stockError && (
              <div className="text-center py-10">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cyan-100 flex items-center justify-center">
                  <Package className="w-8 h-8 text-cyan-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No hay datos disponibles</h3>
                <p className="text-gray-500">No hay stock lleno para mostrar en este momento.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================== MODAL: Reportar faltante ================== */}
      <Modal
        open={faltanteOpen}
        title="Reportar faltante"
        onClose={() => {
          setFaltanteOpen(false);
          resetFaltanteForm();
        }}
      >
        <div className="space-y-6">
          {/* Selector tipo */}
          <div>
            <p className="text-sm font-medium text-gray-900 mb-3">¿Qué hace falta?</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {FALTANTE_TIPOS.map((t) => {
                const Icon = t.icon;
                const active = faltanteTipo === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setFaltanteTipo(t.key)}
                    className={[
                      'flex flex-col items-center gap-2 p-4 rounded-xl border text-sm transition-all duration-200',
                      active
                        ? 'bg-gradient-to-br from-cyan-600 to-cyan-700 text-white border-cyan-700 shadow-lg'
                        : 'bg-white text-gray-900 border-gray-200 hover:bg-gray-50 hover:shadow-md hover:-translate-y-0.5',
                    ].join(' ')}
                    type="button"
                  >
                    <div className={`p-2 rounded-lg ${active ? 'bg-white/20' : t.color}`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-medium">{t.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-sm text-gray-600 mt-3 bg-cyan-50 rounded-lg p-3">
              {FALTANTE_TIPOS.find((x) => x.key === faltanteTipo)?.helper}
            </p>
          </div>

          {/* Bolsas: buscador + select */}
          {faltanteTipo === 'BOLSAS' && (
            <div className="bg-gradient-to-br from-cyan-50 to-white border border-cyan-200 rounded-2xl p-5 space-y-4">
              <div className="relative">
                <Search className="w-5 h-5 text-cyan-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  value={bolsaSearch}
                  onChange={(e) => setBolsaSearch(e.target.value)}
                  placeholder="Buscar bolsa por código, nombre o kg…"
                  className="w-full pl-11 pr-4 py-3 rounded-xl border border-cyan-300 bg-white text-sm outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 transition-all duration-200"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-900 mb-2 block">Bolsa faltante</label>
                <select
                  value={bolsaCodigo}
                  onChange={(e) => setBolsaCodigo(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-cyan-300 bg-white text-sm outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 transition-all duration-200"
                >
                  <option value="" className="text-gray-400">
                    Selecciona una bolsa…
                  </option>
                  {bolsasFiltradas.map((bv: any) => (
                    <option key={bv.codigo} value={bv.codigo}>
                      {(bv.pesoKg ?? '—')}kg · {bv.nombre ?? 'Bolsa'} · {bv.codigo}
                    </option>
                  ))}
                </select>

                {!!bolsaCodigo && !!selectedBV && (
                  <div className="mt-3 p-3 bg-gradient-to-r from-cyan-50 to-cyan-100 rounded-lg border border-cyan-200">
                    <p className="text-sm text-cyan-800 font-medium">
                      Seleccionada: <span className="font-bold">{(selectedBV as any).nombre ?? 'Bolsa'}</span>
                    </p>
                    <p className="text-xs text-cyan-600 mt-1">
                      {safeNum((selectedBV as any).pesoKg, 0)}kg · Código:{' '}
                      <span className="font-mono">{selectedBV.codigo}</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* OTRO: texto */}
          {faltanteTipo === 'OTRO' && (
            <div>
              <label className="text-sm font-medium text-gray-900 mb-2 block">¿Qué faltó?</label>
              <input
                value={otroTexto}
                onChange={(e) => setOtroTexto(e.target.value)}
                placeholder="Ej. Cinta, etiquetas, gasolina, etc."
                className="w-full px-4 py-3 rounded-xl border border-cyan-300 bg-white text-sm outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 transition-all duration-200"
              />
              <p className="text-xs text-cyan-600 mt-2">Describe con al menos 3 caracteres.</p>
            </div>
          )}

          {/* Cantidad + Nota */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-900 mb-2 block">Cantidad</label>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  value={cantidad}
                  onChange={(e) => setCantidad(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl border border-cyan-300 bg-white text-sm outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 transition-all duration-200"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-500 text-sm">unidades</div>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-900 mb-2 block">Nota (opcional)</label>
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Ej. Urgente para el turno, se acabó hoy…"
                className="w-full px-4 py-3 rounded-xl border border-cyan-300 bg-white text-sm outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 transition-all duration-200"
              />
            </div>
          </div>

          {/* Toast */}
          {toast && (
            <div
              className={[
                'text-sm rounded-xl border p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4 duration-200',
                toast.type === 'ok'
                  ? 'bg-gradient-to-r from-cyan-50 to-cyan-100 border-cyan-200 text-cyan-800'
                  : 'bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200 text-purple-800',
              ].join(' ')}
            >
              {toast.type === 'ok' ? (
                <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1 font-medium">{toast.msg}</div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 sm:justify-end pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                setFaltanteOpen(false);
                resetFaltanteForm();
              }}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white border border-cyan-200 text-cyan-700 hover:bg-cyan-50 hover:border-cyan-300 transition-all duration-200 font-medium"
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
                'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-white transition-all duration-200 font-medium shadow-lg',
                !canSend || sending
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-700 hover:to-cyan-800 hover:shadow-xl hover:-translate-y-0.5',
              ].join(' ')}
            >
              {sending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  Enviando…
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