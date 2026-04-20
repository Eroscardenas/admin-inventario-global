// components/SessionSwitcher.tsx - Agregar información de pestaña
'use client';

import { useState, useEffect } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { usePathname } from 'next/navigation';
import { 
  User, 
  Factory, 
  StretchHorizontal, 
  X,
  LogOut,
  Check,
  AlertCircle,
  Copy,
  RefreshCw
} from 'lucide-react';

export default function SessionSwitcher() {
  const pathname = usePathname();
  const {
    adminSession,
    productionSession,
    logoutAdmin,
    logoutProduction,
    isAdminLoggedIn,
    isProductionLoggedIn,
    hasMultipleSessions,
    getTabId
  } = useAuthContext();
  
  const [isOpen, setIsOpen] = useState(false);
  const [currentSessionType, setCurrentSessionType] = useState<'admin' | 'production' | null>(null);
  const [tabId, setTabId] = useState('');

  // Determinar sesión actual
  useEffect(() => {
    if (pathname.startsWith('/admin')) {
      setCurrentSessionType('admin');
    } else if (pathname.startsWith('/produccion')) {
      setCurrentSessionType('production');
    } else {
      setCurrentSessionType(null);
    }
    
    setTabId(getTabId());
  }, [pathname, getTabId]);

  // Copiar ID de pestaña para debugging
  const copyTabId = () => {
    navigator.clipboard.writeText(tabId);
    alert(`ID de pestaña copiado: ${tabId}`);
  };

  // Refrescar página
  const refreshPage = () => {
    window.location.reload();
  };

  if (!isAdminLoggedIn && !isProductionLoggedIn) {
    return null;
  }

  const handleLogout = (type: 'admin' | 'production') => {
    if (type === 'admin') {
      logoutAdmin();
    } else {
      logoutProduction();
    }
    setIsOpen(false);
  };

  const handleNavigate = (path: string) => {
    window.location.href = path;
    setIsOpen(false);
  };

  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 shadow-2xl hover:shadow-3xl hover:scale-105 transition-all duration-300 flex items-center justify-center group"
        title={`${hasMultipleSessions ? 'Cambiar entre sesiones' : 'Sesión activa'}`}
      >
        <StretchHorizontal className="h-6 w-6 text-white group-hover:rotate-180 transition-transform" />
        
        {hasMultipleSessions && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center text-xs text-white font-bold">
            2
          </div>
        )}
        
        {!hasMultipleSessions && (
          <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full animate-pulse ${
            currentSessionType === 'admin' ? 'bg-blue-500' : 'bg-green-500'
          }`} />
        )}
      </button>

      {/* Panel desplegable */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-4 animate-in fade-in slide-in-from-bottom-5 duration-300">
          {/* Encabezado */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <StretchHorizontal className="h-5 w-5 text-purple-400" />
              <h3 className="font-semibold text-white">Sesiones</h3>
              <span className="text-xs text-gray-400 px-2 py-1 bg-gray-800 rounded">
                Tab: {tabId.slice(0, 8)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copyTabId}
                className="text-gray-400 hover:text-white p-1"
                title="Copiar ID de pestaña"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                onClick={refreshPage}
                className="text-gray-400 hover:text-white p-1"
                title="Refrescar"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Lista de sesiones */}
          <div className="space-y-3">
            {/* Sesión Admin */}
            {isAdminLoggedIn && adminSession && (
              <div className={`p-3 rounded-lg ${
                currentSessionType === 'admin' 
                  ? 'bg-blue-900/30 border border-blue-700' 
                  : 'bg-gray-800'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-900 rounded-lg">
                      <User className="h-4 w-4 text-blue-300" />
                    </div>
                    <div>
                      <p className="font-medium text-white">Administración</p>
                      <p className="text-xs text-gray-400 truncate max-w-[140px]">
                        {adminSession.nombre}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {currentSessionType === 'admin' && (
                      <Check className="h-4 w-4 text-green-400" />
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleNavigate('/admin/dashboard')}
                    className={`flex-1 py-1.5 text-sm rounded ${
                      currentSessionType === 'admin'
                        ? 'bg-blue-800 text-blue-300 hover:bg-blue-700'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {currentSessionType === 'admin' ? 'Sesión Actual' : 'Ir a Admin'}
                  </button>
                  <button
                    onClick={() => handleLogout('admin')}
                    className="px-3 py-1.5 bg-red-900 text-red-300 text-sm rounded hover:bg-red-800"
                    title="Cerrar sesión admin (solo esta pestaña)"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Sesión Producción */}
            {isProductionLoggedIn && productionSession && (
              <div className={`p-3 rounded-lg ${
                currentSessionType === 'production' 
                  ? 'bg-green-900/30 border border-green-700' 
                  : 'bg-gray-800'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-900 rounded-lg">
                      <Factory className="h-4 w-4 text-green-300" />
                    </div>
                    <div>
                      <p className="font-medium text-white">Producción</p>
                      <p className="text-xs text-gray-400 truncate max-w-[140px]">
                        {productionSession.nombre}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {currentSessionType === 'production' && (
                      <Check className="h-4 w-4 text-green-400" />
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleNavigate('/produccion/dashboard')}
                    className={`flex-1 py-1.5 text-sm rounded ${
                      currentSessionType === 'production'
                        ? 'bg-green-800 text-green-300 hover:bg-green-700'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {currentSessionType === 'production' ? 'Sesión Actual' : 'Ir a Producción'}
                  </button>
                  <button
                    onClick={() => handleLogout('production')}
                    className="px-3 py-1.5 bg-red-900 text-red-300 text-sm rounded hover:bg-red-800"
                    title="Cerrar sesión producción (solo esta pestaña)"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Información */}
          <div className="mt-4 pt-3 border-t border-gray-700">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <AlertCircle className="h-3 w-3" />
                <span>Sesión actual: {
                  currentSessionType === 'admin' ? 'Administración' : 
                  currentSessionType === 'production' ? 'Producción' : 
                  'No determinada'
                }</span>
              </div>
              <div className="text-xs text-gray-500">
                <p>💡 Cada pestaña tiene sesiones independientes</p>
                <p>🔧 Puedes probar Admin y Producción simultáneamente</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black bg-opacity-20 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}