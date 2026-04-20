// lib/services/faltantes.service.ts  ✅ PRODUCTION (FINALIZAR = archivar + borrar activo + meta gate)
'use client';

import { db } from '@/lib/firebase/config.client';
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  type QueryConstraint,
  type Unsubscribe,
  Timestamp,
  increment,
} from 'firebase/firestore';

import type {
  Faltante,
  FaltanteEstado,
  ReportarFaltanteDTO,
  MovimientoFaltante,
  FaltanteAtendidoPor,
} from '@/lib/utils/types/faltante.types';

const COL_FALTANTES = 'faltantes';
const COL_FALTANTES_HIST = 'faltantes_historial'; // ✅ historial finalizados (admin/reportes)
const COL_MOVS = 'movimientos_faltantes';
const COUNTER_DOC = 'counters/faltantes';

// ✅ META (gate barato para dashboard)
const META_DOC = 'meta/faltantes';

// =================== helpers ===================
const pad3 = (n: number) => String(n).padStart(3, '0');
const buildCode = (seq: number) => `FAL${pad3(seq)}`;

/**
 * Limpia undefined (Firestore no permite undefined).
 * Importante: serverTimestamp() es FieldValue, no se toca.
 */
const toSafe = (value: any): any => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value;

  if (Array.isArray(value)) return value.map(toSafe);

  if (typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) {
      const v = toSafe(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  return value;
};

const clamp = (n: number, minN: number, maxN: number) => Math.max(minN, Math.min(maxN, n));

export class FaltantesService {
  // =====================================================
  // Producción -> reportar faltante (CREA PENDIENTE)
  // - crea doc en /faltantes
  // - agrega movimiento en /movimientos_faltantes
  // - incrementa counter en /counters/faltantes
  // - ✅ actualiza meta/faltantes (openCount +1, hasOpen true)
  // =====================================================
  static async reportar(dto: ReportarFaltanteDTO): Promise<{ id: string; codigo: string }> {
    if (!dto?.reportadoPor?.codigo) throw new Error('reportadoPor.codigo es requerido');
    if (!dto?.reportadoPor?.nombre) throw new Error('reportadoPor.nombre es requerido');
    if (!dto?.reportadoPor?.role) throw new Error('reportadoPor.role es requerido');

    const cantidad = Number(dto.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error('cantidad inválida');

    if (dto.tipo === 'BOLSAS') {
      if (!dto.bolsa?.codigo) throw new Error('Selecciona una bolsa (BV) para reportar.');
      if (!Number.isFinite(Number(dto.bolsa?.pesoKg))) throw new Error('bolsa.pesoKg inválido');
    }

    if (dto.tipo === 'OTRO') {
      const t = (dto.otro ?? '').trim();
      if (t.length < 3) throw new Error('Describe el faltante (mín 3).');
    }

    const counterRef = doc(db, COUNTER_DOC);
    const metaRef = doc(db, META_DOC);

    const faltanteRef = doc(collection(db, COL_FALTANTES));
    const movRef = doc(collection(db, COL_MOVS));

    const result = await runTransaction(db, async (tx) => {
      // counter
      const counterSnap = await tx.get(counterRef);
      const current = counterSnap.exists() ? Number((counterSnap.data() as any).seq ?? 0) : 0;
      const next = current + 1;
      const codigo = buildCode(next);

      tx.set(counterRef, { seq: next, updatedAt: serverTimestamp() }, { merge: true });

      const now = serverTimestamp();

      const faltante: Omit<Faltante, 'id'> = toSafe({
        codigo,
        tipo: dto.tipo,
        estado: 'PENDIENTE' as const,
        cantidad,

        bolsa: dto.tipo === 'BOLSAS' ? dto.bolsa ?? null : null,
        otro: dto.tipo === 'OTRO' ? (dto.otro ?? '').trim() : null,
        nota: (dto.nota ?? '').trim() || null,

        origen: dto.origen,
        reportadoPor: dto.reportadoPor,

        atendidoPor: null,
        aceptadoAt: null,
        finalizadoAt: null,

        createdAt: now,
        updatedAt: now,
      });

      tx.set(faltanteRef, faltante);

      const mov: Omit<MovimientoFaltante, 'id'> = toSafe({
        faltanteId: faltanteRef.id,
        faltanteCodigo: codigo,
        tipoMovimiento: 'CREADO' as const,
        snapshotEstado: 'PENDIENTE' as const,
        payload: {
          tipo: dto.tipo,
          cantidad,
          bolsa: dto.bolsa ?? null,
          otro: dto.otro ?? null,
          nota: dto.nota ?? null,
          origen: dto.origen,
        },
        actor: {
          tipo: 'PRODUCCION',
          codigo: dto.reportadoPor.codigo,
          nombre: dto.reportadoPor.nombre,
        },
        createdAt: now,
      });

      tx.set(movRef, mov);

      // ✅ meta gate: sumamos abiertos y marcamos hasOpen
      // Nota: no dependemos de reads caros; es un doc pequeño
      tx.set(
        metaRef,
        {
          hasOpen: true,
          openCount: increment(1),
          updatedAt: now,
        },
        { merge: true }
      );

      return { id: faltanteRef.id, codigo };
    });

    return result;
  }

  // =====================================================
  // Admin -> ACEPTAR o FINALIZAR
  // - ACEPTAR: update /faltantes + mov
  // - FINALIZAR: set /faltantes_historial + mov + delete /faltantes
  // - ✅ FINALIZAR: meta/faltantes openCount -1 y hasOpen = (openCount>0)
  // =====================================================
  static async setEstado(params: {
    faltanteId: string;
    estado: Exclude<FaltanteEstado, 'PENDIENTE'>; // ACEPTADA | FINALIZADA
    admin: FaltanteAtendidoPor;
  }): Promise<void> {
    const { faltanteId, estado, admin } = params;

    if (!faltanteId) throw new Error('faltanteId requerido');
    if (estado !== 'ACEPTADA' && estado !== 'FINALIZADA') throw new Error('estado inválido');
    if (!admin?.uid) throw new Error('admin.uid requerido');

    const faltanteRef = doc(db, COL_FALTANTES, faltanteId);
    const histRef = doc(db, COL_FALTANTES_HIST, faltanteId);
    const movRef = doc(collection(db, COL_MOVS));
    const metaRef = doc(db, META_DOC);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(faltanteRef);
      if (!snap.exists()) throw new Error('Faltante no existe');

      const data = snap.data() as any;
      const prev: FaltanteEstado = data.estado;

      // reglas de flujo
      if (prev === 'FINALIZADA') return;
      if (estado === 'ACEPTADA' && prev !== 'PENDIENTE') return;
      if (estado === 'FINALIZADA' && prev === 'PENDIENTE') {
        throw new Error('No puedes finalizar sin aceptar primero.');
      }

      const now = serverTimestamp();

      // ✅ ACEPTAR
      if (estado === 'ACEPTADA') {
        const patch: Partial<Faltante> = toSafe({
          estado: 'ACEPTADA',
          updatedAt: now,
          atendidoPor: { uid: admin.uid, nombre: admin.nombre ?? null },
          aceptadoAt: now,
        });

        tx.update(faltanteRef, patch as any);

        const mov: Omit<MovimientoFaltante, 'id'> = toSafe({
          faltanteId,
          faltanteCodigo: String(data.codigo ?? ''),
          tipoMovimiento: 'ACEPTADO' as const,
          snapshotEstado: 'ACEPTADA' as const,
          payload: { from: prev, to: 'ACEPTADA' },
          actor: {
            tipo: 'ADMIN',
            uid: admin.uid,
            nombre: admin.nombre ?? undefined,
          },
          createdAt: now,
        });

        tx.set(movRef, mov);
        return;
      }

      // ✅ FINALIZAR = archivar + movimiento + borrar activo
      const finalDoc: Omit<Faltante, 'id'> = toSafe({
        ...data,
        estado: 'FINALIZADA' as const,
        updatedAt: now,
        atendidoPor: data.atendidoPor ?? { uid: admin.uid, nombre: admin.nombre ?? null },
        finalizadoAt: now,
      });

      // 1) guardar en historial
      tx.set(histRef, finalDoc, { merge: true });

      // 2) registrar movimiento
      const movFinal: Omit<MovimientoFaltante, 'id'> = toSafe({
        faltanteId,
        faltanteCodigo: String(data.codigo ?? ''),
        tipoMovimiento: 'FINALIZADO' as const,
        snapshotEstado: 'FINALIZADA' as const,
        payload: { from: prev, to: 'FINALIZADA' },
        actor: {
          tipo: 'ADMIN',
          uid: admin.uid,
          nombre: admin.nombre ?? undefined,
        },
        createdAt: now,
      });

      tx.set(movRef, movFinal);

      // 3) borrar el activo
      tx.delete(faltanteRef);

      // 4) ✅ meta gate: decrement y recalcular hasOpen con lectura consistente
      const metaSnap = await tx.get(metaRef);
      const currentCount = metaSnap.exists() ? Number((metaSnap.data() as any).openCount ?? 0) : 0;
      const nextCount = Math.max(0, currentCount - 1);

      tx.set(
        metaRef,
        {
          openCount: nextCount,
          hasOpen: nextCount > 0,
          updatedAt: now,
        },
        { merge: true }
      );
    });
  }

  // =====================================================
  // Consulta sin realtime (opcional)
  // =====================================================
  static async listByEstados(estados: FaltanteEstado[], max = 100): Promise<Faltante[]> {
    if (!estados?.length) return [];
    const m = clamp(max, 1, 500);

    const qs: QueryConstraint[] = [
      where('estado', 'in', estados),
      orderBy('createdAt', 'desc'),
      limit(m),
    ];

    const qref = query(collection(db, COL_FALTANTES), ...qs);
    const snap = await getDocs(qref);

    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Faltante[];
  }

  // =====================================================
  // Historial (opcional para reportes admin)
  // =====================================================
  static async listHistorial(max = 200): Promise<Faltante[]> {
    const m = clamp(max, 1, 500);
    const qref = query(collection(db, COL_FALTANTES_HIST), orderBy('finalizadoAt', 'desc'), limit(m));
    const snap = await getDocs(qref);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Faltante[];
  }

  // =====================================================
  // ✅ Meta (gate barato para dashboard)
  // =====================================================
  static subscribeMeta(
    onData: (meta: { hasOpen: boolean; openCount: number }) => void,
    onError?: (err: Error) => void
  ): Unsubscribe {
    const metaRef = doc(db, META_DOC);

    return onSnapshot(
      metaRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : {};
        onData({
          hasOpen: Boolean(data.hasOpen ?? false),
          openCount: Number(data.openCount ?? 0),
        });
      },
      (e) => onError?.(e as any)
    );
  }

  // =====================================================
  // Realtime helpers (opcionales)
  // =====================================================
  static subscribeByEstados(
    estados: FaltanteEstado[],
    onData: (rows: Faltante[]) => void,
    onError?: (err: Error) => void,
    max = 200
  ): Unsubscribe {
    const m = clamp(max, 1, 500);
    const qref = query(
      collection(db, COL_FALTANTES),
      where('estado', 'in', estados),
      orderBy('createdAt', 'desc'),
      limit(m)
    );

    return onSnapshot(
      qref,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Faltante[];
        onData(rows);
      },
      (e) => onError?.(e as any)
    );
  }

  static subscribeAceptadasByEmpleado(
    empleadoCodigo: string,
    onData: (rows: Faltante[]) => void,
    onError?: (err: Error) => void,
    max = 50
  ): Unsubscribe {
    const m = clamp(max, 1, 200);
    const qref = query(
      collection(db, COL_FALTANTES),
      where('estado', '==', 'ACEPTADA'),
      where('reportadoPor.codigo', '==', empleadoCodigo),
      orderBy('createdAt', 'desc'),
      limit(m)
    );

    return onSnapshot(
      qref,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Faltante[];
        onData(rows);
      },
      (e) => onError?.(e as any)
    );
  }
}
