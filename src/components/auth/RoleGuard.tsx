// components/auth/RoleGuard.tsx  ✅ FINAL (PROD)
// - NO protege rutas
// - SOLO controla visibilidad de UI
// - Compatible con adminSession + productionSession

'use client';

import { ReactNode, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthContext } from '@/context/AuthContext';
import { AlertTriangle } from 'lucide-react';

type Role = 'ADMIN' | 'PRODUCCION' | 'TRANSPORTE' | 'CHOFER';

interface RoleGuardProps {
  children: ReactNode;
  allowedRoles: Role[];
  fallback?: ReactNode;
  showMessage?: boolean;
}

function isTransporteRole(r?: string) {
  const x = String(r || '').toUpperCase();
  return x === 'TRANSPORTE' || x === 'CHOFER';
}

export default function RoleGuard({
  children,
  allowedRoles,
  fallback,
  showMessage = false,
}: RoleGuardProps) {
  const pathname = usePathname();
  const { adminSession, productionSession } = useAuthContext();

  // 🔑 Elegir sesión correcta según ruta
  const session = useMemo(() => {
    if (pathname.startsWith('/admin')) return adminSession;
    if (pathname.startsWith('/produccion')) return productionSession;
    if (pathname.startsWith('/transporte')) return productionSession;
    return adminSession || productionSession;
  }, [pathname, adminSession, productionSession]);

  const hasAccess = useMemo(() => {
    if (!session) return false;

    return allowedRoles.some((r) => {
      if (r === 'TRANSPORTE' || r === 'CHOFER') {
        return isTransporteRole(session.role);
      }
      return session.role === r;
    });
  }, [session, allowedRoles]);

  if (hasAccess) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  if (!showMessage) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
        <div>
          <p className="font-medium text-amber-800">Acceso restringido</p>
          <p className="text-sm text-amber-700">
            Requiere permisos: {allowedRoles.join(', ')}
          </p>
        </div>
      </div>
    </div>
  );
}
