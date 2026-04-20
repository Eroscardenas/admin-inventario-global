// app/admin/asignacion/page.tsx
// ✅ FINAL (sin errores TS) — Historial con EDITAR / ELIMINAR + COSECHAS + BV-only + inputs PRO
// - ✅ Asigna SOLO Bolsas Vacías (BV)
// - ✅ Cosecha: Nueva / Existente (usa hook.cosechasAbiertas + getCosechasAbiertasPara)
// - ✅ Historial agrupado por cosecha (cosechaId/cosechaCodigo)
// - ✅ Botones Editar / Eliminar (Cancelar) desde historial
// - ✅ Usa useProducts.adminEditarAsignacion / adminCancelarAsignacion (docId real)
// - ✅ Inputs cantidad: vacío por defecto (placeholder)
// - ✅ FIX TS: NO mezcla ?? y || (sin TS5076)

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuthContext } from '@/context/AuthContext';
import { useProducts, type TurnoType, type Asignacion, type EmpleadoSimple } from '@/lib/hooks/useProducts';

import {
  ArrowLeft,
  RefreshCw,
  Search,
  Filter,
  Loader2,
  AlertTriangle,
  ClipboardList,
  PlusCircle,
  Trash2,
  CalendarDays,
  X,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Pencil,
  Save,
  Ban,
  Users,
  Package,
  History,
  BarChart3,
  Info,
  FileText,
  Timer,
  TrendingUp,
} from 'lucide-react';

type ModoCosecha = 'NUEVA' | 'EXISTENTE';

const ETIQUETA_TURNO: Record<TurnoType, string> = {
  MATUTINO: 'Matutino',
  VESPERTINO: 'Vespertino',
  NOCTURNO: 'Nocturno',
};

// 🎨 Componente StatCard para mantener consistencia
const StatCard = ({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  onClick,
}: {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
  onClick?: () => void;
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
        <p className="text-sm text-white/90 font-medium mb-3">{title}</p>
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

function fmtDate(d: Date) {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

function fmtDay(d: Date) {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

function todayInputValue(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateInput(value: string) {
  if (!value) return new Date();
  const [y, m, d] = value.split('-').map((x) => Number(x));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

function displayEmpleado(empleadoSeleccionado: EmpleadoSimple | undefined, empleadoCodigo: string) {
  const nombre = (empleadoSeleccionado?.nombre ?? '').trim();
  if (nombre) return nombre;

  const codigo = (empleadoCodigo ?? '').trim();
  if (codigo) return codigo;

  return '—';
}

// 🎨 Modal mejorado con diseño consistente
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800/50 shadow-2xl">
        <div className="px-6 py-4 border-b border-gray-800 bg-gradient-to-r from-gray-900 to-gray-800/80">
          <div className="flex justify-between items-center">
            <h3 className="text-white text-lg font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-400" />
              {title}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors duration-300 p-2 hover:bg-gray-800/50 rounded-lg"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="p-6 text-white">{children}</div>
      </div>
    </div>
  );
}

export default function AdminAsignacionPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuthContext();

  const {
    loading,
    error,
    reload,

    bolsasVacias,
    empleados,

    asignaciones,
    cosechasAbiertas,
    getCosechasAbiertasPara,

    asignarBolsasConStock,
    adminEditarAsignacion,
    adminCancelarAsignacion,
  } = useProducts();

  const actor = useMemo(() => {
    return (user as any)?.email || (user as any)?.displayName || (user as any)?.uid || 'admin';
  }, [user]);

  // -----------------------------
  // UI state - Asignar
  // -----------------------------
  const [searchBV, setSearchBV] = useState('');
  const [selectedBV, setSelectedBV] = useState<string>('');

  const [empleadoCodigo, setEmpleadoCodigo] = useState<string>('');
  const empleadoSeleccionado = useMemo(
    () => empleados.find((e) => e.codigo === empleadoCodigo),
    [empleados, empleadoCodigo]
  );

  const [turno, setTurno] = useState<TurnoType>('MATUTINO');
  const [fechaAsignacionStr, setFechaAsignacionStr] = useState<string>(todayInputValue(new Date()));
  const fechaAsignacion = useMemo(() => parseDateInput(fechaAsignacionStr), [fechaAsignacionStr]);

  const [modoCosecha, setModoCosecha] = useState<ModoCosecha>('NUEVA');
  const [cosechaId, setCosechaId] = useState<string>('');

  const cosechasDisponiblesPara = useMemo(() => {
    return getCosechasAbiertasPara({
      empleadoCodigo: empleadoCodigo || undefined,
      turno: turno || undefined,
      fecha: fechaAsignacion,
    });
  }, [getCosechasAbiertasPara, empleadoCodigo, turno, fechaAsignacion]);

  useEffect(() => {
    if (modoCosecha === 'EXISTENTE') {
      const exists = cosechasDisponiblesPara.some((c) => c.id === cosechaId);
      if (!exists) setCosechaId('');
    } else {
      setCosechaId('');
    }
  }, [modoCosecha, cosechasDisponiblesPara, cosechaId]);

  const [cantidadStr, setCantidadStr] = useState<string>('');
  const cantidadNum = useMemo(() => {
    const raw = cantidadStr.trim();
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }, [cantidadStr]);

  const [observaciones, setObservaciones] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // -----------------------------
  // UI state - Historial (filtros)
  // -----------------------------
  const [openHistorial, setOpenHistorial] = useState(true);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroTurno, setFiltroTurno] = useState<TurnoType | 'TODOS'>('TODOS');
  const [soloPendientes, setSoloPendientes] = useState(false);

  // -----------------------------
  // Edit / Cancel modals
  // -----------------------------
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const [target, setTarget] = useState<Asignacion | null>(null);

  const [editCantidadStr, setEditCantidadStr] = useState<string>('');
  const [editObs, setEditObs] = useState<string>('');
  const [editTurno, setEditTurno] = useState<TurnoType>('MATUTINO');
  const [editForce, setEditForce] = useState(false);

  const [cancelMotivo, setCancelMotivo] = useState<string>('');
  const [cancelForce, setCancelForce] = useState(false);

  const openEdit = useCallback((a: Asignacion) => {
    setTarget(a);
    setEditCantidadStr(String(a.cantidad ?? ''));
    setEditObs(String(a.observaciones ?? ''));
    setEditTurno((a.turno as TurnoType) ?? 'MATUTINO');
    setEditForce(false);
    setEditOpen(true);
  }, []);

  const openCancel = useCallback((a: Asignacion) => {
    setTarget(a);
    setCancelMotivo('');
    setCancelForce(false);
    setCancelOpen(true);
  }, []);

  const closeAllModals = useCallback(() => {
    setEditOpen(false);
    setCancelOpen(false);
    setTarget(null);
  }, []);

  // -----------------------------
  // Stats para la página
  // -----------------------------
  const stats = useMemo(() => {
    const pendientes = asignaciones.filter((a) => String(a.estado ?? 'PENDIENTE') === 'PENDIENTE').length;
    const completadas = asignaciones.filter((a) => String(a.estado ?? '') === 'COMPLETADA').length;
    const canceladas = asignaciones.filter((a) => String(a.estado ?? '') === 'CANCELADA').length;

    const totalBolsas = bolsasVacias.reduce((sum, bv: any) => sum + Number(bv.cantidad ?? 0), 0);

    return {
      totalAsignaciones: asignaciones.length,
      asignacionesPendientes: pendientes,
      asignacionesCompletadas: completadas,
      asignacionesCanceladas: canceladas,
      totalBolsasVacias: totalBolsas,
      totalEmpleados: empleados.length,
      cosechasAbiertas: cosechasAbiertas.length,
    };
  }, [asignaciones, bolsasVacias, empleados, cosechasAbiertas]);

  // -----------------------------
  // BV list filtered
  // -----------------------------
  const bolsasVaciasFiltradas = useMemo(() => {
    const q = searchBV.trim().toLowerCase();
    const list = bolsasVacias.slice();
    if (!q) return list;

    return list.filter((b: any) => {
      const codigo = String(b.codigo ?? '').toLowerCase();
      const nombre = String(b.nombre ?? '').toLowerCase();
      return codigo.includes(q) || nombre.includes(q);
    });
  }, [bolsasVacias, searchBV]);

  // -----------------------------
  // Historial filtrado
  // -----------------------------
  const asignacionesFiltradas = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();

    return asignaciones.filter((a) => {
      const estado = String(a.estado ?? 'PENDIENTE');

      if (soloPendientes && estado !== 'PENDIENTE') return false;
      if (filtroTurno !== 'TODOS' && String(a.turno ?? '') !== String(filtroTurno)) return false;

      if (!q) return true;

      return (
        String(a.productoCodigo ?? '').toLowerCase().includes(q) ||
        String(a.productoNombre ?? '').toLowerCase().includes(q) ||
        String(a.empleadoNombre ?? '').toLowerCase().includes(q) ||
        String(a.empleadoCodigo ?? '').toLowerCase().includes(q) ||
        String(a.cosechaCodigo ?? '').toLowerCase().includes(q) ||
        String(a.codigo ?? '').toLowerCase().includes(q)
      );
    });
  }, [asignaciones, filtroTexto, filtroTurno, soloPendientes]);

  // -----------------------------
  // Historial agrupado por cosecha
  // -----------------------------
  const gruposHistorial = useMemo(() => {
    const map = new Map<
      string,
      { key: string; title: string; sub: string; items: Asignacion[]; sortTs: number }
    >();

    for (const a of asignacionesFiltradas) {
      const key = String(a.cosechaId ?? `SIN_COSECHA__${fmtDay(a.fechaAsignacion)}`);

      const title = a.cosechaCodigo
        ? `${a.cosechaCodigo}`
        : a.cosechaId
        ? `${a.cosechaId}`
        : `Sin cosecha (${fmtDay(a.fechaAsignacion)})`;

      const sub = `${fmtDay(a.fechaAsignacion)} • ${a.empleadoNombre || a.empleadoCodigo || '—'} • ${
        a.turno ? ETIQUETA_TURNO[a.turno as TurnoType] : '—'
      }`;

      const ts = (a.createdAt?.getTime?.() ?? 0) || a.fechaAsignacion.getTime();

      const prev = map.get(key);
      if (!prev) {
        map.set(key, { key, title, sub, items: [a], sortTs: ts });
      } else {
        prev.items.push(a);
        prev.sortTs = Math.max(prev.sortTs, ts);
      }
    }

    const out = Array.from(map.values());
    out.sort((x, y) => y.sortTs - x.sortTs);

    out.forEach((g) => {
      g.items.sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0));
    });

    return out;
  }, [asignacionesFiltradas]);

  // -----------------------------
  // Actions
  // -----------------------------
  const doReload = useCallback(async () => {
    setToast(null);
    await reload();
  }, [reload]);

  const onAsignar = useCallback(async () => {
    setToast(null);

    try {
      if (!selectedBV) throw new Error('Selecciona una Bolsa Vacía (BV)');
      if (!empleadoCodigo) throw new Error('Selecciona un empleado');
      if (!turno) throw new Error('Selecciona un turno');

      if (!cantidadStr.trim()) throw new Error('Ingresa una cantidad');
      if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) throw new Error('La cantidad debe ser > 0');

      if (modoCosecha === 'EXISTENTE' && !cosechaId) {
        throw new Error('Selecciona una cosecha existente');
      }

      setSubmitting(true);

      await asignarBolsasConStock(
        selectedBV,
        cantidadNum,
        String(actor),
        String(empleadoSeleccionado?.nombre ?? ''),
        String(empleadoCodigo),
        turno,
        observaciones?.trim() ? observaciones.trim() : undefined,
        undefined,
        modoCosecha === 'EXISTENTE' ? { modo: 'EXISTENTE', cosechaId } : { modo: 'NUEVA' },
        fechaAsignacion
      );

      setCantidadStr('');
      setObservaciones('');
      setToast({ type: 'ok', msg: '✅ Asignación creada / actualizada correctamente.' });
    } catch (e: any) {
      setToast({ type: 'err', msg: `❌ ${e?.message ?? 'Error asignando'}` });
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedBV,
    empleadoCodigo,
    turno,
    cantidadStr,
    cantidadNum,
    modoCosecha,
    cosechaId,
    actor,
    empleadoSeleccionado?.nombre,
    observaciones,
    asignarBolsasConStock,
    fechaAsignacion,
  ]);

  const onGuardarEdicion = useCallback(async () => {
    setToast(null);
    try {
      if (!target?.id) throw new Error('Asignación inválida (sin id)');

      const n = Number(String(editCantidadStr).trim());
      if (!Number.isFinite(n) || n <= 0) throw new Error('La nueva cantidad debe ser > 0');

      setSubmitting(true);

      await adminEditarAsignacion({
        asignacionId: target.id,
        actor: String(actor),
        nuevaCantidad: n,
        nuevasObservaciones: editObs?.trim() ? editObs.trim() : undefined,
        nuevoTurno: editTurno,
        force: editForce,
      });

      closeAllModals();
      setToast({ type: 'ok', msg: '✅ Asignación editada correctamente.' });
    } catch (e: any) {
      setToast({ type: 'err', msg: `❌ ${e?.message ?? 'Error editando asignación'}` });
    } finally {
      setSubmitting(false);
    }
  }, [target?.id, actor, editCantidadStr, editObs, editTurno, editForce, adminEditarAsignacion, closeAllModals]);

  const onCancelar = useCallback(async () => {
    setToast(null);
    try {
      if (!target?.id) throw new Error('Asignación inválida (sin id)');

      setSubmitting(true);

      await adminCancelarAsignacion({
        asignacionId: target.id,
        actor: String(actor),
        motivo: cancelMotivo?.trim() ? cancelMotivo.trim() : undefined,
        force: cancelForce,
      });

      closeAllModals();
      setToast({ type: 'ok', msg: '✅ Asignación cancelada correctamente.' });
    } catch (e: any) {
      setToast({ type: 'err', msg: `❌ ${e?.message ?? 'Error cancelando asignación'}` });
    } finally {
      setSubmitting(false);
    }
  }, [target?.id, actor, cancelMotivo, cancelForce, adminCancelarAsignacion, closeAllModals]);

  // -----------------------------
  // UI helpers
  // -----------------------------
  const renderToast = () => {
    if (!toast) return null;

    const isOk = toast.type === 'ok';
    return (
      <div
        className={`mb-6 rounded-2xl border p-5 backdrop-blur-sm shadow-lg ${
          isOk
            ? 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/30 border-emerald-700/30'
            : 'bg-gradient-to-r from-rose-900/40 to-rose-800/30 border-rose-700/30'
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={`p-3 rounded-xl ${
              isOk
                ? 'bg-gradient-to-br from-emerald-800/40 to-emerald-700/30'
                : 'bg-gradient-to-br from-rose-800/40 to-rose-700/30'
            }`}
          >
            {isOk ? <CheckCircle2 className="h-7 w-7 text-emerald-300" /> : <AlertTriangle className="h-7 w-7 text-rose-300" />}
          </div>

          <div className="flex-1">
            <h3 className="font-bold text-lg text-white">{isOk ? 'Operación exitosa' : 'Error'}</h3>
            <p className={`mt-1 ${isOk ? 'text-emerald-300' : 'text-rose-300'}`}>{toast.msg}</p>
          </div>

          <button
            className="text-gray-400 hover:text-white transition-colors"
            onClick={() => setToast(null)}
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  };

  // -----------------------------
  // Guard: auth
  // -----------------------------
  useEffect(() => {
    if (!authLoading && !user) router.push('/admin-login');
  }, [authLoading, user, router]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-950 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="h-20 w-20 rounded-full border-4 border-gray-800 border-t-blue-500 animate-spin mx-auto"></div>
            <Loader2 className="h-16 w-16 animate-spin text-blue-500 mx-auto absolute top-2 left-2" />
          </div>
          <p className="mt-8 text-gray-400 font-medium text-lg">Cargando sesión...</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-950 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="h-20 w-20 rounded-full border-4 border-gray-800 border-t-orange-500 animate-spin mx-auto"></div>
            <Loader2 className="h-16 w-16 animate-spin text-orange-500 mx-auto absolute top-2 left-2" />
          </div>
          <p className="mt-8 text-gray-400 font-medium text-lg">Cargando asignaciones...</p>
          <p className="text-sm text-gray-600 mt-2">Preparando el panel de asignaciones</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-950 to-black p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
        <div className="flex items-start gap-4">
          <button
            onClick={() => router.push('/admin/dashboard')}
            className="p-3 bg-gradient-to-br from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 rounded-xl text-gray-400 hover:text-white transition-all duration-300 hover:scale-105 mt-1"
            title="Volver al Dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="p-3 rounded-xl bg-gradient-to-r from-purple-900/60 via-blue-800/60 to-cyan-900/60 backdrop-blur-sm border border-purple-700/30 shadow-lg">
            <ClipboardList className="h-10 w-10 text-purple-300" />
          </div>

          <div>
            <h1 className="text-3xl font-bold text-white bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              Asignaciones de Producción
            </h1>
            <p className="text-gray-400 text-sm mt-2 flex items-center gap-2">
              <Info className="h-4 w-4" />
              Gestión de bolsas vacías por cosecha y empleado
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <button
            onClick={doReload}
            disabled={loading}
            className="px-5 py-2.5 bg-gradient-to-r from-gray-800 to-gray-900 text-gray-300 rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 hover:text-white flex items-center transition-all duration-300"
            title="Recargar datos"
          >
            <RefreshCw className={`h-5 w-5 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Recargar
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-8 bg-gradient-to-r from-rose-900/40 to-rose-800/30 border border-rose-700/30 rounded-2xl p-5 backdrop-blur-sm shadow-lg">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-gradient-to-br from-rose-800/40 to-rose-700/30 rounded-xl">
              <AlertTriangle className="h-7 w-7 text-rose-300" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-white text-lg">Error al cargar datos</h3>
              <p className="text-rose-300 mt-1">{String(error)}</p>
            </div>
          </div>
        </div>
      )}

      {renderToast()}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 mb-8">
        <StatCard title="Total Asignaciones" value={stats.totalAsignaciones} icon={ClipboardList} color="from-blue-900/40 to-blue-800/30" />
        <StatCard title="Pendientes" value={stats.asignacionesPendientes} icon={Timer} color="from-amber-900/40 to-amber-800/30" />
        <StatCard title="Completadas" value={stats.asignacionesCompletadas} icon={CheckCircle2} color="from-emerald-900/40 to-emerald-800/30" />
        <StatCard title="Canceladas" value={stats.asignacionesCanceladas} icon={Ban} color="from-rose-900/40 to-rose-800/30" />
        <StatCard title="Bolsas Vacías" value={stats.totalBolsasVacias} icon={Package} color="from-cyan-900/40 to-cyan-800/30" />
        <StatCard title="Empleados" value={stats.totalEmpleados} icon={Users} color="from-purple-900/40 to-purple-800/30" />
        <StatCard title="Cosechas Abiertas" value={stats.cosechasAbiertas} icon={TrendingUp} color="from-orange-900/40 to-orange-800/30" />
      </div>

      {/* Panel de Asignación */}
      <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl p-6 mb-8 border border-gray-700/50 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-emerald-900/40 to-emerald-800/30 rounded-lg">
                <PlusCircle className="h-6 w-6 text-emerald-300" />
              </div>
              Nueva Asignación
            </h2>
            <p className="text-gray-400 text-sm mt-2">Agrupa por cosecha (suma cantidades)</p>
          </div>
        </div>

        {/* Fila 1: Empleado + Turno + Fecha + Cosecha */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Empleado</label>
            <div className="relative">
              <Users className="h-4 w-4 text-gray-500 absolute left-3 top-3.5" />
              <select
                className="w-full pl-10 pr-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
                value={empleadoCodigo}
                onChange={(e) => setEmpleadoCodigo(e.target.value)}
              >
                <option value="">Selecciona empleado...</option>
                {empleados.map((e) => (
                  <option key={e.codigo} value={e.codigo}>
                    {e.codigo} — {e.nombre}
                  </option>
                ))}
              </select>
            </div>
            {empleadoSeleccionado?.isActive === false && (
              <div className="mt-2 flex items-center gap-1 text-xs text-amber-400">
                <ShieldAlert className="h-3 w-3" />
                Empleado inactivo
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Turno</label>
            <select
              className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
              value={turno}
              onChange={(e) => setTurno(e.target.value as TurnoType)}
            >
              <option value="MATUTINO">Matutino</option>
              <option value="VESPERTINO">Vespertino</option>
              <option value="NOCTURNO">Nocturno</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Fecha para el lote</label>
            <div className="relative">
              <CalendarDays className="h-4 w-4 text-gray-500 absolute left-3 top-3.5" />
              <input
                type="date"
                className="w-full pl-10 pr-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
                value={fechaAsignacionStr}
                onChange={(e) => setFechaAsignacionStr(e.target.value)}
              />
            </div>
            <div className="mt-2 text-xs text-gray-400">{fmtDay(fechaAsignacion)}</div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Modo de Cosecha</label>
            <select
              className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
              value={modoCosecha}
              onChange={(e) => setModoCosecha(e.target.value as ModoCosecha)}
            >
              <option value="NUEVA">Nueva Cosecha</option>
              <option value="EXISTENTE">Cosecha Existente</option>
            </select>
          </div>

          <div className={cn(modoCosecha !== 'EXISTENTE' && 'opacity-50 pointer-events-none')}>
            <label className="block text-sm font-medium text-gray-300 mb-2">Cosecha Existente</label>
            <select
              className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
              value={cosechaId}
              onChange={(e) => setCosechaId(e.target.value)}
            >
              <option value="">Selecciona cosecha...</option>
              {cosechasDisponiblesPara.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} — {c.empleadoNombre} — {ETIQUETA_TURNO[c.turno]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Fila 2: Selector BV + Datos */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Selector de Bolsas Vacías */}
          <div className="bg-gradient-to-br from-gray-900/40 to-gray-800/30 rounded-2xl p-5 border border-gray-700/30">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2">
                  <Package className="h-5 w-5 text-cyan-400" />
                  Bolsas Vacías Disponibles
                </h3>
                <p className="text-sm text-gray-400">Selecciona una BV para asignar</p>
              </div>
              <div className="relative">
                <Search className="h-4 w-4 text-gray-500 absolute left-3 top-3" />
                <input
                  value={searchBV}
                  onChange={(e) => setSearchBV(e.target.value)}
                  placeholder="Buscar BV..."
                  className="pl-10 pr-4 py-2 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white text-sm w-64 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 backdrop-blur-sm"
                />
              </div>
            </div>

            <div className="max-h-80 overflow-auto rounded-xl border border-gray-700/50 bg-gray-900/30">
              {bolsasVaciasFiltradas.length === 0 ? (
                <div className="p-6 text-center">
                  <Package className="h-12 w-12 text-gray-600 mx-auto mb-3 opacity-50" />
                  <p className="text-gray-400">No hay bolsas vacías que coincidan</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-700/30">
                  {bolsasVaciasFiltradas.map((bv: any) => {
                    const isSel = selectedBV === String(bv.codigo);
                    return (
                      <button
                        key={String(bv.codigo)}
                        onClick={() => setSelectedBV(String(bv.codigo))}
                        className={cn(
                          'w-full text-left p-4 hover:bg-gray-800/50 transition-all duration-300 flex items-start justify-between gap-3',
                          isSel && 'bg-gradient-to-r from-cyan-900/20 to-cyan-800/10 border-l-4 border-cyan-500'
                        )}
                      >
                        <div>
                          <div className="text-sm font-semibold text-white">
                            {String(bv.codigo)} — {String(bv.nombre ?? '')}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            Stock disponible:{' '}
                            <span className="font-bold text-cyan-300">{Number(bv.cantidad ?? 0)}</span>
                            {bv.pesoKg != null && (
                              <>
                                {' • '}Peso:{' '}
                                <span className="font-bold text-gray-300">{Number(bv.pesoKg)}kg</span>
                              </>
                            )}
                          </div>
                        </div>
                        {isSel && <CheckCircle2 className="h-5 w-5 text-cyan-400 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Datos de Asignación */}
          <div className="bg-gradient-to-br from-gray-900/40 to-gray-800/30 rounded-2xl p-5 border border-gray-700/30">
            <h3 className="font-bold text-white flex items-center gap-2 mb-4">
              <FileText className="h-5 w-5 text-emerald-400" />
              Detalles de la Asignación
            </h3>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Cantidad</label>
                  <input
                    inputMode="numeric"
                    value={cantidadStr}
                    onChange={(e) => setCantidadStr(e.target.value)}
                    placeholder="Ingresa cantidad"
                    className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white text-lg font-bold text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent backdrop-blur-sm"
                  />
                  <div className="mt-2 text-xs text-gray-500">Campo vacío por defecto ✅</div>
                </div>

                <div className="bg-gradient-to-br from-gray-900/50 to-gray-800/40 rounded-xl p-4">
                  <div className="text-xs text-gray-400 mb-2">Resumen</div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-400">BV:</span>
                      <span className="font-semibold text-white">{selectedBV || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Empleado:</span>
                      <span className="font-semibold text-white">
                        {displayEmpleado(empleadoSeleccionado, empleadoCodigo)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Turno:</span>
                      <span className="font-semibold text-amber-300">{ETIQUETA_TURNO[turno]}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Fecha:</span>
                      <span className="font-semibold text-cyan-300">{fmtDay(fechaAsignacion)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Cosecha:</span>
                      <span className="font-semibold text-emerald-300">
                        {modoCosecha === 'NUEVA' ? 'Nueva' : cosechaId ? 'Existente' : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Observaciones (opcional)</label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Notas para el lote o la asignación..."
                  className="w-full px-4 py-3.5 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent backdrop-blur-sm min-h-[100px]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-700/50">
                <button
                  onClick={() => {
                    setSelectedBV('');
                    setCantidadStr('');
                    setObservaciones('');
                    setToast(null);
                  }}
                  className="px-5 py-2.5 bg-gradient-to-r from-gray-800 to-gray-900 text-gray-300 rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 hover:text-white transition-all duration-300"
                  disabled={submitting}
                >
                  Limpiar
                </button>

                <button
                  onClick={onAsignar}
                  className={cn(
                    'px-5 py-2.5 bg-gradient-to-r from-emerald-700 to-emerald-800 text-white rounded-xl font-medium hover:from-emerald-800 hover:to-emerald-900 flex items-center transition-all duration-300 hover:shadow-lg hover:shadow-emerald-900/20',
                    submitting && 'opacity-50 cursor-not-allowed'
                  )}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <PlusCircle className="h-5 w-5 mr-2" />
                      Asignar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Historial */}
      <div className="bg-gradient-to-br from-gray-800/30 to-gray-900/20 backdrop-blur-sm rounded-2xl border border-gray-700/50 shadow-xl">
        <div className="px-6 py-5 border-b border-gray-700/50 bg-gradient-to-r from-gray-900/60 to-gray-800/40">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setOpenHistorial((v) => !v)}
                className="p-3 bg-gradient-to-br from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 rounded-xl text-gray-400 hover:text-white transition-all duration-300"
                title={openHistorial ? 'Ocultar' : 'Mostrar'}
              >
                {openHistorial ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </button>
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                  <div className="p-2.5 bg-gradient-to-br from-purple-900/40 to-purple-800/30 rounded-lg">
                    <History className="h-6 w-6 text-purple-300" />
                  </div>
                  Historial de Asignaciones
                </h2>
                <p className="text-gray-400 text-sm mt-1">
                  {asignaciones.length} asignaciones • {cosechasAbiertas.length} cosechas abiertas
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative">
                <Search className="h-4 w-4 text-gray-500 absolute left-3 top-3.5" />
                <input
                  value={filtroTexto}
                  onChange={(e) => setFiltroTexto(e.target.value)}
                  placeholder="Buscar (BV, empleado, cosecha)..."
                  className="pl-10 pr-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-purple-500/50 backdrop-blur-sm"
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-500" />
                  <select
                    className="px-3 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 backdrop-blur-sm"
                    value={filtroTurno}
                    onChange={(e) => setFiltroTurno(e.target.value as any)}
                  >
                    <option value="TODOS">Todos los turnos</option>
                    <option value="MATUTINO">Matutino</option>
                    <option value="VESPERTINO">Vespertino</option>
                    <option value="NOCTURNO">Nocturno</option>
                  </select>
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={soloPendientes}
                    onChange={(e) => setSoloPendientes(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500/50"
                  />
                  Solo pendientes
                </label>
              </div>
            </div>
          </div>
        </div>

        {openHistorial && (
          <div className="p-6">
            {gruposHistorial.length === 0 ? (
              <div className="py-10 text-center">
                <div className="max-w-md mx-auto">
                  <History className="h-24 w-24 text-gray-700 mx-auto mb-4 opacity-50" />
                  <h3 className="text-xl font-bold text-gray-300 mb-2">No hay asignaciones</h3>
                  <p className="text-gray-500">
                    {filtroTexto || filtroTurno !== 'TODOS' || soloPendientes
                      ? 'No hay asignaciones que coincidan con los filtros'
                      : 'Crea tu primera asignación usando el formulario superior'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {gruposHistorial.map((g) => (
                  <div
                    key={g.key}
                    className="bg-gradient-to-br from-gray-900/40 to-gray-800/30 rounded-2xl border border-gray-700/30 overflow-hidden"
                  >
                    <div className="px-6 py-4 bg-gradient-to-r from-gray-900/60 to-gray-800/40 border-b border-gray-700/30">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-lg font-bold text-white">{g.title}</div>
                          <div className="text-sm text-gray-400 mt-1">{g.sub}</div>
                        </div>
                        <div className="px-3 py-1 bg-gray-900/50 rounded-full text-xs text-gray-300">
                          {g.items.length} asignaciones
                        </div>
                      </div>
                    </div>

                    <div className="divide-y divide-gray-700/20">
                      {g.items.map((a) => {
                        const estado = String(a.estado ?? 'PENDIENTE');
                        const isCancel = estado === 'CANCELADA';
                        const isDone = estado === 'COMPLETADA';

                        return (
                          <div
                            key={a.id}
                            className="px-6 py-4 hover:bg-gray-800/20 transition-colors duration-200"
                          >
                            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-start gap-3 mb-2">
                                  <div
                                    className={`p-2 rounded-lg ${
                                      isCancel
                                        ? 'bg-gradient-to-br from-rose-900/40 to-rose-800/30'
                                        : isDone
                                        ? 'bg-gradient-to-br from-emerald-900/40 to-emerald-800/30'
                                        : 'bg-gradient-to-br from-amber-900/40 to-amber-800/30'
                                    }`}
                                  >
                                    {isCancel ? (
                                      <Ban className="h-5 w-5 text-rose-400" />
                                    ) : isDone ? (
                                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                                    ) : (
                                      <Timer className="h-5 w-5 text-amber-400" />
                                    )}
                                  </div>

                                  <div>
                                    <div className="font-bold text-white text-lg">
                                      {a.productoCodigo} — {a.productoNombre}
                                    </div>

                                    <div className="text-sm text-gray-400 mt-1">
                                      Cantidad: <span className="font-bold text-white">{a.cantidad}</span>
                                      {a.pesoKg != null && (
                                        <>
                                          {' • '}Peso:{' '}
                                          <span className="font-bold text-cyan-300">{a.pesoKg}kg</span>
                                        </>
                                      )}
                                      {' • '}Turno:{' '}
                                      <span className="font-bold text-amber-300">
                                        {a.turno ? ETIQUETA_TURNO[a.turno as TurnoType] : '—'}
                                      </span>
                                    </div>

                                    <div className="text-xs text-gray-500 mt-2">
                                      Creado: {fmtDate(a.createdAt)} • Asignación: {fmtDate(a.fechaAsignacion)}
                                    </div>

                                    {a.observaciones && (
                                      <div className="mt-3 p-3 bg-gray-900/30 rounded-lg border border-gray-700/50">
                                        <div className="text-xs text-gray-400 mb-1">Observaciones</div>
                                        <div className="text-sm text-gray-300">{a.observaciones}</div>
                                      </div>
                                    )}

                                    <div className="mt-3">
                                      <span
                                        className={cn(
                                          'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium',
                                          isCancel
                                            ? 'bg-gradient-to-r from-rose-900/30 to-rose-800/20 text-rose-300 border border-rose-700/30'
                                            : isDone
                                            ? 'bg-gradient-to-r from-emerald-900/30 to-emerald-800/20 text-emerald-300 border border-emerald-700/30'
                                            : 'bg-gradient-to-r from-amber-900/30 to-amber-800/20 text-amber-300 border border-amber-700/30'
                                        )}
                                      >
                                        {estado}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={() => openEdit(a)}
                                  disabled={submitting}
                                  className="p-2.5 text-blue-400 hover:text-blue-300 hover:bg-blue-900/40 rounded-xl transition-all duration-300 hover:scale-110"
                                  title="Editar asignación"
                                >
                                  <Pencil className="h-5 w-5" />
                                </button>

                                <button
                                  onClick={() => openCancel(a)}
                                  disabled={submitting}
                                  className="p-2.5 text-rose-400 hover:text-rose-300 hover:bg-rose-900/40 rounded-xl transition-all duration-300 hover:scale-110"
                                  title="Cancelar asignación"
                                >
                                  <Trash2 className="h-5 w-5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modales */}
      {/* Modal Editar */}
      <Modal open={editOpen} title="Editar Asignación" onClose={closeAllModals}>
        {target && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-blue-900/20 to-blue-800/10 rounded-xl p-4 border border-blue-700/30">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-blue-800/40 to-blue-700/30 rounded-lg">
                  <Pencil className="h-5 w-5 text-blue-300" />
                </div>
                <div>
                  <div className="font-bold text-white">
                    {target.productoCodigo} — {target.productoNombre}
                  </div>
                  <div className="text-sm text-blue-300">
                    ID: <span className="font-mono">{target.id}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Nueva cantidad</label>
                <input
                  inputMode="numeric"
                  value={editCantidadStr}
                  onChange={(e) => setEditCantidadStr(e.target.value)}
                  placeholder="Ingresa cantidad"
                  className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Turno</label>
                <select
                  className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm"
                  value={editTurno}
                  onChange={(e) => setEditTurno(e.target.value as TurnoType)}
                >
                  <option value="MATUTINO">Matutino</option>
                  <option value="VESPERTINO">Vespertino</option>
                  <option value="NOCTURNO">Nocturno</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Observaciones</label>
              <textarea
                value={editObs}
                onChange={(e) => setEditObs(e.target.value)}
                placeholder="Notas..."
                className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent backdrop-blur-sm min-h-[100px]"
              />
            </div>

            <div className="bg-gradient-to-r from-amber-900/20 to-amber-800/10 rounded-xl p-4 border border-amber-700/30">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-400 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm text-amber-300">
                    Si la cosecha ya no está ABIERTA, marca <span className="font-bold">Force</span> para override admin.
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForce}
                    onChange={(e) => setEditForce(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-800 text-amber-500 focus:ring-amber-500/50"
                  />
                  <span className="text-amber-300">Force</span>
                </label>
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-800/50">
              <button
                onClick={closeAllModals}
                className="flex-1 px-4 py-3 text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-xl font-medium transition-all duration-300"
                disabled={submitting}
              >
                Cancelar
              </button>
              <button
                onClick={onGuardarEdicion}
                disabled={submitting}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-700 to-blue-800 text-white rounded-xl font-medium hover:from-blue-800 hover:to-blue-900 flex items-center justify-center transition-all duration-300 shadow-lg hover:shadow-blue-900/30"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save className="h-5 w-5 mr-2" />
                    Guardar Cambios
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Cancelar */}
      <Modal open={cancelOpen} title="Cancelar Asignación" onClose={closeAllModals}>
        {target && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-rose-900/20 to-rose-800/10 rounded-xl p-4 border border-rose-700/30">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-rose-800/40 to-rose-700/30 rounded-lg">
                  <Trash2 className="h-5 w-5 text-rose-300" />
                </div>
                <div>
                  <div className="font-bold text-white">
                    {target.productoCodigo} — {target.productoNombre}
                  </div>
                  <div className="text-sm text-rose-300">
                    ID: <span className="font-mono">{target.id}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-rose-900/20 to-rose-800/10 rounded-xl p-4 border border-rose-700/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-rose-400 mt-0.5" />
                <div className="text-sm text-rose-300">
                  Esto NO borra el documento: lo marca como <span className="font-bold">CANCELADA</span> para auditoría.
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Motivo (opcional)</label>
              <textarea
                value={cancelMotivo}
                onChange={(e) => setCancelMotivo(e.target.value)}
                placeholder="Ej: Error de captura, cambio de lote, etc..."
                className="w-full px-4 py-3 bg-gray-900/70 border border-gray-700/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-transparent backdrop-blur-sm min-h-[100px]"
              />
            </div>

            <div className="bg-gradient-to-r from-amber-900/20 to-amber-800/10 rounded-xl p-4 border border-amber-700/30">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-400 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm text-amber-300">
                    Si la cosecha ya no está ABIERTA, marca <span className="font-bold">Force</span> para override admin.
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cancelForce}
                    onChange={(e) => setCancelForce(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-800 text-amber-500 focus:ring-amber-500/50"
                  />
                  <span className="text-amber-300">Force</span>
                </label>
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-800/50">
              <button
                onClick={closeAllModals}
                className="flex-1 px-4 py-3 text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-xl font-medium transition-all duration-300"
                disabled={submitting}
              >
                Regresar
              </button>
              <button
                onClick={onCancelar}
                disabled={submitting}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-rose-700 to-rose-800 text-white rounded-xl font-medium hover:from-rose-800 hover:to-rose-900 flex items-center justify-center transition-all duration-300 shadow-lg hover:shadow-rose-900/30"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Cancelando...
                  </>
                ) : (
                  <>
                    <Ban className="h-5 w-5 mr-2" />
                    Confirmar Cancelación
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
