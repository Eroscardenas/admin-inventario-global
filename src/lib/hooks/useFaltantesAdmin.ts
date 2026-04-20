// lib/hooks/useFaltantesAdmin.ts  ✅ PRODUCTION (activos: PENDIENTE/ACEPTADA + gate meta)
'use client';

import { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/firebase/config.client';

import { doc, onSnapshot, collection, query, where, orderBy, limit } from 'firebase/firestore';

import type { Faltante, FaltanteEstado } from '@/lib/utils/types/faltante.types';

type UseFaltantesAdminOptions = {
  enabled?: boolean;          // default true
  gateByMeta?: boolean;       // ✅ NUEVO: si true, NO se suscribe a /faltantes hasta que meta.hasOpen sea true
  max?: number;               // default 200, clamp 1..500
  estados?: FaltanteEstado[]; // default ['PENDIENTE','ACEPTADA']
};

const clamp = (n: number, minN: number, maxN: number) => Math.max(minN, Math.min(maxN, n));
const META_DOC_PATH = 'meta/faltantes';

export function useFaltantesAdmin(options?: UseFaltantesAdminOptions) {
  const enabled = options?.enabled ?? true;
  const gateByMeta = options?.gateByMeta ?? false;

  const estadosRaw = options?.estados ?? (['PENDIENTE', 'ACEPTADA'] as FaltanteEstado[]);
  const max = clamp(options?.max ?? 200, 1, 500);

  // ✅ Key estable aunque el caller pase arrays literales nuevos en cada render
  const estadosKey = useMemo(() => {
    const arr = Array.from(new Set(estadosRaw ?? []));
    arr.sort();
    return arr.join('|');
  }, [(estadosRaw ?? []).join('|')]);

  // ✅ reconstruye estados desde key (estable)
  const estados = useMemo(() => {
    if (!estadosKey) return [] as FaltanteEstado[];
    return estadosKey.split('|').filter(Boolean) as FaltanteEstado[];
  }, [estadosKey]);

  const canQuery = estados.length > 0 && estados.length <= 10;

  const [faltantes, setFaltantes] = useState<Faltante[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ meta gate state
  const [metaHasOpen, setMetaHasOpen] = useState<boolean>(false);
  const [metaReady, setMetaReady] = useState<boolean>(!gateByMeta);

  // 1) ✅ Suscripción a meta/faltantes (barata)
  useEffect(() => {
    if (!enabled) {
      setMetaHasOpen(false);
      setMetaReady(!gateByMeta);
      return;
    }

    if (!gateByMeta) {
      setMetaReady(true);
      return;
    }

    setMetaReady(false);

    const unsub = onSnapshot(
      doc(db, META_DOC_PATH),
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : {};
        const hasOpen = Boolean(data.hasOpen ?? false);
        setMetaHasOpen(hasOpen);
        setMetaReady(true);
      },
      (e) => {
        console.error('useFaltantesAdmin meta error:', e);
        setMetaHasOpen(false);
        setMetaReady(true);
      }
    );

    return () => unsub();
  }, [enabled, gateByMeta]);

  // 2) ✅ Suscripción a /faltantes SOLO cuando corresponde
  useEffect(() => {
    if (!enabled) {
      setFaltantes([]);
      setLoading(false);
      setError(null);
      return;
    }

    if (!canQuery) {
      setFaltantes([]);
      setLoading(false);
      setError(
        estados.length === 0
          ? 'Debes indicar al menos un estado.'
          : 'Demasiados estados (Firestore "in" soporta máximo 10).'
      );
      return;
    }

    if (!metaReady) {
      setFaltantes([]);
      setLoading(false);
      setError(null);
      return;
    }

    if (gateByMeta && !metaHasOpen) {
      setFaltantes([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const qref = query(
      collection(db, 'faltantes'),
      where('estado', 'in', estados),
      orderBy('createdAt', 'desc'),
      limit(max)
    );

    const unsub = onSnapshot(
      qref,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Faltante[];
        setFaltantes(rows);
        setLoading(false);
      },
      (e) => {
        console.error('useFaltantesAdmin error:', e);
        setError(e?.message ?? 'Error cargando faltantes.');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [enabled, canQuery, estadosKey, max, gateByMeta, metaHasOpen, metaReady]); // ✅ sin `estados` en deps

  // Derivados útiles para UI admin
  const pending = useMemo(() => faltantes.filter((f) => f.estado === 'PENDIENTE'), [faltantes]);
  const accepted = useMemo(() => faltantes.filter((f) => f.estado === 'ACEPTADA'), [faltantes]);

  const counts = useMemo(
    () => ({
      total: faltantes.length,
      pendientes: pending.length,
      enProceso: accepted.length,
    }),
    [faltantes.length, pending.length, accepted.length]
  );

  return {
    faltantes,
    pending,
    accepted,
    counts,
    loading,
    error,
    enabled,
    meta: gateByMeta ? { ready: metaReady, hasOpen: metaHasOpen } : null,
  };
}
