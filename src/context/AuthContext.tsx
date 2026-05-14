'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
  useMemo,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  setDoc,
  serverTimestamp,
  limit,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase/config.client';

import { COLECCIONES } from '@/lib/firebase/firestore';

// ===============================
// Session Keys
// ===============================
const TAB_ID =
  typeof window !== 'undefined'
    ? `tab-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    : 'server-tab';

// ✅ Admin persistente + empleado persistente.
// IMPORTANTE: PROD_KEY ya NO depende de TAB_ID.
// Antes cambiaba en cada reload/montaje y por eso producción perdía sesión.
const ADMIN_KEY = 'hielo_admin_session';
const PROD_KEY = 'hielo_production_session';

// ✅ Cache empleados (para listados admin)
const EMP_CACHE_KEY = 'hielo_empleados_cache_v1';
const EMP_CACHE_TTL_MS = 1000 * 60 * 10; // 10 min

// ===============================
// Cookies (para middleware)
// ===============================
const ADMIN_AUTH_COOKIE = 'hielo-auth-token';
const ADMIN_USER_COOKIE = 'hielo-user';
const PROD_COOKIE = 'hielo-prod-session';

function setCookie(name: string, value: string, days = 7) {
  if (typeof document === 'undefined') return;
  const maxAge = days * 24 * 60 * 60; // seconds
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function deleteCookie(name: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

// ===============================
// TIPOS (Sesión) — ✅ FIX TS
// ===============================
export type AdminRole = 'ADMIN';
export type EmpleadoRole = 'PRODUCCION' | 'TRANSPORTE' | 'CHOFER';
export type AnyRole = AdminRole | EmpleadoRole;

export interface AuthUserBase {
  id: string; // docId firebase (o uid admin)
  nombre: string;
  role: AnyRole;
  isActive: boolean;
  email?: string;

  // Identificadores de empleado (UI / trazabilidad)
  codigo?: string; // EMP001 / USR001
  empleadoId?: string; // legacy/compat

  // Sesión
  loggedInAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  tabId?: string;

  // ✅ Empleado: tracking de inactividad
  lastActivity?: number;
}

export type AdminSession = AuthUserBase & {
  role: 'ADMIN';
};

export type ProductionSession = AuthUserBase & {
  role: EmpleadoRole;
  codigo: string; // ✅ obligatorio
};

// ===============================
// Context Type
// ===============================
export interface AuthContextType {
  // Sesiones
  adminSession: AdminSession | null;
  productionSession: ProductionSession | null;

  // Login/Logout
  loginAdmin: (email: string, password: string) => Promise<void>;
  loginProduction: (codigo: string, pin: string) => Promise<void>;
  logoutAdmin: () => void;
  logoutProduction: () => void;
  logout: () => void;

  // Estado
  isAdminLoggedIn: boolean;
  isProductionLoggedIn: boolean;
  hasMultipleSessions: boolean;
  loading: boolean;
  user: AuthUserBase | null;

  // Empleados (para listados admin)
  empleados: AuthUserBase[];
  loadEmpleados: (force?: boolean) => Promise<AuthUserBase[]>;
  getEmpleadoById: (idOrCodigo: string) => Promise<AuthUserBase | null>;

  // Utilitarios
  getUserForRoute: (route: string) => AuthUserBase | null;
  updateLastActivity: () => void;
  clearCache: () => void;
  getTabId: () => string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ===============================
// Helpers
// ===============================
function devLog(...args: any[]) {
  if (process.env.NODE_ENV === 'development') console.log(...args);
}
function devWarn(...args: any[]) {
  if (process.env.NODE_ENV === 'development') console.warn(...args);
}
function devError(...args: any[]) {
  if (process.env.NODE_ENV === 'development') console.error(...args);
}

function toDateSafe(v: any): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Quita datos sensibles y rehidrata fechas.
 * (Nunca guardamos PIN en sesión)
 */
function sanitizeSession(input: any): AuthUserBase {
  const s: AuthUserBase = {
    id: input?.id,
    nombre: input?.nombre,
    role: input?.role,
    isActive: input?.isActive !== false,
    email: input?.email,
    codigo: input?.codigo,
    empleadoId: input?.empleadoId,
    tabId: input?.tabId,
    lastActivity: typeof input?.lastActivity === 'number' ? input.lastActivity : undefined,
    createdAt: toDateSafe(input?.createdAt),
    updatedAt: toDateSafe(input?.updatedAt),
    loggedInAt: toDateSafe(input?.loggedInAt),
  };

  // ❌ NUNCA persistimos pin en sesión
  if ('pin' in (s as any)) delete (s as any).pin;
  return s;
}

const ROLES_EMPLEADO_PERMITIDOS: EmpleadoRole[] = ['PRODUCCION', 'TRANSPORTE', 'CHOFER'];

function normalizeCodigo(v: string) {
  return String(v || '').trim().toUpperCase();
}
function isPin4(pin: string) {
  return /^\d{4}$/.test(String(pin || '').trim());
}

// ===============================
// ✅ Crypto helpers (PIN hash/salt)
// ===============================
async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
async function hashPin(pin: string, salt: string) {
  return sha256Hex(`${salt}:${pin}`);
}

// ===============================
// Cache empleados (localStorage)
// ===============================
function readEmpleadosCache(): AuthUserBase[] | null {
  try {
    const raw = localStorage.getItem(EMP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !Array.isArray(parsed?.data)) return null;
    if (Date.now() - parsed.ts > EMP_CACHE_TTL_MS) return null;
    return (parsed.data as any[]).map(sanitizeSession);
  } catch {
    return null;
  }
}

function writeEmpleadosCache(data: AuthUserBase[]) {
  try {
    localStorage.setItem(EMP_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

// ===============================
// Provider
// ===============================
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';

  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [productionSession, setProductionSession] = useState<ProductionSession | null>(null);
  const [empleados, setEmpleados] = useState<AuthUserBase[]>([]);
  const [loading, setLoading] = useState(true);


  // ===============================
  // Load sessions (SOLO al montar)
  // ===============================
  useEffect(() => {
    let cancelled = false;

    const loadSessions = () => {
      try {
        setLoading(true);
        devLog(`🆔 Cargando sesiones iniciales...`, { pathname, tabId: TAB_ID });

        // ✅ Admin persistente. No lo apagamos al navegar fuera de /admin.
        const savedAdmin = localStorage.getItem(ADMIN_KEY);
        if (savedAdmin) {
          const parsed = sanitizeSession(JSON.parse(savedAdmin));
          if (parsed?.role === 'ADMIN') {
            if (!cancelled) setAdminSession(parsed as AdminSession);
            setCookie(ADMIN_USER_COOKIE, JSON.stringify({ id: parsed.id, role: parsed.role, nombre: parsed.nombre }), 2);
          } else {
            localStorage.removeItem(ADMIN_KEY);
            if (!cancelled) setAdminSession(null);
          }
        } else if (!cancelled) {
          setAdminSession(null);
        }

        // ✅ Producción persistente.
        // NO depende de TAB_ID, NO se borra con beforeunload y NO se recarga en cada ruta.
        const savedProduction = localStorage.getItem(PROD_KEY);
        if (savedProduction) {
          const parsed = sanitizeSession(JSON.parse(savedProduction));

          const isProd =
            ROLES_EMPLEADO_PERMITIDOS.includes(parsed.role as EmpleadoRole) &&
            typeof parsed.codigo === 'string' &&
            parsed.codigo.trim().length > 0 &&
            parsed.isActive !== false;

          if (isProd) {
            if (!cancelled) setProductionSession(parsed as ProductionSession);
            setCookie(PROD_COOKIE, JSON.stringify({ role: parsed.role, codigo: parsed.codigo }), 2);
            devLog('✅ Sesión producción cargada');
          } else {
            devWarn('⚠️ Sesión producción inválida, limpiando');
            localStorage.removeItem(PROD_KEY);
            deleteCookie(PROD_COOKIE);
            if (!cancelled) setProductionSession(null);
          }
        } else if (!cancelled) {
          setProductionSession(null);
        }
      } catch (error) {
        devError('Error loading sessions:', error);
        localStorage.removeItem(PROD_KEY);
        deleteCookie(PROD_COOKIE);
        if (!cancelled) setProductionSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadSessions();

    return () => {
      cancelled = true;
    };
    // IMPORTANTE: no depende de pathname. Si depende de pathname, al moverte entre páginas
    // vuelve a poner loading=true y algunos guards alcanzan a redirigir al login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===============================
  // Sync entre pestañas del mismo dominio
  // ===============================
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROD_KEY) {
        if (!event.newValue) {
          setProductionSession(null);
          deleteCookie(PROD_COOKIE);
          return;
        }
        try {
          const parsed = sanitizeSession(JSON.parse(event.newValue));
          if (ROLES_EMPLEADO_PERMITIDOS.includes(parsed.role as EmpleadoRole) && parsed.codigo) {
            setProductionSession(parsed as ProductionSession);
            setCookie(PROD_COOKIE, JSON.stringify({ role: parsed.role, codigo: parsed.codigo }), 2);
          }
        } catch {}
      }

      if (event.key === ADMIN_KEY) {
        if (!event.newValue) {
          setAdminSession(null);
          deleteCookie(ADMIN_AUTH_COOKIE);
          deleteCookie(ADMIN_USER_COOKIE);
          return;
        }
        try {
          const parsed = sanitizeSession(JSON.parse(event.newValue));
          if (parsed.role === 'ADMIN') setAdminSession(parsed as AdminSession);
        } catch {}
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ===============================
  // LOGIN ADMIN (Firebase Auth + Firestore) + Cookies p/ Middleware
  // ===============================
  const loginAdmin = useCallback(
    async (email: string, password: string): Promise<void> => {
      setLoading(true);
      try {
        devLog(`🔐 [Tab ${TAB_ID}] Intentando login admin:`, email);

        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const firebaseUser = userCredential.user;

        const userDoc = await getDoc(doc(db, COLECCIONES.USUARIOS, firebaseUser.uid));

        let userData: any;

        if (userDoc.exists()) {
          userData = userDoc.data();
        } else {
          // crear doc admin si no existe
          userData = {
            nombre: 'Administrador',
            email: firebaseUser.email,
            role: 'ADMIN',
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(doc(db, COLECCIONES.USUARIOS, firebaseUser.uid), userData);
        }

        if (String(userData.role).toUpperCase() !== 'ADMIN') {
          await signOut(auth);
          throw new Error('No tienes permisos de administrador');
        }

        const sessionUser: AdminSession = sanitizeSession({
          id: firebaseUser.uid,
          nombre: userData.nombre || 'Administrador',
          role: 'ADMIN',
          isActive: userData.isActive !== false,
          email: firebaseUser.email || email,
          codigo: userData.codigo,
          empleadoId: userData.empleadoId,
          createdAt: userData.createdAt?.toDate?.() || new Date(),
          updatedAt: userData.updatedAt?.toDate?.() || new Date(),
          loggedInAt: new Date(),
          tabId: TAB_ID,
        }) as AdminSession;

        setAdminSession(sessionUser);
        localStorage.setItem(ADMIN_KEY, JSON.stringify(sessionUser));

        // ✅ Cookies para middleware /admin
        setCookie(ADMIN_AUTH_COOKIE, firebaseUser.uid, 7);
        setCookie(
          ADMIN_USER_COOKIE,
          JSON.stringify({
            id: sessionUser.id,
            role: sessionUser.role,
            nombre: sessionUser.nombre,
            email: sessionUser.email,
          }),
          7
        );

        setTimeout(() => router.replace('/admin/dashboard'), 80);
      } catch (error: any) {
        devError('🔥 Error login admin:', error);

        const errorMessages: Record<string, string> = {
          'auth/user-not-found': 'Usuario no encontrado',
          'auth/wrong-password': 'Contraseña incorrecta',
          'auth/invalid-email': 'Correo inválido',
          'auth/user-disabled': 'Usuario deshabilitado',
          'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde',
        };

        throw new Error(errorMessages[error.code] || error.message || 'Error de autenticación');
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  // ===============================
  // LOGIN EMPLEADO (PROD)
  // ===============================
  const loginProduction = useCallback(
    async (codigo: string, pin: string): Promise<void> => {
      setLoading(true);
      try {
        const cod = normalizeCodigo(codigo);
        const pinIngresado = String(pin || '').trim();

        devLog(`🔐 [Tab ${TAB_ID}] Login empleado (PRO):`, { codigo: cod });

        if (!cod) throw new Error('Selecciona tu empleado');
        if (!isPin4(pinIngresado)) throw new Error('El PIN debe ser numérico de 4 dígitos');

        // 1) docId primero
        let empleadoSnap = await getDoc(doc(db, 'empleados', cod));
        let data: any = null;

        if (empleadoSnap.exists()) {
          data = empleadoSnap.data() || {};
        } else {
          // 2) fallback legacy
          const empleadosRef = collection(db, 'empleados');
          const qy = query(empleadosRef, where('codigo', '==', cod), limit(1));
          const snap = await getDocs(qy);

          if (snap.empty) throw new Error(`Empleado "${cod}" no encontrado`);

          empleadoSnap = snap.docs[0] as any;
          data = empleadoSnap.data() || {};
        }

        const role = String(data.role || 'PRODUCCION').toUpperCase() as EmpleadoRole;

        if (!ROLES_EMPLEADO_PERMITIDOS.includes(role)) {
          throw new Error('Este usuario no tiene permisos para entrar aquí');
        }

        if (data.isActive === false) {
          throw new Error('Usuario desactivado. Contacta al administrador.');
        }

        // PIN seguro
        const salt = String(data.pinSalt ?? '').trim();
        const storedHash = String(data.pinHash ?? '').trim();

        if (!salt || !storedHash) {
          throw new Error('Usuario no tiene PIN configurado. Contacta al administrador.');
        }

        const computed = await hashPin(pinIngresado, salt);
        if (computed !== storedHash) {
          throw new Error('PIN incorrecto.');
        }

        const sessionUser: ProductionSession = sanitizeSession({
          id: empleadoSnap.id,
          nombre: data.nombre || cod,
          role,
          isActive: data.isActive !== false,
          email: data.email || `${cod.toLowerCase()}@hielo.local`,
          codigo: String(data.codigo || cod),
          empleadoId: data.empleadoId || data.codigo || cod,
          createdAt: data.createdAt?.toDate?.() || new Date(),
          updatedAt: data.updatedAt?.toDate?.() || new Date(),
          loggedInAt: new Date(),
          tabId: TAB_ID,
          lastActivity: Date.now(),
        }) as ProductionSession;

        setProductionSession(sessionUser);

        localStorage.setItem(PROD_KEY, JSON.stringify(sessionUser));

        setCookie(PROD_COOKIE, JSON.stringify({ role: sessionUser.role, codigo: sessionUser.codigo }), 2);

        if (sessionUser.role === 'TRANSPORTE' || sessionUser.role === 'CHOFER') {
          setTimeout(() => router.replace('/transporte/dashboard'), 60);
        } else {
          setTimeout(() => router.replace('/produccion/dashboard'), 60);
        }
      } catch (error: any) {
        devError('🔥 Error login empleado:', error);
        throw new Error(error?.message || 'Error en el sistema de autenticación');
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  // ===============================
  // LOGOUTS
  // ===============================
  const logoutAdmin = useCallback(() => {
    devLog(`👋 [Tab ${TAB_ID}] Cerrando sesión admin`);
    setAdminSession(null);
    localStorage.removeItem(ADMIN_KEY);

    deleteCookie(ADMIN_AUTH_COOKIE);
    deleteCookie(ADMIN_USER_COOKIE);

    // Firebase signOut (esto sí es global para auth)
    signOut(auth).catch(devError);
  }, []);

  const logoutProduction = useCallback(() => {
    devLog(`👋 [Tab ${TAB_ID}] Cerrando sesión empleado`);
    setProductionSession(null);

    localStorage.removeItem(PROD_KEY);

    deleteCookie(PROD_COOKIE);
  }, []);

  const logout = useCallback(() => {
    logoutAdmin();
    logoutProduction();
  }, [logoutAdmin, logoutProduction]);

  // ===============================
  // EMPLEADOS (para listados admin)
  // ===============================
  const loadEmpleados = useCallback(async (force = false): Promise<AuthUserBase[]> => {
    try {
      devLog('📥 Cargando empleados (OPT)...');

      if (!force) {
        const cached = readEmpleadosCache();
        if (cached?.length) {
          setEmpleados(cached);
          return cached;
        }
      }

      const empleadosRef = collection(db, 'empleados');
      const qy = query(empleadosRef, where('isActive', '==', true));
      const snap = await getDocs(qy);

      const empleadosData: AuthUserBase[] = snap.docs.map((d) => {
        const data: any = d.data();
        return sanitizeSession({
          id: d.id,
          nombre: data.nombre || '',
          role: (String(data.role || 'PRODUCCION').toUpperCase() as EmpleadoRole) || 'PRODUCCION',
          isActive: data.isActive !== false,
          email: data.email,
          codigo: data.codigo,
          empleadoId: data.empleadoId || data.codigo || d.id.slice(-6),
          createdAt: data.createdAt?.toDate?.() || new Date(),
          updatedAt: data.updatedAt?.toDate?.() || new Date(),
        });
      });

      empleadosData.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

      setEmpleados(empleadosData);
      writeEmpleadosCache(empleadosData);
      return empleadosData;
    } catch (error) {
      devError('❌ Error cargando empleados:', error);
      return [];
    }
  }, []);

  // ===============================
  // GET EMPLEADO
  // ===============================
  const getEmpleadoById = useCallback(
    async (idOrCodigo: string): Promise<AuthUserBase | null> => {
      try {
        const key = normalizeCodigo(idOrCodigo);

        const cached =
          empleados.find((e) => normalizeCodigo(e.id) === key) ||
          empleados.find((e) => normalizeCodigo(e.codigo || '') === key) ||
          empleados.find((e) => normalizeCodigo(e.empleadoId || '') === key);

        if (cached) return cached;

        const snap = await getDoc(doc(db, 'empleados', idOrCodigo));
        if (snap.exists()) {
          const data: any = snap.data();
          return sanitizeSession({
            id: snap.id,
            nombre: data.nombre || '',
            role: (String(data.role || 'PRODUCCION').toUpperCase() as EmpleadoRole) || 'PRODUCCION',
            isActive: data.isActive !== false,
            email: data.email,
            codigo: data.codigo,
            empleadoId: data.empleadoId || data.codigo || snap.id.slice(-6),
            createdAt: data.createdAt?.toDate?.() || new Date(),
            updatedAt: data.updatedAt?.toDate?.() || new Date(),
          });
        }

        const empleadosRef = collection(db, 'empleados');
        const qCodigo = query(empleadosRef, where('codigo', '==', key), limit(1));
        const snapCodigo = await getDocs(qCodigo);

        if (!snapCodigo.empty) {
          const d = snapCodigo.docs[0];
          const data: any = d.data();
          return sanitizeSession({
            id: d.id,
            nombre: data.nombre || '',
            role: (String(data.role || 'PRODUCCION').toUpperCase() as EmpleadoRole) || 'PRODUCCION',
            isActive: data.isActive !== false,
            email: data.email,
            codigo: data.codigo,
            empleadoId: data.empleadoId || data.codigo || d.id.slice(-6),
            createdAt: data.createdAt?.toDate?.() || new Date(),
            updatedAt: data.updatedAt?.toDate?.() || new Date(),
          });
        }

        return null;
      } catch (error) {
        devError('Error obteniendo empleado:', error);
        return null;
      }
    },
    [empleados]
  );

  // ===============================
  // ROUTE USER
  // ===============================
  const getUserForRoute = useCallback(
    (route: string): AuthUserBase | null => {
      if (route.startsWith('/admin')) return adminSession;
      if (route.startsWith('/produccion')) return productionSession;
      if (route.startsWith('/transporte')) return productionSession;
      return adminSession || productionSession;
    },
    [adminSession, productionSession]
  );

  // ✅ CAMBIO: usar pathname (no window.location)
  const user = useMemo(() => {
    return getUserForRoute(pathname);
  }, [getUserForRoute, pathname]);

  // ===============================
  // ACTIVITY (empleado)
  // ===============================
  const updateLastActivity = useCallback(() => {
    if (!productionSession) return;

    const updated: ProductionSession = {
      ...productionSession,
      lastActivity: Date.now(),
    };

    setProductionSession(updated);
    localStorage.setItem(PROD_KEY, JSON.stringify(updated));
  }, [productionSession]);

  // ===============================
  // CACHE
  // ===============================
  const clearCache = useCallback(() => {
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem(PROD_KEY);
    localStorage.removeItem(EMP_CACHE_KEY);

    setAdminSession(null);
    setProductionSession(null);
    setEmpleados([]);

    deleteCookie(ADMIN_AUTH_COOKIE);
    deleteCookie(ADMIN_USER_COOKIE);
    deleteCookie(PROD_COOKIE);
  }, []);

  const getTabId = useCallback(() => TAB_ID, []);

  const contextValue: AuthContextType = {
    adminSession,
    productionSession,
    loginAdmin,
    loginProduction,
    logoutAdmin,
    logoutProduction,
    logout,
    isAdminLoggedIn: !!adminSession,
    isProductionLoggedIn: !!productionSession,
    hasMultipleSessions: !!adminSession && !!productionSession,
    loading,
    user,
    empleados,
    loadEmpleados,
    getEmpleadoById,
    getUserForRoute,
    updateLastActivity,
    clearCache,
    getTabId,
  };

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthContext debe usarse dentro de AuthProvider');
  return context;
}