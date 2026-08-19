/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/context/AuthContext';

import type { BolsaProduct, IceType } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO, ETIQUETAS_TIPO_HIELO } from '@/lib/utils/types/product.types';

import { useProductionStock } from '@/lib/hooks/useProductionStock';
import { ProductionService } from '@/lib/services/production.service';

import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config.client';

import {
  ArrowLeft,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  BadgeCheck,
  Filter,
  UserRound,
  Truck,
  Factory,
  Droplets,
  ChevronRight,
  BarChart3,
  Thermometer,
  Package,
  User,
  X,
  Send,
  Search,
  Snowflake
} from 'lucide-react';

type TransporteUI = { codigo: string; nombre: string; isActive: boolean };

type StockTipoUI = {
  tipoHielo: IceType;
  stockActual?: any;
  stockMinimo?: any;
  stockMaximo?: any;
};

type StockProductoUI = {
  bolsaVaciaCodigo: string;
  productoNombre: string;
  pesoKg?: number | null;
  totalLlenas?: any;
  tipos?: StockTipoUI[];
};

type CardUI = {
  key: string;
  codigo: string;
  nombre: string;
  pesoKg?: number | null;
  tipoHielo: IceType;
  actual: number;
  min: number;
  max: number;
  ok: boolean;
  totalProducto: number;
  esMaquila: boolean;
};

const safeNum = (n: any, f = 0) => (Number.isFinite(Number(n)) ? Number(n) : f);
const pct = (v: number, m: number) => (m > 0 ? Math.min(100, (v / m) * 100) : 0);

const esBolsaMaquila = (nombre: unknown) =>
  /maquila/i.test(String(nombre ?? '').trim());

const buildNombreBolsaLlena = (pesoKg: unknown, nombreBV?: unknown) => {
  const kg = safeNum(pesoKg, 0);
  const maquila = esBolsaMaquila(nombreBV);

  if (kg <= 0) {
    return maquila ? 'Bolsa llena MAQUILA' : 'Bolsa llena';
  }

  return maquila ? `Bolsa llena ${kg}kg MAQUILA` : `Bolsa llena ${kg}kg`;
};

// ✅ helper: int >= 1 por default, pero en submit usamos f=0 para permitir vacío inválido
const safeInt = (n: any, f = 1) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return f;
  const i = Math.floor(v);
  return i <= 0 ? f : i;
};

function getTiposConfigurados(bv: BolsaProduct): IceType[] {
  const a = (bv as any).configuracionAdmin?.tiposHieloConfigurados;
  if (Array.isArray(a) && a.length) return a as IceType[];

  const b = (bv as any).configuracionEspecifica?.tiposHieloHabilitados;
  if (Array.isArray(b) && b.length) return b as IceType[];

  const c = (bv as any).tiposHieloPermitidos;
  if (Array.isArray(c) && c.length) return c as IceType[];

  return [...TIPOS_HIELO];
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-slate-900 rounded-3xl shadow-2xl border border-slate-700/80 animate-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between p-6 border-b border-slate-700/80 bg-gradient-to-r from-slate-900 via-cyan-900/30 to-slate-900">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl shadow-lg shadow-cyan-500/30">
                <RotateCcw className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-white text-lg tracking-tight">{title}</h3>
                <p className="text-sm text-slate-400 mt-0.5">
                  ✅ Solo bolsas <b className="text-cyan-300">LLENAS</b> (suma a stockPorHielo)
                </p>
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

export default function ProductionDevolucionesPage() {
  const router = useRouter();
  const { productionSession, isProductionLoggedIn, loading } = useAuthContext();

  useEffect(() => {
    if (loading) return;
    if (!isProductionLoggedIn || !productionSession) {
      router.replace('/login?mode=empleado');
    }
  }, [loading, isProductionLoggedIn, productionSession, router]);

  const { bolsasVacias, stockLlenoPorProducto, loading: loadingStock, error: stockError } =
    useProductionStock();

  // ============================
  // Transportistas (listener)
  // ============================
  const [transportistas, setTransportistas] = useState<TransporteUI[]>([]);
  useEffect(() => {
    const qy = query(collection(db, 'empleados'), where('role', '==', 'TRANSPORTE'));
    const unsub = onSnapshot(qy, (snap) => {
      const list: TransporteUI[] = snap.docs
        .map((d) => {
          const data = d.data() as any;
          return {
            codigo: String(data.codigo ?? d.id),
            nombre: String(data.nombre ?? 'Transporte'),
            isActive: data.isActive !== false,
          };
        })
        .filter((x) => x.isActive);

      list.sort((a, b) => a.codigo.localeCompare(b.codigo));
      setTransportistas(list);
    });

    return () => unsub();
  }, []);

  // ============================
  // Mapas BV (para tipos permitidos / nombre)
  // ============================
  const bvByCodigo = useMemo(() => {
    const m = new Map<string, BolsaProduct>();
    for (const b of bolsasVacias) m.set(String(b.codigo).toUpperCase(), b);
    return m;
  }, [bolsasVacias]);

  const tiposPermitidosByCodigo = useMemo(() => {
    const m = new Map<string, Set<IceType>>();
    for (const b of bolsasVacias) m.set(String(b.codigo).toUpperCase(), new Set<IceType>(getTiposConfigurados(b)));
    return m;
  }, [bolsasVacias]);

  // ============================
  // Filtros
  // ============================
  const [filterTipo, setFilterTipo] = useState<IceType | 'TODOS'>('TODOS');
  const [q, setQ] = useState('');
  const qNorm = useMemo(() => q.trim().toLowerCase(), [q]);

  // ============================
  // Carrusel directo (SOLO LLENAS)
  // ============================
  const carouselCards = useMemo<CardUI[]>(() => {
    const list = (stockLlenoPorProducto as unknown as StockProductoUI[]) ?? [];
    const out: CardUI[] = [];

    for (const p of list) {
      const codigo = String(p.bolsaVaciaCodigo ?? '').trim().toUpperCase();
      if (!codigo) continue;

      const bv = bvByCodigo.get(codigo) ?? null;
      const allowed = tiposPermitidosByCodigo.get(codigo) ?? new Set<IceType>(TIPOS_HIELO);

      const nombreBV = String(bv?.nombre ?? p.productoNombre ?? codigo);
      const pesoKg = p.pesoKg ?? (bv as any)?.pesoKg ?? null;
      const esMaquila = esBolsaMaquila(nombreBV);
      const nombre = buildNombreBolsaLlena(pesoKg, nombreBV);

      if (qNorm) {
        const ok =
          nombre.toLowerCase().includes(qNorm) ||
          nombreBV.toLowerCase().includes(qNorm) ||
          codigo.toLowerCase().includes(qNorm);
        if (!ok) continue;
      }

      const tipos = (p.tipos ?? []) as StockTipoUI[];
      for (const t of tipos) {
        if (!t?.tipoHielo) continue;
        if (!allowed.has(t.tipoHielo)) continue;
        if (filterTipo !== 'TODOS' && t.tipoHielo !== filterTipo) continue;

        const actual = safeNum(t.stockActual, 0);
        const min = safeNum(t.stockMinimo, 0);
        const max = safeNum(t.stockMaximo, 0);

        // ✅ SOLO TIPOS CONFIGURADOS (evita cards basura)
        if (max <= 0) continue;

        out.push({
          key: `${codigo}-${t.tipoHielo}`,
          codigo,
          nombre,
          pesoKg,
          tipoHielo: t.tipoHielo,
          actual,
          min,
          max,
          ok: actual > min,
          totalProducto: safeNum(p.totalLlenas, 0),
          esMaquila,
        });
      }
    }

    out.sort((a, b) => {
      const n = a.nombre.localeCompare(b.nombre);
      if (n !== 0) return n;
      return a.tipoHielo.localeCompare(b.tipoHielo);
    });

    return out;
  }, [stockLlenoPorProducto, bvByCodigo, tiposPermitidosByCodigo, filterTipo, qNorm]);

  // ============================
  // Modal DEVOLVER
  // ============================
  const [openDev, setOpenDev] = useState(false);
  const [devBVCodigo, setDevBVCodigo] = useState<string>('');
  const [devTipo, setDevTipo] = useState<IceType>('ROLITO');

  // inicia vacío
  const [devCantidad, setDevCantidad] = useState<number | ''>('');

  const [devModo, setDevModo] = useState<'NORMAL' | 'TRANSPORTE'>('NORMAL');
  const [devTransCodigo, setDevTransCodigo] = useState<string>('');

  const [motivo, setMotivo] = useState<string>('');
  const [observaciones, setObservaciones] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const selectedBV = useMemo(() => {
    if (!devBVCodigo) return null;
    return bvByCodigo.get(devBVCodigo) ?? null;
  }, [devBVCodigo, bvByCodigo]);

  const selectedEsMaquila = useMemo(
    () => esBolsaMaquila(selectedBV?.nombre),
    [selectedBV],
  );

  const selectedNombreLleno = useMemo(
    () => buildNombreBolsaLlena((selectedBV as any)?.pesoKg, selectedBV?.nombre),
    [selectedBV],
  );

  const openDevModal = (bvCodigo: string, tipo: IceType) => {
    setOkMsg(null);
    setErrMsg(null);
    setDevBVCodigo(String(bvCodigo).toUpperCase());
    setDevTipo(tipo);

    setDevCantidad('');
    setDevModo('NORMAL');
    setDevTransCodigo('');
    setMotivo('');
    setObservaciones('');
    setOpenDev(true);
  };

  const submitDev = async () => {
    setOkMsg(null);
    setErrMsg(null);

    if (!productionSession) return;
    if (!selectedBV) return setErrMsg('No se encontró el producto.');

    const cantidad = safeInt(devCantidad as any, 0);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return setErrMsg('Ingresa una cantidad válida.');
    if (!motivo.trim()) return setErrMsg('Selecciona un motivo.');

    const trans =
      devModo === 'TRANSPORTE'
        ? transportistas.find((t) => t.codigo === devTransCodigo) ?? null
        : null;

    if (devModo === 'TRANSPORTE' && !trans) return setErrMsg('Selecciona el empleado de transporte.');

    try {
      setSaving(true);

      const destinatario =
        devModo === 'TRANSPORTE' && trans
          ? `Transporte: ${trans.codigo} - ${trans.nombre}`
          : 'Cliente/Interno';

      const motivoFinal = `[DEV:${devModo}] ${motivo}`;

      await ProductionService.registrarDevolucionStock({
        bolsaVaciaCodigo: selectedBV.codigo,
        tipoHielo: devTipo,
        cantidad,
        usuarioCodigo: productionSession.codigo,
        usuarioNombre: productionSession.nombre,
        motivo: motivoFinal,
        destinatario,
        observaciones,
        empleadoAsignadoCodigo: trans?.codigo,
        empleadoAsignadoNombre: trans?.nombre,
      } as any);

      setOkMsg(
        `✓ Listo: +${cantidad} en ${ETIQUETAS_TIPO_HIELO[devTipo]}${
          selectedEsMaquila ? ' · MAQUILA' : ''
        }`,
      );
      setOpenDev(false);
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Error registrando devolución');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !productionSession) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950/30">
      {/* Header */}
      <div className="relative overflow-hidden bg-slate-900/70 backdrop-blur-md rounded-b-3xl border-b border-slate-700/50 shadow-2xl shadow-slate-950/50 p-6 mb-8">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-600 hover:to-blue-700 shadow-lg shadow-cyan-500/20 transition-all duration-300 hover:-translate-y-0.5"
                type="button"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-2xl border border-cyan-500/30 shadow-lg">
                  <RotateCcw className="w-6 h-6 text-cyan-300" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <Snowflake className="h-5 w-5 text-cyan-300" />
                    <h1 className="text-2xl font-bold text-white tracking-tight">Devoluciones (solo llenas)</h1>
                  </div>
                  <p className="text-slate-400 mt-1">
                    Stock <ChevronRight className="w-4 h-4 inline mx-1 text-slate-500" /> Sumar por devolución
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-slate-400">Operario</p>
                <p className="text-lg font-bold text-cyan-300">{productionSession.nombre}</p>
                <p className="text-xs text-slate-500 font-mono">{productionSession.codigo}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-2xl flex items-center justify-center border border-cyan-500/30 shadow-lg">
                <div className="w-8 h-8 bg-cyan-500/20 rounded-full flex items-center justify-center">
                  <Factory className="w-4 h-4 text-cyan-300" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contenido */}
      <div className="container mx-auto px-4 pb-10">
        {/* Estado */}
        <div className="grid grid-cols-1 gap-6 mb-6">
          {loadingStock && (
            <div className="bg-slate-900/70 backdrop-blur-md rounded-2xl border border-slate-700/50 p-6 shadow-xl">
              <div className="flex items-center justify-center gap-4">
                <div className="relative">
                  <div className="w-12 h-12 border-4 border-slate-700/50 rounded-full"></div>
                  <div className="absolute top-0 left-0 w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div>
                  <p className="font-medium text-white">Cargando datos del sistema...</p>
                  <p className="text-sm text-slate-400">Sincronizando información en tiempo real</p>
                </div>
              </div>
            </div>
          )}

          {stockError && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl shadow-lg">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-amber-400">Error del Sistema</p>
                  <p className="text-amber-300/80 mt-1">{stockError}</p>
                </div>
              </div>
            </div>
          )}

          {okMsg && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl shadow-lg">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-emerald-400">Devolución Exitosa</p>
                  <p className="text-emerald-300/80 mt-1">{okMsg}</p>
                  <p className="text-sm text-emerald-400/60 mt-2">✓ Stock lleno actualizado ✓ Registro guardado</p>
                </div>
              </div>
            </div>
          )}

          {errMsg && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl shadow-lg">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-amber-400">Validación Requerida</p>
                  <p className="text-amber-300/80 mt-1">{errMsg}</p>
                  <p className="text-sm text-amber-400/60 mt-2">Revisa los datos y vuelve a intentar</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Filtros */}
        <section className="mb-6">
          <div className="bg-slate-900/70 backdrop-blur-md rounded-3xl border border-slate-700/50 shadow-2xl shadow-slate-950/50 p-5">
            <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl shadow-lg shadow-cyan-500/20">
                  <BarChart3 className="w-5 h-5 text-white" />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar por nombre o código..."
                    className="pl-9 pr-3 py-2.5 rounded-xl border border-slate-700/50 bg-slate-800/50 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-cyan-400" />
                  <select
                    value={filterTipo}
                    onChange={(e) => setFilterTipo(e.target.value as IceType | 'TODOS')}
                    className="px-3 py-2 rounded-xl border border-slate-700/50 bg-slate-800/50 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40"
                  >
                    <option value="TODOS">Todos los tipos</option>
                    {TIPOS_HIELO.map((t) => (
                      <option key={t} value={t}>
                        {ETIQUETAS_TIPO_HIELO[t]}
                      </option>
                    ))}
                  </select>
                </div>

                <span className="px-3 py-1.5 bg-cyan-500/20 text-cyan-300 rounded-full text-sm font-semibold border border-cyan-500/30 self-start sm:self-auto">
                  {carouselCards.length} cards
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Carrusel */}
        <section>
          <div className="bg-slate-900/70 backdrop-blur-md rounded-3xl border border-slate-700/50 shadow-2xl shadow-slate-950/50 p-6 h-full">
            {!carouselCards.length && !loadingStock && (
              <div className="text-center py-12">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                  <BadgeCheck className="w-10 h-10 text-cyan-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Sin cards disponibles</h3>
                <p className="text-slate-400 max-w-md mx-auto">
                  Ajusta búsqueda/filtro o revisa configuración de máximos.
                </p>
              </div>
            )}

            {!!carouselCards.length && (
              <div className="relative">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
                  {carouselCards.map((c) => (
                    <div
                      key={c.key}
                      className="group relative overflow-hidden bg-gradient-to-br from-slate-800/80 via-slate-900/80 to-cyan-900/30 rounded-2xl border border-slate-700/50 p-5 shadow-xl hover:shadow-2xl hover:shadow-cyan-500/10 hover:-translate-y-1 transition-all duration-300"
                    >
                      {/* Glow Effect */}
                      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-400/5 blur-2xl group-hover:bg-cyan-400/15 transition-all duration-500" />
                      <div className="absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-blue-400/5 blur-2xl group-hover:bg-blue-400/10 transition-all duration-500" />

                      <div className="flex items-start justify-between gap-3 mb-6 relative">
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Snowflake className="w-5 h-5 text-cyan-400" />
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-white text-lg">
                                {c.pesoKg ?? '—'}kg · {ETIQUETAS_TIPO_HIELO[c.tipoHielo]}
                              </span>
                              {c.esMaquila && (
                                <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black tracking-[0.12em] text-amber-400 shadow-sm">
                                  MAQUILA
                                </span>
                              )}
                            </div>
                          </div>
                          <div
                            className={[
                              'text-sm rounded-xl px-3 py-1.5 inline-flex items-center gap-1.5 border font-medium shadow-sm',
                              c.esMaquila
                                ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
                                : 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
                            ].join(' ')}
                          >
                            {c.nombre} · {c.codigo}
                            {c.esMaquila && <span className="font-black">· MAQUILA</span>}
                          </div>
                        </div>

                        <div
                          className={`px-3 py-1.5 rounded-full font-bold ${
                            c.ok
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {c.ok ? 'OK' : 'BAJO'}
                        </div>
                      </div>

                      <div className="mb-6 relative">
                        <div className="flex justify-between text-sm text-slate-400 mb-2">
                          <span>Stock lleno</span>
                          <span className="font-bold text-white">
                            {safeNum(c.actual, 0)} / {safeNum(c.max, 0)}
                          </span>
                        </div>
                        <div className="h-3 bg-slate-700/50 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              c.ok
                                ? 'bg-gradient-to-r from-cyan-400 to-blue-500'
                                : 'bg-gradient-to-r from-amber-400 to-orange-400'
                            }`}
                            style={{ width: `${pct(safeNum(c.actual, 0), safeNum(c.max, 0))}%` }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3 mb-6 relative">
                        <div className="text-center p-3 bg-slate-800/50 rounded-2xl border border-slate-700/50">
                          <div className="text-xs text-slate-400 mb-1">Mínimo</div>
                          <div className="text-xl font-bold text-white">{safeNum(c.min, 0)}</div>
                        </div>
                        <div className="text-center p-3 bg-slate-800/50 rounded-2xl border border-slate-700/50">
                          <div className="text-xs text-slate-400 mb-1">Máximo</div>
                          <div className="text-xl font-bold text-white">{safeNum(c.max, 0)}</div>
                        </div>
                        <div className="text-center p-3 bg-slate-800/50 rounded-2xl border border-slate-700/50">
                          <div className="text-xs text-slate-400 mb-1">Total producto</div>
                          <div className="text-xl font-bold text-white">{safeNum(c.totalProducto, 0)}</div>
                        </div>
                      </div>

                      <button
                        onClick={() => openDevModal(c.codigo, c.tipoHielo)}
                        className="w-full rounded-xl py-3.5 font-bold transition-all duration-300 shadow-lg bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-700 hover:to-blue-700 hover:shadow-xl hover:shadow-cyan-500/20 hover:-translate-y-0.5 relative"
                        type="button"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <RotateCcw className="w-5 h-5" />
                          Devolver {ETIQUETAS_TIPO_HIELO[c.tipoHielo]}
                          {c.esMaquila ? ' · MAQUILA' : ''}
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Modal devolver */}
      <Modal open={openDev} title="Registrar devolución (bolsas llenas)" onClose={() => setOpenDev(false)}>
        {!selectedBV ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-cyan-400" />
            </div>
            <p className="text-white font-medium">No se encontró el producto</p>
          </div>
        ) : (
          <>
            <div className="mb-6 p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-xl border border-cyan-500/20">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg shadow-lg shadow-cyan-500/20">
                  <Package className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-bold text-white">{selectedNombreLleno}</h4>
                    {selectedEsMaquila && (
                      <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black tracking-[0.12em] text-amber-400">
                        MAQUILA
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400">
                    {selectedBV.codigo} · {(selectedBV as any).pesoKg != null ? `${Number((selectedBV as any).pesoKg)}kg` : ''}
                  </p>
                  {selectedEsMaquila && (
                    <p className="mt-2 text-xs font-bold text-amber-400">
                      Esta devolución corresponde a producto de MAQUILA.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3">
                <div className="text-sm text-slate-300">
                  Tipo: <span className="font-bold text-white">{ETIQUETAS_TIPO_HIELO[devTipo]}</span>
                </div>
                <div className="mt-1 text-xs text-cyan-400">
                  ✓ Esta devolución <b className="text-cyan-300">SUMA</b> al stock de bolsas <b className="text-cyan-300">LLENAS</b>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <label className="text-sm font-medium text-white mb-3 block flex items-center gap-2">
                <UserRound className="w-4 h-4 text-cyan-400" />
                Tipo de devolución
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDevModo('NORMAL')}
                  className={`px-4 py-3 rounded-xl border text-center transition-all duration-200 ${
                    devModo === 'NORMAL'
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white border-cyan-500 shadow-lg shadow-cyan-500/20'
                      : 'bg-slate-800/50 text-slate-300 border-slate-700/50 hover:border-cyan-500/30 hover:shadow-md'
                  }`}
                >
                  <User className="w-5 h-5 mx-auto mb-2" />
                  <div className="font-bold">Normal</div>
                  <div className="text-xs mt-1 text-slate-400">Cliente / Interno</div>
                </button>

                <button
                  type="button"
                  onClick={() => setDevModo('TRANSPORTE')}
                  className={`px-4 py-3 rounded-xl border text-center transition-all duration-200 ${
                    devModo === 'TRANSPORTE'
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-700 text-white border-cyan-500 shadow-lg shadow-cyan-500/20'
                      : 'bg-slate-800/50 text-slate-300 border-slate-700/50 hover:border-cyan-500/30 hover:shadow-md'
                  }`}
                >
                  <Truck className="w-5 h-5 mx-auto mb-2" />
                  <div className="font-bold">Transporte</div>
                  <div className="text-xs mt-1 text-slate-400">Por chofer</div>
                </button>
              </div>
            </div>

            {devModo === 'TRANSPORTE' && (
              <div className="mb-6">
                <label className="text-sm font-medium text-white mb-2 block flex items-center gap-2">
                  <Truck className="w-4 h-4 text-cyan-400" />
                  Transportista que devolvió
                </label>
                <select
                  value={devTransCodigo}
                  onChange={(e) => setDevTransCodigo(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/50 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40 transition-all duration-200"
                >
                  <option value="">Selecciona transporte…</option>
                  {transportistas.map((t) => (
                    <option key={t.codigo} value={t.codigo}>
                      {t.codigo} · {t.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Cantidad */}
            <div className="mb-6">
              <label className="text-sm font-medium text-white mb-2 block">Cantidad devuelta (llenas)</label>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  value={devCantidad}
                  placeholder="Ingresar cantidad"
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setDevCantidad('');
                      return;
                    }
                    const next = safeInt(raw, 1);
                    setDevCantidad(next);
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/50 text-white text-center text-lg font-bold outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40 transition-all duration-200 placeholder:text-slate-500"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400 font-medium">unidades</div>
              </div>
              <p className="mt-2 text-xs text-cyan-400">
                Se <b className="text-cyan-300">suma</b> al stock lleno de {ETIQUETAS_TIPO_HIELO[devTipo]}
                {selectedEsMaquila ? ' · MAQUILA' : ''}
              </p>
            </div>

            <div className="mb-6">
              <label className="text-sm font-medium text-white mb-2 block">Motivo de devolución</label>
              <select
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/50 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40 transition-all duration-200"
              >
                <option value="">Selecciona un motivo…</option>
                <option value="DEVOLUCION_CLIENTE">Devolución del cliente</option>
                <option value="RUTA_NO_ENTREGADA">Ruta no entregada</option>
                <option value="EXCESO_INVENTARIO">Exceso de inventario</option>
                <option value="PROCESO_INTERNO">Proceso interno</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>

            <div className="mb-8">
              <label className="text-sm font-medium text-white mb-2 block">Observaciones (opcional)</label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/50 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/40 transition-all duration-200"
                rows={3}
                placeholder="Detalles extra, comentarios, condiciones..."
              />
            </div>

            <button
              onClick={submitDev}
              disabled={saving || !motivo || (devModo === 'TRANSPORTE' && !devTransCodigo)}
              className={`w-full rounded-xl py-4 font-bold transition-all duration-300 shadow-lg ${
                saving || !motivo || (devModo === 'TRANSPORTE' && !devTransCodigo)
                  ? 'bg-slate-700/50 text-slate-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-700 hover:to-blue-700 hover:shadow-xl hover:shadow-cyan-500/20 hover:-translate-y-0.5'
              }`}
              type="button"
            >
              {saving ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                  Registrando devolución...
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <Send className="w-5 h-5" />
                  Confirmar Devolución{selectedEsMaquila ? ' · MAQUILA' : ''}
                </div>
              )}
            </button>
          </>
        )}
      </Modal>
    </div>
  );
}