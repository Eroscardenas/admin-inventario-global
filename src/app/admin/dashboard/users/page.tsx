// app/admin/users/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/context/AuthContext';
import { useUsers } from '@/lib/hooks/useUsers';

import type {
  EmpleadoRole,
  CrearEmpleadoDTO,
  ActualizarEmpleadoDTO,
} from '@/lib/utils/types/user.types';
import { ROLES_UI } from '@/lib/utils/types/user.types';

import {
  Users,
  ShieldCheck,
  Search,
  Filter,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  KeyRound,
  Power,
  PowerOff,
  CheckCircle2,
  AlertTriangle,
  X,
  BadgeCheck,
  BadgeX,
  ArrowLeft,
  LogIn,
  Lock,
} from 'lucide-react';

/* ============================================================
  Helpers
============================================================ */
function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

type EstadoFiltro = 'TODOS' | 'ACTIVOS' | 'INACTIVOS';

const roleLabel = (r: EmpleadoRole) => ROLES_UI[r]?.label ?? String(r);

function shortCode(codigo: string) {
  return (codigo || '').slice(0, 6);
}

function esPin4(pin: string) {
  return /^\d{4}$/.test((pin || '').trim());
}

/* ============================================================
  Modal Shell
============================================================ */
function ModalShell({
  title,
  onClose,
  children,
  tone = 'cyan',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  tone?: 'cyan' | 'purple';
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden shadow-2xl">
        <div className="px-4 py-3 bg-gray-900 flex items-center justify-between">
          <div className="font-medium text-gray-100 flex items-center gap-2">
            {tone === 'cyan' ? (
              <ShieldCheck className="h-4 w-4 text-cyan-300" />
            ) : (
              <KeyRound className="h-4 w-4 text-purple-300" />
            )}
            {title}
          </div>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-200 flex items-center gap-1"
          >
            <X className="h-4 w-4" />
            Cerrar
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/* ============================================================
  Stat Card
============================================================ */
function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-400">{label}</div>
          <div className="text-xl font-semibold text-gray-100">{value}</div>
        </div>
        <div className="text-gray-400">{icon}</div>
      </div>
    </div>
  );
}

/* ============================================================
  Page
============================================================ */
export default function UsersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuthContext();

  const {
    empleados,
    loading,
    error,
    stats,
    crearEmpleado,
    actualizarEmpleado,
    eliminarEmpleado,
    cambiarEstadoEmpleado,
    definirPinManual,
    definirPinsMasivo,
    limpiarPin,
    cambiarEstadoMasivo,
    reload,
  } = useUsers();

  const [gateStatus, setGateStatus] = useState<'CHECKING' | 'OK' | 'DENIED'>('CHECKING');
  const [denyReason, setDenyReason] = useState<string>('No autorizado.');

  useEffect(() => {
    if (authLoading) {
      setGateStatus('CHECKING');
      return;
    }

    if (!user) {
      setGateStatus('DENIED');
      setDenyReason('No hay sesión iniciada.');
      return;
    }

    const isAdmin = (user as any)?.role === 'ADMIN';
    if (!isAdmin) {
      setGateStatus('DENIED');
      setDenyReason('Tu sesión no tiene permisos de ADMIN.');
      return;
    }

    setGateStatus('OK');
  }, [user, authLoading]);

  const [buscar, setBuscar] = useState('');
  const [rol, setRol] = useState<EmpleadoRole | 'TODOS'>('TODOS');
  const [estado, setEstado] = useState<EstadoFiltro>('TODOS');

  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [editCodigo, setEditCodigo] = useState<string | null>(null);

  const [openPinSingle, setOpenPinSingle] = useState(false);
  const [pinCodigo, setPinCodigo] = useState<string | null>(null);

  const [openPinMasivo, setOpenPinMasivo] = useState(false);

  const rolesList = useMemo(() => Object.keys(ROLES_UI) as EmpleadoRole[], []);
  const [fNombre, setFNombre] = useState('');
  const [fRole, setFRole] = useState<EmpleadoRole>(rolesList[0] ?? ('PRODUCCION' as EmpleadoRole));
  const [fActive, setFActive] = useState(true);

  const [pinInput, setPinInput] = useState('');
  const [pinResult, setPinResult] = useState<string | null>(null);

  const [localError, setLocalError] = useState<string | null>(null);

  const resetEmpleadoForm = () => {
    setFNombre('');
    setFRole(rolesList[0] ?? ('PRODUCCION' as EmpleadoRole));
    setFActive(true);
  };

  const resetPinForm = () => {
    setPinInput('');
    setPinResult(null);
  };

  const clearLocalError = () => setLocalError(null);

  const closeAllModals = () => {
    setOpenCreate(false);
    setOpenEdit(false);
    setOpenPinSingle(false);
    setOpenPinMasivo(false);
    setEditCodigo(null);
    setPinCodigo(null);
    setLocalError(null);
    setPinResult(null);
    setPinInput('');
  };

  const handleVolver = () => {
    router.push('/admin/dashboard');
  };

  const filtered = useMemo(() => {
    const b = buscar.trim().toLowerCase();

    return empleados
      .filter((e) => {
        if (rol !== 'TODOS' && e.role !== rol) return false;
        if (estado === 'ACTIVOS' && !e.isActive) return false;
        if (estado === 'INACTIVOS' && e.isActive) return false;

        if (!b) return true;
        return (
          (e.nombre || '').toLowerCase().includes(b) ||
          (e.codigo || '').toLowerCase().includes(b)
        );
      })
      .sort((a, z) => (a.nombre || '').localeCompare(z.nombre || ''));
  }, [empleados, buscar, rol, estado]);

  const selectedCodigos = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
    [selected]
  );

  const allOnPageSelected = useMemo(() => {
    if (filtered.length === 0) return false;
    return filtered.every((e) => !!selected[e.codigo]);
  }, [filtered, selected]);

  const toggleSelectAllPage = () => {
    const next = { ...selected };
    const value = !allOnPageSelected;
    filtered.forEach((e) => {
      next[e.codigo] = value;
    });
    setSelected(next);
  };

  const toggleOne = (codigo: string) => {
    setSelected((prev) => ({ ...prev, [codigo]: !prev[codigo] }));
  };

  const openCreateModal = () => {
    clearLocalError();
    resetEmpleadoForm();
    resetPinForm();
    setOpenCreate(true);
  };

  const openEditModal = (codigo: string) => {
    const e = empleados.find((x) => x.codigo === codigo);
    if (!e) return;

    clearLocalError();
    setPinResult(null);
    setEditCodigo(codigo);
    setFNombre(e.nombre || '');
    setFRole(e.role);
    setFActive(!!e.isActive);
    setOpenEdit(true);
  };

  const openPinSingleModal = (codigo: string) => {
    clearLocalError();
    resetPinForm();
    setPinCodigo(codigo);
    setOpenPinSingle(true);
  };

  const openPinMasivoModal = () => {
    clearLocalError();
    resetPinForm();
    setOpenPinMasivo(true);
  };

  const onCreate = async () => {
    try {
      clearLocalError();

      const adminName = (user as any)?.nombre || (user as any)?.email || 'admin';
      const nombre = fNombre.trim();
      const pin = pinInput.trim();

      if (!nombre) {
        setLocalError('Escribe el nombre.');
        return;
      }

      if (!esPin4(pin)) {
        setLocalError('El PIN debe ser de 4 dígitos.');
        return;
      }

      // ✅ IMPORTANTE:
      // Ya NO mandamos codigo desde el frontend.
      // El codigo lo genera el service.
      const dto: CrearEmpleadoDTO = {
        nombre,
        role: fRole,
        pin,
        isActive: fActive,
      } as CrearEmpleadoDTO;

      await crearEmpleado(dto, adminName);
      closeAllModals();
    } catch (e: any) {
      setLocalError(e?.message || 'Error al crear empleado');
    }
  };

  const onEdit = async () => {
    try {
      clearLocalError();

      if (!editCodigo) return;

      const nombre = fNombre.trim();
      if (!nombre) {
        setLocalError('Escribe el nombre.');
        return;
      }

      const patch: ActualizarEmpleadoDTO = {
        nombre,
        role: fRole,
        isActive: fActive,
      } as ActualizarEmpleadoDTO;

      await actualizarEmpleado(editCodigo, patch);
      closeAllModals();
    } catch (e: any) {
      setLocalError(e?.message || 'Error al actualizar empleado');
    }
  };

  const onDelete = async (codigo: string) => {
    const ok = confirm(`¿Eliminar empleado ${codigo}? (Se desactiva / borrado lógico)`);
    if (!ok) return;

    await eliminarEmpleado(codigo);

    setSelected((prev) => {
      const n = { ...prev };
      delete n[codigo];
      return n;
    });
  };

  const onToggleActive = async (codigo: string, activo: boolean) => {
    await cambiarEstadoEmpleado(codigo, !activo);
  };

  const onLimpiarPin = async (codigo: string) => {
    const ok = confirm(`¿Quitar PIN a ${codigo}? (El empleado quedará sin acceso)`);
    if (!ok) return;
    await limpiarPin(codigo);
  };

  const onDefinirPinSingle = async () => {
    try {
      clearLocalError();
      if (!pinCodigo) return;

      const pin = pinInput.trim();
      if (!esPin4(pin)) {
        setLocalError('El PIN debe ser de 4 dígitos.');
        return;
      }

      const fijo = await definirPinManual(pinCodigo, pin);
      setPinResult(`PIN definido para ${pinCodigo}: ${fijo}`);
    } catch (e: any) {
      setLocalError(e?.message || 'Error al definir PIN');
    }
  };

  const onMasivoPinsFijo = async () => {
    try {
      clearLocalError();

      if (selectedCodigos.length === 0) return;

      const pin = pinInput.trim();
      if (!esPin4(pin)) {
        setLocalError('El PIN debe ser de 4 dígitos.');
        return;
      }

      const ok = confirm(`Definir EL MISMO PIN fijo para ${selectedCodigos.length} empleados seleccionados?`);
      if (!ok) return;

      const res = await definirPinsMasivo(selectedCodigos, pin);
      setPinResult(`PIN definido: ${res.exitosos.length} ok, ${res.fallidos.length} fallidos`);

      if (res.fallidos.length) {
        alert(`PIN definidos: ${res.exitosos.length}. Fallidos: ${res.fallidos.length}`);
      }
    } catch (e: any) {
      setLocalError(e?.message || 'Error en PIN masivo');
    }
  };

  const onMasivoActivar = async (activo: boolean) => {
    if (selectedCodigos.length === 0) return;

    const ok = confirm(`${activo ? 'Activar' : 'Desactivar'} ${selectedCodigos.length} empleados seleccionados?`);
    if (!ok) return;

    await cambiarEstadoMasivo(selectedCodigos, activo);
  };

  if (authLoading || gateStatus === 'CHECKING') {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-200 flex items-center justify-center">
        <div className="animate-pulse">Cargando sesión...</div>
      </div>
    );
  }

  if (gateStatus === 'DENIED') {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-red-900/30 border border-red-800 flex items-center justify-center">
              <Lock className="h-5 w-5 text-red-200" />
            </div>
            <div>
              <div className="text-lg font-semibold">Acceso restringido</div>
              <div className="text-sm text-gray-300">{denyReason}</div>
            </div>
          </div>

          <div className="mt-5 text-sm text-gray-300">
            Esta página es solo para <span className="font-mono">ADMIN</span>.
            No te redirecciono automáticamente para evitar loops.
          </div>

          <div className="mt-6 flex flex-wrap gap-2 justify-end">
            <button
              onClick={() => router.push('/admin/dashboard')}
              className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm inline-flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </button>
            <button
              onClick={() => router.push('/login')}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium text-white inline-flex items-center gap-2"
            >
              <LogIn className="h-4 w-4" />
              Ir a Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleVolver}
              className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm inline-flex items-center gap-2"
              title="Volver al Dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </button>

            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <Users className="h-6 w-6 text-cyan-300" />
                Empleados
              </h1>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => reload(false)}
              className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm inline-flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Recargar
            </button>

            <button
              onClick={() => reload(true)}
              className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm inline-flex items-center gap-2"
              title="Rompe TTL y fuerza lectura"
            >
              <RefreshCw className="h-4 w-4" />
              Forzar
            </button>

            <button
              onClick={openCreateModal}
              className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Alta empleado
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <Stat label="Total" value={stats?.total ?? empleados.length} icon={<BadgeCheck className="h-6 w-6" />} />
          <Stat
            label="Activos"
            value={stats?.activos ?? empleados.filter((e) => e.isActive).length}
            icon={<CheckCircle2 className="h-6 w-6" />}
          />
          <Stat
            label="Inactivos"
            value={stats?.inactivos ?? empleados.filter((e) => !e.isActive).length}
            icon={<BadgeX className="h-6 w-6" />}
          />
          <Stat label="Seleccionados" value={selectedCodigos.length} icon={<Filter className="h-6 w-6" />} />
        </div>

        <div className="mt-6 p-4 rounded-xl bg-gray-900 border border-gray-800">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Buscar por nombre o código..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-950 border border-gray-800 outline-none focus:border-cyan-600 text-gray-100"
              />
            </div>

            <select
              value={rol}
              onChange={(e) => {
                const v = e.target.value;
                setRol(v === 'TODOS' ? 'TODOS' : (v as EmpleadoRole));
              }}
              className="px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 outline-none focus:border-cyan-600 text-gray-100"
            >
              <option value="TODOS">Todos los roles</option>
              {rolesList.map((r) => (
                <option key={r} value={r}>
                  {ROLES_UI[r].label}
                </option>
              ))}
            </select>

            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoFiltro)}
              className="px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 outline-none focus:border-cyan-600 text-gray-100"
            >
              <option value="TODOS">Todos</option>
              <option value="ACTIVOS">Activos</option>
              <option value="INACTIVOS">Inactivos</option>
            </select>

            <div className="flex items-center justify-between text-sm text-gray-400 px-1">
              <span>Mostrando</span>
              <span className="text-gray-200 font-medium">{filtered.length}</span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              disabled={selectedCodigos.length === 0}
              onClick={() => onMasivoActivar(true)}
              className="px-3 py-2 rounded-lg bg-green-700/80 hover:bg-green-700 disabled:opacity-40 text-sm inline-flex items-center gap-2"
            >
              <Power className="h-4 w-4" />
              Activar seleccionados
            </button>

            <button
              disabled={selectedCodigos.length === 0}
              onClick={() => onMasivoActivar(false)}
              className="px-3 py-2 rounded-lg bg-yellow-700/80 hover:bg-yellow-700 disabled:opacity-40 text-sm inline-flex items-center gap-2"
            >
              <PowerOff className="h-4 w-4" />
              Desactivar seleccionados
            </button>

            <button
              disabled={selectedCodigos.length === 0}
              onClick={openPinMasivoModal}
              className="px-3 py-2 rounded-lg bg-purple-700/80 hover:bg-purple-700 disabled:opacity-40 text-sm inline-flex items-center gap-2"
            >
              <KeyRound className="h-4 w-4" />
              Definir PIN (masivo)
            </button>
          </div>

          {error && (
            <div className="mt-3 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {pinResult && (
            <div className="mt-3 text-sm text-purple-200 bg-purple-950/30 border border-purple-900 rounded-lg p-3">
              {pinResult}
            </div>
          )}
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-gray-800">
          <div className="bg-gray-900 px-4 py-3 flex items-center justify-between">
            <div className="text-sm text-gray-300">{loading ? 'Cargando empleados...' : 'Lista de empleados'}</div>

            <button
              onClick={toggleSelectAllPage}
              className="text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700"
            >
              {allOnPageSelected ? 'Deseleccionar página' : 'Seleccionar página'}
            </button>
          </div>

          <div className="overflow-x-auto bg-gray-950">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900 text-gray-300">
                <tr>
                  <th className="text-left px-4 py-3">Sel</th>
                  <th className="text-left px-4 py-3">Código</th>
                  <th className="text-left px-4 py-3">Nombre</th>
                  <th className="text-left px-4 py-3">Rol</th>
                  <th className="text-left px-4 py-3">Estado</th>
                  <th className="text-left px-4 py-3">PIN</th>
                  <th className="text-right px-4 py-3">Acciones</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-900">
                {filtered.map((e) => (
                  <tr key={e.codigo} className="hover:bg-gray-900/40">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={!!selected[e.codigo]}
                        onChange={() => toggleOne(e.codigo)}
                        className="h-4 w-4"
                      />
                    </td>

                    <td className="px-4 py-3 font-mono text-gray-200">{e.codigo}</td>

                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-100">{e.nombre || '(sin nombre)'}</div>
                      <div className="text-xs text-gray-500">ID corto: {shortCode(e.codigo)}</div>
                    </td>

                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-md bg-blue-900/30 border border-blue-800 text-blue-200">
                        {roleLabel(e.role)}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={
                          e.isActive
                            ? 'px-2 py-1 rounded-md bg-green-900/30 border border-green-800 text-green-200'
                            : 'px-2 py-1 rounded-md bg-red-900/30 border border-red-800 text-red-200'
                        }
                      >
                        {e.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'px-2 py-1 rounded-md border text-xs',
                          (e as any).pinHash
                            ? 'bg-purple-900/30 border-purple-800 text-purple-200'
                            : 'bg-gray-900 border-gray-800 text-gray-400'
                        )}
                      >
                        {(e as any).pinHash ? '✅' : '❌'}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2 flex-wrap">
                        <button
                          onClick={() => openPinSingleModal(e.codigo)}
                          className="px-3 py-1.5 rounded-lg bg-purple-700/70 hover:bg-purple-700 text-xs inline-flex items-center gap-2"
                        >
                          <KeyRound className="h-4 w-4" />
                          PIN
                        </button>

                        <button
                          onClick={() => onToggleActive(e.codigo, !!e.isActive)}
                          className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs inline-flex items-center gap-2"
                        >
                          {e.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                          {e.isActive ? 'Desactivar' : 'Activar'}
                        </button>

                        <button
                          onClick={() => openEditModal(e.codigo)}
                          className="px-3 py-1.5 rounded-lg bg-cyan-700/70 hover:bg-cyan-700 text-xs inline-flex items-center gap-2"
                        >
                          <Pencil className="h-4 w-4" />
                          Editar
                        </button>

                        <button
                          onClick={() => onLimpiarPin(e.codigo)}
                          className="px-3 py-1.5 rounded-lg bg-slate-700/70 hover:bg-slate-700 text-xs inline-flex items-center gap-2"
                        >
                          <KeyRound className="h-4 w-4" />
                          Quitar PIN
                        </button>

                        <button
                          onClick={() => onDelete(e.codigo)}
                          className="px-3 py-1.5 rounded-lg bg-red-700/70 hover:bg-red-700 text-xs inline-flex items-center gap-2"
                        >
                          <Trash2 className="h-4 w-4" />
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {!loading && filtered.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-gray-400" colSpan={7}>
                      No hay empleados con esos filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {openCreate && (
          <ModalShell title="Alta de empleado (PIN inicial fijo)" onClose={closeAllModals} tone="cyan">
            <div className="space-y-4">
              {localError && (
                <div className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div>{localError}</div>
                </div>
              )}

              <div>
                <label className="text-sm text-gray-300">Nombre</label>
                <input
                  value={fNombre}
                  onChange={(e) => setFNombre(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 outline-none focus:border-cyan-600 text-gray-100"
                  placeholder="Ej. Juan Pérez"
                />
              </div>

              <div>
                <label className="text-sm text-gray-300">Rol</label>
                <select
                  value={fRole}
                  onChange={(e) => setFRole(e.target.value as EmpleadoRole)}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 outline-none focus:border-cyan-600 text-gray-100"
                >
                  {rolesList.map((r) => (
                    <option key={r} value={r}>
                      {ROLES_UI[r]?.label ?? String(r)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-300">PIN (4 dígitos)</label>
                <input
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 outline-none focus:border-purple-600 text-gray-100 font-mono"
                  placeholder="Ej. 1234"
                  inputMode="numeric"
                />
                <p className="text-xs text-gray-500 mt-2">
                  El código del empleado se genera automáticamente en el service.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={fActive}
                  onChange={(e) => setFActive(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-300">Activo</span>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={onCreate}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium text-white inline-flex items-center gap-2"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Crear empleado
                </button>
              </div>
            </div>
          </ModalShell>
        )}

        {openEdit && (
          <ModalShell title={`Editar empleado ${editCodigo ?? ''}`} onClose={closeAllModals} tone="cyan">
            <div className="space-y-4">
              {localError && (
                <div className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div>{localError}</div>
                </div>
              )}

              <div>
                <label className="text-sm text-gray-300">Nombre</label>
                <input
                  value={fNombre}
                  onChange={(e) => setFNombre(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 outline-none focus:border-cyan-600 text-gray-100"
                />
              </div>

              <div>
                <label className="text-sm text-gray-300">Rol</label>
                <select
                  value={fRole}
                  onChange={(e) => setFRole(e.target.value as EmpleadoRole)}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 outline-none focus:border-cyan-600 text-gray-100"
                >
                  {rolesList.map((r) => (
                    <option key={r} value={r}>
                      {ROLES_UI[r]?.label ?? String(r)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={fActive}
                  onChange={(e) => setFActive(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-300">Activo</span>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={onEdit}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium text-white inline-flex items-center gap-2"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Guardar
                </button>
              </div>

              <p className="text-xs text-gray-500">
                El PIN no se edita aquí. Usa el botón <span className="font-mono">PIN</span> en la tabla.
              </p>
            </div>
          </ModalShell>
        )}

        {openPinSingle && pinCodigo && (
          <ModalShell title="Definir PIN fijo (individual)" onClose={closeAllModals} tone="purple">
            <div className="space-y-4">
              {localError && (
                <div className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div>{localError}</div>
                </div>
              )}

              <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                <div className="text-gray-100 font-medium">
                  {empleados.find((x) => x.codigo === pinCodigo)?.nombre || '(sin nombre)'}
                </div>
                <div className="text-xs text-gray-400 font-mono">{pinCodigo}</div>
              </div>

              <div>
                <label className="text-sm text-gray-300">PIN (4 dígitos)</label>
                <input
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 outline-none focus:border-purple-600 text-gray-100 font-mono"
                  placeholder="Ej. 1234"
                  inputMode="numeric"
                />
                <p className="text-xs text-gray-500 mt-2">PIN fijo: solo cambia si lo vuelves a definir.</p>
              </div>

              {pinResult && (
                <div className="text-sm text-purple-200 bg-purple-950/30 border border-purple-900 rounded-lg p-3">
                  {pinResult}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={onDefinirPinSingle}
                  className="px-4 py-2 rounded-lg bg-purple-700/80 hover:bg-purple-700 text-sm font-medium text-white inline-flex items-center gap-2"
                >
                  <KeyRound className="h-4 w-4" />
                  Definir PIN
                </button>
              </div>
            </div>
          </ModalShell>
        )}

        {openPinMasivo && (
          <ModalShell
            title={`Definir PIN fijo (masivo) · ${selectedCodigos.length} seleccionados`}
            onClose={closeAllModals}
            tone="purple"
          >
            <div className="space-y-4">
              {localError && (
                <div className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div>{localError}</div>
                </div>
              )}

              <div>
                <label className="text-sm text-gray-300">PIN (4 dígitos)</label>
                <input
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 outline-none focus:border-purple-600 text-gray-100 font-mono"
                  placeholder="Ej. 1234"
                  inputMode="numeric"
                />
                <p className="text-xs text-gray-500 mt-2">Se aplica el mismo PIN fijo a todos los seleccionados.</p>
              </div>

              {pinResult && (
                <div className="text-sm text-purple-200 bg-purple-950/30 border border-purple-900 rounded-lg p-3">
                  {pinResult}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={onMasivoPinsFijo}
                  disabled={selectedCodigos.length === 0}
                  className="px-4 py-2 rounded-lg bg-purple-700/80 hover:bg-purple-700 disabled:opacity-40 text-sm font-medium text-white inline-flex items-center gap-2"
                >
                  <KeyRound className="h-4 w-4" />
                  Definir PIN a seleccionados
                </button>
              </div>
            </div>
          </ModalShell>
        )}
      </div>
    </div>
  );
}