// lib/hooks/useMyAssignments.ts
'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config.client';

import type { IceType } from '@/lib/utils/types/product.types';

export type TurnoType = 'MATUTINO' | 'VESPERTINO' | 'NOCTURNO';

export interface AsignacionUI {
  id: string; // Firestore docId
  codigo: string; // ASG-xxx (si existe)
  productoCodigo: string; // BVxxx
  productoNombre: string;

  empleadoCodigo: string;
  empleadoNombre: string;

  cantidad: number;
  pesoKg?: number;

  turno?: TurnoType;
  tipoHielo?: IceType | string;

  estado?: 'PENDIENTE' | 'COMPLETADA' | 'CANCELADA' | string;

  fechaAsignacion?: Date;
  createdAt: Date;
  updatedAt?: Date;
}

const toDateSafe = (v: any): Date => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  return new Date(v);
};

export function useMyAssignments(empleadoCodigo?: string) {
  const [asignacionesRaw, setAsignacionesRaw] = useState<AsignacionUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ IMPORTANTE:
  // where(empleadoCodigo) + orderBy(createdAt) probablemente pide índice compuesto.
  // Si te aparece el error, copias el link y creas el índice (igual que antes).
  const qy = useMemo(() => {
    if (!empleadoCodigo) return null;
    return query(
      collection(db, 'asignaciones'),
      where('empleadoCodigo', '==', empleadoCodigo),
      orderBy('createdAt', 'desc')
    );
  }, [empleadoCodigo]);

  useEffect(() => {
    if (!qy) {
      setAsignacionesRaw([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list: AsignacionUI[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            codigo: String(data.codigo ?? d.id),

            productoCodigo: String(data.productoCodigo ?? ''),
            productoNombre: String(data.productoNombre ?? ''),

            empleadoCodigo: String(data.empleadoCodigo ?? ''),
            empleadoNombre: String(data.empleadoNombre ?? ''),

            cantidad: Number(data.cantidad ?? 0),
            pesoKg: data.pesoKg != null ? Number(data.pesoKg) : undefined,

            turno: data.turno ?? undefined,
            tipoHielo: data.tipoHielo ?? undefined,

            estado: (data.estado ?? 'PENDIENTE') as any,

            fechaAsignacion: data.fechaAsignacion ? toDateSafe(data.fechaAsignacion) : undefined,
            createdAt: toDateSafe(data.createdAt),
            updatedAt: data.updatedAt ? toDateSafe(data.updatedAt) : undefined,
          };
        });

        setAsignacionesRaw(list);
        setLoading(false);
      },
      (err) => {
        console.error('useMyAssignments snapshot error:', err);
        setError(err.message ?? 'Error cargando asignaciones');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [qy]);

  // ✅ Solo disponibles: PENDIENTE y cantidad > 0
  const asignaciones = useMemo(() => {
    return asignacionesRaw.filter((a) => {
      const estado = String(a.estado ?? 'PENDIENTE');
      return estado === 'PENDIENTE' && Number(a.cantidad ?? 0) > 0;
    });
  }, [asignacionesRaw]);

  return { asignaciones, loading, error };
}
