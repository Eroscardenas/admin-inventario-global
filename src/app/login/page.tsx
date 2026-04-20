// app/login/page.tsx ✅ FINAL (ADMIN + EMPLEADO por SELECTOR + PIN)
// - Admin: email + password
// - Empleado: selecciona empleado (lista local por sessionStorage, recarga opcional) + PIN 4 dígitos
// - Cero escrituras extra (solo las de AuthContext en login)
// - Cero lecturas extra (solo 1 query en AuthContext loginProduction; listado usa caché local)
// - Selector NO se rompe (click-outside real, sin overlay que tape clicks)
// ✅ FIX: Redirect respeta modo (evita brincarse a /admin si existe sesión admin)
// ✅ FIX: Redirect inmediato tras login empleado/admin

'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthContext } from '@/context/AuthContext';

import {
  User,
  Factory,
  Mail,
  Eye,
  EyeOff,
  Lock,
  Fingerprint,
  AlertCircle,
  CheckCircle,
  Truck,
  BadgeCheck,
  Search,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';

type Mode = 'admin' | 'empleado';

type EmpleadoLite = {
  codigo: string;
  nombre: string;
  role?: 'PRODUCCION' | 'TRANSPORTE' | 'CHOFER' | string;
};

const normalizeCodigo = (v: string) => String(v || '').trim().toUpperCase();
const isPin4 = (pin: string) => /^\d{4}$/.test(String(pin || '').trim());

const EMP_LITE_CACHE_KEY = 'hielo_login_empleados_lite_v1';
const EMP_LITE_CACHE_TS_KEY = 'hielo_login_empleados_lite_ts_v1';
const EMP_LITE_TTL_MS = 1000 * 60 * 10; // 10 min

function readLiteCache(): EmpleadoLite[] | null {
  try {
    const raw = sessionStorage.getItem(EMP_LITE_CACHE_KEY);
    const ts = sessionStorage.getItem(EMP_LITE_CACHE_TS_KEY);
    if (!raw || !ts) return null;
    if (Date.now() - Number(ts) > EMP_LITE_TTL_MS) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
function writeLiteCache(list: EmpleadoLite[]) {
  try {
    sessionStorage.setItem(EMP_LITE_CACHE_KEY, JSON.stringify(list));
    sessionStorage.setItem(EMP_LITE_CACHE_TS_KEY, String(Date.now()));
  } catch {}
}

export default function LoginPage() {
  const router = useRouter();
  const {
    loginAdmin,
    loginProduction,
    isAdminLoggedIn,
    isProductionLoggedIn,
    loading,
    productionSession,
    loadEmpleados, // ✅ usa cache+TTL (mínimas lecturas)
  } = useAuthContext();

  const [mode, setMode] = useState<Mode>('admin');

  // Admin
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Empleado
  const [empleadosLite, setEmpleadosLite] = useState<EmpleadoLite[]>([]);
  const [empleadosLoading, setEmpleadosLoading] = useState(false);
  const [empleadosError, setEmpleadosError] = useState('');

  const [empleadoOpen, setEmpleadoOpen] = useState(false);
  const [empleadoSearch, setEmpleadoSearch] = useState('');
  const [empleadoSel, setEmpleadoSel] = useState<EmpleadoLite | null>(null);

  const [pin, setPin] = useState('');

  // UI states
  const [error, setError] = useState('');
  const [localError, setLocalError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const pinValido = useMemo(() => isPin4(pin), [pin]);
  const empleadoValido = useMemo(() => !!normalizeCodigo(empleadoSel?.codigo || ''), [empleadoSel]);

  // Colores por modo
  const colors = {
    admin: {
      primary: 'from-cyan-600 to-cyan-700',
      light: 'from-cyan-500 to-cyan-600',
      bg: 'from-cyan-900/20 via-gray-900 to-gray-900',
      border: 'border-cyan-700/30',
      text: 'text-cyan-300',
      icon: 'text-cyan-400',
      shadow: 'shadow-cyan-600/20',
    },
    empleado: {
      primary: 'from-purple-600 to-purple-700',
      light: 'from-purple-500 to-purple-600',
      bg: 'from-purple-900/20 via-gray-900 to-gray-900',
      border: 'border-purple-700/30',
      text: 'text-purple-300',
      icon: 'text-purple-400',
      shadow: 'shadow-purple-600/20',
    },
  } as const;

  const currentColors = colors[mode];

  // ✅ Redirect inteligente: respeta el modo actual (evita brincarse al admin)
  useEffect(() => {
    if (loading) return;

    if (mode === 'admin') {
      if (isAdminLoggedIn) router.replace('/admin/dashboard');
      return;
    }

    // mode === 'empleado'
    if (!isProductionLoggedIn) return;

    if (productionSession?.role === 'TRANSPORTE' || productionSession?.role === 'CHOFER') {
      router.replace('/transporte/dashboard');
    } else {
      router.replace('/produccion/dashboard');
    }
  }, [mode, loading, isAdminLoggedIn, isProductionLoggedIn, productionSession, router]);

  // Limpiar formularios al cambiar modo
  useEffect(() => {
    setEmail('');
    setPassword('');

    setEmpleadoSel(null);
    setEmpleadoSearch('');
    setEmpleadoOpen(false);
    setPin('');

    setError('');
    setLocalError('');
    setShowPassword(false);
    setShowPin(false);
    setLoginLoading(false);
  }, [mode]);

  // ✅ Cargar lista de empleados (mínimas lecturas)
  const hydrateEmpleadosLite = async (force = false) => {
    setEmpleadosError('');
    setEmpleadosLoading(true);
    try {
      if (!force) {
        const cached = readLiteCache();
        if (cached?.length) {
          setEmpleadosLite(cached);
          return;
        }
      }

      const full = await loadEmpleados(force); // trae activos (según tu AuthContext)
      const lite: EmpleadoLite[] = (full || [])
        .filter((e) => !!e.codigo && !!e.nombre)
        .map((e) => ({
          codigo: normalizeCodigo(e.codigo || ''),
          nombre: String(e.nombre || '').trim(),
          role: e.role,
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

      setEmpleadosLite(lite);
      writeLiteCache(lite);
    } catch (err: any) {
      setEmpleadosError(err?.message || 'No se pudieron cargar empleados');
      setEmpleadosLite([]);
    } finally {
      setEmpleadosLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'empleado') return;
    hydrateEmpleadosLite(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ✅ cerrar dropdown con click-outside real (sin overlay que bloquee clicks)
  useEffect(() => {
    if (!empleadoOpen) return;

    const onDown = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      const inDropdown = dropdownRef.current?.contains(target);
      const inButton = buttonRef.current?.contains(target);
      if (!inDropdown && !inButton) setEmpleadoOpen(false);
    };

    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
    };
  }, [empleadoOpen]);

  const empleadosFiltrados = useMemo(() => {
    const s = empleadoSearch.trim().toLowerCase();
    if (!s) return empleadosLite;
    return empleadosLite.filter((e) => {
      return e.nombre.toLowerCase().includes(s) || e.codigo.toLowerCase().includes(s);
    });
  }, [empleadosLite, empleadoSearch]);

  const handleAdminLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoginLoading(true);
    try {
      if (!email || !password) throw new Error('Completa todos los campos');
      await loginAdmin(email, password);

      // ✅ redirect inmediato admin (sin costo extra)
      router.replace('/admin/dashboard');
    } catch (err: any) {
      setError(err?.message || 'Credenciales de administrador incorrectas');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleEmpleadoLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setLoginLoading(true);
    try {
      const cod = normalizeCodigo(empleadoSel?.codigo || '');
      if (!cod) throw new Error('Selecciona tu empleado');
      if (!isPin4(pin)) throw new Error('El PIN debe ser numérico de 4 dígitos');

      // ✅ esto ya guarda sesión en AuthContext (1 query)
      await loginProduction(cod, pin);

      // ✅ redirect inmediato por rol (sin costo extra)
      const role = String(empleadoSel?.role || '').toUpperCase();
      if (role === 'TRANSPORTE' || role === 'CHOFER') {
        router.replace('/transporte/dashboard');
      } else {
        router.replace('/produccion/dashboard');
      }
    } catch (err: any) {
      setLocalError(err?.message || 'PIN incorrecto o usuario inválido');
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div
        className={`absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] ${currentColors.bg}`}
      ></div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5 }}
        className={`relative w-full max-w-md p-8 bg-gray-800/90 backdrop-blur-sm rounded-2xl border ${currentColors.border} shadow-2xl`}
      >
        {/* Header */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className={`inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br ${currentColors.light} rounded-2xl mb-4 shadow-lg ${currentColors.shadow}`}
          >
            <span className="text-2xl font-bold text-white">{mode === 'admin' ? '❄️' : '🧊'}</span>
          </motion.div>
          <h1 className="text-3xl font-bold text-white mb-2">Global Ice de Mexico SA. de CV.</h1>
          <p className="text-gray-400">Sistema de Gestión de Inventario</p>
        </div>

        {/* Switch */}
        <div className="flex bg-gray-700/50 rounded-xl p-1 mb-8 border border-gray-600">
          <button
            onClick={() => setMode('admin')}
            className={`flex-1 py-3 rounded-lg font-medium transition-all duration-300 flex items-center justify-center gap-2 ${
              mode === 'admin'
                ? `bg-gradient-to-r ${colors.admin.primary} text-white shadow-lg ${colors.admin.shadow}`
                : 'text-gray-400 hover:text-gray-200'
            }`}
            disabled={loginLoading || loading}
          >
            <User className="h-4 w-4" />
            Admin
          </button>

          <button
            onClick={() => setMode('empleado')}
            className={`flex-1 py-3 rounded-lg font-medium transition-all duration-300 flex items-center justify-center gap-2 ${
              mode === 'empleado'
                ? `bg-gradient-to-r ${colors.empleado.primary} text-white shadow-lg ${colors.empleado.shadow}`
                : 'text-gray-400 hover:text-gray-200'
            }`}
            disabled={loginLoading || loading}
          >
            <Factory className="h-4 w-4" />
            Produccion
          </button>
        </div>

        <AnimatePresence mode="wait">
          {mode === 'admin' ? (
            <motion.form
              key="admin-form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              onSubmit={handleAdminLogin}
              className="space-y-6"
            >
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2 flex items-center gap-2">
                  <Mail className="h-4 w-4 text-cyan-400" />
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  placeholder="inventario.admin@globalice.com"
                  className="w-full p-4 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  required
                  disabled={loginLoading || loading}
                />
              </div>

              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2 flex items-center gap-2">
                  <Lock className="h-4 w-4 text-cyan-400" />
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="w-full p-4 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all pr-12 disabled:opacity-50"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    required
                    disabled={loginLoading || loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-cyan-300 transition-colors disabled:opacity-50"
                    disabled={loginLoading || loading}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <motion.button
                type="submit"
                disabled={loginLoading || loading}
                whileHover={{ scale: loginLoading || loading ? 1 : 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`w-full bg-gradient-to-r ${colors.admin.primary} text-white p-4 rounded-xl font-semibold shadow-lg shadow-cyan-600/25 hover:shadow-cyan-600/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
              >
                {loginLoading || loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Verificando...
                  </>
                ) : (
                  <>
                    <User className="h-5 w-5" />
                    Acceder al panel Admin
                  </>
                )}
              </motion.button>
            </motion.form>
          ) : (
            <motion.form
              key="empleado-form"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              onSubmit={handleEmpleadoLogin}
              className="space-y-6"
            >
              {/* Selector empleado */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-gray-300 text-sm font-medium flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 text-purple-400" />
                    Selecciona tu nombre
                  </label>

                  <button
                    type="button"
                    onClick={() => hydrateEmpleadosLite(true)}
                    className="text-xs text-gray-300 hover:text-white inline-flex items-center gap-1"
                    disabled={empleadosLoading || loginLoading || loading}
                    title="Recargar lista"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${empleadosLoading ? 'animate-spin' : ''}`} />
                    Recargar
                  </button>
                </div>

                <div className="relative">
                  <button
                    ref={buttonRef}
                    type="button"
                    onClick={() => setEmpleadoOpen((s) => !s)}
                    disabled={loginLoading || loading || empleadosLoading}
                    className={`w-full p-4 bg-gray-700/50 border ${
                      empleadoSel ? 'border-purple-500/50' : 'border-gray-600'
                    } rounded-xl text-white flex items-center justify-between gap-3 transition-all disabled:opacity-50`}
                  >
                    <div className="flex flex-col text-left leading-tight min-w-0">
                      <span className="font-semibold truncate">
                        {empleadoSel
                          ? empleadoSel.nombre
                          : empleadosLoading
                          ? 'Cargando empleados…'
                          : 'Elige tu nombre'}
                      </span>
                      <span className="text-xs text-gray-400 truncate">
                        {empleadoSel
                          ? `${empleadoSel.codigo}${empleadoSel.role ? ` • ${empleadoSel.role}` : ''}`
                          : 'Busca por nombre o código'}
                      </span>
                    </div>
                    <ChevronDown
                      className={`h-5 w-5 text-gray-300 transition-transform ${empleadoOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {empleadoOpen && (
                    <div
                      ref={dropdownRef}
                      className="absolute z-[9999] mt-2 w-full rounded-xl border border-gray-600 bg-gray-900/95 backdrop-blur p-3 shadow-2xl"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {/* Search */}
                      <div className="relative mb-3">
                        <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          value={empleadoSearch}
                          onChange={(e) => setEmpleadoSearch(e.target.value)}
                          placeholder="Buscar por nombre o código…"
                          className="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                          autoFocus
                        />
                      </div>

                      {empleadosError ? (
                        <div className="text-sm text-red-200 bg-red-900/30 border border-red-700/50 rounded-lg p-3">
                          {empleadosError}
                        </div>
                      ) : (
                        <div className="max-h-64 overflow-auto space-y-1 pr-1">
                          {empleadosFiltrados.length === 0 ? (
                            <div className="text-sm text-gray-300 p-3 text-center">
                              No hay empleados que coincidan.
                            </div>
                          ) : (
                            empleadosFiltrados.map((emp) => (
                              <button
                                key={emp.codigo}
                                type="button"
                                onClick={() => {
                                  setEmpleadoSel(emp);
                                  setEmpleadoOpen(false);
                                  setEmpleadoSearch('');
                                  setLocalError('');
                                  setPin('');
                                }}
                                className={`w-full text-left px-3 py-2 rounded-lg border transition ${
                                  empleadoSel?.codigo === emp.codigo
                                    ? 'border-purple-500/50 bg-purple-900/20'
                                    : 'border-transparent hover:border-gray-700 hover:bg-gray-800/60'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-white font-semibold truncate">{emp.nombre}</div>
                                    <div className="text-xs text-gray-400 font-mono">{emp.codigo}</div>
                                  </div>
                                  <div className="text-xs text-gray-300">
                                    {emp.role === 'TRANSPORTE' || emp.role === 'CHOFER' ? (
                                      <span className="inline-flex items-center gap-1">
                                        <Truck className="h-4 w-4 text-amber-300" /> Transporte
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1">
                                        <Factory className="h-4 w-4 text-purple-300" /> Producción
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <p className="text-gray-400 text-xs text-center mt-2">
                  Selecciona tu nombre y luego ingresa tu PIN asignado.
                </p>
              </div>

              {/* PIN */}
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2 flex items-center gap-2">
                  <Fingerprint className="h-4 w-4 text-purple-400" />
                  PIN de Acceso
                  {pin.length > 0 && (
                    <span className={`text-xs ml-auto ${pinValido ? 'text-green-400' : 'text-red-400'}`}>
                      {pin.length}/4
                    </span>
                  )}
                </label>

                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    placeholder="Ej: 1234"
                    className={`w-full p-4 bg-gray-700/50 border ${
                      pinValido ? 'border-green-500/50' : 'border-gray-600'
                    } rounded-xl text-white text-center text-xl tracking-[0.3em] font-mono placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all pr-12 disabled:opacity-50`}
                    value={pin}
                    onChange={(e) => {
                      let value = e.target.value.replace(/\D/g, '');
                      value = value.slice(0, 4);
                      setPin(value);
                      setLocalError('');
                    }}
                    maxLength={4}
                    required
                    disabled={loginLoading || loading || !empleadoValido}
                  />

                  <div className="absolute right-10 top-1/2 transform -translate-y-1/2">
                    {pin.length === 4 && pinValido && <CheckCircle className="h-5 w-5 text-green-400" />}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowPin((s) => !s)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-purple-300 transition-colors disabled:opacity-50"
                    disabled={loginLoading || loading || !empleadoValido}
                  >
                    {showPin ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>

                {/* Nota rol (si ya hay session) */}
                {productionSession?.codigo && (
                  <div className={`mt-3 p-3 rounded-lg border ${currentColors.border} bg-gray-900/40`}>
                    <p className="text-xs text-gray-400 text-center">Sesión detectada</p>
                    <p className={`text-center font-semibold ${currentColors.text}`}>{productionSession.nombre}</p>
                    <div className="flex items-center justify-center gap-2 mt-1 text-sm text-gray-200">
                      {productionSession.role === 'TRANSPORTE' || productionSession.role === 'CHOFER' ? (
                        <>
                          <Truck className="h-4 w-4 text-amber-300" />
                          Transporte
                        </>
                      ) : (
                        <>
                          <Factory className="h-4 w-4 text-purple-300" />
                          Producción
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <motion.button
                type="submit"
                disabled={loginLoading || loading || !empleadoValido || !pinValido}
                whileHover={{ scale: loginLoading || loading || !empleadoValido || !pinValido ? 1 : 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`w-full p-4 rounded-xl font-semibold shadow-lg transition-all flex items-center justify-center gap-2 ${
                  loginLoading || loading || !empleadoValido || !pinValido
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    : `bg-gradient-to-r ${colors.empleado.primary} text-white hover:shadow-purple-600/40`
                }`}
              >
                {loginLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Iniciando sesión...
                  </>
                ) : (
                  <>
                    {empleadoSel?.role === 'TRANSPORTE' || empleadoSel?.role === 'CHOFER' ? (
                      <Truck className="h-5 w-5" />
                    ) : (
                      <Factory className="h-5 w-5" />
                    )}
                    Acceder
                  </>
                )}
              </motion.button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Errores */}
        {(error || localError) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mt-6 p-4 rounded-xl text-sm border ${
              mode === 'admin'
                ? 'bg-red-900/30 border-red-700/50'
                : 'bg-purple-900/30 border-purple-700/50'
            }`}
          >
            <div className="flex items-start gap-3">
              <AlertCircle className={`h-5 w-5 ${mode === 'admin' ? 'text-red-400' : 'text-purple-400'} mt-0.5`} />
              <div className="flex-1">
                <p className={`font-medium ${mode === 'admin' ? 'text-red-200' : 'text-purple-200'}`}>
                  Error de autenticación
                </p>
                <div className="mt-1 text-gray-200">{localError || error}</div>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
