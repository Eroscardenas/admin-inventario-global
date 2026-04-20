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
  BarChart3,
  Building2,
  Activity,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ProduccionLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { productionSession, logoutProduction, loading } = useAuthContext();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionTime, setSessionTime] = useState<string>('');
  const [scrolled, setScrolled] = useState(false);

  // Calcular tiempo de sesión
  const updateSessionTime = useCallback(() => {
    if (productionSession?.loggedInAt) {
      const loggedInTime = new Date(productionSession.loggedInAt).getTime();
      const diffMs = Date.now() - loggedInTime;
      const minutes = Math.floor(diffMs / (1000 * 60));
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        setSessionTime(`${hours}h ${minutes % 60}m`);
      } else {
        setSessionTime(`${minutes}m`);
      }
    }
  }, [productionSession]);

  // Efecto de scroll para header
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Protección de ruta y actualizar tiempo
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

  // Cerrar menú al cambiar ruta
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    logoutProduction();
    router.replace('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center space-y-6">
          <div className="relative">
            <div className="w-20 h-20 border-4 border-cyan-100/50 rounded-full"></div>
            <div className="absolute top-0 left-0 w-20 h-20 border-4 border-cyan-500 rounded-full border-t-transparent animate-spin"></div>
            <div className="absolute top-0 left-0 w-20 h-20 border-4 border-purple-500 rounded-full border-b-transparent animate-spin animation-delay-1000"></div>
          </div>
          <div>
            <p className="text-cyan-700 font-semibold text-lg">Iniciando sesión de producción</p>
            <p className="text-cyan-500 text-sm mt-2">Cargando configuración del sistema...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!productionSession) return null;

  // Navegación específica para producción
  const navItems = [
    { 
      href: '/produccion/dashboard', 
      label: 'Dashboard', 
      icon: <Home className="w-5 h-5" />,
      badge: null,
      gradient: 'from-cyan-500 to-blue-500'
    },
    { 
      href: '/produccion/llenar', 
      label: 'Llenar Bolsas', 
      icon: <Package className="w-5 h-5" />,
      badge: 'nuevo',
      gradient: 'from-purple-500 to-indigo-500'
    },
    { 
      href: '/produccion/salidas', 
      label: 'Registrar Salidas', 
      icon: <ShoppingBag className="w-5 h-5" />,
      badge: null,
      gradient: 'from-blue-500 to-cyan-500'
    },
    { 
      href: '/produccion/devoluciones', 
      label: 'Devoluciones', 
      icon: <RotateCcw className="w-5 h-5" />,
      badge: null,
      gradient: 'from-indigo-500 to-purple-500'
    },
        { 
      href: '/produccion/historial', 
      label: 'Historial', 
      icon: <Clock className="w-5 h-5" />,
      badge: null,
      gradient: 'from-indigo-500 to-purple-500'
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-cyan-50 to-blue-50">
      {/* Header mejorado */}
      <header className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled 
          ? 'bg-white/90 backdrop-blur-lg shadow-xl' 
          : 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600'
      }`}>
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            {/* Logo y botón móvil */}
            <div className="flex items-center gap-6">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2.5 rounded-xl bg-white/20 hover:bg-white/30 transition-all duration-200"
              >
                {mobileMenuOpen ? (
                  <X className="w-6 h-6 text-white" />
                ) : (
                  <Menu className="w-6 h-6 text-white" />
                )}
              </button>
              
              <Link href="/produccion/dashboard" className="flex items-center gap-4 group">
                <div className="relative">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-2xl ${
                    scrolled 
                      ? 'bg-gradient-to-br from-cyan-500 to-blue-500' 
                      : 'bg-white/20 backdrop-blur-sm border border-white/30'
                  }`}>
                    <Building2 className={`w-6 h-6 ${
                      scrolled ? 'text-white' : 'text-white'
                    }`} />
                  </div>
                  <div className="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full border-2 border-white flex items-center justify-center">
                    <Activity className="w-2.5 h-2.5 text-white" />
                  </div>
                </div>
                <div className="hidden sm:block">
                  <h1 className={`text-xl font-bold tracking-tight transition-colors ${
                    scrolled ? 'text-gray-900' : 'text-white'
                  }`}>
                    PRODUCCIÓN
                  </h1>
                  <p className={`text-xs transition-colors ${
                    scrolled ? 'text-gray-600' : 'text-cyan-100'
                  }`}>
                    Control Operativo de Produccion Global Ice de Mexico S.A. de C.V 
                  </p>
                </div>
              </Link>
            </div>

            {/* Información usuario */}
            <div className="flex items-center gap-4">
              {/* Indicador de sesión */}
              <div className={`hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300 ${
                scrolled 
                  ? 'bg-cyan-50 border border-cyan-200' 
                  : 'bg-white/20 backdrop-blur-sm border border-white/30'
              }`}>
                <Clock className={`w-4 h-4 ${
                  scrolled ? 'text-cyan-600' : 'text-white'
                }`} />
                <span className={`text-sm font-medium ${
                  scrolled ? 'text-cyan-700' : 'text-white'
                }`}>
                  {sessionTime}
                </span>
              </div>

              {/* Perfil del usuario */}
              <div className="flex items-center gap-3">
                <div className={`text-right hidden md:block transition-opacity ${
                  scrolled ? 'opacity-100' : 'opacity-90'
                }`}>
                  <p className={`text-sm font-semibold ${
                    scrolled ? 'text-gray-900' : 'text-white'
                  }`}>
                    {productionSession.nombre}
                  </p>
                  <div className="flex items-center gap-1">
                    <ShieldCheck className={`w-3 h-3 ${
                      scrolled ? 'text-cyan-500' : 'text-cyan-200'
                    }`} />
                    <p className={`text-xs ${
                      scrolled ? 'text-gray-500' : 'text-cyan-100'
                    }`}>
                      Operario Autorizado
                    </p>
                  </div>
                </div>
                <div className="relative group">
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-transform group-hover:scale-105 ${
                    scrolled 
                      ? 'bg-gradient-to-br from-cyan-500 to-blue-500' 
                      : 'bg-white/20 backdrop-blur-sm border border-white/30'
                  }`}>
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full border-2 border-white"></div>
                </div>
              </div>

              {/* Botón de logout */}
              <button
                onClick={handleLogout}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-0.5 ${
                  scrolled
                    ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-700 hover:to-blue-700'
                    : 'bg-white/20 backdrop-blur-sm text-white border border-white/30 hover:bg-white/30'
                }`}
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline text-sm font-semibold">Salir</span>
              </button>
            </div>
          </div>

          {/* Navegación desktop mejorada */}
          <nav className="hidden lg:flex gap-3 py-4">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group relative flex items-center gap-3 px-5 py-3 rounded-2xl transition-all duration-300 ${
                    isActive
                      ? `bg-gradient-to-r ${item.gradient} text-white shadow-2xl scale-105`
                      : scrolled
                      ? 'text-gray-700 hover:bg-white hover:shadow-xl hover:border hover:border-gray-200'
                      : 'text-white/90 hover:bg-white/10 hover:backdrop-blur-sm'
                  }`}
                >
                  <div className={`transition-transform ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                    {item.icon}
                  </div>
                  <span className="font-semibold">{item.label}</span>
                  {item.badge && (
                    <span className="absolute -top-2 -right-2 px-2 py-1 text-xs font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full shadow-lg">
                      {item.badge}
                    </span>
                  )}
                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 bg-white/10 rounded-2xl"
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Menú móvil mejorado */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <div 
              className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="lg:hidden fixed inset-y-0 left-0 z-50 w-80 bg-gradient-to-b from-cyan-900 via-blue-900 to-indigo-900 shadow-2xl"
            >
              <div className="h-full flex flex-col overflow-hidden">
                {/* Encabezado del menú móvil */}
                <div className="px-6 py-8 border-b border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-xl">
                        <Building2 className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h2 className="font-bold text-white text-lg">Producción</h2>
                        <p className="text-cyan-200 text-sm">Panel de Control</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setMobileMenuOpen(false)}
                      className="p-2 rounded-lg bg-white/10 hover:bg-white/20"
                    >
                      <X className="w-6 h-6 text-white" />
                    </button>
                  </div>
                </div>
                
                {/* Navegación móvil */}
                <div className="flex-1 overflow-y-auto px-4 py-6">
                  <div className="space-y-2">
                    {navItems.map((item) => {
                      const isActive = pathname === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`flex items-center gap-4 px-5 py-4 rounded-xl transition-all ${
                            isActive
                              ? `bg-gradient-to-r ${item.gradient} text-white shadow-lg`
                              : 'text-white/80 hover:bg-white/10'
                          }`}
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          <div className={`p-2 rounded-lg ${isActive ? 'bg-white/20' : 'bg-white/5'}`}>
                            {item.icon}
                          </div>
                          <span className="font-medium">{item.label}</span>
                          {item.badge && (
                            <span className="ml-auto px-3 py-1 text-xs font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full">
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                  
                  {/* Información del usuario móvil */}
                  <div className="mt-8 p-5 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <div className="w-14 h-14 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-xl">
                          <User className="w-6 h-6 text-white" />
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full border-2 border-white"></div>
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-white">{productionSession.nombre}</p>
                        <p className="text-cyan-200 text-sm">Operario de Producción</p>
                        <div className="flex items-center gap-2 mt-2">
                          <Clock className="w-4 h-4 text-cyan-300" />
                          <span className="text-sm text-cyan-200">Sesión: {sessionTime}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Footer móvil */}
                <div className="p-6 border-t border-white/10">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl hover:from-cyan-700 hover:to-blue-700 transition-all shadow-lg"
                  >
                    <LogOut className="w-5 h-5" />
                    <span className="font-semibold">Cerrar Sesión</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Contenido principal mejorado */}
      <main className="px-4 sm:px-6 lg:px-8 py-8">
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="bg-gradient-to-br from-white to-cyan-50 rounded-3xl border border-cyan-200/50 shadow-2xl overflow-hidden min-h-[calc(100vh-14rem)]"
        >
          {/* Efecto decorativo superior */}
          <div className="h-2 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500" />
          
          <div className="p-6 sm:p-8 lg:p-10">
            {children}
          </div>
        </motion.div>
      </main>

      {/* Footer mejorado */}
      <footer className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-gradient-to-r from-white to-cyan-50 rounded-3xl border border-cyan-200/50 shadow-xl p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row justify-between items-center gap-6">
            {/* Logo y descripción */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-14 h-14 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-xl">
                  <Building2 className="w-7 h-7 text-white" />
                </div>
                <div className="absolute -top-2 -right-2 w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                  <Activity className="w-4 h-4 text-white" />
                </div>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">Sistema de Producción</p>
              </div>
            </div>
            
            {/* Información del sistema */}
            <div className="text-center lg:text-right">
              <div className="inline-flex flex-col sm:flex-row items-center gap-4">
                <div className="px-4 py-2 bg-cyan-50 rounded-xl border border-cyan-200">
                  <p className="text-sm font-semibold text-cyan-700">
                    © {new Date().getFullYear()} Global Ice de Mexico SA. CV
                  </p>
                  <p className="text-xs text-cyan-600">Versión 2.0 • Producción</p>
                </div>
                <div className="px-4 py-2 bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl border border-blue-200">
                  <p className="text-sm text-gray-700">
                    Operario: <span className="font-bold text-cyan-600">{productionSession.nombre}</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    Última actividad: {sessionTime} activo
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Separador decorativo */}
          <div className="h-px bg-gradient-to-r from-transparent via-cyan-300 to-transparent my-6" />
          
          {/* Estado del sistema */}
          <div className="flex flex-wrap justify-center gap-4">
          </div>
        </div>
      </footer>

      {/* Session Switcher */}
      <SessionSwitcher />
    </div>
  );
}