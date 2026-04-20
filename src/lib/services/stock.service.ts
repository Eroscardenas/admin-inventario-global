'use client';

// lib/services/stock.service.ts
// =====================================================
// STOCK SERVICE - A + B (BLxxx + stockPorHielo) COMPAT
// - Compatible con useStock + stock.types.ts (calcularResumenStock)
// - A) Bolsas LLENAS BLxxx: status LLENA + tipoHieloContenido + cantidad
// - B) Producto agregado: stockPorHielo[tipo].stockActual
//
// CLAVE: stock.types.ts suma por hielo usando stockPorHielo.
//        Aquí “normalizamos” BLxxx para que aporten a stockPorHielo
//        SOLO EN MEMORIA al calcular el resumen (sin tocar Firestore).
// =====================================================

import { db } from '@/lib/firebase/config.client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  Timestamp,
  query,
  where,
  type DocumentReference,
} from 'firebase/firestore';

import type { IceType, ProductType, Product } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO, esBarra } from '@/lib/utils/types/product.types';

import type {
  StockAlerta,
  StockResumen,
  StockActualizacionResultado,
  StockGlobalPorHielo,
} from '@/lib/utils/types/stock.types';

import {
  crearAlerta,
  calcularResumenStock,
  formatearResultadoActualizacion,
} from '@/lib/utils/types/stock.types';

import { ProductService } from '@/lib/services/product.service';

// =====================================================
// Helpers
// =====================================================

const toDateSafe = (v: any): Date => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  return new Date(v);
};

const toTs = (d: Date) => Timestamp.fromDate(d);

const safeNum = (v: any) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const clampNonNegative = (v: any) => Math.max(0, safeNum(v));

const DEFAULT_GLOBAL: StockGlobalPorHielo = {
  stockMinimo: 0,
  stockMaximo: 0,
  activo: true,
  prioridad: 0,
  actualizadoPor: 'system',
  ultimaActualizacion: new Date(),
};

// =====================================================
// Firestore paths
// =====================================================

const COL_PRODUCTOS = 'productos';
const COL_CFG_GLOBAL = 'config_stock_global_hielo';

// =====================================================
// StockService
// =====================================================

export class StockService {
  // ============================
  // CONFIG GLOBAL POR HIELO
  // ============================
  static async obtenerConfigGlobalPorHielo(): Promise<Record<IceType, StockGlobalPorHielo>> {
    const out = {} as Record<IceType, StockGlobalPorHielo>;
    const now = new Date();

    (TIPOS_HIELO as readonly IceType[]).forEach((t) => {
      out[t] = { ...DEFAULT_GLOBAL, ultimaActualizacion: now };
    });

    try {
      const snap = await getDocs(collection(db, COL_CFG_GLOBAL));
      snap.forEach((d) => {
        const id = d.id as IceType;
        if (!out[id]) return;

        const data = d.data() as any;
        out[id] = {
          stockMinimo: clampNonNegative(data.stockMinimo),
          stockMaximo: clampNonNegative(data.stockMaximo),
          activo: Boolean(data.activo ?? true),
          prioridad: Number(data.prioridad ?? 0),
          actualizadoPor: data.actualizadoPor ?? 'system',
          ultimaActualizacion: data.ultimaActualizacion ? toDateSafe(data.ultimaActualizacion) : now,
        };
      });
    } catch (e) {
      console.warn('⚠️ No se pudo leer config global por hielo. Usando defaults.', e);
    }

    return out;
  }

  static async actualizarConfigGlobalPorHielo(opts: {
    tipoHielo: IceType;
    stockMinimo: number;
    stockMaximo: number;
    activo: boolean;
    actualizadoPor?: string;
    prioridad?: number;
  }): Promise<void> {
    const ref = doc(db, COL_CFG_GLOBAL, opts.tipoHielo);

    await setDoc(
      ref,
      {
        stockMinimo: clampNonNegative(opts.stockMinimo),
        stockMaximo: clampNonNegative(opts.stockMaximo),
        activo: Boolean(opts.activo),
        prioridad: Number(opts.prioridad ?? 0),
        actualizadoPor: opts.actualizadoPor ?? 'admin',
        ultimaActualizacion: toTs(new Date()),
      },
      { merge: true }
    );
  }

  // ============================
  // Productos (fuente)
  // ============================
  private static async getAllProductos(): Promise<Product[]> {
    if ((ProductService as any)?.obtenerTodosProductos) {
      return await (ProductService as any).obtenerTodosProductos();
    }
    const snap = await getDocs(collection(db, COL_PRODUCTOS));
    return snap.docs.map((d) => d.data() as Product);
  }

  /**
   * ✅ Resolver ref real por codigo (NO asume docId = codigo)
   */
  private static async getProductoRefByCodigo(codigo: string): Promise<DocumentReference | null> {
    const cod = String(codigo ?? '').trim();
    if (!cod) return null;

    // Si tu ProductService ya expone "obtenerProductoPorCodigo", lo usamos,
    // pero necesitamos REF para update: así que resolvemos con query.
    const snap = await getDocs(query(collection(db, COL_PRODUCTOS), where('codigo', '==', cod)));
    if (snap.empty) return null;

    if (snap.size > 1) {
      throw new Error(`Código duplicado en productos: ${cod} (${snap.size} docs). Corrige duplicados.`);
    }

    return snap.docs[0].ref;
  }

  private static async getProductoByCodigo(codigo: string): Promise<Product | null> {
    const cod = String(codigo ?? '').trim();
    if (!cod) return null;

    if ((ProductService as any)?.obtenerProductoPorCodigo) {
      return await (ProductService as any).obtenerProductoPorCodigo(cod);
    }

    const snap = await getDocs(query(collection(db, COL_PRODUCTOS), where('codigo', '==', cod)));
    if (snap.empty) return null;

    if (snap.size > 1) {
      throw new Error(`Código duplicado en productos: ${cod} (${snap.size} docs). Corrige duplicados.`);
    }

    return snap.docs[0].data() as Product;
  }

  /**
   * ✅ NORMALIZACIÓN A+B PARA stock.types.ts
   *
   * Tu calcularResumenStock() suma por hielo usando stockPorHielo.
   * Pero si todavía existen BLxxx legacy con tipoHieloContenido,
   * le inyectamos un stockPorHielo “virtual” EN MEMORIA.
   */
  private static normalizarProductosParaResumen(productos: Product[]): Product[] {
    return productos.map((p: any) => {
      if (p?.tipo !== 'BOLSA') return p;

      const status = p.status;
      if (status !== 'LLENA') return p;

      const tieneStockPorHielo = Boolean(p.stockPorHielo && Object.keys(p.stockPorHielo).length > 0);
      if (tieneStockPorHielo) return p;

      const tipoHielo = p.tipoHieloContenido as IceType | undefined;
      if (!tipoHielo) return p;

      // No inventamos para BARRA
      if (tipoHielo === 'BARRA') return p;

      const cant = clampNonNegative(p.cantidad ?? 0);
      if (cant <= 0) return p;

      return {
        ...p,
        stockPorHielo: {
          [tipoHielo]: {
            stockActual: cant,
            ultimaActualizacion: new Date(),
          },
        },
      } as Product;
    });
  }

  // ============================
  // RESUMEN + ALERTAS
  // ============================

  static async obtenerResumenStock(): Promise<StockResumen> {
    const [productosRaw, cfgGlobal] = await Promise.all([
      this.getAllProductos(),
      this.obtenerConfigGlobalPorHielo(),
    ]);

    const productos = this.normalizarProductosParaResumen(productosRaw);
    return calcularResumenStock(productos, cfgGlobal);
  }

  static async obtenerAlertasStock(): Promise<StockAlerta[]> {
    const productos = await this.getAllProductos();

    const alertas: StockAlerta[] = (productos as any[]).map((p) => {
      if (esBarra(p)) {
        return crearAlerta(
          p.codigo,
          p.nombre,
          p.tipo,
          clampNonNegative(p.cuartosDisponibles ?? 0),
          undefined,
          p.status,
          p.stockMinimo,
          p.stockMaximo,
          clampNonNegative(p.cuartosDisponibles ?? 0),
          clampNonNegative(p.cuartosTotales ?? 0)
        );
      }

      return crearAlerta(
        p.codigo,
        p.nombre,
        p.tipo,
        clampNonNegative(p.cantidad ?? 0),
        p.tipoHieloContenido,
        p.status,
        p.stockMinimo,
        p.stockMaximo
      );
    });

    return alertas.sort((a, b) => a.prioridad - b.prioridad || a.nombre.localeCompare(b.nombre));
  }

  static async obtenerProductosBajoStock(): Promise<StockAlerta[]> {
    const alertas = await this.obtenerAlertasStock();
    return alertas.filter((a) => a.estado === 'BAJO' || a.estado === 'CRITICO');
  }

  // ============================
  // Operaciones de stock
  // - BARRA: ajusta cuartosDisponibles
  // - BOLSA: ajusta cantidad
  // ✅ FIX: NO asume docId=codigo
  // ============================

  private static async updateFieldByCodigo(codigo: string, patch: Record<string, any>): Promise<void> {
    const ref = await this.getProductoRefByCodigo(codigo);
    if (!ref) throw new Error(`Producto ${codigo} no encontrado`);
    await updateDoc(ref, { ...patch, ultimaModificacion: toTs(new Date()) });
  }

  static async actualizarStockProducto(codigo: string, nuevaCantidad: number): Promise<StockActualizacionResultado> {
    const prod = await this.getProductoByCodigo(codigo);
    if (!prod) throw new Error(`Producto ${codigo} no encontrado`);

    const isB = esBarra(prod);
    const anterior = isB
      ? clampNonNegative((prod as any).cuartosDisponibles ?? 0)
      : clampNonNegative((prod as any).cantidad ?? 0);

    const nuevo = clampNonNegative(nuevaCantidad);

    if (isB) {
      await this.updateFieldByCodigo(codigo, { cuartosDisponibles: nuevo });
    } else {
      await this.updateFieldByCodigo(codigo, { cantidad: nuevo });
    }

    return formatearResultadoActualizacion(
      true,
      codigo,
      (prod as any).nombre,
      (prod as any).tipo,
      anterior,
      nuevo,
      { nota: `actualizarStockProducto(${isB ? 'cuartosDisponibles' : 'cantidad'})` }
    );
  }

  static async incrementarStock(codigo: string, cantidad: number, _tipo: ProductType): Promise<StockActualizacionResultado> {
    const prod = await this.getProductoByCodigo(codigo);
    if (!prod) throw new Error(`Producto ${codigo} no encontrado`);

    const inc = clampNonNegative(cantidad);
    if (inc <= 0) throw new Error('Cantidad debe ser > 0');

    const isB = esBarra(prod);
    const anterior = isB
      ? clampNonNegative((prod as any).cuartosDisponibles ?? 0)
      : clampNonNegative((prod as any).cantidad ?? 0);

    const nuevo = anterior + inc;

    if (isB) {
      await this.updateFieldByCodigo(codigo, { cuartosDisponibles: nuevo });
    } else {
      await this.updateFieldByCodigo(codigo, { cantidad: nuevo });
    }

    return formatearResultadoActualizacion(
      true,
      codigo,
      (prod as any).nombre,
      (prod as any).tipo,
      anterior,
      nuevo,
      { operacion: 'incrementar', incremento: inc, campo: isB ? 'cuartosDisponibles' : 'cantidad' }
    );
  }

  static async decrementarStock(codigo: string, cantidad: number, _tipo: ProductType): Promise<StockActualizacionResultado> {
    const prod = await this.getProductoByCodigo(codigo);
    if (!prod) throw new Error(`Producto ${codigo} no encontrado`);

    const dec = clampNonNegative(cantidad);
    if (dec <= 0) throw new Error('Cantidad debe ser > 0');

    const isB = esBarra(prod);
    const anterior = isB
      ? clampNonNegative((prod as any).cuartosDisponibles ?? 0)
      : clampNonNegative((prod as any).cantidad ?? 0);

    if (anterior < dec) throw new Error(`Stock insuficiente: ${anterior} disponible, ${dec} solicitado`);

    const nuevo = anterior - dec;

    if (isB) {
      await this.updateFieldByCodigo(codigo, { cuartosDisponibles: nuevo });
    } else {
      await this.updateFieldByCodigo(codigo, { cantidad: nuevo });
    }

    return formatearResultadoActualizacion(
      true,
      codigo,
      (prod as any).nombre,
      (prod as any).tipo,
      anterior,
      nuevo,
      { operacion: 'decrementar', decremento: dec, campo: isB ? 'cuartosDisponibles' : 'cantidad' }
    );
  }

  static async verificarStockDisponible(
    codigo: string,
    cantidadRequerida: number
  ): Promise<{ disponible: boolean; stockActual: number; diferencia: number }> {
    const prod = await this.getProductoByCodigo(codigo);
    const req = clampNonNegative(cantidadRequerida);

    if (!prod) return { disponible: false, stockActual: 0, diferencia: req };

    const isB = esBarra(prod);
    const actual = isB
      ? clampNonNegative((prod as any).cuartosDisponibles ?? 0)
      : clampNonNegative((prod as any).cantidad ?? 0);

    return {
      disponible: actual >= req,
      stockActual: actual,
      diferencia: Math.max(0, req - actual),
    };
  }
}