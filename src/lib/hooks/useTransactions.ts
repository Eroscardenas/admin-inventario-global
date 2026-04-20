// lib/hooks/useTransactions.ts  ✅ FINAL (PROD READY + alineado a TransactionService nuevo)
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import * as TxModule from '@/lib/services/transaction.service'; // ✅ agnóstico a named/default
import { useAuthContext } from '@/context/AuthContext';

import type { IceType, ProductType, FireDate } from '@/lib/utils/types/product.types';
import type { TurnoType } from '@/lib/utils/types/turno.types';
import type { Movimiento, TipoMovimiento } from '@/lib/utils/types/transaction.types';

// ✅ Resolver universal: soporta export class TransactionService, export default, o exports sueltos
const TransactionService: any =
  (TxModule as any).TransactionService ??
  (TxModule as any).default ??
  TxModule;

// =====================================================
// UI type (simple)
// =====================================================

export interface SimpleTransaction {
  id: string;
  codigo: string;
  tipo: TipoMovimiento;

  productoCodigo: string;
  productoNombre: string;
  tipoProducto: ProductType;

  // ✅ alineado a tu modelo Movimiento
  cantidad: number; // abs(deltaPrincipal)
  delta: number; // deltaPrincipal (puede ser -)
  stockAnterior: number; // principalAnterior
  stockNuevo: number; // principalNuevo

  usuarioCodigo: string;
  usuarioNombre: string;

  fecha: Date;
  turno: TurnoType;

  tipoHielo?: IceType;

  motivo?: string;
  clienteNombre?: string;
  empleadoAsignadoNombre?: string;

  valorTotal?: number;
  observaciones?: string;
}

interface UseTransactionsOptions {
  limite?: number;

  // filtros
  qNombre?: string; // contains (client)
  tipoProducto?: ProductType;
  fechaDesde?: Date;
  fechaHasta?: Date;
  tipo?: TipoMovimiento;
  usuarioCodigo?: string;
  empleadoAsignadoCodigo?: string;
  productoCodigo?: string;
  tipoHielo?: IceType;

  // cache (pasa directo al service)
  cacheTtlMs?: number;
}

function isTimestamp(v: any): v is { toDate: () => Date } {
  return v && typeof v === 'object' && typeof v.toDate === 'function';
}

function toDateSafe(v: any): Date {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (isTimestamp(v)) return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function absNum(n: any, fb = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.abs(x) : fb;
}
function num(n: any, fb = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fb;
}

export function useTransactions(options: UseTransactionsOptions = {}) {
  const { productionSession, adminSession } = useAuthContext();

  const [transactions, setTransactions] = useState<SimpleTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeUser = useMemo(() => {
    if (adminSession) {
      return {
        codigo: (adminSession as any).id || 'admin',
        nombre: (adminSession as any).nombre || 'Administrador',
        rol: 'ADMIN' as const,
      };
    }
    if (productionSession) {
      return {
        codigo: (productionSession as any).id || 'EMP',
        nombre: (productionSession as any).nombre || 'Producción',
        rol: 'PRODUCCION' as const,
      };
    }
    return null;
  }, [productionSession, adminSession]);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // ✅ Alineado al TransactionService nuevo
      const movs: Movimiento[] = await TransactionService.obtenerMovimientos({
        tipo: options.tipo,
        tipoProducto: options.tipoProducto,
        tipoHielo: options.tipoHielo,

        usuarioCodigo: options.usuarioCodigo,
        empleadoAsignadoCodigo: options.empleadoAsignadoCodigo,

        productoCodigo: options.productoCodigo,
        productoNombreContains: options.qNombre,

        fechaInicio: options.fechaDesde,
        fechaFin: options.fechaHasta,

        limit: options.limite ?? 200,
        cacheTtlMs: options.cacheTtlMs ?? 20_000,
      });

      const mapped: SimpleTransaction[] = (movs ?? []).map((m: any) => ({
        id: String(m.id ?? m.codigo ?? ''),
        codigo: String(m.codigo ?? ''),
        tipo: m.tipo as TipoMovimiento,

        productoCodigo: String(m.productoCodigo ?? ''),
        productoNombre: String(m.productoNombre ?? ''),
        tipoProducto: (m.tipoProducto ?? 'BOLSA') as ProductType,

        delta: num(m.deltaPrincipal, 0),
        cantidad: absNum(m.deltaPrincipal, 0),
        stockAnterior: num(m.principalAnterior, 0),
        stockNuevo: num(m.principalNuevo, 0),

        usuarioCodigo: String(m.usuarioCodigo ?? ''),
        usuarioNombre: String(m.usuarioNombre ?? ''),

        fecha: toDateSafe(m.fecha as FireDate),
        turno: (m.turno ?? 'MATUTINO') as TurnoType,

        tipoHielo: m.tipoHielo as IceType | undefined,

        motivo: m.motivo ?? undefined,
        clienteNombre: m.clienteNombre ?? undefined,
        empleadoAsignadoNombre: m.empleadoAsignadoNombre ?? undefined,

        valorTotal: Number.isFinite(Number(m.valorTotal)) ? Number(m.valorTotal) : undefined,
        observaciones: m.observaciones ?? undefined,
      }));

      setTransactions(mapped);
    } catch (err: any) {
      setError(err?.message || 'Error al cargar movimientos');
    } finally {
      setLoading(false);
    }
  }, [
    options.tipo,
    options.tipoProducto,
    options.tipoHielo,
    options.usuarioCodigo,
    options.empleadoAsignadoCodigo,
    options.productoCodigo,
    options.qNombre,
    options.fechaDesde,
    options.fechaHasta,
    options.limite,
    options.cacheTtlMs,
  ]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // =====================================================
  // Acciones (alineadas al service actual)
  // =====================================================

  const limpiarAntiguos = useCallback(
    async (dias = 30) => {
      if (typeof TransactionService.limpiarMovimientosAntiguos !== 'function') {
        throw new Error('TransactionService.limpiarMovimientosAntiguos no existe');
      }
      const res = await TransactionService.limpiarMovimientosAntiguos(dias);
      await fetchTransactions();
      return res;
    },
    [fetchTransactions]
  );

  // ✅ Nota importante:
  // Tu TransactionService actual SOLO hace movimientos (registrarMovimiento)
  // y consultas. NO tiene registrarCreacion/registrarVenta/etc.
  // Esas operaciones se registran desde ProductService/ProductionService
  // (donde ocurre el stock real). Aquí dejamos un helper genérico:

  const registrarMovimiento = useCallback(
    async (
      mov: Omit<Movimiento, 'codigo' | 'fecha' | 'turno'> & Partial<Pick<Movimiento, 'codigo' | 'fecha' | 'turno'>>
    ) => {
      if (typeof TransactionService.registrarMovimiento !== 'function') {
        throw new Error('TransactionService.registrarMovimiento no existe');
      }
      const id = await TransactionService.registrarMovimiento(mov);
      await fetchTransactions();
      return id as string;
    },
    [fetchTransactions]
  );

  return {
    // data
    transactions,
    loading,
    error,
    activeUser,

    // flags
    esAdmin: !!adminSession,
    esProduccion: !!productionSession,
    estaAutenticado: !!activeUser,

    // actions
    refresh: fetchTransactions,
    limpiarAntiguos,
    registrarMovimiento,
  };
}
