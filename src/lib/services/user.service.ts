// lib/services/user.service.ts
// ✅ PRODUCTION READY
// - Usuarios con codigo secuencial persistente: USR001, USR002, ...
// - Firestore lleva el contador real en system_counters/usuarios
// - Se evita sobrescribir usuarios existentes
// - PIN seguro con hash + salt
// - Compatibilidad con docs legacy por codigo
// - codigo sigue como docId para no romper tu app actual
// - ✅ Si el role es TRANSPORTE, sincroniza automáticamente con entregas

'use client';

import { db } from '@/lib/firebase/config.client';
import {
  collection,
  getDocs,
  getDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  limit,
  doc,
  runTransaction,
  type DocumentData,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import type {
  Empleado,
  CrearEmpleadoDTO,
  ActualizarEmpleadoDTO,
  EmpleadoRole,
} from '@/lib/utils/types/user.types';

import { validarEmpleado, validarPin } from '@/lib/utils/validators';

async function syncTransporteToDeliveries(input: {
  codigo: string;
  nombre: string;
  isActive: boolean;
}) {
  const res = await fetch('/api/sync/transport-to-deliveries', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'No se pudo sincronizar transporte con entregas');
  }

  return data;
}

// ========== CONFIG ==========
const COLECCIONES = {
  EMPLEADOS: 'empleados',
  COUNTERS: 'system_counters',
} as const;

const COUNTER_DOCS = {
  USUARIOS: 'usuarios',
} as const;

// ========== CRYPTO (PIN HASH + SALT) ==========
function randomSalt(len = 16) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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

// ========== REFS ==========
function empleadosColRef() {
  return collection(db, COLECCIONES.EMPLEADOS);
}

function empleadoDocRefByCodigo(codigo: string) {
  return doc(db, COLECCIONES.EMPLEADOS, codigo);
}

function usuariosCounterRef() {
  return doc(db, COLECCIONES.COUNTERS, COUNTER_DOCS.USUARIOS);
}

// ========== CACHE (para legacy IDs random, evitar repetir queries) ==========
type CacheEntry = { ref: DocumentReference<DocumentData>; ts: number };
const REF_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGetRef(codigo: string): DocumentReference<DocumentData> | null {
  const e = REF_CACHE.get(codigo);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    REF_CACHE.delete(codigo);
    return null;
  }
  return e.ref;
}

function cacheSetRef(codigo: string, ref: DocumentReference<DocumentData>) {
  REF_CACHE.set(codigo, { ref, ts: Date.now() });
}

// ========== DATE SAFE ==========
function toDateSafe(v: any): Date {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  return new Date(v);
}

// ========== MAPPERS ==========
function mapEmpleadoFromDoc(docSnap: QueryDocumentSnapshot<DocumentData>): Empleado {
  const data = docSnap.data() ?? {};
  const codigo = String(data.codigo ?? docSnap.id ?? '');

  return {
    codigo,
    nombre: String(data.nombre ?? ''),
    role: (data.role ?? 'PRODUCCION') as EmpleadoRole,
    isActive: data.isActive !== false,

    pin: '',
    pinHash: typeof data.pinHash === 'string' && data.pinHash ? data.pinHash : undefined,

    createdAt: toDateSafe(data.createdAt),
    updatedAt: toDateSafe(data.updatedAt),

    creadoPor: String(data.creadoPor ?? 'admin'),
  };
}

function mapEmpleadoFromGetDoc(codigo: string, data: any): Empleado {
  return {
    codigo: String(data?.codigo ?? codigo ?? ''),
    nombre: String(data?.nombre ?? ''),
    role: (data?.role ?? 'PRODUCCION') as EmpleadoRole,
    isActive: data?.isActive !== false,

    pin: '',
    pinHash: typeof data?.pinHash === 'string' && data.pinHash ? data.pinHash : undefined,

    createdAt: toDateSafe(data?.createdAt),
    updatedAt: toDateSafe(data?.updatedAt),

    creadoPor: String(data?.creadoPor ?? 'admin'),
  };
}

// ========== HELPERS ==========
function formatearCodigoUsuario(n: number): string {
  return `USR${String(n).padStart(3, '0')}`;
}

// ========== SERVICE ==========
export class EmpleadoService {
  // =========================
  // LECTURAS
  // =========================
  static async obtenerTodos(): Promise<Empleado[]> {
    try {
      const q = query(empleadosColRef(), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(mapEmpleadoFromDoc);
    } catch (error) {
      console.error('❌ Error al obtener empleados:', error);
      throw new Error('Error al cargar la lista de empleados');
    }
  }

  static async obtenerActivos(): Promise<Empleado[]> {
    try {
      const q = query(
        empleadosColRef(),
        where('isActive', '==', true),
        orderBy('nombre', 'asc')
      );
      const snap = await getDocs(q);
      return snap.docs.map(mapEmpleadoFromDoc);
    } catch (error) {
      console.error('❌ Error al obtener empleados activos:', error);
      return [];
    }
  }

  static async obtenerPorCodigo(codigoEmpleado: string): Promise<Empleado | null> {
    try {
      const codigo = (codigoEmpleado || '').trim();
      if (!codigo) return null;

      const directRef = empleadoDocRefByCodigo(codigo);
      const directSnap = await getDoc(directRef);

      if (directSnap.exists()) {
        cacheSetRef(codigo, directRef);
        return mapEmpleadoFromGetDoc(codigo, directSnap.data());
      }

      const q = query(empleadosColRef(), where('codigo', '==', codigo), limit(1));
      const snap = await getDocs(q);

      if (snap.empty) return null;

      const legacyDoc = snap.docs[0];
      cacheSetRef(codigo, legacyDoc.ref);
      return mapEmpleadoFromDoc(legacyDoc);
    } catch (error) {
      console.error('❌ Error al obtener empleado por código:', error);
      return null;
    }
  }

  static async obtenerPorRol(role: EmpleadoRole): Promise<Empleado[]> {
    try {
      const q = query(
        empleadosColRef(),
        where('role', '==', role),
        where('isActive', '==', true),
        orderBy('nombre', 'asc')
      );
      const snap = await getDocs(q);
      return snap.docs.map(mapEmpleadoFromDoc);
    } catch (error) {
      console.error('❌ Error al obtener empleados por rol:', error);
      return [];
    }
  }

  static async buscarPorNombre(nombre: string): Promise<Empleado[]> {
    try {
      const busqueda = (nombre || '').toLowerCase().trim();
      if (!busqueda) return [];

      const activos = await this.obtenerActivos();
      return activos.filter((e) => (e.nombre || '').toLowerCase().includes(busqueda));
    } catch (error) {
      console.error('❌ Error al buscar empleados:', error);
      return [];
    }
  }

  // =========================
  // ESCRITURAS
  // =========================
  static async crear(dto: CrearEmpleadoDTO, creadoPor: string): Promise<Empleado> {
    try {
      const validacion = validarEmpleado(dto as any);
      if (!validacion.valido) {
        throw new Error(`Errores de validación: ${validacion.errores.join(', ')}`);
      }

      const pinValido = validarPin((dto as any).pin);
      if (!pinValido.valido) {
        throw new Error(pinValido.mensaje);
      }

      const now = new Date();
      const salt = randomSalt(16);
      const pinHash = await hashPin(String((dto as any).pin || '').trim(), salt);

      const empleadoUI = await runTransaction(db, async (transaction) => {
        const counterRef = usuariosCounterRef();
        const counterSnap = await transaction.get(counterRef);

        let next = 1;

        if (!counterSnap.exists()) {
          transaction.set(counterRef, {
            next: 2,
            updatedAt: serverTimestamp(),
          });
        } else {
          const data = counterSnap.data() ?? {};
          next = Number(data.next ?? 1);

          if (!Number.isFinite(next) || next < 1) {
            next = 1;
          }

          transaction.update(counterRef, {
            next: next + 1,
            updatedAt: serverTimestamp(),
          });
        }

        const codigo = formatearCodigoUsuario(next);
        const ref = empleadoDocRefByCodigo(codigo);

        const existente = await transaction.get(ref);
        if (existente.exists()) {
          throw new Error(`Ya existe un usuario con el código ${codigo}.`);
        }

        const empleadoData = {
          codigo,
          nombre: (dto.nombre || '').trim(),
          role: dto.role,
          isActive: (dto as any).isActive !== false,

          pinSalt: salt,
          pinHash,

          creadoPor: (creadoPor || 'admin').toString(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        transaction.set(ref, empleadoData);
        cacheSetRef(codigo, ref);

        const empleadoReturn: Empleado = {
          codigo,
          nombre: empleadoData.nombre,
          role: empleadoData.role,
          isActive: empleadoData.isActive,
          pin: '',
          pinHash,
          creadoPor: empleadoData.creadoPor,
          createdAt: now,
          updatedAt: now,
        };

        return empleadoReturn;
      });

      // ✅ sincroniza solo si es transporte
      if (empleadoUI.role === 'TRANSPORTE') {
        try {
          await syncTransporteToDeliveries({
            codigo: empleadoUI.codigo,
            nombre: empleadoUI.nombre,
            isActive: empleadoUI.isActive,
          });
        } catch (syncError) {
          console.error('❌ Error sincronizando transporte con entregas:', syncError);
        }
      }

      return empleadoUI;
    } catch (error: any) {
      console.error('❌ Error al crear empleado:', error);

      if (error?.code === 'permission-denied') {
        throw new Error('No tienes permisos para crear empleados');
      }

      throw new Error(error?.message || 'Error al crear el empleado');
    }
  }

  static async actualizar(codigoEmpleado: string, updates: ActualizarEmpleadoDTO): Promise<void> {
    try {
      const codigo = (codigoEmpleado || '').trim();
      if (!codigo) throw new Error('Código de empleado requerido');

      const ref = await this.obtenerRefPorCodigoFast(codigo);
      if (!ref) throw new Error('Empleado no encontrado');

      const patch: any = { ...updates };
      delete patch.pin;
      delete patch.pinHash;
      delete patch.pinSalt;
      delete patch.codigo;

      await updateDoc(ref, {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (error: any) {
      console.error('❌ Error al actualizar empleado:', error);
      throw new Error(error?.message || 'Error al actualizar el empleado');
    }
  }

  static async eliminar(codigoEmpleado: string): Promise<void> {
    return this.cambiarEstado(codigoEmpleado, false);
  }

  static async cambiarEstado(codigoEmpleado: string, activo: boolean): Promise<void> {
    try {
      const codigo = (codigoEmpleado || '').trim();
      if (!codigo) throw new Error('Código de empleado requerido');

      const ref = await this.obtenerRefPorCodigoFast(codigo);
      if (!ref) throw new Error('Empleado no encontrado');

      await updateDoc(ref, {
        isActive: activo,
        updatedAt: serverTimestamp(),
      });
    } catch (error: any) {
      console.error('❌ Error al cambiar estado:', error);
      throw new Error(error?.message || 'Error al cambiar estado');
    }
  }

  // =========================
  // AUTH (PIN)
  // =========================
  static async verificarPin(
    codigoEmpleado: string,
    pin: string
  ): Promise<{ valido: boolean; empleado?: Empleado; mensaje?: string }> {
    try {
      const codigo = (codigoEmpleado || '').trim();
      if (!codigo) return { valido: false, mensaje: 'Código requerido' };

      const pinValido = validarPin(pin);
      if (!pinValido.valido) return { valido: false, mensaje: pinValido.mensaje };

      const directRef = empleadoDocRefByCodigo(codigo);
      const directSnap = await getDoc(directRef);

      let data: any = null;
      let empleado: Empleado | null = null;

      if (directSnap.exists()) {
        cacheSetRef(codigo, directRef);
        data = directSnap.data();

        if (data?.isActive === false) {
          return { valido: false, mensaje: 'Empleado desactivado' };
        }

        empleado = mapEmpleadoFromGetDoc(codigo, data);
      } else {
        const q = query(empleadosColRef(), where('codigo', '==', codigo), limit(1));
        const snap = await getDocs(q);

        if (snap.empty) {
          return { valido: false, mensaje: 'Empleado no encontrado' };
        }

        const legacy = snap.docs[0];
        cacheSetRef(codigo, legacy.ref);
        data = legacy.data();

        if (data?.isActive === false) {
          return { valido: false, mensaje: 'Empleado desactivado' };
        }

        empleado = mapEmpleadoFromDoc(legacy);
      }

      const salt = data?.pinSalt;
      const stored = data?.pinHash;

      if (!salt || !stored) {
        return { valido: false, mensaje: 'PIN no configurado' };
      }

      const computed = await hashPin(pin.trim(), String(salt));
      if (computed !== String(stored)) {
        return { valido: false, mensaje: 'PIN incorrecto' };
      }

      return { valido: true, empleado: empleado ?? undefined };
    } catch (error) {
      console.error('❌ Error al verificar PIN:', error);
      return { valido: false, mensaje: 'Error al verificar credenciales' };
    }
  }

  static async definirPinManual(codigoEmpleado: string, pin: string): Promise<string> {
    try {
      const codigo = (codigoEmpleado || '').trim();
      if (!codigo) throw new Error('Código de empleado requerido');

      const pinValido = validarPin(pin);
      if (!pinValido.valido) throw new Error(pinValido.mensaje);

      const ref = await this.obtenerRefPorCodigoFast(codigo);
      if (!ref) throw new Error('Empleado no encontrado');

      const fijo = pin.trim();
      const salt = randomSalt(16);
      const pinHash = await hashPin(fijo, salt);

      await updateDoc(ref, {
        pinSalt: salt,
        pinHash,
        updatedAt: serverTimestamp(),
      });

      return fijo;
    } catch (error: any) {
      console.error('❌ Error definiendo PIN manual:', error);
      throw new Error(error?.message || 'Error al definir PIN');
    }
  }

  static async limpiarPin(codigoEmpleado: string): Promise<void> {
    try {
      const codigo = (codigoEmpleado || '').trim();
      if (!codigo) throw new Error('Código de empleado requerido');

      const ref = await this.obtenerRefPorCodigoFast(codigo);
      if (!ref) throw new Error('Empleado no encontrado');

      await updateDoc(ref, {
        pinSalt: '',
        pinHash: '',
        updatedAt: serverTimestamp(),
      });
    } catch (error: any) {
      console.error('❌ Error limpiando PIN:', error);
      throw new Error(error?.message || 'Error al limpiar PIN');
    }
  }

  // =========================
  // PRIVADO
  // =========================
  private static async obtenerRefPorCodigoFast(
    codigo: string
  ): Promise<DocumentReference<DocumentData> | null> {
    const c = (codigo || '').trim();
    if (!c) return null;

    const cached = cacheGetRef(c);
    if (cached) return cached;

    const directRef = empleadoDocRefByCodigo(c);
    const directSnap = await getDoc(directRef);

    if (directSnap.exists()) {
      cacheSetRef(c, directRef);
      return directRef;
    }

    try {
      const q = query(empleadosColRef(), where('codigo', '==', c), limit(1));
      const snap = await getDocs(q);

      if (!snap.empty) {
        const ref = snap.docs[0].ref;
        cacheSetRef(c, ref);
        return ref;
      }
    } catch (error) {
      console.warn('⚠️ Fallback query obtenerRefPorCodigoFast:', error);
    }

    return null;
  }
}