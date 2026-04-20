// src/lib/adapters/movimientos.ui.ts
// ✅ Un modelo único para UI (export, filtros, stats, pdf)
// La página/hook mapea tus docs reales a este formato.

import type { IceType } from '@/lib/utils/types/product.types';

// Ajusta/expande si tu enum real difiere
export type MovimientoUIType =
  | 'ENTRADA'
  | 'SALIDA'
  | 'TRANSFERENCIA'
  | 'CONVERSION'
  | 'LLENADO'
  | 'MERMA'
  | 'DEVOLUCION'
  | 'AJUSTE';

export type TipoProductoUI = 'BOLSA_VACIA' | 'BOLSA_LLENA' | 'BARRA';
export type UbicacionUI = 'M1' | 'M2' | 'M3' | 'BODEGA';

export type TurnoUI = 'MATUTINO' | 'VESPERTINO' | 'NOCTURNO';

export interface MovimientoUIRow {
  id: string;

  fecha: Date;
  tipo: MovimientoUIType;

  // producto
  productoCodigo?: string;
  productoNombre: string;
  tipoProducto?: TipoProductoUI;
  pesoKg?: number | null;
  tipoHielo?: IceType | string;

  // operación
  cantidad: number; // (+/- o siempre +, pero consistente)
  unidad?: 'pzas' | 'kg' | 'cuartos' | 'bolsas' | string;

  // contexto
  ubicacion?: UbicacionUI | string;
  turno?: TurnoUI;

  // personas
  registradoPorNombre?: string; // admin o empleado
  empleadoNombre?: string;
  clienteNombre?: string;
  destinatario?: string;

  // notas
  motivo?: string;

  // stock opcional
  stockAnterior?: number;
  stockNuevo?: number;
}

// Helpers para labels en UI
export const MOVIMIENTO_LABELS: Record<MovimientoUIType, string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  TRANSFERENCIA: 'Transferencia',
  CONVERSION: 'Conversión',
  LLENADO: 'Llenado',
  MERMA: 'Merma',
  DEVOLUCION: 'Devolución',
  AJUSTE: 'Ajuste',
};
