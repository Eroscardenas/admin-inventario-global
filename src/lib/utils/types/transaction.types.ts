// lib/utils/types/transaction.types.ts - ✅ FINAL (TS OK + Firestore friendly + multi-impact)

import type { TurnoType } from './turno.types';
import type {
  ProductType,
  IceType,
  ProductStatus,
  FireDate,
  MaquinaId,
  UbicacionId,
} from './product.types';

// =====================================================
// TIPOS DE MOVIMIENTO (EVENTO)
// =====================================================

export type TipoMovimiento =
  | 'CREACION_BARRA'
  | 'CREACION_BOLSA_VACIA'
  | 'ASIGNACION_BOLSA'
  | 'LLENADO_BOLSA'
  | 'VENTA_BOLSA'
  | 'VENTA_BARRA'
  | 'DEVOLUCION_BOLSA'
  | 'DEVOLUCION_BARRA'
  | 'MERMA_BOLSA'
  | 'MERMA_BARRA'
  | 'USO_CUARTOS_BARRA'
  | 'AJUSTE_STOCK'
  | 'CONFIG_STOCK_GLOBAL_HIELO'
  | 'LLENADO_MANUAL'
  | 'ACTUALIZACION_STOCK';

// =====================================================
// IMPACTOS (multi-impact)
// =====================================================

export type TipoImpacto =
  | 'STOCK_PRODUCTO' // producto.cantidad
  | 'STOCK_POR_HIELO' // producto.stockPorHielo[tipo].stockActual
  | 'CUARTOS_BARRA' // barra.cuartosDisponibles/usados
  | 'CONFIG_GLOBAL_HIELO'; // config global por hielo (si lo logueas)

export interface ImpactoMovimiento {
  tipo: TipoImpacto;

  productoCodigo?: string;
  productoNombre?: string;
  tipoProducto?: ProductType;

  tipoHielo?: IceType;
  status?: ProductStatus;

  delta: number; // + / -
  anterior: number;
  nuevo: number;

  // Solo si aplica a barra
  cuartosDisponiblesAnterior?: number;
  cuartosDisponiblesNuevo?: number;
  cuartosUsadosAnterior?: number;
  cuartosUsadosNuevo?: number;
}

// =====================================================
// MOVIMIENTO PRINCIPAL
// - principal = para UI rápida
// - impactos = verdad de lo que pasó
// =====================================================

export interface Movimiento {
  // Firestore doc id (se agrega al leer)
  id?: string;

  codigo: string; // MOV001
  tipo: TipoMovimiento;

  // entidad principal (para filtros UI)
  productoCodigo: string;
  productoNombre: string;
  tipoProducto: ProductType;

  // resumen rápido del evento (principal)
  deltaPrincipal: number;
  principalAnterior: number;
  principalNuevo: number;

  // contexto
  tipoHielo?: IceType;
  status?: ProductStatus;

  // vínculos (trazabilidad)
  productoOrigenCodigo?: string;
  productoDestinoCodigo?: string;

  bolsaVaciaCodigo?: string;
  bolsaAsignadaCodigo?: string;
  bolsaLlenaCodigo?: string;

  barraOrigenCodigo?: string;
  cuartosUsados?: number;

  // personas
  usuarioCodigo: string; // "admin" o "EMP001"
  usuarioNombre: string;

  empleadoAsignadoCodigo?: string;
  empleadoAsignadoNombre?: string;

  clienteNombre?: string;

  // devoluciones / mermas
  recibidoPor?: string;
  motivo?: string;
  motivoRechazo?: string;
  accionesTomadas?: string;

  // ✅ extras usados por UI (monitoreo / salidas / devoluciones)
  origen?: 'ADMIN' | 'PRODUCCION';
  maquina?: MaquinaId;
  ubicacion?: UbicacionId;
  pesoKg?: number;
  destinatario?: string;

  // fechas
  fecha: FireDate;

  // ✅ turno puede faltar en movimientos viejos
  turno?: TurnoType;

  // extras
  observaciones?: string;

  // dinero/reportes
  precioUnitario?: number;
  valorTotal?: number;
  unidadMedida?: string;

  // ✅ impactos reales
  impactos: ImpactoMovimiento[];
}

// =====================================================
// MOVIMIENTO COMPUESTO (opcional)
// =====================================================

export interface MovimientoCompuesto {
  codigo: string; // MCP001
  movimientos: Movimiento[];

  bolsaVaciaCodigo: string;
  bolsaAsignadaCodigo: string;
  bolsaLlenaCodigo: string;
  barraOrigenCodigo?: string;

  cantidadTotal: number;
  cuartosUsadosTotal: number;

  creadoPor: string;
  asignadoPor: string;
  asignadoA: string;
  llenadoPor: string;

  fechaInicio: FireDate;
  fechaFin: FireDate;
  duracionMinutos: number;
}

// =====================================================
// HELPERS
// =====================================================

export function obtenerTurnoActual(): TurnoType {
  const hora = new Date().getHours();
  if (hora >= 6 && hora < 14) return 'MATUTINO';
  if (hora >= 14 && hora < 22) return 'VESPERTINO';
  return 'NOCTURNO';
}

type MovimientoInput = Omit<Movimiento, 'codigo' | 'fecha' | 'turno'> & {
  // si tu service lo pone después, dejamos vacío
  codigo?: string;
  fecha?: FireDate;
  turno?: TurnoType;
};

function crearBaseMovimiento(input: MovimientoInput): Movimiento {
  return {
    codigo: input.codigo ?? '',
    ...input,
    fecha: (input.fecha ?? new Date()) as FireDate,
    turno: input.turno ?? obtenerTurnoActual(),
  };
}

// =====================================================
// FACTORIES (flujo real)
// =====================================================

export function crearMovimientoCreacion(params: {
  productoCodigo: string;
  productoNombre: string;
  tipoProducto: ProductType; // 'BARRA' | 'BOLSA'
  status?: ProductStatus; // si es bolsa vacía => 'VACIA'
  cantidadAgregada: number;
  stockAnterior: number;
  stockNuevo: number;
  adminCodigo?: string;
  adminNombre?: string;

  // opcionales de contexto
  origen?: 'ADMIN' | 'PRODUCCION';
  maquina?: MaquinaId;
  ubicacion?: UbicacionId;
  pesoKg?: number;
}): Movimiento {
  const tipo: TipoMovimiento = params.tipoProducto === 'BARRA' ? 'CREACION_BARRA' : 'CREACION_BOLSA_VACIA';

  const statusFinal: ProductStatus | undefined =
    params.tipoProducto === 'BOLSA' ? (params.status ?? 'VACIA') : undefined;

  return crearBaseMovimiento({
    tipo,
    productoCodigo: params.productoCodigo,
    productoNombre: params.productoNombre,
    tipoProducto: params.tipoProducto,
    deltaPrincipal: params.cantidadAgregada,
    principalAnterior: params.stockAnterior,
    principalNuevo: params.stockNuevo,
    status: statusFinal,
    usuarioCodigo: params.adminCodigo ?? 'admin',
    usuarioNombre: params.adminNombre ?? 'Administrador',

    origen: params.origen ?? 'ADMIN',
    maquina: params.maquina,
    ubicacion: params.ubicacion,
    pesoKg: params.pesoKg,

    impactos: [
      {
        tipo: 'STOCK_PRODUCTO',
        productoCodigo: params.productoCodigo,
        productoNombre: params.productoNombre,
        tipoProducto: params.tipoProducto,
        status: statusFinal,
        delta: params.cantidadAgregada,
        anterior: params.stockAnterior,
        nuevo: params.stockNuevo,
      },
    ],
  });
}

/**
 * ASIGNACIÓN:
 * - BV (vacías) baja
 * - BA (asignadas) sube
 */
export function crearMovimientoAsignacion(params: {
  bolsaVaciaCodigo: string;
  bolsaVaciaNombre: string;
  stockVacioAnterior: number;
  stockVacioNuevo: number;

  bolsaAsignadaCodigo: string;
  bolsaAsignadaNombre: string;
  stockAsignadaAnterior: number;
  stockAsignadaNuevo: number;

  cantidad: number;

  empleadoCodigo: string;
  empleadoNombre: string;

  adminCodigo?: string;
  adminNombre?: string;

  maquina?: MaquinaId;
  ubicacion?: UbicacionId;
  pesoKg?: number;
}): Movimiento {
  return crearBaseMovimiento({
    tipo: 'ASIGNACION_BOLSA',

    // principal = destino (asignadas)
    productoCodigo: params.bolsaAsignadaCodigo,
    productoNombre: params.bolsaAsignadaNombre,
    tipoProducto: 'BOLSA',

    deltaPrincipal: +params.cantidad,
    principalAnterior: params.stockAsignadaAnterior,
    principalNuevo: params.stockAsignadaNuevo,

    status: 'ASIGNADA',

    usuarioCodigo: params.adminCodigo ?? 'admin',
    usuarioNombre: params.adminNombre ?? 'Administrador',

    origen: 'ADMIN',
    maquina: params.maquina,
    ubicacion: params.ubicacion,
    pesoKg: params.pesoKg,

    empleadoAsignadoCodigo: params.empleadoCodigo,
    empleadoAsignadoNombre: params.empleadoNombre,

    productoOrigenCodigo: params.bolsaVaciaCodigo,
    productoDestinoCodigo: params.bolsaAsignadaCodigo,

    bolsaVaciaCodigo: params.bolsaVaciaCodigo,
    bolsaAsignadaCodigo: params.bolsaAsignadaCodigo,

    observaciones: `Asignado a ${params.empleadoNombre}`,

    impactos: [
      {
        tipo: 'STOCK_PRODUCTO',
        productoCodigo: params.bolsaVaciaCodigo,
        productoNombre: params.bolsaVaciaNombre,
        tipoProducto: 'BOLSA',
        status: 'VACIA',
        delta: -params.cantidad,
        anterior: params.stockVacioAnterior,
        nuevo: params.stockVacioNuevo,
      },
      {
        tipo: 'STOCK_PRODUCTO',
        productoCodigo: params.bolsaAsignadaCodigo,
        productoNombre: params.bolsaAsignadaNombre,
        tipoProducto: 'BOLSA',
        status: 'ASIGNADA',
        delta: +params.cantidad,
        anterior: params.stockAsignadaAnterior,
        nuevo: params.stockAsignadaNuevo,
      },
    ],
  });
}

/**
 * LLENADO:
 * - BA (asignadas) baja
 * - stockPorHielo[tipo] sube (terminado REAL)
 * - si es barra: cuartos baja/usados sube
 */
export function crearMovimientoLlenado(params: {
  bolsaAsignadaCodigo: string;
  bolsaAsignadaNombre: string;
  stockAsignadaAnterior: number;
  stockAsignadaNuevo: number;

  // “producto terminado” (típicamente el producto bolsa kg)
  productoTerminadoCodigo: string;
  productoTerminadoNombre: string;

  tipoHielo: IceType;

  // stockPorHielo del producto terminado
  stockHieloAnterior: number;
  stockHieloNuevo: number;

  cantidad: number;

  empleadoCodigo: string;
  empleadoNombre: string;

  // barra opcional
  barraOrigenCodigo?: string;
  cuartosUsados?: number;
  barra?: {
    cuartosDisponiblesAnterior: number;
    cuartosDisponiblesNuevo: number;
    cuartosUsadosAnterior: number;
    cuartosUsadosNuevo: number;
  };

  // opcional: si generas un código BLxxxx como entidad
  bolsaLlenaCodigo?: string;

  // contexto
  turno?: TurnoType;
  maquina?: MaquinaId;
  ubicacion?: UbicacionId;
  pesoKg?: number;
}): Movimiento {
  const impactos: ImpactoMovimiento[] = [
    {
      tipo: 'STOCK_PRODUCTO',
      productoCodigo: params.bolsaAsignadaCodigo,
      productoNombre: params.bolsaAsignadaNombre,
      tipoProducto: 'BOLSA',
      status: 'ASIGNADA',
      delta: -params.cantidad,
      anterior: params.stockAsignadaAnterior,
      nuevo: params.stockAsignadaNuevo,
    },
    {
      tipo: 'STOCK_POR_HIELO',
      productoCodigo: params.productoTerminadoCodigo,
      productoNombre: params.productoTerminadoNombre,
      tipoProducto: 'BOLSA',
      tipoHielo: params.tipoHielo,
      status: 'LLENA',
      delta: +params.cantidad,
      anterior: params.stockHieloAnterior,
      nuevo: params.stockHieloNuevo,
    },
  ];

  if (params.barraOrigenCodigo && typeof params.cuartosUsados === 'number' && params.barra) {
    impactos.push({
      tipo: 'CUARTOS_BARRA',
      productoCodigo: params.barraOrigenCodigo,
      productoNombre: 'Barra Origen',
      tipoProducto: 'BARRA',
      delta: -params.cuartosUsados,
      anterior: params.barra.cuartosDisponiblesAnterior,
      nuevo: params.barra.cuartosDisponiblesNuevo,
      cuartosDisponiblesAnterior: params.barra.cuartosDisponiblesAnterior,
      cuartosDisponiblesNuevo: params.barra.cuartosDisponiblesNuevo,
      cuartosUsadosAnterior: params.barra.cuartosUsadosAnterior,
      cuartosUsadosNuevo: params.barra.cuartosUsadosNuevo,
    });
  }

  return crearBaseMovimiento({
    tipo: 'LLENADO_BOLSA',

    productoCodigo: params.productoTerminadoCodigo,
    productoNombre: params.productoTerminadoNombre,
    tipoProducto: 'BOLSA',

    deltaPrincipal: +params.cantidad,
    principalAnterior: params.stockHieloAnterior,
    principalNuevo: params.stockHieloNuevo,

    tipoHielo: params.tipoHielo,
    status: 'LLENA',

    usuarioCodigo: params.empleadoCodigo,
    usuarioNombre: params.empleadoNombre,

    origen: 'PRODUCCION',
    turno: params.turno,
    maquina: params.maquina,
    ubicacion: params.ubicacion,
    pesoKg: params.pesoKg,

    productoOrigenCodigo: params.bolsaAsignadaCodigo,
    productoDestinoCodigo: params.productoTerminadoCodigo,

    bolsaAsignadaCodigo: params.bolsaAsignadaCodigo,
    bolsaLlenaCodigo: params.bolsaLlenaCodigo,

    barraOrigenCodigo: params.barraOrigenCodigo,
    cuartosUsados: params.cuartosUsados,

    observaciones: `Llenado con ${params.tipoHielo}`,
    impactos,
  });
}

/**
 * VENTA:
 * - baja stock (producto o stockPorHielo dependiendo tu estrategia)
 */
export function crearMovimientoVenta(params: {
  tipoProducto: ProductType; // BOLSA | BARRA
  productoCodigo: string;
  productoNombre: string;

  cantidad: number;

  principalAnterior: number;
  principalNuevo: number;

  usuarioCodigo: string;
  usuarioNombre: string;

  // si bolsa por hielo:
  tipoHielo?: IceType;
  impactoPorHielo?: {
    stockHieloAnterior: number;
    stockHieloNuevo: number;
  };

  clienteNombre?: string;
  destinatario?: string;
  precioUnitario?: number;
  valorTotal?: number;
  unidadMedida?: string;
  observaciones?: string;

  // contexto
  origen?: 'ADMIN' | 'PRODUCCION';
  turno?: TurnoType;
  maquina?: MaquinaId;
  ubicacion?: UbicacionId;
  pesoKg?: number;
}): Movimiento {
  const tipo: TipoMovimiento = params.tipoProducto === 'BARRA' ? 'VENTA_BARRA' : 'VENTA_BOLSA';

  const impactos: ImpactoMovimiento[] = [];

  impactos.push({
    tipo: 'STOCK_PRODUCTO',
    productoCodigo: params.productoCodigo,
    productoNombre: params.productoNombre,
    tipoProducto: params.tipoProducto,
    delta: -Math.abs(params.cantidad),
    anterior: params.principalAnterior,
    nuevo: params.principalNuevo,
  });

  if (params.tipoProducto === 'BOLSA' && params.tipoHielo && params.impactoPorHielo) {
    impactos.push({
      tipo: 'STOCK_POR_HIELO',
      productoCodigo: params.productoCodigo,
      productoNombre: params.productoNombre,
      tipoProducto: 'BOLSA',
      tipoHielo: params.tipoHielo,
      status: 'LLENA',
      delta: -Math.abs(params.cantidad),
      anterior: params.impactoPorHielo.stockHieloAnterior,
      nuevo: params.impactoPorHielo.stockHieloNuevo,
    });
  }

  return crearBaseMovimiento({
    tipo,
    productoCodigo: params.productoCodigo,
    productoNombre: params.productoNombre,
    tipoProducto: params.tipoProducto,

    deltaPrincipal: -Math.abs(params.cantidad),
    principalAnterior: params.principalAnterior,
    principalNuevo: params.principalNuevo,

    usuarioCodigo: params.usuarioCodigo,
    usuarioNombre: params.usuarioNombre,

    tipoHielo: params.tipoHielo,
    clienteNombre: params.clienteNombre,
    destinatario: params.destinatario,

    origen: params.origen,
    turno: params.turno,
    maquina: params.maquina,
    ubicacion: params.ubicacion,
    pesoKg: params.pesoKg,

    precioUnitario: params.precioUnitario,
    valorTotal: params.valorTotal,
    unidadMedida: params.unidadMedida,

    observaciones: params.observaciones ?? 'Venta',
    impactos,
  });
}

/**
 * DEVOLUCIÓN:
 * - sube stock (producto o stockPorHielo)
 */
export function crearMovimientoDevolucion(params: {
  tipoProducto: ProductType; // BOLSA | BARRA
  productoCodigo: string;
  productoNombre: string;

  cantidad: number;

  principalAnterior: number;
  principalNuevo: number;

  usuarioCodigo: string;
  usuarioNombre: string;

  // si bolsa por hielo:
  tipoHielo?: IceType;
  impactoPorHielo?: {
    stockHieloAnterior: number;
    stockHieloNuevo: number;
  };

  motivo?: string;
  recibidoPor?: string;
  destinatario?: string;
  observaciones?: string;

  // contexto
  origen?: 'ADMIN' | 'PRODUCCION';
  turno?: TurnoType;
  maquina?: MaquinaId;
  ubicacion?: UbicacionId;
  pesoKg?: number;
}): Movimiento {
  const tipo: TipoMovimiento = params.tipoProducto === 'BARRA' ? 'DEVOLUCION_BARRA' : 'DEVOLUCION_BOLSA';

  const impactos: ImpactoMovimiento[] = [];

  impactos.push({
    tipo: 'STOCK_PRODUCTO',
    productoCodigo: params.productoCodigo,
    productoNombre: params.productoNombre,
    tipoProducto: params.tipoProducto,
    delta: +Math.abs(params.cantidad),
    anterior: params.principalAnterior,
    nuevo: params.principalNuevo,
  });

  if (params.tipoProducto === 'BOLSA' && params.tipoHielo && params.impactoPorHielo) {
    impactos.push({
      tipo: 'STOCK_POR_HIELO',
      productoCodigo: params.productoCodigo,
      productoNombre: params.productoNombre,
      tipoProducto: 'BOLSA',
      tipoHielo: params.tipoHielo,
      status: 'LLENA',
      delta: +Math.abs(params.cantidad),
      anterior: params.impactoPorHielo.stockHieloAnterior,
      nuevo: params.impactoPorHielo.stockHieloNuevo,
    });
  }

  return crearBaseMovimiento({
    tipo,
    productoCodigo: params.productoCodigo,
    productoNombre: params.productoNombre,
    tipoProducto: params.tipoProducto,

    deltaPrincipal: +Math.abs(params.cantidad),
    principalAnterior: params.principalAnterior,
    principalNuevo: params.principalNuevo,

    usuarioCodigo: params.usuarioCodigo,
    usuarioNombre: params.usuarioNombre,

    tipoHielo: params.tipoHielo,
    motivo: params.motivo,
    recibidoPor: params.recibidoPor,
    destinatario: params.destinatario,

    origen: params.origen,
    turno: params.turno,
    maquina: params.maquina,
    ubicacion: params.ubicacion,
    pesoKg: params.pesoKg,

    observaciones: params.observaciones ?? 'Devolución',
    impactos,
  });
}

/**
 * MERMA:
 * - baja stock (producto o stockPorHielo si aplica)
 */
export function crearMovimientoMerma(params: {
  tipoProducto: ProductType; // BOLSA | BARRA
  productoCodigo: string;
  productoNombre: string;

  cantidad: number;

  principalAnterior: number;
  principalNuevo: number;

  usuarioCodigo: string;
  usuarioNombre: string;

  tipoHielo?: IceType;
  impactoPorHielo?: {
    stockHieloAnterior: number;
    stockHieloNuevo: number;
  };

  motivo: string;
  observaciones?: string;

  // contexto
  origen?: 'ADMIN' | 'PRODUCCION';
  turno?: TurnoType;
  maquina?: MaquinaId;
  ubicacion?: UbicacionId;
  pesoKg?: number;
}): Movimiento {
  const tipo: TipoMovimiento = params.tipoProducto === 'BARRA' ? 'MERMA_BARRA' : 'MERMA_BOLSA';

  const impactos: ImpactoMovimiento[] = [];

  impactos.push({
    tipo: 'STOCK_PRODUCTO',
    productoCodigo: params.productoCodigo,
    productoNombre: params.productoNombre,
    tipoProducto: params.tipoProducto,
    delta: -Math.abs(params.cantidad),
    anterior: params.principalAnterior,
    nuevo: params.principalNuevo,
  });

  if (params.tipoProducto === 'BOLSA' && params.tipoHielo && params.impactoPorHielo) {
    impactos.push({
      tipo: 'STOCK_POR_HIELO',
      productoCodigo: params.productoCodigo,
      productoNombre: params.productoNombre,
      tipoProducto: 'BOLSA',
      tipoHielo: params.tipoHielo,
      status: 'LLENA',
      delta: -Math.abs(params.cantidad),
      anterior: params.impactoPorHielo.stockHieloAnterior,
      nuevo: params.impactoPorHielo.stockHieloNuevo,
    });
  }

  return crearBaseMovimiento({
    tipo,
    productoCodigo: params.productoCodigo,
    productoNombre: params.productoNombre,
    tipoProducto: params.tipoProducto,

    deltaPrincipal: -Math.abs(params.cantidad),
    principalAnterior: params.principalAnterior,
    principalNuevo: params.principalNuevo,

    usuarioCodigo: params.usuarioCodigo,
    usuarioNombre: params.usuarioNombre,

    tipoHielo: params.tipoHielo,
    motivo: params.motivo,

    origen: params.origen,
    turno: params.turno,
    maquina: params.maquina,
    ubicacion: params.ubicacion,
    pesoKg: params.pesoKg,

    observaciones: params.observaciones ?? `Merma: ${params.motivo}`,
    impactos,
  });
}

/**
 * AJUSTE / ACTUALIZACIÓN (manual/admin)
 */
export function crearMovimientoAjusteStock(params: {
  tipo: 'AJUSTE_STOCK' | 'ACTUALIZACION_STOCK' | 'LLENADO_MANUAL';
  productoCodigo: string;
  productoNombre: string;
  tipoProducto: ProductType;

  delta: number;
  anterior: number;
  nuevo: number;

  usuarioCodigo: string;
  usuarioNombre: string;

  tipoHielo?: IceType;
  status?: ProductStatus;

  motivo?: string;
  observaciones?: string;

  // si quieres también impactar stockPorHielo
  impactoPorHielo?: {
    stockHieloAnterior: number;
    stockHieloNuevo: number;
  };

  // contexto
  origen?: 'ADMIN' | 'PRODUCCION';
  turno?: TurnoType;
  maquina?: MaquinaId;
  ubicacion?: UbicacionId;
  pesoKg?: number;
}): Movimiento {
  const impactos: ImpactoMovimiento[] = [
    {
      tipo: 'STOCK_PRODUCTO',
      productoCodigo: params.productoCodigo,
      productoNombre: params.productoNombre,
      tipoProducto: params.tipoProducto,
      status: params.status,
      delta: params.delta,
      anterior: params.anterior,
      nuevo: params.nuevo,
    },
  ];

  if (params.tipoHielo && params.impactoPorHielo) {
    impactos.push({
      tipo: 'STOCK_POR_HIELO',
      productoCodigo: params.productoCodigo,
      productoNombre: params.productoNombre,
      tipoProducto: params.tipoProducto,
      tipoHielo: params.tipoHielo,
      status: params.status,
      delta: params.delta,
      anterior: params.impactoPorHielo.stockHieloAnterior,
      nuevo: params.impactoPorHielo.stockHieloNuevo,
    });
  }

  return crearBaseMovimiento({
    tipo: params.tipo,
    productoCodigo: params.productoCodigo,
    productoNombre: params.productoNombre,
    tipoProducto: params.tipoProducto,

    deltaPrincipal: params.delta,
    principalAnterior: params.anterior,
    principalNuevo: params.nuevo,

    usuarioCodigo: params.usuarioCodigo,
    usuarioNombre: params.usuarioNombre,

    tipoHielo: params.tipoHielo,
    status: params.status,

    origen: params.origen,
    turno: params.turno,
    maquina: params.maquina,
    ubicacion: params.ubicacion,
    pesoKg: params.pesoKg,

    motivo: params.motivo,
    observaciones: params.observaciones ?? params.tipo,

    impactos,
  });
}

// =====================================================
// UI META (Lucide icon name como string)
// =====================================================

export const TIPOS_MOVIMIENTO_UI: Record<TipoMovimiento, { texto: string; color: string; icon: string; esEntrada: boolean }> =
  {
    CREACION_BARRA: { texto: 'Creación Barra', color: 'green', icon: 'IceCream', esEntrada: true },
    CREACION_BOLSA_VACIA: { texto: 'Creación Bolsa Vacía', color: 'green', icon: 'PackagePlus', esEntrada: true },
    ASIGNACION_BOLSA: { texto: 'Asignación', color: 'blue', icon: 'UserCheck', esEntrada: false },
    LLENADO_BOLSA: { texto: 'Llenado', color: 'cyan', icon: 'Factory', esEntrada: true },
    VENTA_BOLSA: { texto: 'Venta Bolsa', color: 'orange', icon: 'ShoppingCart', esEntrada: false },
    VENTA_BARRA: { texto: 'Venta Barra', color: 'orange', icon: 'ShoppingCart', esEntrada: false },
    DEVOLUCION_BOLSA: { texto: 'Devolución Bolsa', color: 'yellow', icon: 'Undo2', esEntrada: true },
    DEVOLUCION_BARRA: { texto: 'Devolución Barra', color: 'yellow', icon: 'Undo2', esEntrada: true },
    MERMA_BOLSA: { texto: 'Merma Bolsa', color: 'red', icon: 'Trash2', esEntrada: false },
    MERMA_BARRA: { texto: 'Merma Barra', color: 'red', icon: 'Trash2', esEntrada: false },
    USO_CUARTOS_BARRA: { texto: 'Uso Cuartos Barra', color: 'purple', icon: 'Zap', esEntrada: false },
    AJUSTE_STOCK: { texto: 'Ajuste Stock', color: 'gray', icon: 'SlidersHorizontal', esEntrada: true },
    CONFIG_STOCK_GLOBAL_HIELO: { texto: 'Config Stock Global', color: 'indigo', icon: 'Settings', esEntrada: false },
    LLENADO_MANUAL: { texto: 'Llenado Manual', color: 'teal', icon: 'Wrench', esEntrada: true },
    ACTUALIZACION_STOCK: { texto: 'Actualización Stock', color: 'teal', icon: 'Wrench', esEntrada: true },
  };

export function getMovimientoMeta(tipo: TipoMovimiento) {
  return (
    TIPOS_MOVIMIENTO_UI[tipo] ?? {
      texto: tipo,
      color: 'gray',
      icon: 'CircleHelp',
      esEntrada: false,
    }
  );
}
