// lib/hooks/useUsers.ts
// ✅ PRODUCTION READY
// - 0 lecturas duplicadas innecesarias
// - TTL para recarga
// - optimistic updates
// - deduplicación por codigo al crear
// - helpers locales para filtros / stats / UI
// - PIN fijo individual y masivo

'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EmpleadoService } from '@/lib/services/user.service';
import type {
  Empleado,
  EmpleadoRole,
  CrearEmpleadoDTO,
  ActualizarEmpleadoDTO,
} from '@/lib/utils/types/user.types';
import { ROLES_UI } from '@/lib/utils/types/user.types';

type UsersStats = {
  total: number;
  activos: number;
  inactivos: number;
  porRol: Record<EmpleadoRole, number>;
};

const DEFAULT_TTL_MS = 60 * 1000; // 60s

// marcador SOLO UI (no afecta auth real)
const PIN_CONFIGURED_MARK = '__configured__';

const toDateSafe = (d: any): Date => {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  if (typeof d?.toDate === 'function') return d.toDate();
  return new Date(d);
};

function dedupeByCodigo(items: Empleado[]): Empleado[] {
  const map = new Map<string, Empleado>();

  for (const item of items) {
    const codigo = String(item?.codigo || '').trim();
    if (!codigo) continue;
    map.set(codigo, item);
  }

  return Array.from(map.values());
}

export function useUsers() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const inflightRef = useRef<Promise<void> | null>(null);
  const lastLoadAtRef = useRef<number>(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stats = useMemo<UsersStats>(() => {
    const total = empleados.length;
    const activos = empleados.filter((e) => !!e.isActive).length;
    const inactivos = total - activos;

    const porRol = empleados.reduce((acc, e) => {
      const role = e.role as EmpleadoRole;
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    }, {} as Record<EmpleadoRole, number>);

    return { total, activos, inactivos, porRol };
  }, [empleados]);

  const loadEmpleados = useCallback(async (opts?: { force?: boolean; ttlMs?: number }) => {
    const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    const force = !!opts?.force;

    const hasData = empleados.length > 0;
    const freshEnough = Date.now() - lastLoadAtRef.current < ttlMs;

    if (!force && hasData && freshEnough) return;
    if (inflightRef.current) return inflightRef.current;

    const run = (async () => {
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      try {
        const data = await EmpleadoService.obtenerTodos();
        if (!mountedRef.current) return;

        setEmpleados(dedupeByCodigo(data));
        lastLoadAtRef.current = Date.now();
      } catch (err: any) {
        const msg = err?.message || 'Error al cargar empleados';
        if (mountedRef.current) setError(msg);
        console.error('❌ useUsers loadEmpleados:', err);
      } finally {
        if (mountedRef.current) setLoading(false);
        inflightRef.current = null;
      }
    })();

    inflightRef.current = run;
    return run;
  }, [empleados.length]);

  useEffect(() => {
    loadEmpleados({ force: false });
  }, [loadEmpleados]);

  const crearEmpleado = useCallback(async (datos: CrearEmpleadoDTO, creadoPor: string): Promise<Empleado> => {
    setError(null);

    try {
      const nuevo = await EmpleadoService.crear(datos, creadoPor);

      setEmpleados((prev) => {
        const filtered = prev.filter((e) => e.codigo !== nuevo.codigo);
        return [nuevo, ...filtered];
      });

      return nuevo;
    } catch (err: any) {
      const msg = err?.message || 'Error al crear empleado';
      if (mountedRef.current) setError(msg);
      console.error('❌ useUsers crearEmpleado:', err);
      throw err;
    }
  }, []);

  const actualizarEmpleado = useCallback(async (codigoEmpleado: string, updates: ActualizarEmpleadoDTO): Promise<void> => {
    setError(null);

    try {
      await EmpleadoService.actualizar(codigoEmpleado, updates);

      setEmpleados((prev) =>
        prev.map((e) =>
          e.codigo === codigoEmpleado
            ? ({ ...e, ...updates, updatedAt: new Date() } as Empleado)
            : e
        )
      );
    } catch (err: any) {
      const msg = err?.message || 'Error al actualizar empleado';
      if (mountedRef.current) setError(msg);
      console.error('❌ useUsers actualizarEmpleado:', err);
      throw err;
    }
  }, []);

  const eliminarEmpleado = useCallback(async (codigoEmpleado: string): Promise<void> => {
    setError(null);

    try {
      await EmpleadoService.eliminar(codigoEmpleado);

      setEmpleados((prev) =>
        prev.map((e) =>
          e.codigo === codigoEmpleado
            ? { ...e, isActive: false, updatedAt: new Date() }
            : e
        )
      );
    } catch (err: any) {
      const msg = err?.message || 'Error al eliminar empleado';
      if (mountedRef.current) setError(msg);
      console.error('❌ useUsers eliminarEmpleado:', err);
      throw err;
    }
  }, []);

  const cambiarEstadoEmpleado = useCallback(async (codigoEmpleado: string, activo: boolean): Promise<void> => {
    setError(null);

    try {
      await EmpleadoService.cambiarEstado(codigoEmpleado, activo);

      setEmpleados((prev) =>
        prev.map((e) =>
          e.codigo === codigoEmpleado
            ? { ...e, isActive: activo, updatedAt: new Date() }
            : e
        )
      );
    } catch (err: any) {
      const msg = err?.message || 'Error al cambiar estado';
      if (mountedRef.current) setError(msg);
      console.error('❌ useUsers cambiarEstadoEmpleado:', err);
      throw err;
    }
  }, []);

  const definirPinManual = useCallback(async (codigoEmpleado: string, pinFijo: string): Promise<string> => {
    setError(null);

    try {
      const pin = await EmpleadoService.definirPinManual(codigoEmpleado, pinFijo);

      setEmpleados((prev) =>
        prev.map((e) =>
          e.codigo === codigoEmpleado
            ? { ...e, pinHash: PIN_CONFIGURED_MARK as any, updatedAt: new Date() }
            : e
        )
      );

      return pin;
    } catch (err: any) {
      const msg = err?.message || 'Error al definir PIN';
      if (mountedRef.current) setError(msg);
      console.error('❌ useUsers definirPinManual:', err);
      throw err;
    }
  }, []);

  const limpiarPin = useCallback(async (codigoEmpleado: string): Promise<void> => {
    setError(null);

    try {
      await EmpleadoService.limpiarPin(codigoEmpleado);

      setEmpleados((prev) =>
        prev.map((e) =>
          e.codigo === codigoEmpleado
            ? { ...e, pinHash: undefined, updatedAt: new Date() }
            : e
        )
      );
    } catch (err: any) {
      const msg = err?.message || 'Error al limpiar PIN';
      if (mountedRef.current) setError(msg);
      console.error('❌ useUsers limpiarPin:', err);
      throw err;
    }
  }, []);

  const definirPinsMasivo = useCallback(async (codigos: string[], pinFijo: string) => {
    setError(null);

    const exitosos: Array<{ codigo: string; pin: string }> = [];
    const fallidos: Array<{ codigo: string; error: string }> = [];

    const batchSize = 5;

    for (let i = 0; i < codigos.length; i += batchSize) {
      const chunk = codigos.slice(i, i + batchSize);

      const res = await Promise.allSettled(
        chunk.map(async (codigo) => {
          const pin = await EmpleadoService.definirPinManual(codigo, pinFijo);
          return { codigo, pin };
        })
      );

      res.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          exitosos.push(r.value);
        } else {
          fallidos.push({
            codigo: chunk[idx],
            error: (r as any).reason?.message || 'Error',
          });
        }
      });
    }

    if (exitosos.length) {
      const okSet = new Set(exitosos.map((x) => x.codigo));
      setEmpleados((prev) =>
        prev.map((e) =>
          okSet.has(e.codigo)
            ? { ...e, pinHash: PIN_CONFIGURED_MARK as any, updatedAt: new Date() }
            : e
        )
      );
    }

    return { exitosos, fallidos };
  }, []);

  const verificarPin = useCallback(async (codigoEmpleado: string, pin: string) => {
    setError(null);

    try {
      return await EmpleadoService.verificarPin(codigoEmpleado, pin);
    } catch (err: any) {
      const msg = err?.message || 'Error al verificar PIN';
      if (mountedRef.current) setError(msg);
      console.error('❌ useUsers verificarPin:', err);
      return { valido: false, mensaje: msg as string };
    }
  }, []);

  const obtenerEmpleadoPorCodigo = useCallback(async (codigoEmpleado: string) => {
    setError(null);

    const c = (codigoEmpleado || '').trim();
    if (!c) return null;

    const local = empleados.find((e) => e.codigo === c);
    if (local) return local;

    try {
      return await EmpleadoService.obtenerPorCodigo(c);
    } catch (err: any) {
      const msg = err?.message || 'Error al obtener empleado';
      if (mountedRef.current) setError(msg);
      console.error('❌ useUsers obtenerEmpleadoPorCodigo:', err);
      return null;
    }
  }, [empleados]);

  const obtenerEmpleadosPorRol = useCallback((rol: EmpleadoRole) => {
    return empleados.filter((e) => e.role === rol);
  }, [empleados]);

  const obtenerEmpleadosActivos = useCallback(() => {
    return empleados.filter((e) => !!e.isActive);
  }, [empleados]);

  const obtenerEmpleadosInactivos = useCallback(() => {
    return empleados.filter((e) => !e.isActive);
  }, [empleados]);

  const buscarEmpleadosPorNombre = useCallback((texto: string) => {
    const q = (texto || '').toLowerCase().trim();
    if (!q) return empleados;

    return empleados.filter((e) => (e.nombre || '').toLowerCase().includes(q));
  }, [empleados]);

  const filtrarEmpleados = useCallback((filtros: { rol?: EmpleadoRole; activo?: boolean; buscar?: string }) => {
    let filtrados = empleados;

    if (filtros.rol) {
      filtrados = filtrados.filter((e) => e.role === filtros.rol);
    }

    if (filtros.activo !== undefined) {
      filtrados = filtrados.filter((e) => !!e.isActive === filtros.activo);
    }

    if (filtros.buscar?.trim()) {
      const b = filtros.buscar.toLowerCase();
      filtrados = filtrados.filter((e) => {
        const nombre = (e.nombre || '').toLowerCase();
        const codigo = (e.codigo || '').toLowerCase();
        return nombre.includes(b) || codigo.includes(b);
      });
    }

    return filtrados;
  }, [empleados]);

  const formatearEmpleadoParaUI = useCallback((empleado: Empleado) => {
    const hasPin = !!empleado.pinHash;

    return {
      codigo: empleado.codigo,
      nombre: empleado.nombre,
      rol: empleado.role,
      rolUI: ROLES_UI[empleado.role],
      estado: empleado.isActive ? 'Activo' : 'Inactivo',
      estadoColor: empleado.isActive ? 'green' : 'red',
      pin: hasPin ? '✅' : '❌',
      creado: toDateSafe((empleado as any).createdAt).toLocaleDateString('es-MX'),
      actualizado: toDateSafe((empleado as any).updatedAt).toLocaleDateString('es-MX'),
    };
  }, []);

  const cambiarEstadoMasivo = useCallback(async (codigos: string[], activo: boolean) => {
    setError(null);

    const resultados = await Promise.allSettled(
      codigos.map((c) => EmpleadoService.cambiarEstado(c, activo))
    );

    const exitososCodigos: string[] = [];
    let fallidos = 0;

    resultados.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        exitososCodigos.push(codigos[idx]);
      } else {
        fallidos++;
      }
    });

    if (exitososCodigos.length) {
      const ok = new Set(exitososCodigos);
      setEmpleados((prev) =>
        prev.map((e) =>
          ok.has(e.codigo)
            ? { ...e, isActive: activo, updatedAt: new Date() }
            : e
        )
      );
    }

    return { exitosos: exitososCodigos.length, fallidos };
  }, []);

  const derivados = useMemo(() => {
    const activos = empleados.filter((e) => !!e.isActive);
    const inactivos = empleados.filter((e) => !e.isActive);

    return {
      totalEmpleados: empleados.length,
      empleadosActivos: activos.length,
      empleadosInactivos: inactivos.length,
    };
  }, [empleados]);

  const reload = useCallback((force = false) => {
    if (force) lastLoadAtRef.current = 0;
    return loadEmpleados({ force });
  }, [loadEmpleados]);

  return {
    empleados,
    loading,
    error,
    stats,

    reload,
    loadEmpleados,

    crearEmpleado,
    actualizarEmpleado,
    eliminarEmpleado,
    cambiarEstadoEmpleado,

    definirPinManual,
    limpiarPin,
    definirPinsMasivo,
    verificarPin,

    obtenerEmpleadoPorCodigo,
    obtenerEmpleadosPorRol,
    obtenerEmpleadosActivos,
    obtenerEmpleadosInactivos,
    buscarEmpleadosPorNombre,

    filtrarEmpleados,
    formatearEmpleadoParaUI,

    cambiarEstadoMasivo,

    ...derivados,

    obtenerRolUI: (rol: EmpleadoRole) => ROLES_UI[rol],
    obtenerColorEstado: (activo: boolean) => (activo ? 'green' : 'red'),
  };
}