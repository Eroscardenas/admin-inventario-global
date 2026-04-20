'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { useAuthContext } from '@/context/AuthContext';

// ✅ IMPORT DIRECTO (no desde barrel)
import { useProducts } from '@/lib/hooks/useProducts';

import ModalDialog from '@/components/ui/Modal';

import type { Product, IceType, BolsaProduct } from '@/lib/utils/types/product.types';

import type { LucideIcon } from 'lucide-react';
import {
  Box,
  Plus,
  Edit,
  Trash2,
  Search,
  Filter,
  RefreshCw,
  ArrowLeft,
  AlertTriangle,
  Loader2,
  AlertCircle,
  PackageX,
  ShieldCheck,
  Eye,
  TrendingDown,
  Warehouse,
  Scale,
  Snowflake,
  Thermometer,
  X,
  Info,
  Check,
} from 'lucide-react';

// ============ helpers ============
const onlyDigitsOrEmpty = (v: string) => v === '' || /^\d+$/.test(v);
const toIntOrNull = (v: string) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};
const safeInt0 = (v: any) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : 0;
};

// 🎨 COMPONENTES SIMPLES MEJORADOS
const StatCard = ({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  onClick,
  badge,
}: {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: LucideIcon;
  color: string;
  onClick?: () => void;
  badge?: string;
}) => (
  <div
    className={`bg-gradient-to-br ${color} rounded-xl p-5 border border-gray-800/50 shadow-lg hover:shadow-xl transition-all duration-300 ${
      onClick ? 'cursor-pointer hover:-translate-y-1 hover:scale-[1.02]' : ''
    }`}
    onClick={onClick}
    role={onClick ? 'button' : undefined}
  >
    <div className="flex items-center justify-between">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-white/90 font-medium">{title}</p>
          {badge && (
            <span
              className={`text-xs px-2 py-1 rounded-full font-medium ${
                badge.includes('OK')
                  ? 'bg-gradient-to-r from-green-800/60 to-green-900/40 text-green-300'
                  : 'bg-gradient-to-r from-red-800/60 to-red-900/40 text-red-300'
              }`}
            >
              {badge}
            </span>
          )}
        </div>
        <p className="text-3xl font-bold text-white mb-1">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        {subtitle && <p className="text-xs text-white/70 mt-2 opacity-90">{subtitle}</p>}
      </div>
      <div className={`p-3 rounded-xl ${color.split(' ')[1]} bg-opacity-30 backdrop-blur-sm ml-4`}>
        <Icon className="h-7 w-7 text-white" />
      </div>
    </div>
  </div>
);

// 🧊 CHIP PARA TIPO DE HIELO MEJORADO
const IceTypeChip = ({ tipo, onRemove }: { tipo: IceType; onRemove?: () => void }) => {
  const getIceTypeInfo = (type: IceType) => {
    const types: Record<IceType, { label: string; color: string; icon: LucideIcon; desc?: string }> = {
      BARRA: { label: 'Barra', color: 'bg-gradient-to-r from-purple-600 to-purple-700', icon: Box, desc: 'Barra' },
      ROLITO: { label: 'Rolito', color: 'bg-gradient-to-r from-blue-800 to-blue-900', icon: Snowflake, desc: 'Rolito' },
      FRAPPE: { label: 'Frappé', color: 'bg-gradient-to-r from-pink-800 to-pink-900', icon: Snowflake, desc: 'Frappe' },
      GOURMET: { label: 'Gourmet', color: 'bg-gradient-to-r from-sky-600 to-sky-700', icon: Snowflake, desc: 'Premium' },
      ENFRIAR: { label: 'Enfriar', color: 'bg-gradient-to-r from-blue-600 to-blue-700', icon: Thermometer, desc: 'Para Enfriar' },
    };
    return types[type];
  };

  const info = getIceTypeInfo(tipo);
  const Icon = info.icon;

  return (
    <div className="relative group">
      <span
        className={`inline-flex items-center px-3.5 py-2 rounded-full text-sm ${info.color} text-white shadow-md hover:shadow-lg transition-shadow duration-200`}
      >
        <Icon className="h-3.5 w-3.5 mr-2" />
        <span className="font-medium">{info.label}</span>
        {info.desc && (
          <span className="ml-2 text-xs opacity-75 bg-white/10 px-1.5 py-0.5 rounded-full">
            {info.desc}
          </span>
        )}
      </span>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-2 -right-2 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-300 hover:scale-110 shadow-lg"
          title="Quitar"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
};

export default function AlmacenPage() {
  const router = useRouter();
  const { user } = useAuthContext();

  // ✅ Hook real
  const { products, loading, error, reload, crearBolsaVacia: crearBolsaVaciaHook, actualizarCantidad } = useProducts();

  // 🎯 ESTADOS
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [bolsaForm, setBolsaForm] = useState({
    nombre: '',
    cantidad: '', // string vacío -> placeholder
    pesoKg: 3,
    tiposHielo: [] as IceType[],
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'TODOS' | 'BOLSA'>('TODOS');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showIceTypeSelector, setShowIceTypeSelector] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [stats, setStats] = useState({
    totalBolsasVacias: 0,
    alertasBajoStock: 0,
    valorTotal: 0,
  });

  // ✅ ALMACÉN = SOLO INSUMOS (BOLSAS VACÍAS)
  const bolsasVacias = useMemo(() => {
    return (products ?? []).filter(
      (p) => p.tipo === 'BOLSA' && (p as BolsaProduct).status === 'VACIA'
    ) as BolsaProduct[];
  }, [products]);

  // 📊 STATS
  useEffect(() => {
    if (!bolsasVacias.length) {
      setStats({ totalBolsasVacias: 0, alertasBajoStock: 0, valorTotal: 0 });
      return;
    }

    const alertasBajoStock = bolsasVacias.filter((p) => {
      const cantidad = Number(p.cantidad ?? 0);
      const stockMinimo = Number((p as any).stockMinimo ?? 10);
      return cantidad <= stockMinimo && cantidad > 0;
    }).length;

    const valorBolsas = bolsasVacias.reduce((sum: number, b) => sum + Number(b.cantidad ?? 0) * 150, 0);

    setStats({
      totalBolsasVacias: bolsasVacias.length,
      alertasBajoStock,
      valorTotal: valorBolsas,
    });
  }, [bolsasVacias]);

  // 🔄 RECARGAR
  const reloadTodo = useCallback(async () => {
    await reload();
  }, [reload]);

  // 📋 FILTRAR (solo BOLSA VACIA)
  const productosFiltrados = useMemo(() => {
    return bolsasVacias.filter((product) => {
      const nombre = (product.nombre ?? '').toLowerCase();
      const codigo = (product.codigo ?? '').toLowerCase();
      const q = searchTerm.toLowerCase();

      const matchesSearch = nombre.includes(q) || codigo.includes(q);
      const matchesType = filterType === 'TODOS' || (filterType === 'BOLSA' && product.tipo === 'BOLSA');

      return matchesSearch && matchesType;
    });
  }, [bolsasVacias, searchTerm, filterType]);

  // ⚠️ alertas bajo stock
  const alertasStockBajo = useMemo(() => {
    return bolsasVacias.filter((product) => {
      const cantidad = Number(product.cantidad ?? 0);
      const stockMinimo = Number((product as any).stockMinimo ?? 10);
      return cantidad <= stockMinimo && cantidad > 0;
    });
  }, [bolsasVacias]);

  // ✏️ modal create/edit (solo bolsa)
  const abrirModalBolsa = (product?: Product) => {
    if (!user) return;

    setEditingProduct(product || null);

    if (product) {
      const bolsa = product as BolsaProduct;
      const cant = product.cantidad != null ? String(safeInt0(product.cantidad)) : '';
      setBolsaForm({
        nombre: product.nombre ?? '',
        cantidad: cant === '0' ? '' : cant,
        pesoKg: Number((bolsa as any).pesoKg ?? 3),
        tiposHielo: (((bolsa as any).tiposHieloPermitidos ?? []) as IceType[]) || [],
      });
    } else {
      setBolsaForm({ nombre: '', cantidad: '', pesoKg: 3, tiposHielo: [] });
    }

    setShowModal(true);
  };

  // 🧊 tipos hielo
  const agregarTipoHielo = (tipo: IceType) => {
    if (!bolsaForm.tiposHielo.includes(tipo)) {
      setBolsaForm((prev) => ({ ...prev, tiposHielo: [...prev.tiposHielo, tipo] }));
    }
  };

  const removerTipoHielo = (tipo: IceType) => {
    setBolsaForm((prev) => ({ ...prev, tiposHielo: prev.tiposHielo.filter((t) => t !== tipo) }));
  };

  // 💾 Guardar bolsa (crear o actualizar cantidad)
  const guardarBolsa = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return alert('Usuario no autenticado');

    if (!bolsaForm.nombre.trim()) return alert('El nombre de la bolsa es requerido');

    const cantidad = toIntOrNull(bolsaForm.cantidad);
    if (!cantidad) return alert('Ingresa una cantidad válida');

    setIsProcessing(true);
    try {
      const usuarioNombre = (user as any).nombre || user.email || 'Usuario';

      if (editingProduct) {
        await actualizarCantidad(editingProduct.codigo || '', cantidad);
        alert(`✅ Bolsa "${bolsaForm.nombre}" actualizada: ${cantidad} unidades`);
      } else {
        await crearBolsaVaciaHook({
          nombre: bolsaForm.nombre,
          cantidad,
          creadoPor: usuarioNombre,
          pesoKg: bolsaForm.pesoKg,
          tiposHieloPermitidos: bolsaForm.tiposHielo.length ? bolsaForm.tiposHielo : undefined,
        });

        alert(`✅ Bolsa vacía "${bolsaForm.nombre}" creada: ${cantidad} unidades`);
      }

      await reloadTodo();

      setShowModal(false);
      setEditingProduct(null);
      setBolsaForm({ nombre: '', cantidad: '', pesoKg: 3, tiposHielo: [] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      console.error(err);
      alert(`❌ Error: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 🗑️ "Eliminar" -> marcar cantidad 0
  const eliminarProductoConRegistro = async (product: Product) => {
    if (!user) return;

    const confirmacion = window.confirm(
      `¿Estás seguro de eliminar "${product.nombre}"?\n\nEsta acción marcará el producto como sin stock (cantidad = 0).`
    );
    if (!confirmacion) return;

    setIsProcessing(true);
    try {
      await actualizarCantidad(product.codigo || '', 0);
      await reloadTodo();
      alert(`✅ "${product.nombre}" marcado como sin stock`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      console.error(err);
      alert(`❌ Error al eliminar: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const verDetalle = (product: Product) => {
    const bolsa = product as BolsaProduct;
    const tiposHielo = (bolsa as any).tiposHieloPermitidos?.join(', ') || 'No definidos';
    alert(
      `📋 DETALLE DE INSUMO (BOLSA VACÍA)\n\n` +
        `Nombre: ${bolsa.nombre}\n` +
        `Código: ${bolsa.codigo}\n` +
        `Cantidad: ${bolsa.cantidad || 0}\n` +
        `Peso: ${(bolsa as any).pesoKg || 3}kg\n` +
        `Estado: ${(bolsa as any).status || 'VACIA'}\n` +
        `Tipos de hielo permitidos: ${tiposHielo}\n` +
        `Última modificación: ${(bolsa as any).ultimaModificacion?.toLocaleString?.('es-MX') || 'N/A'}\n`
    );
  };

  // RENDER loading/error
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="relative">
            <div className="h-20 w-20 rounded-full border-4 border-gray-800 border-t-blue-500 animate-spin mx-auto"></div>
            <Loader2 className="h-16 w-16 animate-spin text-blue-500 mx-auto absolute top-2 left-2" />
          </div>
          <p className="mt-8 text-gray-400 font-medium text-lg">Cargando almacén...</p>
          <p className="text-sm text-gray-600 mt-2">Preparando insumos</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-10">
        <div className="bg-gradient-to-r from-red-900/30 to-red-800/20 border-l-4 border-red-500 p-6 rounded-r-xl backdrop-blur-sm">
          <div className="flex items-start">
            <AlertCircle className="h-7 w-7 text-red-400 mr-3 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-bold text-red-300 text-lg">Error al cargar el almacén</h3>
              <p className="text-red-200/90 mt-1">{String(error)}</p>
              <button
                type="button"
                onClick={reloadTodo}
                className="mt-4 px-5 py-2.5 bg-gradient-to-r from-red-700 to-red-800 text-red-100 rounded-lg font-medium hover:from-red-800 hover:to-red-900 flex items-center transition-all duration-300"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Reintentar conexión
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // UI
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-950 to-black p-4 md:p-6">
      {/* Toastify */}
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="dark"
      />

      <div className="max-w-7xl mx-auto">
        {/* HEADER */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => router.push('/admin/dashboard')}
              disabled={isProcessing}
              className="p-3 bg-gradient-to-br from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 rounded-xl text-gray-400 hover:text-white disabled:opacity-50 transition-all duration-300 hover:scale-105 mt-1"
              title="Volver al Dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="p-3 rounded-xl bg-gradient-to-r from-blue-900/60 via-cyan-900/60 to-sky-900/60 backdrop-blur-sm border border-blue-700/30 shadow-lg">
              <Warehouse className="h-10 w-10 text-blue-200" />
            </div>

            <div>
              <h1 className="text-3xl font-bold text-white bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                Almacén Global Ice
              </h1>
              <p className="text-gray-400 text-sm mt-2 flex items-center gap-2">
                <Info className="h-4 w-4" />
                <span className="font-medium text-gray-300">Solo insumos</span> Solo Bolsas Vacias
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <button
              type="button"
              onClick={() => abrirModalBolsa()}
              disabled={isProcessing}
              className="px-5 py-2.5 bg-gradient-to-r from-sky-700/80 to-blue-900/80 text-white rounded-xl font-medium hover:from-sky-500 hover:to-blue-800 disabled:opacity-50 flex items-center transition-all duration-300 hover:shadow-lg hover:shadow-blue-900/20"
            >
              <Box className="h-5 w-5 mr-2" />
              Nueva Bolsa Vacía
            </button>

            <button
              type="button"
              onClick={reloadTodo}
              disabled={isProcessing}
              className="p-3 bg-gradient-to-br from-gray-800 to-gray-900 text-gray-300 hover:text-white rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 flex items-center disabled:opacity-50 transition-all duration-300"
              title="Recargar datos"
            >
              <RefreshCw className={`${loading ? 'animate-spin' : ''} h-5 w-5`} />
            </button>
          </div>
        </div>

        {/* ALERTAS */}
        {alertasStockBajo.length > 0 && (
          <div className="mb-8 bg-gradient-to-r from-orange-900/40 to-amber-900/30 border border-orange-700/30 rounded-2xl p-6 backdrop-blur-sm shadow-xl">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-gradient-to-br from-orange-800/40 to-orange-700/30 rounded-xl">
                <AlertTriangle className="h-7 w-7 text-orange-300" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-white text-lg">¡Atención! Stock bajo</h3>
                    <p className="text-sm text-red-300 mt-1">
                      {alertasStockBajo.length} insumo(s) necesitan reabastecimiento inmediato
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-gradient-to-r from-red-800/60 to-amber-800/40 text-red-300 rounded-full text-sm font-medium">
                    Urgente
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {alertasStockBajo.slice(0, 4).map((product) => (
                    <div
                      key={product.codigo}
                      className="bg-gradient-to-br from-blue-900/30 to-blue-800/20 p-3 rounded-lg border border-blue-700/30"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Box className="h-3.5 w-3.5 text-blue-300" />
                          <span className="text-white text-sm truncate">{product.nombre}</span>
                        </div>
                        <span className="text-red-400 font-bold text-lg">{Number(product.cantidad ?? 0)}</span>
                      </div>
                      <div className="text-xs text-blue-200/80 mt-2 flex justify-between">
                        <span>Stock mínimo: {Number((product as any).stockMinimo ?? 10)}</span>
                        <span className="text-red-300">
                          ↓ {Number((product as any).stockMinimo ?? 10) - Number(product.cantidad ?? 0)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATS */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          <StatCard
            title="Bolsas Vacías"
            value={stats.totalBolsasVacias}
            subtitle="Disponibles"
            icon={Snowflake}
            color="from-blue-900/40 to-blue-800/30"
            onClick={() => setFilterType('BOLSA')}
          />
          <StatCard
            title="Stock Bajo"
            value={stats.alertasBajoStock}
            subtitle="Reabastecer"
            icon={AlertTriangle}
            color="from-red-900/40 to-red-800/30"
            badge={stats.alertasBajoStock > 0 ? '¡Urgente!' : 'OK'}
          />
        </div>

        {/* BUSCADOR */}
        <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-6 mb-8 border border-gray-700/50 shadow-xl">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <div className="relative group">
                <Search className="absolute left-4 top-3.5 h-5 w-5 text-gray-500 group-focus-within:text-blue-500 transition-colors" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar bolsas vacías por nombre, código..."
                  disabled={isProcessing}
                  className="w-full pl-12 pr-10 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-transparent backdrop-blur-sm transition-all duration-300"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-3.5 text-gray-500 hover:text-gray-400"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as 'TODOS' | 'BOLSA')}
                disabled={isProcessing}
                className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-transparent backdrop-blur-sm"
              >
                <option value="TODOS">🔍 Todos los insumos</option>
                <option value="BOLSA">🛍️ Solo bolsas vacías</option>
              </select>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className="px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-gray-400 hover:text-white hover:border-gray-600 transition-all duration-300 flex-1"
              >
                <Filter className="h-5 w-5" />
              </button>

              <div className="bg-gradient-to-r from-gray-900/50 to-gray-800/40 rounded-xl px-4 py-3.5 flex items-center justify-center backdrop-blur-sm">
                <div className="text-center">
                  <div className="text-lg font-bold text-white">{productosFiltrados.length}</div>
                  <div className="text-xs text-gray-400">encontrados</div>
                </div>
              </div>
            </div>
          </div>

          {showAdvancedFilters && (
            <div className="mt-4 p-5 bg-gray-900/30 rounded-xl border border-gray-700/30 animate-in fade-in duration-300">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm text-gray-400">Stock mínimo (informativo)</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white"
                    placeholder="Ej: 10"
                    disabled
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-gray-400">Estado</label>
                  <select className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white" disabled>
                    <option>Todos</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-gray-400">Ordenar por</label>
                  <select className="w-full px-3 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white" disabled>
                    <option>Stock (descendente)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* TABLA */}
        <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl overflow-hidden border border-gray-700/50 shadow-xl">
          <div className="px-6 py-5 border-b border-gray-700/50 bg-gradient-to-r from-gray-900/60 to-gray-800/40">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                  <div className="p-2.5 bg-gradient-to-br from-blue-900/40 to-blue-800/30 rounded-lg">
                    <Warehouse className="h-6 w-6 text-blue-200" />
                  </div>
                  Inventario de Insumos (BV)
                </h2>
                <p className="text-gray-400 text-sm mt-1">Solo bolsas vacías disponibles para producción</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="bg-gray-900/50 backdrop-blur-sm rounded-lg px-4 py-2">
                  <span className="text-sm text-gray-300">
                    Mostrando: <span className="font-bold text-white">{productosFiltrados.length}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-700/30">
              <thead className="bg-gray-900/50 backdrop-blur-sm">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Insumo</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Especificaciones</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Stock</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-400 w-48">Acciones</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-700/20">
                {productosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-16 text-center">
                      <div className="max-w-md mx-auto">
                        <div className="relative">
                          <Warehouse className="h-24 w-24 text-gray-700 mx-auto mb-4 opacity-50" />
                          <div className="absolute inset-0 bg-gradient-to-br from-gray-800/20 to-transparent rounded-full"></div>
                        </div>
                        <h3 className="text-xl font-bold text-gray-300 mb-2">No se encontraron bolsas vacías</h3>
                        <p className="text-gray-500 mb-6">
                          {searchTerm || filterType !== 'TODOS'
                            ? 'No hay insumos que coincidan con tu búsqueda'
                            : 'Empieza agregando bolsas vacías'}
                        </p>
                        <button
                          type="button"
                          onClick={() => abrirModalBolsa()}
                          className="px-5 py-2.5 bg-gradient-to-r from-blue-700/80 to-blue-800/80 text-white rounded-xl font-medium hover:from-blue-800 hover:to-blue-900 flex items-center transition-all duration-300 mx-auto"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Nueva Bolsa Vacía
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  productosFiltrados.map((product) => {
                    const cantidad = Number(product.cantidad ?? 0);
                    const stockMinimo = Number((product as any).stockMinimo ?? 10);
                    const isLowStock = cantidad <= stockMinimo && cantidad > 0;
                    const isOutOfStock = cantidad === 0;

                    const bolsaProduct = product as BolsaProduct;
                    const tiposHielo = ((bolsaProduct as any)?.tiposHieloPermitidos || []) as IceType[];

                    return (
                      <tr
                        key={product.codigo}
                        className={`hover:bg-gray-800/30 transition-all duration-200 ${isOutOfStock ? 'opacity-70' : ''}`}
                      >
                        <td className="px-6 py-5">
                          <div className="flex items-center">
                            <div className="p-3 rounded-xl mr-4 bg-gradient-to-br from-blue-900/40 to-blue-800/30">
                              <Box className="h-7 w-7 text-blue-200" />
                            </div>

                            <div>
                              <div className="font-semibold text-white flex items-center gap-2">
                                <span className="truncate max-w-xs">{product.nombre}</span>
                                {isLowStock && (
                                  <span className="px-2.5 py-1 bg-gradient-to-r from-red-900/40 to-red-800/30 text-red-300 text-xs rounded-full whitespace-nowrap">
                                    ¡Bajo stock!
                                  </span>
                                )}
                              </div>
                              <div className="text-xs mt-2 flex items-center gap-2">
                                <span className="text-gray-400">Código:</span>
                                <code className="text-gray-300 font-mono bg-gray-900/50 px-2 py-1 rounded-md">
                                  {product.codigo || 'N/A'}
                                </code>
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <div className="space-y-3">
                            <div className="flex items-center bg-gray-900/30 rounded-lg p-3">
                              <Scale className="h-5 w-5 text-gray-400 mr-3" />
                              <div>
                                <div className="text-gray-300">Peso</div>
                                <div className="font-bold text-white text-lg">{(bolsaProduct as any)?.pesoKg || 3}kg</div>
                              </div>
                            </div>

                            {tiposHielo.length > 0 && (
                              <div className="space-y-2">
                                <div className="text-xs text-gray-400 uppercase tracking-wider">Tipos permitidos</div>
                                <div className="flex flex-wrap gap-2">
                                  {tiposHielo.map((tipo, idx) => (
                                    <IceTypeChip key={`${tipo}-${idx}`} tipo={tipo} />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <div className="space-y-4">
                            <div
                              className={`text-3xl font-bold ${
                                isOutOfStock ? 'text-red-400' : isLowStock ? 'text-orange-400' : 'text-white'
                              }`}
                            >
                              {cantidad.toLocaleString()}
                              <span className="text-sm font-normal text-gray-400 ml-2">unidades</span>
                            </div>

                            {isLowStock && !isOutOfStock && (
                              <div className="flex items-center gap-2 bg-gradient-to-r from-red-900/20 to-red-800/10 rounded-lg p-2">
                                <TrendingDown className="h-4 w-4 text-red-400" />
                                <div className="text-xs text-red-300">Por debajo del mínimo ({stockMinimo})</div>
                              </div>
                            )}

                            {isOutOfStock && (
                              <div className="flex items-center gap-2 bg-gradient-to-r from-gray-900/20 to-gray-800/10 rounded-lg p-2">
                                <PackageX className="h-4 w-4 text-red-400" />
                                <div className="text-xs text-red-300">Sin stock</div>
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => verDetalle(product)}
                              disabled={isProcessing}
                              className="p-2.5 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-xl transition-all duration-300 disabled:opacity-50 hover:scale-110"
                              title="Ver detalle"
                            >
                              <Eye className="h-4.5 w-4.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => abrirModalBolsa(product)}
                              disabled={isProcessing}
                              className="p-2.5 text-blue-400 hover:text-blue-300 hover:bg-blue-900/40 rounded-xl transition-all duration-300 disabled:opacity-50 hover:scale-110"
                              title="Editar"
                            >
                              <Edit className="h-4.5 w-4.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => eliminarProductoConRegistro(product)}
                              disabled={isProcessing}
                              className="p-2.5 text-red-400 hover:text-red-300 hover:bg-red-900/40 rounded-xl transition-all duration-300 disabled:opacity-50 hover:scale-110"
                              title="Eliminar"
                            >
                              <Trash2 className="h-4.5 w-4.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* FOOTER */}
        <div className="mt-8 pt-6 border-t border-gray-800/50">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-800/50 rounded-lg">
                <ShieldCheck className="h-5 w-5 text-gray-400" />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => router.push('/admin/dashboard')}
                disabled={isProcessing}
                className="px-5 py-2.5 bg-gradient-to-r from-gray-800 to-gray-900 text-gray-300 rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 hover:text-white disabled:opacity-50 flex items-center transition-all duration-300"
              >
                <ArrowLeft className="h-5 w-5 mr-2" />
                Volver al Panel
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL BOLSA */}
      <ModalDialog
        isOpen={showModal}
        onClose={() => {
          if (isProcessing) return;
          setShowModal(false);
          setEditingProduct(null);
          setBolsaForm({ nombre: '', cantidad: '', pesoKg: 3, tiposHielo: [] });
        }}
        title={editingProduct ? '✏️ Editar Bolsa Vacía' : '🛍️ Nueva Bolsa Vacía'}
        size="lg"
      >
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl overflow-hidden border border-gray-700/50">
          <div className="p-6">
            <form onSubmit={guardarBolsa}>
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Nombre de la Bolsa <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={bolsaForm.nombre}
                    onChange={(e) => setBolsaForm((p) => ({ ...p, nombre: e.target.value }))}
                    required
                    disabled={isProcessing}
                    className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
                    placeholder="Ej: Bolsa Vacía 3kg Premium"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-3">
                      Cantidad de Bolsas <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Ingresa cantidad"
                        value={bolsaForm.cantidad}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!onlyDigitsOrEmpty(v)) return;
                          setBolsaForm((p) => ({ ...p, cantidad: v }));
                        }}
                        required
                        disabled={isProcessing}
                        className="placeholder:text-xs placeholder:font-medium w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white text-2xl font-bold text-center disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
                      />
                      <div className="absolute right-4 top-3.5 text-gray-400 text-sm">unid.</div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-3">
                      Capacidad (Peso) <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={bolsaForm.pesoKg}
                      onChange={(e) => setBolsaForm((p) => ({ ...p, pesoKg: parseInt(e.target.value) }))}
                      disabled={isProcessing}
                      className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
                      required
                    >
                      <option value="1">1 kg</option>
                      <option value="3">3 kg</option>
                      <option value="5">5 kg</option>
                      <option value="10">10 kg</option>
                      <option value="15">15 kg</option>
                      <option value="20">20 kg</option>
                    </select>
                  </div>
                </div>

                {/* Tipos de hielo */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-300">
                      Tipos de Hielo Permitidos (Opcional)
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowIceTypeSelector(true)}
                      disabled={isProcessing}
                      className="px-4 py-2 bg-gradient-to-r from-blue-900/40 to-blue-800/30 text-blue-400 hover:text-blue-300 hover:from-blue-800/40 hover:to-blue-700/30 rounded-lg text-sm flex items-center disabled:opacity-50 transition-all duration-300"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      Agregar tipo
                    </button>
                  </div>

                  {bolsaForm.tiposHielo.length > 0 ? (
                    <div className="p-5 bg-gray-900/40 rounded-xl border border-gray-700/50">
                      <div className="flex flex-wrap gap-2">
                        {bolsaForm.tiposHielo.map((tipo, idx) => (
                          <IceTypeChip key={`${tipo}-${idx}`} tipo={tipo} onRemove={() => removerTipoHielo(tipo)} />
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-4 flex items-center gap-2">
                        <Info className="h-3.5 w-3.5" />
                        La bolsa solo podrá ser llenada con estos tipos de hielo
                      </p>
                    </div>
                  ) : (
                    <div className="p-8 bg-gray-900/20 rounded-xl border-2 border-dashed border-gray-600/50 text-center backdrop-blur-sm">
                      <Snowflake className="h-12 w-12 text-gray-600 mx-auto mb-4 opacity-50" />
                      <p className="text-gray-400 text-sm">No se han agregado tipos de hielo</p>
                      <p className="text-gray-500 text-xs mt-2">(Opcional) Define qué tipos de hielo puede contener</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-gray-700/50">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingProduct(null);
                    setBolsaForm({ nombre: '', cantidad: '', pesoKg: 3, tiposHielo: [] });
                  }}
                  disabled={isProcessing}
                  className="px-6 py-3 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-xl font-medium disabled:opacity-50 transition-all duration-300"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isProcessing}
                  className="px-6 py-3 bg-gradient-to-r from-blue-700 to-blue-800 text-white rounded-xl font-medium hover:from-blue-800 hover:to-blue-900 disabled:opacity-50 flex items-center transition-all duration-300 shadow-lg hover:shadow-blue-900/30"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Procesando...
                    </>
                  ) : editingProduct ? (
                    '💾 Actualizar Bolsa'
                  ) : (
                    '✨ Crear Bolsa'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalDialog>

      {/* MODAL selector tipos hielo */}
      <ModalDialog
        isOpen={showIceTypeSelector}
        onClose={() => setShowIceTypeSelector(false)}
        title="🧊 Seleccionar Tipo de Hielo"
        size="md"
      >
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl overflow-hidden border border-gray-700/50">
          <div className="p-6">
            <p className="text-gray-300 text-sm mb-6 text-center">¿Qué tipo de hielo puede contener esta bolsa?</p>

            <div className="space-y-3">
              {(['ROLITO', 'FRAPPE', 'GOURMET', 'ENFRIAR', 'BARRA'] as IceType[]).map((tipo) => {
                const isSelected = bolsaForm.tiposHielo.includes(tipo);

                const desc = (() => {
                  switch (tipo) {
                    case 'BARRA':
                      return 'Barra de hielo';
                    case 'ROLITO':
                      return 'Hielo en Rolito';
                    case 'FRAPPE':
                      return 'Hielo en Frappe';
                    case 'GOURMET':
                      return 'Hielo premium';
                    case 'ENFRIAR':
                      return 'Rolito para enfriamiento';
                    default:
                      return '';
                  }
                })();

                const bgColor = isSelected
                  ? 'bg-gradient-to-r from-blue-900/50 to-blue-800/40 border-blue-500'
                  : 'bg-gray-900/50 border-gray-700 hover:bg-gray-800/60 hover:border-gray-600';

                return (
                  <button
                    key={tipo}
                    type="button"
                    onClick={() => (isSelected ? removerTipoHielo(tipo) : agregarTipoHielo(tipo))}
                    className={`w-full p-4 rounded-xl border-2 flex items-center justify-between transition-all duration-300 ${bgColor}`}
                  >
                    <div className="flex items-center">
                      <div className={`p-2.5 rounded-lg mr-4 ${isSelected ? 'bg-blue-800/60' : 'bg-gray-800/60'}`}>
                        {tipo === 'BARRA' ? (
                          <Box className="h-5 w-5 text-purple-300" />
                        ) : (
                          <Snowflake className="h-5 w-5 text-blue-300" />
                        )}
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-white">{tipo}</div>
                        <div className="text-xs text-gray-400 mt-1">{desc}</div>
                      </div>
                    </div>

                    {isSelected ? (
                      <div className="p-1.5 bg-gradient-to-r from-green-700 to-green-600 rounded-full">
                        <Check className="h-4 w-4 text-white" />
                      </div>
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-gray-500" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-8 pt-6 border-t border-gray-700/50">
              <button
                type="button"
                onClick={() => setShowIceTypeSelector(false)}
                className="w-full px-4 py-3 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-xl transition-all duration-300"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
