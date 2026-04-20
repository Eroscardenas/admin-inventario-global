// components/auth/ProtectedRoute.tsx  ✅ FINAL (PROD) - compatible con tu AuthContext (adminSession + productionSession)
// - Decide sesión por ruta o por requiredRole
// - Permite admin + producción al mismo tiempo (no se pisan)
// - Redirige a login correcto según módulo
// - Evita flicker (loading gate)

'use client';

import React, { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthContext } from '@/context/AuthContext';

type Role = 'ADMIN' | 'PRODUCCION' | 'TRANSPORTE' | 'CHOFER';

type ProtectedRouteProps = {
  children: React.ReactNode;

  /**
   * Si lo pasas, fuerza el rol requerido.
   * Si NO lo pasas, se infiere por pathname:
   * - /admin -> ADMIN
   * - /transporte -> TRANSPORTE/CHOFER
   * - /produccion -> PRODUCCION
   */
  requiredRole?: Role;

  /**
   * Si lo pasas, se usa tal cual.
   * Si NO lo pasas, se calcula según ruta:
   * - /admin -> /login
   * - /produccion -> /produccion/login
   * - /transporte -> /transporte/login (si no existe, cae a /login)
   */
  redirectTo?: string;

  /**
   * Si quieres mostrar UI “acceso denegado” en vez de redirigir.
   * Default: false (redirige)
   */
  showDeniedUI?: boolean;
};

function defaultLoginForPath(path: string) {
  if (path.startsWith('/produccion')) return '/produccion/login';
  if (path.startsWith('/transporte')) return '/transporte/login';
  return '/login';
}

function inferRequiredRole(path: string): Role | undefined {
  if (path.startsWith('/admin')) return 'ADMIN';
  if (path.startsWith('/transporte')) return 'TRANSPORTE'; // aceptamos CHOFER también
  if (path.startsWith('/produccion')) return 'PRODUCCION';
  return undefined;
}

function isTransporteRole(r?: string) {
  const x = String(r || '').toUpperCase();
  return x === 'TRANSPORTE' || x === 'CHOFER';
}

function LoadingGate() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">
        Verificando acceso…
      </div>
    </div>
  );
}

function DeniedUI() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Acceso denegado</h2>
        <p className="mt-2 text-sm text-gray-600">No tienes permisos para acceder a esta página.</p>
      </div>
    </div>
  );
}

export default function ProtectedRoute({
  children,
  requiredRole,
  redirectTo,
  showDeniedUI = false,
}: ProtectedRouteProps) {
  const router = useRouter();
  const pathname = usePathname();

  const { loading, adminSession, productionSession } = useAuthContext();

  // 1) Resolver rol requerido (por prop o por ruta)
  const roleNeeded = useMemo(() => {
    return requiredRole ?? inferRequiredRole(pathname || '/');
  }, [requiredRole, pathname]);

  // 2) Resolver ruta login default
  const loginTarget = useMemo(() => {
    return redirectTo ?? defaultLoginForPath(pathname || '/');
  }, [redirectTo, pathname]);

  // 3) Resolver la sesión “activa” para ESTA ruta
  const sessionForThisRoute = useMemo(() => {
    if (roleNeeded === 'ADMIN') return adminSession;
    if (roleNeeded === 'PRODUCCION') return productionSession;
    if (roleNeeded === 'TRANSPORTE' || roleNeeded === 'CHOFER') return productionSession;

    // si no hay roleNeeded (ruta pública), permite cualquiera
    return adminSession || productionSession;
  }, [roleNeeded, adminSession, productionSession]);

  // 4) Validación de rol (especial para transporte/chofer)
  const hasAccess = useMemo(() => {
    if (!roleNeeded) return true; // ruta sin rol requerido
    if (!sessionForThisRoute) return false;

    const actualRole = String(sessionForThisRoute.role || '').toUpperCase();

    if (roleNeeded === 'TRANSPORTE' || roleNeeded === 'CHOFER') {
      return isTransporteRole(actualRole);
    }

    return actualRole === roleNeeded;
  }, [roleNeeded, sessionForThisRoute]);

  // 5) Redirecciones (solo cuando ya no está loading)
  useEffect(() => {
    if (loading) return;

    // No hay sesión para este módulo
    if (!sessionForThisRoute) {
      router.replace(loginTarget);
      return;
    }

    // Hay sesión pero rol no corresponde
    if (!hasAccess) {
      if (showDeniedUI) return;

      const actualRole = String(sessionForThisRoute.role || '').toUpperCase();

      if (actualRole === 'ADMIN') {
        router.replace('/admin/dashboard');
        return;
      }

      if (isTransporteRole(actualRole)) {
        router.replace('/transporte/dashboard');
        return;
      }

      router.replace('/produccion/dashboard');
    }
  }, [loading, sessionForThisRoute, hasAccess, router, loginTarget, showDeniedUI]);

  // 6) Render gates
  if (loading) return <LoadingGate />;

  if (!sessionForThisRoute) return null; // ya está redirigiendo
  if (!hasAccess) return showDeniedUI ? <DeniedUI /> : null;

  return <>{children}</>;
}
