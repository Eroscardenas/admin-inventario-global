'use client';

// lib/utils/types/production.types.ts  ✅ FINAL (MAQUINA EN UI + UBICACION AUTO CAMARA_FRIA)
// - Producción captura SOLO la máquina (M1/M2/M3)
// - Ubicación se guarda AUTOMÁTICA: CAMARA_FRIA
// - Movimientos: movimientos_produccion (se reflejan en monitoreo)

import type { IceType, FireDate, MaquinaId, UbicacionId } from '@/lib/utils/types/product.types';
import type { BarraProduct, BolsaProduct } from '@/lib/utils/types/product.types';

// ✅ Regla del negocio: todo lo producido / salido de máquina queda resguardado en cámara fría
export const UBICACION_DEFAULT_PRODUCCION: UbicacionId = 'CAMARA_FRIA';

// =========================================
// Tipos de movimiento de producción
// =========================================
export type ProductionMovimientoTipo = 'LLENADO' | 'SALIDA' | 'DEVOLUCION' | 'MERMA';

export interface ProductionMovimientoBase {
  id?: string;
  tipo: ProductionMovimientoTipo;
  fecha: FireDate;

  // tracking básico
  empleado?: string; // codigo empleado (en tu service es "empleado")
  destinatario?: string; // salida
  motivo?: string; // devolucion/merma

  // ✅ Monitoreo: siempre guardamos máquina y ubicación resultante
  maquina?: MaquinaId;
  ubicacion?: UbicacionId; // por regla, normalmente CAMARA_FRIA

  // opcional para trazabilidad (si aplica)
  deMaquina?: MaquinaId;
  aMaquina?: MaquinaId;
  deUbicacion?: UbicacionId;
  aUbicacion?: UbicacionId;
}

// =========================================
// Movimientos específicos
// =========================================
export interface MovimientoLlenado extends ProductionMovimientoBase {
  tipo: 'LLENADO';

  bolsaAsignadaOriginal: string; // codigo ASIGNADA
  bolsaLlenaCodigo: string; // codigo BLxxx

  tipoHielo: IceType;

  cantidad: number; // bolsas llenadas (tu regla: 1 cuarto por bolsa)
  barraOrigen: string; // codigo barra
  cuartosUsados: number;

  // ✅ explícito para auditoría (redundante pero útil)
  maquinaProduccion: MaquinaId;
  ubicacionDestino: UbicacionId; // CAMARA_FRIA
}

export interface MovimientoSalida extends ProductionMovimientoBase {
  tipo: 'SALIDA';

  bolsaLlenaCodigo: string;
  tipoHielo?: IceType;
  cantidad: number;

  destinatario: string;

  // en tu caso la salida podría ir a RUTA/CLIENTE, pero si aún no lo modelas, déjalo opcional
  ubicacionDestino?: UbicacionId;
}

export interface MovimientoDevolucion extends ProductionMovimientoBase {
  tipo: 'DEVOLUCION';

  bolsaLlenaCodigo: string;
  tipoHielo?: IceType;
  cantidad: number;

  motivo: string;

  // si regresa a cámara fría (lo normal)
  ubicacionDestino?: UbicacionId; // CAMARA_FRIA
}

export interface MovimientoMerma extends ProductionMovimientoBase {
  tipo: 'MERMA';

  productoCodigo: string;
  tipoHielo?: IceType;
  cantidad: number;

  motivo: string;
}

export type ProductionMovimiento =
  | MovimientoLlenado
  | MovimientoSalida
  | MovimientoDevolucion
  | MovimientoMerma;

// =========================================
// Inputs para acciones (hook friendly)
// =========================================
// ✅ IMPORTANTE: ya NO pedimos ubicacion en UI. Solo máquina (cuando aplique).

export interface LlenarBolsaInput {
  bolsaAsignadaCodigo: string;
  tipoHielo: IceType;
  empleadoCodigo: string;
  barraOrigenCodigo: string;
  cantidad?: number; // default 1

  // ✅ UI pide solo esto:
  maquina: MaquinaId;
}

export interface RegistrarSalidaInput {
  bolsaLlenaCodigo: string;
  empleadoCodigo: string;
  destinatario: string;
  cantidad?: number; // default 1

  // (si quieres que salida también indique máquina desde la que se despachó)
  maquina?: MaquinaId;

  // opcional si luego manejas RUTA/CLIENTE
  ubicacionDestino?: UbicacionId;
}

export interface RegistrarDevolucionInput {
  bolsaLlenaCodigo: string;
  empleadoCodigo: string;
  motivo: string;
  cantidad?: number; // default 1

  // si regresa a cámara fría (default)
  ubicacionDestino?: UbicacionId; // CAMARA_FRIA
}

export interface RegistrarMermaInput {
  productoCodigo: string;
  empleadoCodigo: string;
  motivo: string;
  cantidad?: number; // default 1

  // opcional: en qué máquina ocurrió (si aplica)
  maquina?: MaquinaId;
  tipoHielo?: IceType;
}

// =========================================
// Reporte del día (tu service lo devuelve así)
// =========================================
export interface ProduccionDelDia {
  totalBolsasLlenadas: number;
  tiposHielo: Record<IceType, number>;
  empleadosProductivos: Array<{ empleado: string; cantidad: number }>;
  barrasUtilizadas: Array<{ barra: string; cuartosUsados: number }>;
}

// =========================================
// Respuesta de llenar bolsa
// =========================================
export interface LlenarBolsaResultado {
  bolsaLlena: BolsaProduct;
  barraActualizada: BarraProduct;
  movimiento: MovimientoLlenado;
}
