// src/middleware.ts ✅ PROTEGE ADMIN + PRODUCCIÓN + TRANSPORTE
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ✅ ADMIN
  if (pathname.startsWith('/admin')) {
    const authCookie = request.cookies.get('hielo-auth-token');
    const userCookie = request.cookies.get('hielo-user');

    if (!authCookie?.value || !userCookie?.value) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const decoded = decodeURIComponent(userCookie.value);
    const userData = safeJsonParse<{ role?: string }>(decoded);

    if (!userData || userData.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    return NextResponse.next();
  }

  // ✅ PRODUCCIÓN / TRANSPORTE
  if (pathname.startsWith('/produccion') || pathname.startsWith('/transporte')) {
    const prodCookie = request.cookies.get('hielo-prod-session');
    if (!prodCookie?.value) return NextResponse.redirect(new URL('/login', request.url));

    const decoded = decodeURIComponent(prodCookie.value);
    const s = safeJsonParse<{ role?: string; codigo?: string }>(decoded);
    if (!s?.role || !s?.codigo) return NextResponse.redirect(new URL('/login', request.url));

    const isTransporte = s.role === 'TRANSPORTE' || s.role === 'CHOFER';

    if (pathname.startsWith('/transporte') && !isTransporte) {
      return NextResponse.redirect(new URL('/produccion/dashboard', request.url));
    }
    if (pathname.startsWith('/produccion') && isTransporte) {
      return NextResponse.redirect(new URL('/transporte/dashboard', request.url));
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/produccion/:path*', '/transporte/:path*'],
};
