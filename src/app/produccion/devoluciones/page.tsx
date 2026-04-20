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
};

const safeNum = (n: any, f = 0) => (Number.isFinite(Number(n)) ? Number(n) : f);
const pct = (v: number, m: number) => (m > 0 ? Math.min(100, (v / m) * 100) : 0);

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
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-gray-200 animate-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-xl">
                <RotateCcw className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-lg">{title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  ✅ Solo bolsas <b>LLENAS</b> (suma a stockPorHielo)
                </p>
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

      const nombre = String(p.productoNombre ?? bv?.nombre ?? codigo);
      const pesoKg = p.pesoKg ?? (bv as any)?.pesoKg ?? null;

      if (qNorm) {
        const ok = nombre.toLowerCase().includes(qNorm) || codigo.toLowerCase().includes(qNorm);
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

      setOkMsg(`✓ Listo: +${cantidad} en ${ETIQUETAS_TIPO_HIELO[devTipo]}`);
      setOpenDev(false);
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Error registrando devolución');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !productionSession) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-cyan-50 to-blue-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-white to-cyan-50 rounded-b-3xl border-b border-cyan-200/50 shadow-xl p-6 mb-8">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5"
                type="button"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-2xl shadow-lg">
                  <RotateCcw className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <Droplets className="h-5 w-5 text-cyan-600" />
                    <h1 className="text-2xl font-bold text-gray-900">Devoluciones (solo llenas)</h1>
                  </div>
                  <p className="text-gray-600 mt-1">
                    Stock <ChevronRight className="w-4 h-4 inline mx-1" /> Sumar por devolución
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-gray-600">Operario</p>
                <p className="text-lg font-bold text-cyan-700">{productionSession.nombre}</p>
                <p className="text-xs text-gray-500 font-mono">{productionSession.codigo}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <Factory className="w-4 h-4 text-white" />
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
            <div className="bg-gradient-to-r from-white to-cyan-50 rounded-2xl border border-cyan-200 p-6 shadow-lg">
              <div className="flex items-center justify-center gap-4">
                <div className="relative">
                  <div className="w-12 h-12 border-4 border-cyan-100 rounded-full"></div>
                  <div className="absolute top-0 left-0 w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Cargando datos del sistema...</p>
                  <p className="text-sm text-gray-500">Sincronizando información en tiempo real</p>
                </div>
              </div>
            </div>
          )}

          {stockError && (
            <div className="bg-gradient-to-r from-white to-rose-50 rounded-2xl border border-rose-200 p-6 shadow-lg">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-r from-rose-500 to-rose-600 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-rose-800">Error del Sistema</p>
                  <p className="text-rose-600 mt-1">{stockError}</p>
                </div>
              </div>
            </div>
          )}

          {okMsg && (
            <div className="bg-gradient-to-r from-emerald-50 to-cyan-50 rounded-2xl border border-emerald-200 p-6 shadow-lg">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-emerald-800">Devolución Exitosa</p>
                  <p className="text-emerald-700 mt-1">{okMsg}</p>
                  <p className="text-sm text-emerald-600 mt-2">✓ Stock lleno actualizado ✓ Registro guardado</p>
                </div>
              </div>
            </div>
          )}

          {errMsg && (
            <div className="bg-gradient-to-r from-rose-50 to-purple-50 rounded-2xl border border-rose-200 p-6 shadow-lg">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-r from-rose-500 to-purple-600 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-rose-800">Validación Requerida</p>
                  <p className="text-rose-700 mt-1">{errMsg}</p>
                  <p className="text-sm text-rose-600 mt-2">Revisa los datos y vuelve a intentar</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Filtros */}
        <section className="mb-6">
          <div className="bg-white/80 backdrop-blur rounded-3xl border border-cyan-200/50 shadow-xl p-5">
            <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl">
                  <BarChart3 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Carrusel directo</h2>
                  <p className="text-sm text-gray-500">Selecciona un card y registra devolución</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar por nombre o código..."
                    className="pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-cyan-600" />
                  <select
                    value={filterTipo}
                    onChange={(e) => setFilterTipo(e.target.value as IceType | 'TODOS')}
                    className="px-3 py-2 rounded-xl border border-cyan-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
                  >
                    <option value="TODOS">Todos los tipos</option>
                    {TIPOS_HIELO.map((t) => (
                      <option key={t} value={t}>
                        {ETIQUETAS_TIPO_HIELO[t]}
                      </option>
                    ))}
                  </select>
                </div>

                <span className="px-3 py-1.5 bg-cyan-100 text-cyan-800 rounded-full text-sm font-semibold self-start sm:self-auto">
                  {carouselCards.length} cards
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Carrusel */}
        <section>
          <div className="bg-gradient-to-b from-white to-cyan-50 rounded-3xl border border-cyan-200/50 shadow-xl p-6 h-full">
            {!carouselCards.length && !loadingStock && (
              <div className="text-center py-12">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center">
                  <BadgeCheck className="w-10 h-10 text-cyan-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Sin cards disponibles</h3>
                <p className="text-gray-600 max-w-md mx-auto">
                  Ajusta búsqueda/filtro o revisa configuración de máximos.
                </p>
              </div>
            )}

            {!!carouselCards.length && (
              <div className="relative">
                <div className="flex gap-6 overflow-x-auto pb-6 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
                  {carouselCards.map((c) => (
                    <div
                      key={c.key}
                      className="min-w-[380px] bg-gradient-to-b from-white to-cyan-50 rounded-2xl border border-cyan-200 p-6 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 flex-shrink-0"
                    >
                      <div className="flex items-start justify-between gap-3 mb-6">
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Thermometer className="w-5 h-5 text-cyan-500" />
                            <span className="font-bold text-gray-900 text-lg">
                              {c.pesoKg ?? '—'}kg · {ETIQUETAS_TIPO_HIELO[c.tipoHielo]}
                            </span>
                          </div>
                          <div className="text-sm text-cyan-600 bg-cyan-50 rounded-xl px-3 py-1.5 inline-block">
                            {c.nombre} · {c.codigo}
                          </div>
                        </div>

                        <div
                          className={`px-3 py-1.5 rounded-full font-bold ${
                            c.ok
                              ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white'
                              : 'bg-gradient-to-r from-purple-500 to-purple-600 text-white'
                          }`}
                        >
                          {c.ok ? 'OK' : 'BAJO'}
                        </div>
                      </div>

                      <div className="mb-6">
                        <div className="flex justify-between text-sm text-gray-600 mb-2">
                          <span>Stock lleno</span>
                          <span className="font-bold text-gray-900">
                            {safeNum(c.actual, 0)} / {safeNum(c.max, 0)}
                          </span>
                        </div>
                        <div className="h-3 bg-cyan-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              c.ok
                                ? 'bg-gradient-to-r from-cyan-500 to-cyan-600'
                                : 'bg-gradient-to-r from-purple-500 to-purple-600'
                            }`}
                            style={{ width: `${pct(safeNum(c.actual, 0), safeNum(c.max, 0))}%` }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3 mb-6">
                        <div className="text-center p-3 bg-cyan-50 rounded-xl border border-cyan-200">
                          <div className="text-xs text-cyan-600 mb-1">Mínimo</div>
                          <div className="text-xl font-bold text-gray-900">{safeNum(c.min, 0)}</div>
                        </div>
                        <div className="text-center p-3 bg-cyan-50 rounded-xl border border-cyan-200">
                          <div className="text-xs text-cyan-600 mb-1">Máximo</div>
                          <div className="text-xl font-bold text-gray-900">{safeNum(c.max, 0)}</div>
                        </div>
                        <div className="text-center p-3 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl border border-cyan-200">
                          <div className="text-xs text-cyan-600 mb-1">Total producto</div>
                          <div className="text-xl font-bold text-gray-900">{safeNum(c.totalProducto, 0)}</div>
                        </div>
                      </div>

                      <button
                        onClick={() => openDevModal(c.codigo, c.tipoHielo)}
                        className="w-full rounded-xl py-3.5 font-bold transition-all duration-300 shadow-lg bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-700 hover:to-blue-700 hover:shadow-xl hover:-translate-y-0.5"
                        type="button"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <RotateCcw className="w-5 h-5" />
                          Devolver {ETIQUETAS_TIPO_HIELO[c.tipoHielo]}
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 bg-gradient-to-l from-white to-transparent flex items-center justify-center">
                  <ChevronRight className="w-6 h-6 text-cyan-400" />
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
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-cyan-400" />
            </div>
            <p className="text-gray-700 font-medium">No se encontró el producto</p>
          </div>
        ) : (
          <>
            <div className="mb-6 p-4 bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl border border-cyan-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-cyan-500 to-cyan-600 rounded-lg">
                  <Package className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">{selectedBV.nombre}</h4>
                  <p className="text-sm text-gray-600">
                    {selectedBV.codigo} · {(selectedBV as any).pesoKg != null ? `${Number((selectedBV as any).pesoKg)}kg` : ''}
                  </p>
                </div>
              </div>

              <div className="mt-3">
                <div className="text-sm text-gray-700">
                  Tipo: <span className="font-bold text-gray-900">{ETIQUETAS_TIPO_HIELO[devTipo]}</span>
                </div>
                <div className="mt-1 text-xs text-cyan-600">
                  ✓ Esta devolución <b>SUMA</b> al stock de bolsas <b>LLENAS</b>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <label className="text-sm font-medium text-gray-900 mb-3 block flex items-center gap-2">
                <UserRound className="w-4 h-4 text-cyan-600" />
                Tipo de devolución
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDevModo('NORMAL')}
                  className={`px-4 py-3 rounded-xl border text-center transition-all duration-200 ${
                    devModo === 'NORMAL'
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white border-cyan-500 shadow-lg'
                      : 'bg-white text-gray-900 border-gray-300 hover:border-cyan-400 hover:shadow-md'
                  }`}
                >
                  <User className="w-5 h-5 mx-auto mb-2" />
                  <div className="font-bold">Normal</div>
                  <div className="text-xs mt-1">Cliente / Interno</div>
                </button>

                <button
                  type="button"
                  onClick={() => setDevModo('TRANSPORTE')}
                  className={`px-4 py-3 rounded-xl border text-center transition-all duration-200 ${
                    devModo === 'TRANSPORTE'
                      ? 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white border-purple-500 shadow-lg'
                      : 'bg-white text-gray-900 border-gray-300 hover:border-purple-400 hover:shadow-md'
                  }`}
                >
                  <Truck className="w-5 h-5 mx-auto mb-2" />
                  <div className="font-bold">Transporte</div>
                  <div className="text-xs mt-1">Por chofer</div>
                </button>
              </div>
            </div>

            {devModo === 'TRANSPORTE' && (
              <div className="mb-6">
                <label className="text-sm font-medium text-gray-900 mb-2 block flex items-center gap-2">
                  <Truck className="w-4 h-4 text-purple-600" />
                  Transportista que devolvió
                </label>
                <select
                  value={devTransCodigo}
                  onChange={(e) => setDevTransCodigo(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-purple-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 transition-all duration-200"
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
              <label className="text-sm font-medium text-gray-900 mb-2 block">Cantidad devuelta (llenas)</label>
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
                  className="w-full px-4 py-3 rounded-xl border border-cyan-300 bg-white text-gray-900 text-center text-lg font-bold outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 transition-all duration-200"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-500 font-medium">unidades</div>
              </div>
              <p className="mt-2 text-xs text-cyan-600">
                Se <b>suma</b> al stock lleno de {ETIQUETAS_TIPO_HIELO[devTipo]}
              </p>
            </div>

            <div className="mb-6">
              <label className="text-sm font-medium text-gray-900 mb-2 block">Motivo de devolución</label>
              <select
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-gray-400 transition-all duration-200"
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
              <label className="text-sm font-medium text-gray-900 mb-2 block">Observaciones (opcional)</label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-gray-400 transition-all duration-200"
                rows={3}
                placeholder="Detalles extra, comentarios, condiciones..."
              />
            </div>

            <button
              onClick={submitDev}
              disabled={saving || !motivo || (devModo === 'TRANSPORTE' && !devTransCodigo)}
              className={`w-full rounded-xl py-4 font-bold transition-all duration-300 shadow-lg ${
                saving || !motivo || (devModo === 'TRANSPORTE' && !devTransCodigo)
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-700 hover:to-blue-700 hover:shadow-xl hover:-translate-y-0.5'
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
                  Confirmar Devolución
                </div>
              )}
            </button>
          </>
        )}
      </Modal>
    </div>
  );
}