'use client';

import { db } from '@/lib/firebase/config.client';

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  Timestamp,
  runTransaction,
  increment,
  limit,
} from 'firebase/firestore';

import type { BolsaProduct, IceType } from '@/lib/utils/types/product.types';
import { calcularStockTotalBolsa } from '@/lib/utils/types/product.types';

const toTs = (d: Date) => Timestamp.fromDate(d);

export type SalidaTipo = 'SALIDA';

export interface CrearSalidaDTO {
  productoId: string; // docId del producto BOLSA (config)
  productoCodigo: string;
  productoNombre: string;

  tipoHielo: IceType;
  cantidad: number; // bolsas (unidades)

  choferId: string;
  choferNombre: string;

  registradoPorCodigo: string;
  registradoPorNombre: string;

  createdAt?: Date;
}

export class SalidasService {
  // =========================
  // Cargar choferes/transporte
  // =========================
static async getChoferesActivos() {
  const col = collection(db, 'empleados');

  const q = query(
    col,
    where('role', '==', 'TRANSPORTE'),
    where('isActive', '==', true),
    limit(200)
  );

  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}


  // =========================
  // Cargar productos bolsa LLENA
  // (los que tienen stockPorHielo)
  // =========================
  static async getProductosBolsaLlenas() {
    const col = collection(db, 'products');

    const q = query(
      col,
      where('tipo', '==', 'BOLSA'),
      where('status', '==', 'LLENA'),
      limit(400)
    );

    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  }

  // =========================
  // Crear salida (TRANSACCIÓN)
  // - descuenta stockPorHielo[tipo].stockActual
  // - descuenta cantidad como cache de total
  // - registra salida + movimiento
  // =========================
  static async crearSalida(dto: CrearSalidaDTO) {
    if (!dto.productoId) throw new Error('productoId requerido.');
    if (!dto.choferId) throw new Error('choferId requerido.');
    if (!dto.tipoHielo) throw new Error('tipoHielo requerido.');
    if (!dto.cantidad || dto.cantidad <= 0) throw new Error('cantidad inválida.');

    const now = dto.createdAt ?? new Date();

    const productoRef = doc(db, 'products', dto.productoId);
    const salidaRef = doc(collection(db, 'salidas'));
    const movRef = doc(collection(db, 'movimientos'));

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(productoRef);
      if (!snap.exists()) throw new Error('Producto no existe.');

      const producto = snap.data() as BolsaProduct & Record<string, any>;

      if (producto.tipo !== 'BOLSA') throw new Error('El producto seleccionado no es BOLSA.');
      if (producto.status !== 'LLENA') throw new Error('El producto seleccionado no está en status LLENA.');

      const stockTotal = calcularStockTotalBolsa(producto); // suma de stockPorHielo
      const stockHielo = Number(producto?.stockPorHielo?.[dto.tipoHielo]?.stockActual ?? 0);

      if (stockTotal < dto.cantidad) {
        throw new Error(`Stock total insuficiente. Disponible: ${stockTotal}`);
      }
      if (stockHielo < dto.cantidad) {
        throw new Error(
          `Stock insuficiente para ${dto.tipoHielo}. Disponible: ${stockHielo}`
        );
      }

      // cantidad como cache de total (para que la UI tenga “total del producto” sin recalcular)
      // Si tu UI siempre calcula por helper, esto sigue siendo coherente.
      const cantidadActual = Number(producto?.cantidad ?? stockTotal);
      const nuevaCantidad = Math.max(0, cantidadActual - dto.cantidad);

      // 1) Descontar stockPorHielo[tipo].stockActual
      tx.update(productoRef, {
        [`stockPorHielo.${dto.tipoHielo}.stockActual`]: increment(-dto.cantidad),
        [`stockPorHielo.${dto.tipoHielo}.ultimaActualizacion`]: toTs(now),

        // 2) Descontar total cacheado
        cantidad: nuevaCantidad,
        ultimaModificacion: toTs(now),
      });

      // 3) Registrar salida (colección salidas)
      tx.set(salidaRef, {
        tipo: 'SALIDA' as SalidaTipo,

        productoId: dto.productoId,
        productoCodigo: dto.productoCodigo,
        productoNombre: dto.productoNombre,

        tipoHielo: dto.tipoHielo,
        cantidad: dto.cantidad,

        choferId: dto.choferId,
        choferNombre: dto.choferNombre,

        registradoPorCodigo: dto.registradoPorCodigo,
        registradoPorNombre: dto.registradoPorNombre,

        createdAt: toTs(now),
        updatedAt: toTs(now),
      });

      // 4) Movimiento (tu flujo real)
      tx.set(movRef, {
        tipo: 'SALIDA',
        origen: 'PRODUCCION',
        destino: 'TRANSPORTE',

        productoId: dto.productoId,
        productoCodigo: dto.productoCodigo,
        productoNombre: dto.productoNombre,

        tipoHielo: dto.tipoHielo,
        cantidad: dto.cantidad,

        choferId: dto.choferId,
        choferNombre: dto.choferNombre,

        registradoPorCodigo: dto.registradoPorCodigo,
        registradoPorNombre: dto.registradoPorNombre,

        createdAt: toTs(now),
      });
    });

    return { ok: true as const };
  }
}
