'use client';

import { useEffect, useMemo, useState, useCallback, JSX } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/context/AuthContext';
import { useInventoryContext } from '@/context/InventoryContext';
import Link from 'next/link';

// ✅ NUEVO: Faltantes (Admin)
import { useFaltantesAdmin } from '@/lib/hooks/useFaltantesAdmin';
import { FaltantesService } from '@/lib/services/faltante.service';

import {
  FaUsers,
  FaWarehouse,
  FaChartLine,
  FaExclamationTriangle,
  FaIndustry,
  FaBoxOpen,
  FaBars,
  FaTimes,
  FaUserCircle,
  FaSync,
  FaBell,
  FaSnowflake,
  FaBox,
  FaTruckLoading,
  FaTruck,
} from 'react-icons/fa';
import { FiPackage, FiLogOut, FiAlertCircle } from 'react-icons/fi';

import { obtenerInfoTurnoActual } from '@/app/utils/turnoUtils';

type ModuleItem = {
  title: string;
  description: string;
  icon: JSX.Element;
  path: string;
  color: string;
  hover: string;
};

// ✅ Tipado mínimo defensivo para alertas (por si cambia algo en tu contexto)
type AlertaEstado = 'NORMAL' | 'BAJO' | 'CRITICO' | 'EXCESO' | string;

type AlertaUI = {
  codigo?: string;
  productoCodigo?: string;
  productoNombre: string;
  tipoProducto?: string;
  tipoHielo?: string;
  stockActual: number;
  stockMinimo: number;
  stockMaximo?: number;
  estado: AlertaEstado;
  prioridad?: number;
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const { adminSession, logout } = useAuthContext();
  const { stats, alertas, refreshAll } = useInventoryContext();

  const [turnoInfo, setTurnoInfo] = useState(() => obtenerInfoTurnoActual());
  const [refreshing, setRefreshing] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // ✅ Modal alertas
  const [showAlertas, setShowAlertas] = useState(false);
  const [alertTab, setAlertTab] = useState<'CRITICO' | 'BAJO' | 'EXCESO' | 'TODAS'>('CRITICO');

  // ✅ Faltantes (PENDIENTE + ACEPTADA) con "gate" por meta:
  const {
    pending: faltantesPendientes,
    accepted: faltantesEnProceso,
    counts: faltantesCounts,
    loading: faltantesLoading,
    error: faltantesError,
    meta,
  } = useFaltantesAdmin({ gateByMeta: true, estados: ['PENDIENTE', 'ACEPTADA'], max: 200 });

  const showFaltantes = Boolean(meta?.ready && meta?.hasOpen);
  const [faltantesBusyId, setFaltantesBusyId] = useState<string | null>(null);

  const aceptarFaltante = async (faltanteId: string) => {
    if (!adminSession?.email) return;
    try {
      setFaltantesBusyId(faltanteId);
      await FaltantesService.setEstado({
        faltanteId,
        estado: 'ACEPTADA',
        admin: { uid: adminSession.email, nombre: adminSession.nombre },
      });
    } catch (e: any) {
      console.error('Error aceptar faltante:', e);
    } finally {
      setFaltantesBusyId(null);
    }
  };

  const finalizarFaltante = async (faltanteId: string) => {
    if (!adminSession?.email) return;
    try {
      setFaltantesBusyId(faltanteId);
      await FaltantesService.setEstado({
        faltanteId,
        estado: 'FINALIZADA',
        admin: { uid: adminSession.email, nombre: adminSession.nombre },
      });
    } catch (e: any) {
      console.error('Error finalizar faltante:', e);
    } finally {
      setFaltantesBusyId(null);
    }
  };

  // =========================
  // Turno (badge)
  // =========================
  useEffect(() => {
    const updateTurno = () => setTurnoInfo(obtenerInfoTurnoActual());
    updateTurno();
    const interval = setInterval(updateTurno, 60000);
    return () => clearInterval(interval);
  }, []);

  const getTurnoConfig = (turno: string) => {
    const configs = {
      matutino: {
        color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
        icon: '☀️',
        label: 'Matutino',
      },
      vespertino: {
        color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
        icon: '🌇',
        label: 'Vespertino',
      },
      nocturno: {
        color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        icon: '🌙',
        label: 'Nocturno',
      },
    };
    return configs[turno as keyof typeof configs] || configs.matutino;
  };

  const turnoConfig = getTurnoConfig(turnoInfo.turno);

  // =========================
  // ✅ ALERTAS: normalización + filtros
  // =========================
  const alertasSafe: AlertaUI[] = useMemo(() => {
    const arr = Array.isArray(alertas) ? (alertas as any[]) : [];
    // Normaliza campos críticos para no romper UI
    return arr
      .map((a) => ({
        productoNombre: String(a?.productoNombre ?? a?.nombre ?? 'Producto'),
        stockActual: Number(a?.stockActual ?? 0),
        stockMinimo: Number(a?.stockMinimo ?? 0),
        stockMaximo: a?.stockMaximo != null ? Number(a.stockMaximo) : undefined,
        tipoProducto: a?.tipoProducto ? String(a.tipoProducto) : undefined,
        tipoHielo: a?.tipoHielo ? String(a.tipoHielo) : undefined,
        estado: String(a?.estado ?? 'NORMAL'),
        codigo: a?.codigo ? String(a.codigo) : undefined,
        productoCodigo: a?.productoCodigo ? String(a.productoCodigo) : undefined,
        prioridad: a?.prioridad != null ? Number(a.prioridad) : undefined,
      }))
      // Solo las que realmente son “alerta”
      .filter((a) => a.estado !== 'NORMAL');
  }, [alertas]);

  const alertasCriticas = useMemo(
    () => alertasSafe.filter((a) => String(a.estado).toUpperCase() === 'CRITICO'),
    [alertasSafe]
  );
  const alertasBajas = useMemo(
    () => alertasSafe.filter((a) => String(a.estado).toUpperCase() === 'BAJO'),
    [alertasSafe]
  );
  const alertasExceso = useMemo(
    () => alertasSafe.filter((a) => String(a.estado).toUpperCase() === 'EXCESO'),
    [alertasSafe]
  );

  const alertasTotal = alertasSafe.length;
  const hasCriticas = alertasCriticas.length > 0;

  const alertasForTab = useMemo(() => {
    if (alertTab === 'CRITICO') return alertasCriticas;
    if (alertTab === 'BAJO') return alertasBajas;
    if (alertTab === 'EXCESO') return alertasExceso;
    return alertasSafe;
  }, [alertTab, alertasCriticas, alertasBajas, alertasExceso, alertasSafe]);

  // =========================
  // ✅ Auto-refresh (para que alertas “jalEN” siempre)
  // =========================
  const doRefreshAll = useCallback(async () => {
    try {
      await refreshAll();
    } catch (e) {
      console.error('refreshAll error:', e);
    }
  }, [refreshAll]);

  // 1) al entrar (cuando ya existe sesión)
  useEffect(() => {
    if (!adminSession) return;
    doRefreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSession?.email]);

  // 2) al volver a la pestaña / foco
  useEffect(() => {
    if (!adminSession) return;

    const onVis = () => {
      if (document.visibilityState === 'visible') doRefreshAll();
    };
    const onFocus = () => doRefreshAll();

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [adminSession, doRefreshAll]);

  // 3) intervalo suave (cada 60s)
  useEffect(() => {
    if (!adminSession) return;
    const t = setInterval(() => doRefreshAll(), 60000);
    return () => clearInterval(t);
  }, [adminSession, doRefreshAll]);

  // =========================
  // Handlers
  // =========================
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await doRefreshAll();
    } finally {
      setTimeout(() => setRefreshing(false), 650);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/admin/login');
  };

  // ✅ navegación PRO: prefetch solo hover/focus (no global)
  const goModule = useCallback(
    (path: string) => {
      setShowMobileMenu(false);
      router.push(path);
    },
    [router]
  );

  const prefetchModule = useCallback(
    (path: string) => {
      router.prefetch(path);
    },
    [router]
  );

  // ✅ Paths alineados a tu estructura
  const modules: ModuleItem[] = [
    {
      title: 'Usuarios',
      description: 'Gestionar empleados',
      icon: <FaUsers className="text-lg" />,
      path: '/admin/dashboard/users',
      color: 'bg-blue-500',
      hover: 'hover:bg-blue-600',
    },
    {
      title: 'Almacén',
      description: 'Productos Barra/Bolsa',
      icon: <FaWarehouse className="text-lg" />,
      path: '/admin/dashboard/almacen',
      color: 'bg-green-500',
      hover: 'hover:bg-green-600',
    },
    {
      title: 'Asignación',
      description: 'Asignar a producción',
      icon: <FaTruckLoading className="text-lg" />,
      path: '/admin/dashboard/asignacion',
      color: 'bg-amber-500',
      hover: 'hover:bg-amber-600',
    },
    {
      title: 'Inventario',
      description: 'Stock y control',
      icon: <FaBoxOpen className="text-lg" />,
      path: '/admin/dashboard/inventario',
      color: 'bg-purple-500',
      hover: 'hover:bg-purple-600',
    },
    {
      title: 'Mermas',
      description: 'Registrar pérdidas',
      icon: <FaExclamationTriangle className="text-lg" />,
      path: '/admin/dashboard/mermas',
      color: 'bg-red-500',
      hover: 'hover:bg-red-600',
    },
    {
      title: 'Reportes',
      description: 'Historial y PDF',
      icon: <FaChartLine className="text-lg" />,
      path: '/admin/dashboard/reportes',
      color: 'bg-indigo-500',
      hover: 'hover:bg-indigo-600',
    },
    {
      title: 'Monitoreo',
      description: 'Estado producción',
      icon: <FaIndustry className="text-lg" />,
      path: '/admin/dashboard/monitoreo',
      color: 'bg-cyan-500',
      hover: 'hover:bg-cyan-600',
    },
    {
      title: 'Cargas',
      description: 'Estado cargas por chofer',
      icon: <FaTruck className="text-lg" />,
      path: '/admin/dashboard/cargas',
      color: 'bg-teal-500',
      hover: 'hover:bg-teal-600',
    },
  ];

  const statsCards = [
    {
      title: 'Total Productos',
      value:
        (stats?.totalBarras || 0) +
        (stats?.totalBolsasVacias || 0) +
        (stats?.totalBolsasAsignadas || 0) +
        (stats?.totalBolsasLlenas || 0),
      icon: <FiPackage className="text-blue-400" />,
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/30',
    },
    {
      title: 'Bolsas Vacías',
      value: stats?.totalBolsasVacias || 0,
      icon: <FaBox className="text-gray-400" />,
      bg: 'bg-gray-500/10',
      border: 'border-gray-500/30',
    },
    {
      title: 'En Producción',
      value: stats?.totalBolsasAsignadas || 0,
      icon: <FaTruckLoading className="text-yellow-400" />,
      bg: 'bg-yellow-500/10',
      border: 'border-yellow-500/30',
    },
    {
      title: 'Listas Venta',
      value: stats?.totalBolsasLlenas || 0,
      icon: <FaBoxOpen className="text-green-400" />,
      bg: 'bg-green-500/10',
      border: 'border-green-500/30',
    },
    {
      title: 'Barras Stock',
      value: stats?.totalBarras || 0,
      icon: <FiPackage className="text-purple-400" />,
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/30',
    },
    {
      title: 'Alertas',
      value: alertasTotal,
      icon: <FiAlertCircle className={hasCriticas ? 'text-red-400' : 'text-amber-300'} />,
      bg: hasCriticas ? 'bg-red-500/10' : 'bg-amber-500/10',
      border: hasCriticas ? 'border-red-500/30' : 'border-amber-500/30',
    },
  ];

  if (!adminSession) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header compacto */}
      <header className="sticky top-0 z-50 bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            {/* Logo y menú hamburguesa */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="lg:hidden text-gray-300 hover:text-white"
              >
                {showMobileMenu ? <FaTimes size={20} /> : <FaBars size={20} />}
              </button>

              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-cyan-600 flex items-center justify-center">
                  <FaSnowflake className="text-white text-sm" />
                </div>
                <h1 className="text-base font-bold">Global Ice de Mexico S.A. de C.V</h1>
              </div>
            </div>

            {/* Acciones derecha */}
            <div className="flex items-center gap-2">
              {/* Turno badge */}
              <div
                className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded text-xs ${turnoConfig.color} border`}
              >
                <span>{turnoConfig.icon}</span>
                <span>{turnoConfig.label}</span>
              </div>

              {/* ✅ Alertas (siempre disponible, deshabilitado si no hay) */}
              <button
                onClick={() => {
                  if (alertasTotal > 0) setShowAlertas(true);
                }}
                disabled={alertasTotal === 0}
                className={`relative p-1.5 rounded disabled:opacity-40 ${
                  hasCriticas ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
                }`}
                title={alertasTotal > 0 ? 'Ver alertas' : 'Sin alertas'}
              >
                <FaBell size={14} />
                {alertasTotal > 0 && (
                  <span className="absolute -top-1 -right-1 bg-white text-gray-900 text-[10px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                    {alertasTotal}
                  </span>
                )}
                {hasCriticas && (
                  <span className="absolute -bottom-1 -right-1 w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                )}
              </button>

              {/* ✅ Faltantes badge mini: SOLO si meta.hasOpen */}
              {showFaltantes && faltantesCounts.pendientes > 0 && (
                <button
                  onClick={() => {
                    // puedes abrir modal/scroll a sección si quieres
                    const el = document.getElementById('faltantes-section');
                    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="relative p-1.5 bg-amber-600 hover:bg-amber-700 rounded"
                  title="Faltantes pendientes"
                >
                  <FaBell size={14} />
                  <span className="absolute -top-1 -right-1 bg-white text-amber-700 text-[10px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                    {faltantesCounts.pendientes}
                  </span>
                </button>
              )}

              {/* Refresh */}
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="p-1.5 bg-cyan-600 hover:bg-cyan-700 rounded disabled:opacity-50"
                title="Actualizar"
              >
                <FaSync size={14} className={refreshing ? 'animate-spin' : ''} />
              </button>

              {/* Usuario */}
              <div className="hidden md:flex items-center gap-2 px-2 py-1 bg-gray-700/50 rounded">
                <FaUserCircle className="text-cyan-400" size={14} />
                <span className="text-xs">{adminSession.nombre.split(' ')[0]}</span>
              </div>

              {/* Logout */}
              <button onClick={handleLogout} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded" title="Salir">
                <FiLogOut size={14} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* Bienvenida */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-300">
                Bienvenido, <span className="text-cyan-300">{adminSession.nombre}</span>
              </h2>
              <p className="text-sm text-gray-500">
                {new Date().toLocaleDateString('es-ES', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${turnoConfig.color} border`}>
                <span className="text-sm">{turnoConfig.icon}</span>
                <div className="text-xs">
                  <div className="font-medium">Turno {turnoConfig.label}</div>
                  <div className="text-gray-300">{turnoInfo.horasTurno}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {statsCards.map((stat, index) => (
            <div
              key={index}
              className={`p-3 rounded-lg border ${stat.border} ${stat.bg} hover:scale-[1.02] transition-transform`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="p-1.5 rounded bg-gray-800/50">{stat.icon}</div>
                <div className="text-lg font-bold">{stat.value}</div>
              </div>
              <div className="text-xs text-gray-400 truncate">{stat.title}</div>
            </div>
          ))}
        </div>

        {/* ✅ FALTANTES */}
        {showFaltantes && (
          <div className="mb-6" id="faltantes-section">
            <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
              <div className="flex items-start sm:items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-200 flex items-center">
                    <FaBell className="mr-2 text-amber-300" />
                    FALTANTES (Producción)
                  </h3>
                  <p className="text-xs text-gray-500">Acepta para marcar “En proceso” y Finaliza al entregar.</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-red-300 px-2 py-1 bg-red-900/20 border border-red-700/50 rounded">
                    Pendientes: {faltantesCounts.pendientes}
                  </span>
                  <span className="text-xs font-bold text-yellow-300 px-2 py-1 bg-yellow-900/20 border border-yellow-700/50 rounded">
                    En proceso: {faltantesCounts.enProceso}
                  </span>
                </div>
              </div>

              {(faltantesLoading || faltantesError) && (
                <div className="text-xs text-gray-400">
                  {faltantesLoading ? 'Cargando faltantes…' : null}
                  {faltantesError ? (
                    <div className="mt-2 text-red-300 flex items-center gap-2">
                      <FiAlertCircle />
                      {faltantesError}
                    </div>
                  ) : null}
                </div>
              )}

              {!faltantesLoading && !faltantesError && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {/* Pendientes */}
                  <div className="bg-gray-900/30 border border-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-bold text-gray-300">Pendientes</div>
                      <span className="text-[10px] font-bold text-red-300 px-2 py-0.5 bg-red-900/30 border border-red-700/50 rounded">
                        {faltantesPendientes.length}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {faltantesPendientes.slice(0, 6).map((f) => (
                        <div
                          key={f.id}
                          className="p-2 bg-gray-800/30 rounded border border-gray-700 flex items-start justify-between gap-3"
                        >
                          <div className="text-xs">
                            <div className="font-bold text-white">
                              {f.codigo} • {f.tipo}
                              {f.tipo === 'BOLSAS' && f.bolsa ? ` • ${f.bolsa.pesoKg}kg` : ''}
                            </div>
                            <div className="text-gray-400 mt-0.5">
                              Cant: <span className="font-bold text-gray-200">{f.cantidad}</span>
                              {f.tipo === 'BOLSAS' && f.bolsa ? <> • {f.bolsa.nombre} ({f.bolsa.codigo})</> : null}
                              {f.tipo === 'OTRO' && f.otro ? <> • {f.otro}</> : null}
                            </div>
                            {f.nota ? <div className="text-gray-500 mt-1">📝 {f.nota}</div> : null}
                            <div className="text-gray-500 mt-1">
                              Reportó: <span className="text-gray-300">{f.reportadoPor?.nombre}</span>
                            </div>
                          </div>

                          <button
                            onClick={() => aceptarFaltante(f.id!)}
                            disabled={faltantesBusyId === f.id}
                            className="px-2 py-1 text-xs font-bold bg-cyan-600 hover:bg-cyan-700 rounded disabled:opacity-50"
                          >
                            {faltantesBusyId === f.id ? '...' : 'Aceptar'}
                          </button>
                        </div>
                      ))}

                      {faltantesPendientes.length === 0 && (
                        <div className="text-xs text-gray-500">No hay faltantes pendientes.</div>
                      )}
                    </div>
                  </div>

                  {/* En proceso */}
                  <div className="bg-gray-900/30 border border-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-bold text-gray-300">En proceso</div>
                      <span className="text-[10px] font-bold text-yellow-300 px-2 py-0.5 bg-yellow-900/30 border border-yellow-700/50 rounded">
                        {faltantesEnProceso.length}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {faltantesEnProceso.slice(0, 6).map((f) => (
                        <div
                          key={f.id}
                          className="p-2 bg-gray-800/30 rounded border border-gray-700 flex items-start justify-between gap-3"
                        >
                          <div className="text-xs">
                            <div className="font-bold text-white">
                              {f.codigo} • {f.tipo}
                              {f.tipo === 'BOLSAS' && f.bolsa ? ` • ${f.bolsa.pesoKg}kg` : ''}
                            </div>
                            <div className="text-gray-400 mt-0.5">
                              Cant: <span className="font-bold text-gray-200">{f.cantidad}</span>
                              {f.tipo === 'BOLSAS' && f.bolsa ? <> • {f.bolsa.nombre} ({f.bolsa.codigo})</> : null}
                              {f.tipo === 'OTRO' && f.otro ? <> • {f.otro}</> : null}
                            </div>
                            <div className="text-gray-500 mt-1">
                              Aceptó: <span className="text-gray-300">{f.atendidoPor?.nombre ?? 'Admin'}</span>
                            </div>
                          </div>

                          <button
                            onClick={() => finalizarFaltante(f.id!)}
                            disabled={faltantesBusyId === f.id}
                            className="px-2 py-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 rounded disabled:opacity-50"
                          >
                            {faltantesBusyId === f.id ? '...' : 'Finalizar'}
                          </button>
                        </div>
                      ))}

                      {faltantesEnProceso.length === 0 && (
                        <div className="text-xs text-gray-500">No hay faltantes en proceso.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Módulos */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-gray-300">Módulos</h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {modules.map((module, index) => (
              <Link
                key={index}
                href={module.path}
                className="group"
                prefetch={false}
                onMouseEnter={() => prefetchModule(module.path)}
                onFocus={() => prefetchModule(module.path)}
                onClick={() => setShowMobileMenu(false)}
              >
                <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-3 hover:border-cyan-500/50 transition-all hover:shadow-lg hover:shadow-cyan-500/10">
                  <div className="flex flex-col items-center text-center">
                    <div className={`p-2 rounded-lg ${module.color} ${module.hover} transition-colors mb-2`}>
                      {module.icon}
                    </div>
                    <h4 className="text-sm font-semibold text-white mb-1">{module.title}</h4>
                    <p className="text-xs text-gray-400 line-clamp-2">{module.description}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* ✅ Resumen rápido de alertas (si hay) */}
        {alertasTotal > 0 && (
          <div className="mb-6">
            <div className={`rounded-lg p-4 border ${hasCriticas ? 'bg-red-900/15 border-red-700/40' : 'bg-amber-900/10 border-amber-700/30'}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-sm font-bold flex items-center ${hasCriticas ? 'text-red-300' : 'text-amber-200'}`}>
                  <FaBell className="mr-2" />
                  ALERTAS
                </h3>
                <button
                  onClick={() => setShowAlertas(true)}
                  className="text-xs text-gray-300 hover:text-white"
                >
                  Ver detalle ({alertasTotal})
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="p-2 rounded border border-gray-700 bg-gray-900/30 flex items-center justify-between">
                  <span className="text-gray-400">Críticas</span>
                  <span className="font-bold text-red-300">{alertasCriticas.length}</span>
                </div>
                <div className="p-2 rounded border border-gray-700 bg-gray-900/30 flex items-center justify-between">
                  <span className="text-gray-400">Bajas</span>
                  <span className="font-bold text-yellow-300">{alertasBajas.length}</span>
                </div>
                <div className="p-2 rounded border border-gray-700 bg-gray-900/30 flex items-center justify-between">
                  <span className="text-gray-400">Exceso</span>
                  <span className="font-bold text-emerald-300">{alertasExceso.length}</span>
                </div>
              </div>

              {alertasCriticas.length > 0 && (
                <div className="mt-3 space-y-2">
                  {alertasCriticas.slice(0, 2).map((a, idx) => (
                    <div key={idx} className="p-2 bg-red-900/20 rounded border border-red-700/40 flex items-center justify-between">
                      <div className="text-xs">
                        <div className="font-semibold text-white">{a.productoNombre}</div>
                        <div className="text-red-300">
                          Stock: {a.stockActual} (Mín: {a.stockMinimo})
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-red-300 px-2 py-1 bg-red-900/40 rounded">
                        CRÍTICO
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-8 pt-4 border-t border-gray-800">
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mb-1">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                <span>Sistema en línea</span>
              </div>
              <span>•</span>
              <span>Turno {turnoConfig.label}</span>
            </div>
            <p className="text-xs text-gray-600">Global Ice de Mexico S.A de C.V v2.0 • © {new Date().getFullYear()}</p>
          </div>
        </footer>
      </main>

      {/* ✅ Modal de Alertas */}
      {showAlertas && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg max-w-lg w-full max-h-[85vh] overflow-hidden border border-gray-700">
            <div className="flex justify-between items-center p-4 border-b border-gray-700">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center">
                  <FaBell className={hasCriticas ? 'text-red-400 mr-2' : 'text-amber-300 mr-2'} />
                  Alertas de Stock
                </h3>
                <div className="text-xs text-gray-400 mt-0.5">{alertasTotal} alertas activas</div>
              </div>
              <button onClick={() => setShowAlertas(false)} className="text-gray-400 hover:text-white">
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="px-4 pt-3">
              <div className="grid grid-cols-4 gap-2 text-xs">
                <button
                  onClick={() => setAlertTab('CRITICO')}
                  className={`px-2 py-2 rounded border ${
                    alertTab === 'CRITICO'
                      ? 'bg-red-900/30 border-red-700/50 text-red-200'
                      : 'bg-gray-900/30 border-gray-700 text-gray-300 hover:bg-gray-900/50'
                  }`}
                >
                  Críticas ({alertasCriticas.length})
                </button>
                <button
                  onClick={() => setAlertTab('BAJO')}
                  className={`px-2 py-2 rounded border ${
                    alertTab === 'BAJO'
                      ? 'bg-yellow-900/30 border-yellow-700/50 text-yellow-200'
                      : 'bg-gray-900/30 border-gray-700 text-gray-300 hover:bg-gray-900/50'
                  }`}
                >
                  Bajas ({alertasBajas.length})
                </button>
                <button
                  onClick={() => setAlertTab('EXCESO')}
                  className={`px-2 py-2 rounded border ${
                    alertTab === 'EXCESO'
                      ? 'bg-emerald-900/30 border-emerald-700/50 text-emerald-200'
                      : 'bg-gray-900/30 border-gray-700 text-gray-300 hover:bg-gray-900/50'
                  }`}
                >
                  Exceso ({alertasExceso.length})
                </button>
                <button
                  onClick={() => setAlertTab('TODAS')}
                  className={`px-2 py-2 rounded border ${
                    alertTab === 'TODAS'
                      ? 'bg-cyan-900/30 border-cyan-700/50 text-cyan-200'
                      : 'bg-gray-900/30 border-gray-700 text-gray-300 hover:bg-gray-900/50'
                  }`}
                >
                  Todas ({alertasTotal})
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {alertasForTab.length === 0 ? (
                <div className="text-sm text-gray-400">No hay alertas en esta categoría.</div>
              ) : (
                <div className="space-y-3">
                  {alertasForTab.map((a, idx) => {
                    const st = String(a.estado).toUpperCase();
                    const badge =
                      st === 'CRITICO'
                        ? 'bg-red-900/40 text-red-200 border-red-700/50'
                        : st === 'BAJO'
                        ? 'bg-yellow-900/40 text-yellow-200 border-yellow-700/50'
                        : 'bg-emerald-900/40 text-emerald-200 border-emerald-700/50';

                    return (
                      <div key={idx} className="p-3 bg-gray-900/20 rounded border border-gray-700">
                        <div className="flex justify-between items-start gap-3">
                          <div className="min-w-0">
                            <div className="font-bold text-white truncate">{a.productoNombre}</div>
                            <div className="text-xs text-gray-300 mt-0.5">
                              {a.tipoProducto ? <>Tipo: {a.tipoProducto}</> : null}
                              {a.tipoHielo ? <> • {a.tipoHielo}</> : null}
                            </div>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-1 rounded border ${badge}`}>
                            {st}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-xs mt-3">
                          <div>
                            <span className="text-gray-400">Stock actual:</span>
                            <span className="ml-2 font-bold text-gray-100">{a.stockActual}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Mínimo:</span>
                            <span className="ml-2 font-bold text-yellow-200">{a.stockMinimo}</span>
                          </div>
                          {a.stockMaximo != null && (
                            <div className="col-span-2">
                              <span className="text-gray-400">Máximo:</span>
                              <span className="ml-2 font-bold text-gray-100">{a.stockMaximo}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-700 flex items-center justify-between">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="px-3 py-2 bg-cyan-700 hover:bg-cyan-800 rounded text-sm disabled:opacity-50 flex items-center gap-2"
              >
                <FaSync className={refreshing ? 'animate-spin' : ''} />
                Actualizar
              </button>

              <button
                onClick={() => setShowAlertas(false)}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Menú móvil */}
      {showMobileMenu && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowMobileMenu(false)}></div>
          <div className="fixed top-0 left-0 bottom-0 w-64 bg-gray-800 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-cyan-600 flex items-center justify-center">
                  <FaSnowflake className="text-white text-sm" />
                </div>
                <h2 className="font-bold">Global Ice de Mexico S.A de C.V</h2>
              </div>
              <button onClick={() => setShowMobileMenu(false)} className="text-gray-400 hover:text-white">
                <FaTimes />
              </button>
            </div>

            {/* Info usuario */}
            <div className="mb-4 p-3 bg-gray-700/50 rounded">
              <div className="flex items-center gap-2 mb-2">
                <FaUserCircle className="text-cyan-400" />
                <div>
                  <div className="text-sm font-medium">{adminSession.nombre}</div>
                  <div className="text-xs text-gray-400">{adminSession.email}</div>
                </div>
              </div>
              <div className={`text-xs px-2 py-1 rounded ${turnoConfig.color} border inline-block`}>
                {turnoConfig.icon} Turno {turnoConfig.label}
              </div>
            </div>

            {/* Módulos móvil */}
            <nav className="grid grid-cols-2 gap-2 mb-6">
              {modules.slice(0, 6).map((module, index) => (
                <button
                  key={index}
                  type="button"
                  onMouseEnter={() => prefetchModule(module.path)}
                  onFocus={() => prefetchModule(module.path)}
                  onClick={() => goModule(module.path)}
                  className="p-3 bg-gray-700/50 rounded text-center hover:bg-gray-700 transition-colors"
                >
                  <div className={`inline-flex items-center justify-center w-8 h-8 rounded ${module.color} mb-1`}>
                    {module.icon}
                  </div>
                  <div className="text-xs font-medium">{module.title}</div>
                </button>
              ))}
            </nav>

            {/* Logout móvil */}
            <button
              onClick={handleLogout}
              className="w-full p-3 text-red-400 hover:bg-red-900/20 rounded transition-colors flex items-center justify-center gap-2 border border-red-700/30"
            >
              <FiLogOut />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
