'use client';

import React, { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthContext } from '@/context/AuthContext';
import SessionSwitcher from '@/components/SessionSwitcher';

// ✅ Toast global para TODO /admin
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { adminSession, loading } = useAuthContext();

  // ✅ Evita loops / redirects repetidos
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (loading) return;

    // si no hay sesión admin => manda a login admin
    if (!adminSession) {
      if (redirectedRef.current) return;
      redirectedRef.current = true;

      // conserva a dónde quería ir
      const next = encodeURIComponent(pathname || '/admin/dashboard');
      router.replace(`/login?mode=admin&next=${next}`);
      return;
    }

    // si ya hay sesión, resetea flag
    redirectedRef.current = false;
  }, [adminSession, loading, router, pathname]);

  // ✅ Si ya hay sesión admin, renderiza SIEMPRE sin bloquear navegación
  if (adminSession) {
    return (
      <>
        {children}

        {/* ✅ Toasts disponibles en TODO /admin */}
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

        <SessionSwitcher />
      </>
    );
  }

  // ✅ Sin sesión: mientras verifica, loader. (solo aquí)
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500 mx-auto mb-4"></div>
          <p className="text-cyan-300">Verificando permisos...</p>
        </div>
      </div>
    );
  }

  // ✅ Sin sesión y ya no está cargando: no pintes nada (redirigiendo)
  return null;
}
