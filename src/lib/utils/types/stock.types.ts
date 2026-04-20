// lib/utils/types/stock.types.ts
// =====================================================
// STOCK TYPES - COMPATIBLE con stock.service.ts y product.types.ts
// - Soporta min/max GLOBAL por hielo (admin) vía StockGlobalPorHielo
// - Resumen usa stockPorHielo como fuente de verdad para bolsas llenas por hielo
// =====================================================

import {
  Product,
  BarraProduct,
  BolsaProduct,
  IceType,
  ProductType,
  ProductStatus,
  StockPorHieloConfig,
  StockTipoHielo,
  TIPOS_HIELO,
  esBarra,
  esBolsa,
  calcularStockTotalBolsa,
  FireDate,
} from '@/lib/utils/types/product.types';

// =====================================================
// CONFIG GLOBAL POR HIELO (ADMIN)
// =====================================================

export interface StockGlobalPorHielo {
  stockMinimo: number;
  stockMaximo: number;
  activo: boolean;
  prioridad?: number;
  actualizadoPor?: string;
  ultimaActualizacion?: FireDate;
}

// =====================================================
// TIPOS AUXILIARES
// =====================================================

export type StockEstado = 'NORMAL' | 'BAJO' | 'CRITICO' | 'EXCESO';

export type TipoAlertaStock =
  | 'BARRA_CUARTOS'
  | 'BOLSA_VACIA'
  | 'BOLSA_ASIGNADA'
  | 'BOLSA_LLENA'
  | 'PRODUCTO_GENERAL'
  | 'STOCK_POR_HIELO';

// =====================================================
// HELPERS INTERNOS
// =====================================================

function calcEstadoStock(stockActual: number, stockMinimo?: number, stockMaximo?: number): StockEstado {
  const min = Number(stockMinimo ?? 0);
  const max = Number(stockMaximo ?? 0);

  if (min > 0 && stockActual <= 0) return 'CRITICO';
  if (min > 0 && stockActual < min) return 'BAJO';
  if (max > 0 && stockActual > max) return 'EXCESO';
  return 'NORMAL';
}

function calcPrioridad(estado: StockEstado): number {
  switch (estado) {
    case 'CRITICO':
      return 1;
    case 'BAJO':
      return 2;
    case 'EXCESO':
      return 3;
    case 'NORMAL':
    default:
      return 99;
  }
}

function defaultGlobalConfig(): Record<IceType, StockGlobalPorHielo> {
  const now = new Date();
  const res = {} as Record<IceType, StockGlobalPorHielo>;
  (TIPOS_HIELO as readonly IceType[]).forEach((t) => {
    res[t] = { stockMinimo: 0, stockMaximo: 0, activo: true, prioridad: 0, ultimaActualizacion: now };
  });
  return res;
}

// =====================================================
// ALERTAS
// =====================================================

export interface StockAlerta {
  id: string;
  codigo: string;
  nombre: string;
  tipo: ProductType;

  estado: StockEstado;
  prioridad: number;

  stockActual: number;
  stockMinimo?: number;
  stockMaximo?: number;

  status?: ProductStatus;
  tipoHielo?: IceType;
  cuartosDisponibles?: number;
  cuartosTotales?: number;

  mensaje: string;
  tipoAlerta: TipoAlertaStock;

  fecha: FireDate;
}

/**
 * ✅ Crea una alerta “general” por producto (lo que tu service usa).
 * - Para BARRA: evalúa por cuartos disponibles
 * - Para BOLSA: evalúa por cantidad y contextualiza si LLENA + tipoHielo
 */
export function crearAlerta(
  codigo: string,
  nombre: string,
  tipo: ProductType,
  stockActual: number,
  tipoHielo?: IceType,
  status?: ProductStatus,
  stockMinimo?: number,
  stockMaximo?: number,
  cuartosDisponibles?: number,
  cuartosTotales?: number
): StockAlerta {
  let tipoAlerta: TipoAlertaStock = 'PRODUCTO_GENERAL';

  if (tipo === 'BARRA') tipoAlerta = 'BARRA_CUARTOS';
  if (tipo === 'BOLSA') {
    if (status === 'VACIA') tipoAlerta = 'BOLSA_VACIA';
    else if (status === 'ASIGNADA') tipoAlerta = 'BOLSA_ASIGNADA';
    else if (status === 'LLENA') tipoAlerta = 'BOLSA_LLENA';
  }

  // BARRA: se decide con cuartos
  if (tipo === 'BARRA') {
    const disp = Number(cuartosDisponibles ?? 0);
    const tot = Number(cuartosTotales ?? 0);

    const estadoFinal = calcEstadoStock(disp, stockMinimo, stockMaximo);
    const prioridadFinal = calcPrioridad(estadoFinal);

    let mensaje = `Cuartos OK: ${disp}/${tot}`;
    if (estadoFinal === 'CRITICO') mensaje = `Sin cuartos disponibles`;
    else if (estadoFinal === 'BAJO') mensaje = `Cuartos bajos: ${disp}/${tot}`;
    else if (estadoFinal === 'EXCESO') mensaje = `Cuartos arriba del máximo: ${disp}/${tot}`;

    return {
      id: codigo,
      codigo,
      nombre,
      tipo,
      estado: estadoFinal,
      prioridad: prioridadFinal,
      stockActual: disp,
      stockMinimo,
      stockMaximo,
      status,
      tipoHielo,
      cuartosDisponibles: disp,
      cuartosTotales: tot,
      mensaje,
      tipoAlerta,
      fecha: new Date(),
    };
  }

  // BOLSA / general
  const estado = calcEstadoStock(stockActual, stockMinimo, stockMaximo);
  const prioridad = calcPrioridad(estado);

  let mensaje = `Stock OK: ${stockActual}`;
  if (estado === 'CRITICO') mensaje = `Stock en 0`;
  else if (estado === 'BAJO') mensaje = `Stock bajo: ${stockActual} (min ${stockMinimo ?? 0})`;
  else if (estado === 'EXCESO') mensaje = `Stock excedido: ${stockActual} (max ${stockMaximo ?? 0})`;

  if (tipo === 'BOLSA' && status === 'LLENA' && tipoHielo) {
    mensaje = `${mensaje} - ${tipoHielo}`;
  }

  return {
    id: codigo,
    codigo,
    nombre,
    tipo,
    estado,
    prioridad,
    stockActual,
    stockMinimo,
    stockMaximo,
    status,
    tipoHielo,
    cuartosDisponibles,
    cuartosTotales,
    mensaje,
    tipoAlerta,
    fecha: new Date(),
  };
}

// =====================================================
// HISTÓRICO
// =====================================================

export interface StockHistoricoEntry {
  id: string;

  bolsaId: string;
  productoNombre: string;
  tipoHielo: IceType;

  stockActual: number;
  stockMinimo: number;
  stockMaximo: number;

  status?: ProductStatus;
  motivo?: string;

  fechaRegistro: FireDate;
  fechaCreacion: FireDate;
}

// =====================================================
// RESULTADO DE ACTUALIZACIÓN
// =====================================================

export interface StockActualizacionResultado {
  ok: boolean;

  codigo: string;
  nombre: string;
  tipo: ProductType;

  stockAnterior: number;
  stockNuevo: number;
  diferencia: number;

  mensaje: string;
  datosExtra?: Record<string, any>;

  fecha: FireDate;
}

export function formatearResultadoActualizacion(
  ok: boolean,
  codigo: string,
  nombre: string,
  tipo: ProductType,
  stockAnterior: number,
  stockNuevo: number,
  datosExtra?: Record<string, any>
): StockActualizacionResultado {
  const diferencia = Number(stockNuevo ?? 0) - Number(stockAnterior ?? 0);

  const mensaje = ok
    ? `✅ Stock actualizado: ${stockAnterior} → ${stockNuevo} (${diferencia >= 0 ? '+' : ''}${diferencia})`
    : `❌ No se pudo actualizar stock para ${codigo}`;

  return {
    ok,
    codigo,
    nombre,
    tipo,
    stockAnterior,
    stockNuevo,
    diferencia,
    mensaje,
    datosExtra,
    fecha: new Date(),
  };
}

// =====================================================
// RESUMEN DE STOCK
// =====================================================

export interface StockResumen {
  totalProductos: number;

  totalBarras: number;
  totalBolsasVacias: number;
  totalBolsasAsignadas: number;
  totalBolsasLlenas: number;

  cuartosTotales: number;
  cuartosDisponibles: number;
  cuartosUsados: number;

  // ✅ agregado por hielo (min/max GLOBAL)
  stockPorTipoHielo: Record<IceType, StockTipoHielo>;

  productosBajoStock: number;
  productosCriticos: number;

  // ✅ opcional: devolver config global leída
  configGlobalPorHielo?: Record<IceType, StockGlobalPorHielo>;

  ultimaActualizacion: FireDate;
}

/**
 * ✅ Calcula resumen del stock para dashboard.
 * - Bolsas LLENAS: usa calcularStockTotalBolsa() (si hay stockPorHielo suma stockActual)
 * - Por hielo: suma stockPorHielo[t].stockActual de todas las bolsas
 * - Min/Max GLOBAL por hielo: viene de configGlobalPorHielo (si se pasa)
 */
export function calcularResumenStock(
  productos: Product[],
  configGlobalPorHielo?: Record<IceType, StockGlobalPorHielo>
): StockResumen {
  const cfgGlobal = configGlobalPorHielo ?? defaultGlobalConfig();

  const barras = productos.filter(esBarra) as BarraProduct[];
  const bolsas = productos.filter(esBolsa) as BolsaProduct[];

  const bolsasVacias = bolsas.filter((b) => b.status === 'VACIA');
  const bolsasAsignadas = bolsas.filter((b) => b.status === 'ASIGNADA');
  const bolsasLlenas = bolsas.filter((b) => b.status === 'LLENA');

  // En tu modelo “cantidad” en barra es barras físicas; y cuartos viven aparte
  const totalBarras = barras.length;

  const totalBolsasVacias = bolsasVacias.reduce((s, b) => s + Number(b.cantidad ?? 0), 0);
  const totalBolsasAsignadas = bolsasAsignadas.reduce((s, b) => s + Number(b.cantidad ?? 0), 0);

  // LLENAS: fuente de verdad si hay stockPorHielo
  const totalBolsasLlenas = bolsasLlenas.reduce((s, b) => s + calcularStockTotalBolsa(b), 0);

  const cuartosTotales = barras.reduce((s, b) => s + Number(b.cuartosTotales ?? 0), 0);
  const cuartosDisponibles = barras.reduce((s, b) => s + Number(b.cuartosDisponibles ?? 0), 0);
  const cuartosUsados = barras.reduce((s, b) => s + Number(b.cuartosUsados ?? 0), 0);

  // Inicializa stockPorTipoHielo con min/max GLOBAL
  const stockPorTipoHielo = {} as Record<IceType, StockTipoHielo>;
  (TIPOS_HIELO as readonly IceType[]).forEach((t) => {
    const g = cfgGlobal[t];
    stockPorTipoHielo[t] = {
      tipoHielo: t,

      // barra: lo llenamos abajo solo en BARRA
      barrasTotales: 0,
      cuartosTotales: 0,
      cuartosDisponibles: 0,
      cuartosUsados: 0,

      bolsasLlenasTotales: 0,
      bolsasLlenasDisponibles: 0,
      bolsasLlenasVendidas: 0,
      bolsasLlenasCodigos: [],

      stockMinimo: Number(g?.stockMinimo ?? 0),
      stockMaximo: Number(g?.stockMaximo ?? 0),

      estado: 'NORMAL',
      necesitaProduccion: false,
      cantidadNecesaria: 0,
      ultimaActualizacion: new Date(),
    };
  });

  // Métricas de barra en el tipo "BARRA"
  const barraAgg = stockPorTipoHielo['BARRA'];
  barraAgg.barrasTotales = totalBarras;
  barraAgg.cuartosTotales = cuartosTotales;
  barraAgg.cuartosDisponibles = cuartosDisponibles;
  barraAgg.cuartosUsados = cuartosUsados;

  // Suma por hielo desde stockPorHielo (fuente de verdad)
  bolsas.forEach((b) => {
    const sPH = b.stockPorHielo;
    if (!sPH) return;

    (Object.entries(sPH) as Array<[IceType, StockPorHieloConfig]>).forEach(([tipo, cfg]) => {
      const val = Number(cfg?.stockActual ?? 0);
      const item = stockPorTipoHielo[tipo];
      if (!item) return;

      item.bolsasLlenasTotales += val;
      item.bolsasLlenasDisponibles += val;

      if (val > 0) item.bolsasLlenasCodigos.push(b.codigo);

      // Si viene configAdmin por hielo, lo reflejamos (UI)
      if (cfg?.configAdmin) {
        item.configAdmin = cfg.configAdmin;
      }
    });
  });

  // Calcula estado GLOBAL por hielo (usa min/max GLOBAL)
  (TIPOS_HIELO as readonly IceType[]).forEach((t) => {
    const item = stockPorTipoHielo[t];
    const g = cfgGlobal[t];

    // Si global desactiva el tipo, lo dejamos “neutral”
    if (g && g.activo === false) {
      item.estado = 'NORMAL';
      item.necesitaProduccion = false;
      item.cantidadNecesaria = 0;
      item.ultimaActualizacion = new Date();
      return;
    }

    if (t === 'BARRA') {
      const actualCuartos = Number(item.cuartosDisponibles ?? 0);
      item.estado = calcEstadoStock(actualCuartos, item.stockMinimo, item.stockMaximo);

      if (item.stockMinimo > 0 && actualCuartos < item.stockMinimo) {
        item.necesitaProduccion = true;
        item.cantidadNecesaria = Math.max(0, item.stockMinimo - actualCuartos);
      } else {
        item.necesitaProduccion = false;
        item.cantidadNecesaria = 0;
      }

      item.ultimaActualizacion = new Date();
      return;
    }

    const actual = Number(item.bolsasLlenasDisponibles ?? 0);
    item.estado = calcEstadoStock(actual, item.stockMinimo, item.stockMaximo);

    if (item.stockMinimo > 0 && actual < item.stockMinimo) {
      item.necesitaProduccion = true;
      item.cantidadNecesaria = Math.max(0, item.stockMinimo - actual);
    } else {
      item.necesitaProduccion = false;
      item.cantidadNecesaria = 0;
    }

    item.ultimaActualizacion = new Date();
  });

  // Alertas por producto (para contadores)
  const alertas = productos.map((p) => {
    if (esBarra(p)) {
      return crearAlerta(
        p.codigo,
        p.nombre,
        p.tipo,
        Number(p.cantidad ?? 0),
        undefined,
        p.status,
        p.stockMinimo,
        p.stockMaximo,
        Number(p.cuartosDisponibles ?? 0),
        Number(p.cuartosTotales ?? 0)
      );
    }

    const b = p as BolsaProduct;
    return crearAlerta(
      b.codigo,
      b.nombre,
      b.tipo,
      Number(b.cantidad ?? 0),
      b.tipoHieloContenido,
      b.status,
      b.stockMinimo,
      b.stockMaximo
    );
  });

  const productosCriticos = alertas.filter((a) => a.estado === 'CRITICO').length;
  const productosBajoStock = alertas.filter((a) => a.estado === 'BAJO').length;

  return {
    totalProductos: productos.length,

    totalBarras,
    totalBolsasVacias,
    totalBolsasAsignadas,
    totalBolsasLlenas,

    cuartosTotales,
    cuartosDisponibles,
    cuartosUsados,

    stockPorTipoHielo,

    productosBajoStock,
    productosCriticos,

    configGlobalPorHielo: cfgGlobal,
    ultimaActualizacion: new Date(),
  };
}

// =====================================================
// UTIL: contar alertas por estado
// =====================================================

export function contarAlertasPorTipo(alertas: StockAlerta[]): Record<StockEstado, number> {
  return alertas.reduce(
    (acc, a) => {
      acc[a.estado] = (acc[a.estado] ?? 0) + 1;
      return acc;
    },
    { NORMAL: 0, BAJO: 0, CRITICO: 0, EXCESO: 0 } as Record<StockEstado, number>
  );
}
