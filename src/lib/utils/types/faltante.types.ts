// lib/utils/types/faltante.types.ts
'use client';

import type { FireDate } from '@/lib/utils/types/user.types';

// Estados para el flujo que describiste
export type FaltanteEstado = 'PENDIENTE' | 'ACEPTADA' | 'FINALIZADA';

// Tipos de faltante
export type FaltanteTipo = 'BOLSAS' | 'GRAPAS' | 'HILAZA' | 'OTRO';

export type FaltanteOrigen = 'produccion/dashboard';

export interface FaltanteBolsaRef {
  codigo: string; // BV.codigo
  nombre: string;
  pesoKg: number;
}

export interface FaltanteReportadoPor {
  codigo: string; // empleado
  nombre: string;
  role: string; // PRODUCCION/TRANSPORTE/...
}

export interface FaltanteAtendidoPor {
  uid: string; // admin uid
  nombre?: string | null; // opcional si guardas displayName
}

export interface Faltante {
  id?: string;         // docId
  codigo: string;      // FAL001
  tipo: FaltanteTipo;
  estado: FaltanteEstado;

  cantidad: number;

  // Si tipo === BOLSAS
  bolsa?: FaltanteBolsaRef | null;

  // Si tipo === OTRO
  otro?: string | null;

  nota?: string | null;

  origen: FaltanteOrigen;

  reportadoPor: FaltanteReportadoPor;
  atendidoPor?: FaltanteAtendidoPor | null;

  createdAt: FireDate;
  updatedAt: FireDate;

  aceptadoAt?: FireDate | null;
  finalizadoAt?: FireDate | null;
}

// DTO para reportar desde Producción
export interface ReportarFaltanteDTO {
  tipo: FaltanteTipo;
  cantidad: number;
  bolsa?: FaltanteBolsaRef | null;
  otro?: string | null;
  nota?: string | null;

  reportadoPor: FaltanteReportadoPor;
  origen: FaltanteOrigen;
}

// Movimientos / historial
export type MovimientoFaltanteTipo = 'CREADO' | 'ACEPTADO' | 'FINALIZADO';

export interface MovimientoFaltante {
  id?: string;
  faltanteId: string;
  faltanteCodigo: string;
  tipoMovimiento: MovimientoFaltanteTipo;
  snapshotEstado: FaltanteEstado;

  payload?: any; // opcional (ej: qué cambió)
  actor: {
    tipo: 'PRODUCCION' | 'ADMIN';
    codigo?: string; // empleado
    nombre?: string;
    uid?: string; // admin
  };

  createdAt: FireDate;
}
