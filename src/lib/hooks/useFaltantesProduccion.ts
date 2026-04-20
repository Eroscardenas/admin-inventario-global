// lib/hooks/useFaltantesProduccion.ts
'use client';

import { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/firebase/config.client';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';

import type { Faltante } from '@/lib/utils/types/faltante.types';

export function useFaltantesProduccion(options?: {
  soloMios?: boolean;
  empleadoCodigo?: string | null;
  max?: number;
}) {
  const soloMios = options?.soloMios ?? true;
  const empleadoCodigo = options?.empleadoCodigo ?? null;
  const max = options?.max ?? 50;

  const [faltantes, setFaltantes] = useState<Faltante[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canQuery = useMemo(() => {
    if (!soloMios) return true;
    return Boolean(empleadoCodigo);
  }, [soloMios, empleadoCodigo]);

  useEffect(() => {
    if (!canQuery) {
      setFaltantes([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const qs: any[] = [
      where('estado', '==', 'ACEPTADA'),
      orderBy('createdAt', 'desc'),
      limit(Math.min(200, Math.max(1, max))),
    ];

    if (soloMios && empleadoCodigo) {
      qs.unshift(where('reportadoPor.codigo', '==', empleadoCodigo));
    }

    const qref = query(collection(db, 'faltantes'), ...qs);

    const unsub = onSnapshot(
      qref,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Faltante[];
        setFaltantes(rows);
        setLoading(false);
      },
      (e) => {
        setError(e?.message ?? 'Error cargando faltantes.');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [canQuery, soloMios, empleadoCodigo, max]);

  return { faltantes, loading, error };
}
