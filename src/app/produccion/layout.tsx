/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { ReactNode, useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthContext } from '@/context/AuthContext';
import SessionSwitcher from '@/components/SessionSwitcher';
import Link from 'next/link';
import {
  Home,
  Package,
  ShoppingBag,
  RotateCcw,
  LogOut,
  User,
  Clock,
  Menu,
  X,
  Building2,
  Activity,
  ShieldCheck,
  Snowflake,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ProduccionLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { productionSession, logoutProduction, loading } = useAuthContext();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionTime, setSessionTime] = useState<string>('');
  const [scrolled, setScrolled] = useState(false);

  const updateSessionTime = useCallback(() => {
    if (productionSession?.loggedInAt) {
      const loggedInTime = new Date(productionSession.loggedInAt).getTime();
      const diffMs = Date.now() - loggedInTime;
      const minutes = Math.floor(diffMs / (1000 * 60));
      const hours = Math.floor(minutes / 60);

      setSessionTime(hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`);
    }
  }, [productionSession]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!loading && !productionSession) {
      router.push('/login?mode=produccion');
    }

    if (productionSession) {
      updateSessionTime();
      const interval = setInterval(updateSessionTime, 60000);
      return () => clearInterval(interval);
    }
  }, [loading, productionSession, router, updateSessionTime]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    logoutProduction();
    router.replace('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-cyan-950/50 to-blue-950 flex items-center justify-center">
        <div className="text-center space-y-6">
          <div className="relative mx-auto w-20 h-20">
            <div className="absolute inset-0 border-4 border-slate-700/50 rounded-full" />
            <div className="absolute inset-0 border-4 border-cyan-400 rounded-full border-t-transparent animate-spin" />
            <div className="absolute inset-0 border-4 border-transparent border-t-blue-400 rounded-full animate-spin-slow" />
          </div>
          <div>
            <p className="text-white font-black text-lg">Iniciando sesión de producción</p>
            <p className="text-cyan-300/70 text-sm mt-2">Cargando configuración del sistema...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!productionSession) return null;

  const navItems = [
    {
      href: '/produccion/dashboard',
      label: 'Dashboard',
      icon: <Home className="w-5 h-5" />,
      badge: null,
      gradient: 'from-cyan-500 to-blue-600',
    },
    {
      href: '/produccion/llenar',
      label: 'Llenar Bolsas',
      icon: <Package className="w-5 h-5" />,
      badge: null,
      gradient: 'from-cyan-500 to-blue-600',
    },
    {
      href: '/produccion/salidas',
      label: 'Registrar Salidas',
      icon: <ShoppingBag className="w-5 h-5" />,
      badge: null,
      gradient: 'from-cyan-500 to-blue-600',
    },
    {
      href: '/produccion/devoluciones',
      label: 'Devoluciones',
      icon: <RotateCcw className="w-5 h-5" />,
      badge: null,
      gradient: 'from-cyan-500 to-blue-600',
    },
    {
      href: '/produccion/historial',
      label: 'Historial',
      icon: <Clock className="w-5 h-5" />,
      badge: null,
      gradient: 'from-cyan-500 to-blue-600',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950/30">
      {/* Header */}
      <header
        className={`sticky top-0 z-50 transition-all duration-300 border-b ${
          scrolled
            ? 'bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-slate-950/50 border-slate-700/50'
            : 'bg-gradient-to-br from-slate-950 via-cyan-950/80 to-blue-950/80 border-white/5'
        }`}
      >
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <div className="flex items-center gap-6">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={`lg:hidden p-2.5 rounded-xl transition-all duration-200 ${
                  scrolled
                    ? 'bg-slate-800/50 text-white border border-slate-700/50'
                    : 'bg-white/10 text-white border border-white/10'
                }`}
                type="button"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>

              <Link href="/produccion/dashboard" className="flex items-center gap-4 group">
                <div className="relative">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-2xl transition-all ${
                      scrolled
                        ? 'bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30'
                        : 'bg-white/10 backdrop-blur-xl border border-white/15'
                    }`}
                  >
                    <Snowflake className="w-6 h-6 text-cyan-300" />
                  </div>

                  <div className="absolute -top-1 -right-1 w-5 h-5 bg-cyan-400 rounded-full border-2 border-slate-950 flex items-center justify-center">
                    <Activity className="w-2.5 h-2.5 text-slate-950" />
                  </div>
                </div>

                <div className="hidden sm:block">
                  <h1 className={`text-xl font-black tracking-tight ${scrolled ? 'text-white' : 'text-white'}`}>
                    PRODUCCIÓN
                  </h1>
                  <p className={`text-xs ${scrolled ? 'text-slate-400' : 'text-cyan-200/80'}`}>
                    Control Operativo de Producción Global Ice de México S.A. de C.V
                  </p>
                </div>
              </Link>
            </div>

            <div className="flex items-center gap-4">
              <div
                className={`hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300 ${
                  scrolled
                    ? 'bg-cyan-500/10 border border-cyan-500/20'
                    : 'bg-white/10 backdrop-blur-xl border border-white/15'
                }`}
              >
                <Clock className={`w-4 h-4 ${scrolled ? 'text-cyan-400' : 'text-cyan-200'}`} />
                <span className={`text-sm font-black ${scrolled ? 'text-cyan-300' : 'text-white'}`}>
                  {sessionTime}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right hidden md:block">
                  <p className={`text-sm font-black ${scrolled ? 'text-white' : 'text-white'}`}>
                    {productionSession.nombre}
                  </p>
                  <div className="flex items-center gap-1 justify-end">
                    <ShieldCheck className={`w-3 h-3 ${scrolled ? 'text-cyan-400' : 'text-cyan-200'}`} />
                    <p className={`text-xs ${scrolled ? 'text-slate-400' : 'text-cyan-100'}`}>
                      Operario Autorizado
                    </p>
                  </div>
                </div>

                <div className="relative group">
                  <div
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-105 ${
                      scrolled
                        ? 'bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30'
                        : 'bg-white/10 backdrop-blur-xl border border-white/15'
                    }`}
                  >
                    <User className="w-5 h-5 text-cyan-300" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-slate-950" />
                </div>
              </div>

              <button
                onClick={handleLogout}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-0.5 ${
                  scrolled
                    ? 'bg-slate-800/50 text-white hover:bg-slate-800 border border-slate-700/50'
                    : 'bg-white/10 backdrop-blur-xl text-white border border-white/15 hover:bg-white/15'
                }`}
                type="button"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline text-sm font-black">Salir</span>
              </button>
            </div>
          </div>

          {/* Navigation */}
          <nav className="hidden lg:flex gap-3 py-4">
            {navItems.map((item) => {
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group relative flex items-center gap-3 px-5 py-3 rounded-2xl transition-all duration-300 ${
                    isActive
                      ? `bg-gradient-to-r ${item.gradient} text-white shadow-2xl shadow-cyan-500/20 scale-105`
                      : scrolled
                      ? 'text-slate-300 hover:bg-slate-800/50 hover:shadow-lg border border-transparent hover:border-slate-700/50'
                      : 'text-white/80 hover:bg-white/10 hover:backdrop-blur-xl border border-transparent hover:border-white/10'
                  }`}
                >
                  <div className={`transition-transform ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                    {item.icon}
                  </div>

                  <span className="font-black">{item.label}</span>

                  {item.badge && (
                    <span className="absolute -top-2 -right-2 px-2 py-1 text-xs font-black bg-slate-950 text-cyan-300 rounded-full shadow-lg border border-cyan-500/30">
                      {item.badge}
                    </span>
                  )}

                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 bg-white/10 rounded-2xl"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <div
              className="lg:hidden fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-md"
              onClick={() => setMobileMenuOpen(false)}
            />

            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="lg:hidden fixed inset-y-0 left-0 z-50 w-80 bg-gradient-to-b from-slate-950 via-cyan-950/80 to-blue-950/80 shadow-2xl border-r border-white/10"
            >
              <div className="h-full flex flex-col overflow-hidden">
                <div className="px-6 py-8 border-b border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-white/10 border border-white/15 rounded-2xl flex items-center justify-center shadow-xl">
                        <Snowflake className="w-6 h-6 text-cyan-300" />
                      </div>
                      <div>
                        <h2 className="font-black text-white text-lg">Producción</h2>
                        <p className="text-cyan-200/80 text-sm">Panel de Control</p>
                      </div>
                    </div>

                    <button
                      onClick={() => setMobileMenuOpen(false)}
                      className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-all"
                      type="button"
                    >
                      <X className="w-6 h-6 text-white" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-6">
                  <div className="space-y-2">
                    {navItems.map((item) => {
                      const isActive = pathname === item.href;

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`flex items-center gap-4 px-5 py-4 rounded-2xl transition-all ${
                            isActive
                              ? `bg-gradient-to-r ${item.gradient} text-white shadow-lg`
                              : 'text-white/80 hover:bg-white/10 border border-transparent hover:border-white/10'
                          }`}
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          <div className={`p-2 rounded-xl ${isActive ? 'bg-white/20' : 'bg-white/5'}`}>
                            {item.icon}
                          </div>

                          <span className="font-black">{item.label}</span>

                          {item.badge && (
                            <span className="ml-auto px-3 py-1 text-xs font-black bg-slate-950 text-cyan-300 rounded-full border border-cyan-500/30">
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>

                  <div className="mt-8 p-5 bg-white/10 rounded-3xl border border-white/10 backdrop-blur-xl">
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <div className="w-14 h-14 bg-white/10 border border-white/15 rounded-2xl flex items-center justify-center shadow-xl">
                          <User className="w-6 h-6 text-cyan-300" />
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-400 rounded-full border-2 border-slate-950" />
                      </div>

                      <div className="flex-1">
                        <p className="font-black text-white">{productionSession.nombre}</p>
                        <p className="text-cyan-200/80 text-sm">Operario de Producción</p>

                        <div className="flex items-center gap-2 mt-2">
                          <Clock className="w-4 h-4 text-cyan-300" />
                          <span className="text-sm text-cyan-200/80">Sesión: {sessionTime}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 border-t border-white/10">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl hover:from-cyan-600 hover:to-blue-700 transition-all shadow-lg shadow-cyan-500/20 font-black"
                    type="button"
                  >
                    <LogOut className="w-5 h-5" />
                    <span>Cerrar Sesión</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="px-4 sm:px-6 lg:px-8 py-8">
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="bg-slate-900/70 backdrop-blur-md rounded-[2rem] border border-slate-700/50 shadow-2xl shadow-slate-950/50 overflow-hidden min-h-[calc(100vh-14rem)]"
        >
          <div className="h-2 bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-400" />

          <div className="relative">
            <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-cyan-400/5 blur-3xl" />
            <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-blue-400/5 blur-3xl" />

            <div className="relative p-6 sm:p-8 lg:p-10">{children}</div>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-slate-900/70 backdrop-blur-md rounded-[2rem] border border-slate-700/50 shadow-2xl shadow-slate-950/50 p-6 sm:p-8 overflow-hidden relative">
          <div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-cyan-400/5 blur-3xl" />

          <div className="relative flex flex-col lg:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-14 h-14 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 rounded-2xl flex items-center justify-center shadow-xl">
                  <Snowflake className="w-7 h-7 text-cyan-300" />
                </div>
                <div className="absolute -top-2 -right-2 w-8 h-8 bg-cyan-400 rounded-full flex items-center justify-center border-2 border-slate-950">
                  <Activity className="w-4 h-4 text-slate-950" />
                </div>
              </div>

              <div>
                <p className="text-lg font-black text-white">Sistema de Producción</p>
                <p className="text-sm text-slate-400">Operación interna Global Ice</p>
              </div>
            </div>

            <div className="text-center lg:text-right">
              <div className="inline-flex flex-col sm:flex-row items-center gap-4">
                <div className="px-4 py-2 bg-cyan-500/10 rounded-xl border border-cyan-500/20">
                  <p className="text-sm font-black text-cyan-300">
                    © {new Date().getFullYear()} Global Ice de Mexico SA. CV
                  </p>
                  <p className="text-xs text-cyan-400/70">Versión 2.0 • Producción</p>
                </div>

                <div className="px-4 py-2 bg-slate-800/50 rounded-xl border border-slate-700/50">
                  <p className="text-sm text-white/80">
                    Operario: <span className="font-black text-cyan-300">{productionSession.nombre}</span>
                  </p>
                  <p className="text-xs text-slate-500">Última actividad: {sessionTime} activo</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent my-6" />
        </div>
      </footer>

      <SessionSwitcher />
    </div>
  );
}