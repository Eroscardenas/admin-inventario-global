// lib/utils/types/devolucion.types.ts
'use client';

import type { IceType, ProductType, FireDate } from '@/lib/utils/types/product.types';

// ==============================
// CONSTANTES
// ==============================

export const MOTIVOS_DEVOLUCION = [
  'PRODUCTO_DANADO',
  'PRODUCTO_EQUIVOCADO',
  'CLIENTE_NO_LO_QUIERE',
  'ENTREGA_INCOMPLETA',
  'CADUCIDAD_CALIDAD',
  'OTRO',
] as const;

export type MotivoDevolucion = typeof MOTIVOS_DEVOLUCION[number];

export type DevolucionEstado = 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA';
export type DevolucionAccion = 'ACEPTADA' | 'RECHAZADA';

// ==============================
// REQUESTS / RESPONSES
// ==============================

export interface DevolucionRequest {
  productoCodigo: string;           // OJO: este es tu campo "codigo" del producto
  productoNombre: string;
  tipoProducto: ProductType;        // 'BOLSA' | 'BARRA'
  tipoHielo?: IceType;              // requerido si es BOLSA (según tu lógica)
  cantidad: number;

  unidad?: 'PZ' | 'BOLSA' | 'BARRA' | 'CUARTO'; // opcional
  motivo: MotivoDevolucion;
  motivoDetallado?: string;

  afectaStock: boolean;             // si true: bloquea el producto y luego incrementa stock al aceptar
}

export interface ProcesarDevolucionRequest {
  devolucionCodigo: string;
  accion: DevolucionAccion;

  // Solo si RECHAZADA
  motivoRechazo?: string;

  // opcional
  accionesTomadas?: string;

  // Si ACEPTADA
  stockDevuelto?: boolean; // tu service lo usa como bandera
  stockAnterior?: number;
  stockNuevo?: number;

  // Si es BARRA y quieres manejar cuartos
  cuartosNuevos?: number;
}

export interface DevolucionResultado {
  exito: boolean;
  devolucionCodigo: string;
  productoCodigo: string;
  productoNombre: string;
  tipoProducto: ProductType;
  tipoHielo?: IceType;
  cantidad: number;
  estado: DevolucionEstado;
  mensaje: string;
  fecha: Date;
}

// ==============================
// MODELO PRINCIPAL
// ==============================

export interface Devolucion {
  codigo: string;

  productoCodigo: string;
  productoNombre: string;
  tipoProducto: ProductType;
  tipoHielo?: IceType;

  cantidad: number;
  unidad?: string;

  motivo: MotivoDevolucion;
  motivoDetallado?: string;

  devueltoPorCodigo: string;
  devueltoPorNombre: string;

  recibidoPor?: string;
  fechaRecepcion?: FireDate;

  estado: DevolucionEstado;
  motivoRechazo?: string;
  accionesTomadas?: string;

  afectaStock: boolean;

  // auditoría stock (si aplica)
  stockDevuelto?: boolean;
  stockAnterior?: number;
  stockNuevo?: number;

  createdAt: FireDate;
  updatedAt: FireDate;
}

export interface DevolucionStats {
  totalDevoluciones: number;
  devolucionesPendientes: number;
  devolucionesAceptadas: number;
  devolucionesRechazadas: number;

  porMotivo: Array<{ motivo: MotivoDevolucion; total: number }>;
  porTipoProducto: Array<{ tipoProducto: ProductType; total: number }>;
  porTipoHielo: Array<{ tipoHielo: IceType; total: number }>;
  porEmpleado: Array<{ devueltoPorCodigo: string; devueltoPorNombre: string; total: number }>;

  tendenciaMensual: Array<{ ym: string; total: number }>;
  ultimaActualizacion: Date;
}

// ==============================
// HELPERS (LOS QUE TU SERVICE IMPORTA)
// ==============================

export function crearDevolucion(
  request: DevolucionRequest,
  devueltoPorCodigo: string,
  devueltoPorNombre: string
): Devolucion {
  const ahora = new Date();

  return {
    codigo: '', // lo asigna el service
    productoCodigo: request.productoCodigo,
    productoNombre: request.productoNombre,
    tipoProducto: request.tipoProducto,
    tipoHielo: request.tipoHielo,

    cantidad: request.cantidad,
    unidad: request.unidad ?? (request.tipoProducto === 'BARRA' ? 'BARRA' : 'BOLSA'),

    motivo: request.motivo,
    motivoDetallado: request.motivoDetallado,

    devueltoPorCodigo,
    devueltoPorNombre,

    estado: 'PENDIENTE',
    afectaStock: request.afectaStock,

    createdAt: ahora,
    updatedAt: ahora,
  };
}

export function procesarDevolucion(
  devolucion: Devolucion,
  request: ProcesarDevolucionRequest,
  recibidoPor: string
): Devolucion {
  const ahora = new Date();

  if (request.accion === 'ACEPTADA') {
    return {
      ...devolucion,
      estado: 'ACEPTADA',
      recibidoPor,
      fechaRecepcion: ahora,
      accionesTomadas: request.accionesTomadas,
      stockDevuelto: request.stockDevuelto ?? devolucion.stockDevuelto ?? true,
      stockAnterior: request.stockAnterior ?? devolucion.stockAnterior,
      stockNuevo: request.stockNuevo ?? devolucion.stockNuevo,
      updatedAt: ahora,
    };
  }

  return {
    ...devolucion,
    estado: 'RECHAZADA',
    recibidoPor,
    fechaRecepcion: ahora,
    motivoRechazo: request.motivoRechazo ?? 'Rechazada',
    accionesTomadas: request.accionesTomadas,
    updatedAt: ahora,
  };
}

export function calcularDevolucionResultado(
  devolucionActualizada: Devolucion,
  request: ProcesarDevolucionRequest
): DevolucionResultado {
  const ok = devolucionActualizada.estado !== 'PENDIENTE';

  return {
    exito: ok,
    devolucionCodigo: devolucionActualizada.codigo,
    productoCodigo: devolucionActualizada.productoCodigo,
    productoNombre: devolucionActualizada.productoNombre,
    tipoProducto: devolucionActualizada.tipoProducto,
    tipoHielo: devolucionActualizada.tipoHielo,
    cantidad: devolucionActualizada.cantidad,
    estado: devolucionActualizada.estado,
    mensaje:
      request.accion === 'ACEPTADA'
        ? 'Devolución aceptada'
        : `Devolución rechazada${request.motivoRechazo ? `: ${request.motivoRechazo}` : ''}`,
    fecha: new Date(),
  };
}

/**
 * Validación base.
 * - NO asume prefijos BV/BL/BR (porque tu sistema no depende de eso para devoluciones)
 * - Si mandas stockActual, valida suficiencia si afectaStock = true (tu service lo usa aparte)
 */
export function validarProductoParaDevolucion(
  productoCodigo: string,
  tipoProducto: ProductType,
  cantidad: number,
  stockActual?: number
): { valido: boolean; mensaje: string; stockActual?: number } {
  if (!productoCodigo?.trim()) return { valido: false, mensaje: 'Código de producto requerido' };
  if (tipoProducto !== 'BOLSA' && tipoProducto !== 'BARRA') {
    return { valido: false, mensaje: 'Tipo de producto inválido' };
  }
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    return { valido: false, mensaje: 'Cantidad inválida' };
  }
  if (stockActual !== undefined && stockActual < 0) {
    return { valido: false, mensaje: 'Stock actual inválido', stockActual };
  }
  return { valido: true, mensaje: 'OK', stockActual };
}

export function calcularStatsDevoluciones(devoluciones: Devolucion[]): DevolucionStats {
  const ahora = new Date();

  const total = devoluciones.length;
  const pendientes = devoluciones.filter(d => d.estado === 'PENDIENTE').length;
  const aceptadas = devoluciones.filter(d => d.estado === 'ACEPTADA').length;
  const rechazadas = devoluciones.filter(d => d.estado === 'RECHAZADA').length;

  const porMotivoMap = new Map<MotivoDevolucion, number>();
  const porTipoProductoMap = new Map<ProductType, number>();
  const porTipoHieloMap = new Map<IceType, number>();
  const porEmpleadoMap = new Map<string, { nombre: string; total: number }>();
  const tendenciaMap = new Map<string, number>(); // "YYYY-MM"

  for (const d of devoluciones) {
    porMotivoMap.set(d.motivo, (porMotivoMap.get(d.motivo) ?? 0) + 1);
    porTipoProductoMap.set(d.tipoProducto, (porTipoProductoMap.get(d.tipoProducto) ?? 0) + 1);

    if (d.tipoHielo) porTipoHieloMap.set(d.tipoHielo, (porTipoHieloMap.get(d.tipoHielo) ?? 0) + 1);

    const empKey = d.devueltoPorCodigo || 'DESCONOCIDO';
    const emp = porEmpleadoMap.get(empKey);
    if (emp) emp.total += 1;
    else porEmpleadoMap.set(empKey, { nombre: d.devueltoPorNombre || 'Desconocido', total: 1 });

    const dt = d.createdAt instanceof Date ? d.createdAt : new Date((d.createdAt as any)?.toDate?.() ?? d.createdAt);
    const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    tendenciaMap.set(ym, (tendenciaMap.get(ym) ?? 0) + 1);
  }

  return {
    totalDevoluciones: total,
    devolucionesPendientes: pendientes,
    devolucionesAceptadas: aceptadas,
    devolucionesRechazadas: rechazadas,

    porMotivo: Array.from(porMotivoMap.entries()).map(([motivo, total]) => ({ motivo, total })),
    porTipoProducto: Array.from(porTipoProductoMap.entries()).map(([tipoProducto, total]) => ({ tipoProducto, total })),
    porTipoHielo: Array.from(porTipoHieloMap.entries()).map(([tipoHielo, total]) => ({ tipoHielo, total })),
    porEmpleado: Array.from(porEmpleadoMap.entries()).map(([devueltoPorCodigo, v]) => ({
      devueltoPorCodigo,
      devueltoPorNombre: v.nombre,
      total: v.total,
    })),

    tendenciaMensual: Array.from(tendenciaMap.entries())
      .map(([ym, total]) => ({ ym, total }))
      .sort((a, b) => a.ym.localeCompare(b.ym)),

    ultimaActualizacion: ahora,
  };
}
