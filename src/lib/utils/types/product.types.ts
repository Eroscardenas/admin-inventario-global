// lib/utils/types/product.types.ts
// ✅ FINAL (MAQUINAS + UBICACIONES + FIRESTORE FRIENDLY)
// - Mantiene tu modelo actual (bolsas/barra + stockPorHielo)
// - Agrega soporte para: ubicaciones, máquinas y trazabilidad de movimientos
// - Todo lo nuevo es OPTIONAL para no romper tu app mientras migras
//
// ✅ FIX CLAVE: ProductStatus ahora incluye 'DISPONIBLE' (para BARRA)
//   => Evita: Type '"VACIA" | "DISPONIBLE"' is not assignable to type 'ProductStatus'

/* =====================================================
   CONSTANTES
===================================================== */

export const PESOS_BOLSA = [3, 5, 10, 15, 17, 19, 20] as const;
export type PesoBolsa = (typeof PESOS_BOLSA)[number];

// ✅ Incluye BARRA como tipo de hielo para reportes / dashboard (cuartos)
export const TIPOS_HIELO = ['ROLITO', 'FRAPPE', 'GOURMET', 'ENFRIAR', 'BARRA'] as const;
export type IceType = (typeof TIPOS_HIELO)[number];

export const ETIQUETAS_TIPO_HIELO: Record<IceType, string> = {
  ROLITO: 'Hielo Rolito',
  FRAPPE: 'Hielo Frappé',
  GOURMET: 'Hielo Gourmet',
  ENFRIAR: 'Para Enfriar',
  BARRA: 'Barra (Cuartos)',
};

/* =====================================================
   MAQUINAS / UBICACIONES (NUEVO)
===================================================== */

export const MAQUINAS = ['M1', 'M2', 'M3', 'Maquina Prueba', 'KLYR'] as const;
export type MaquinaId = (typeof MAQUINAS)[number];

export const UBICACIONES = ['PLANTA', 'CAMARA_FRIA', 'ALMACEN', 'RUTA', 'CLIENTE'] as const;
export type UbicacionId = (typeof UBICACIONES)[number];

export const ETIQUETAS_UBICACION: Record<UbicacionId, string> = {
  PLANTA: 'Planta',
  CAMARA_FRIA: 'Cámara fría',
  ALMACEN: 'Almacén',
  RUTA: 'Ruta',
  CLIENTE: 'Cliente',
};

export type UbicacionMaquina = {
  maquina: MaquinaId;
  ubicacion: UbicacionId;
};

/* =====================================================
   FECHAS COMPATIBLES CON FIRESTORE
===================================================== */

export type FireDate = Date | import('firebase/firestore').Timestamp;

/* =====================================================
   TIPOS BÁSICOS
===================================================== */

export type ProductType = 'BARRA' | 'BOLSA';

/**
 * ✅ FIX: incluye DISPONIBLE para BARRA
 * Bolsas: VACIA | ASIGNADA | LLENA
 * Barras: VACIA | DISPONIBLE
 */
export type ProductStatus = 'VACIA' | 'ASIGNADA' | 'LLENA' | 'DISPONIBLE';

export type EstadoAsignacion = 'PENDIENTE' | 'EN_PROGRESO' | 'COMPLETADA' | 'CANCELADA';
export type EstadoStock = 'NORMAL' | 'BAJO' | 'CRITICO' | 'EXCESO';

export type TurnoType = 'MATUTINO' | 'VESPERTINO' | 'NOCTURNO';

/* =====================================================
   CONFIGURACIÓN ADMIN (si la usas por hielo)
===================================================== */

export interface ConfigAdminStockHielo {
  stockMinimo: number;
  stockMaximo: number;
  activo: boolean;
  prioridad: number;
  ultimaActualizacion: FireDate;
  actualizadoPor: string;
}

/* =====================================================
   HISTÓRICO (GENERAL)
===================================================== */

export interface HistoricoItem {
  fecha: FireDate;
  accion: string;
  usuario: string;
  cantidad: number;
  valoresAnteriores?: unknown;
  valoresNuevos?: unknown;
  observaciones?: string;
}

/* =====================================================
   HISTÓRICO DE UBICACIÓN / MAQUINA (NUEVO)
===================================================== */

export type TipoMovimientoUbicacion =
  | 'ENTRADA'
  | 'SALIDA'
  | 'TRANSFERENCIA'
  | 'ASIGNACION_MAQUINA'
  | 'DESASIGNACION_MAQUINA'
  | 'AJUSTE';

export interface HistoricoUbicacionItem {
  fecha: FireDate;
  tipo: TipoMovimientoUbicacion;

  // “de → a” (si aplica)
  deUbicacion?: UbicacionId;
  aUbicacion?: UbicacionId;

  deMaquina?: MaquinaId;
  aMaquina?: MaquinaId;

  usuario: string; // nombre o codigo
  referencia?: string; // folio/movimiento/codigo de orden
  notas?: string;
}

/* =====================================================
   STOCK POR HIELO (por producto bolsa kg)
===================================================== */

export interface StockPorHieloConfig {
  stockMinimo: number;
  stockMaximo: number;
  stockActual: number; // ✅ fuente de verdad
  ultimaActualizacion?: FireDate;
  configAdmin?: ConfigAdminStockHielo;
}

/* =====================================================
   PRODUCTOS
===================================================== */

export interface BaseProduct {
  codigo: string;
  nombre: string;
  tipo: ProductType;
  status: ProductStatus;

  /**
   * cantidad:
   * - Barra: número de barras físicas
   * - Bolsa VACIA/ASIGNADA: número de bolsas físicas
   * - Bolsa LLENA: si lo usas como lote, puede representar un lote
   */
  cantidad: number;

  creadoPor: string;
  fechaCreacion: FireDate;
  ultimaModificacion: FireDate;

  // opcional legacy
  stockMinimo?: number;
  stockMaximo?: number;

  configuracionAdmin?: {
    permiteConfigIndividual: boolean;
    tiposHieloConfigurados: IceType[];
    ultimaConfiguracion: FireDate;
    configuradoPor: string;
  };

  // =====================================================
  // UBICACIONES / MAQUINAS (NUEVO - OPTIONAL)
  // =====================================================
  ubicacionActual?: UbicacionId;
  maquinaActual?: MaquinaId;

  historicoUbicacion?: HistoricoUbicacionItem[];

  ubicacionesPermitidas?: UbicacionId[];

  ubicacionDetalle?: {
    etiqueta?: string; // "Sucursal Centro", "Cliente X", etc.
    direccion?: string;
    contacto?: string;
    telefono?: string;
  };
}

/* ===========================
   BARRA
=========================== */

export interface BarraProduct extends BaseProduct {
  tipo: 'BARRA';
  peso?: number;

  cuartosTotales: number;
  cuartosDisponibles: number;
  cuartosUsados: number;

  bolsasLlenadasConEstaBarra: string[];

  configPorTipoHielo?: Partial<
    Record<
      IceType,
      {
        prioridad: number;
        cuartosReservados: number;
        cuartosUsados: number;
      }
    >
  >;
}

/* ===========================
   BOLSA
=========================== */

export interface BolsaProduct extends BaseProduct {
  tipo: 'BOLSA';

  pesoKg: number;
  tiposHieloPermitidos: IceType[];

  /**
   * ✅ Fuente de verdad de “llenado”: stockActual por IceType
   */
  stockPorHielo?: Record<IceType, StockPorHieloConfig>;

  configuracionEspecifica?: {
    tiposHieloHabilitados: IceType[];
    stockConfigurado: boolean;
    valoresPorDefecto?: { stockMinimo: number; stockMaximo: number };
  };

  // si está LLENA (lote/registro)
  tipoHieloContenido?: IceType;
  llenadoPor?: string;
  fechaLlenado?: FireDate;
  cuartosUsados: number;
  barraOrigen?: string;

  // ✅ trazabilidad de producción
  maquinaLlenado?: MaquinaId;
  ubicacionLlenado?: UbicacionId;

  // si está ASIGNADA
  asignadaA?: string; // código empleado recomendado
  fechaAsignacion?: FireDate;

  // rastreo flujo
  bolsaVaciaOriginal?: string;
  bolsaAsignadaOriginal?: string;

  historico?: HistoricoItem[];
}

export type Product = BarraProduct | BolsaProduct;

/* =====================================================
   STOCK AGREGADO POR HIELO (para dashboard)
===================================================== */

export interface StockTipoHielo {
  tipoHielo: IceType;

  // barra
  barrasTotales?: number;
  cuartosTotales?: number;
  cuartosDisponibles?: number;
  cuartosUsados?: number;

  // bolsas terminadas
  bolsasLlenasTotales: number;
  bolsasLlenasDisponibles: number;
  bolsasLlenasVendidas: number;
  bolsasLlenasCodigos: string[];

  // ✅ min/max GLOBAL por hielo (admin)
  stockMinimo: number;
  stockMaximo: number;

  estado: EstadoStock;
  necesitaProduccion: boolean;
  cantidadNecesaria: number;
  ultimaActualizacion: FireDate;

  configAdmin?: ConfigAdminStockHielo;
}

/* =====================================================
   HELPERS / CREACIÓN DE CONFIG
===================================================== */

export function crearConfigStockHieloInicial(
  tipos: readonly IceType[] = TIPOS_HIELO,
  configAdmin?: Partial<Record<IceType, ConfigAdminStockHielo>>,
  valoresPorDefecto: { stockMinimo: number; stockMaximo: number } = { stockMinimo: 10, stockMaximo: 100 }
): Record<IceType, StockPorHieloConfig> {
  const ahora = new Date();
  const res = {} as Record<IceType, StockPorHieloConfig>;

  tipos.forEach((t) => {
    const c = configAdmin?.[t];
    res[t] = {
      stockMinimo: c?.stockMinimo ?? valoresPorDefecto.stockMinimo,
      stockMaximo: c?.stockMaximo ?? valoresPorDefecto.stockMaximo,
      stockActual: 0,
      ultimaActualizacion: ahora,
      configAdmin: c ? { ...c, ultimaActualizacion: ahora } : undefined,
    };
  });

  return res;
}

export function esBarra(producto: Product): producto is BarraProduct {
  return producto.tipo === 'BARRA';
}

export function esBolsa(producto: Product): producto is BolsaProduct {
  return producto.tipo === 'BOLSA';
}

export function calcularStockTotalBolsa(bolsa: BolsaProduct): number {
  if (!bolsa) return 0;

  // ✅ bolsas físicas (VACIA/ASIGNADA) se cuentan con cantidad
  if (bolsa.status === 'VACIA' || bolsa.status === 'ASIGNADA') return Number(bolsa.cantidad ?? 0);

  // ✅ bolsas llenas agregadas (si usas stockPorHielo)
  if (bolsa.stockPorHielo) {
    return Object.values(bolsa.stockPorHielo).reduce((sum, cfg) => sum + Number(cfg?.stockActual ?? 0), 0);
  }

  return Number(bolsa.cantidad ?? 0);
}

/* =====================================================
   HELPERS UBICACION/MAQUINA (NUEVO - OPCIONAL)
===================================================== */

export function getEtiquetaUbicacion(u?: UbicacionId): string {
  if (!u) return '—';
  return ETIQUETAS_UBICACION[u] ?? u;
}

export function pushHistoricoUbicacion(
  producto: Product,
  item: Omit<HistoricoUbicacionItem, 'fecha'> & { fecha?: FireDate }
): Product {
  const fecha = item.fecha ?? new Date();
  const hist = Array.isArray(producto.historicoUbicacion) ? producto.historicoUbicacion : [];
  const next = [...hist, { ...item, fecha }];

  return {
    ...producto,
    historicoUbicacion: next,
  } as Product;
}