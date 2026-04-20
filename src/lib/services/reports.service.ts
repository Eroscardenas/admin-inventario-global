// lib/services/reports.service.ts
'use client';

import { db } from '@/lib/firebase/config.client';

import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
  limit,
} from 'firebase/firestore';

import type { IceType } from '@/lib/utils/types/product.types';

// ❌ QUITAR para evitar circular deps
// import { MermasService } from './merma.service';
// import { DevolucionesService } from './devoluciones.service';

// =====================================================
// TIPOS
// =====================================================
export interface ReporteProduccionDiaria {
  fecha: string;
  totalBolsasLlenadas: number;
  totalCuartosUsadosEnBarras: number;
  totalMermas: number;
  totalDevoluciones: number;
  porTipoHielo: Record<string, number>;
  eficienciaGeneral: number;
  empleadosActivos: Array<{
    empleadoCodigo: string;
    empleadoNombre: string;
    bolsasLlenadas: number;
    mermas: number;
    devoluciones: number;
  }>;
}

export interface ReporteMensual {
  periodo: string; // "MM/YYYY"
  dias: Array<{
    dia: number;
    bolsasLlenadas: number;
    cuartosUsadosEnBarras: number;
    mermas: number;
    devoluciones: number;
  }>;
  totales: {
    bolsasLlenadas: number;
    cuartosUsadosEnBarras: number;
    mermas: number;
    devoluciones: number;
    eficienciaPromedio: number;
  };
}

export interface ReporteEmpleado {
  empleadoCodigo: string;
  empleadoNombre: string;
  periodo: string;

  totalBolsasLlenadas: number;
  totalCuartosUsadosEnBarras: number;
  totalMermas: number;
  totalDevoluciones: number;

  eficiencia: number;
  promedioDiarioBolsas: number;
  diasTrabajados: number;
}

type EstadoStock = 'CRITICO' | 'BAJO' | 'NORMAL';

// =====================================================
// HELPERS
// =====================================================
const convertirTimestamp = (timestamp: any): Date => {
  if (!timestamp) return new Date();
  if (timestamp instanceof Date) return timestamp;
  if (timestamp?.toDate && typeof timestamp.toDate === 'function') return timestamp.toDate();
  return new Date(timestamp);
};

const safeNumber = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const formatearFechaLarga = (fecha: Date) =>
  fecha.toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const formatearPeriodoCorto = (inicio: Date, fin: Date) =>
  `${inicio.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} - ${fin.toLocaleDateString(
    'es-ES',
    { day: '2-digit', month: 'short' }
  )}`;

const isTipo = (t: any, expected: string) => String(t || '').toUpperCase() === expected;

// =====================================================
// REPORTS SERVICE
// =====================================================
export class ReportsService {
  static COLECCION_MOVIMIENTOS = 'movimientos';
  static COLECCION_PRODUCTOS = 'productos';

  private static extraerEmpleado(data: any): { codigo: string; nombre: string } {
    const codigo =
      data.empleadoCodigo ||
      data.devueltoPorCodigo ||
      data.procesadoPor ||
      data.empleado ||
      data.llenadoPor ||
      'DESCONOCIDO';

    const nombre =
      data.empleadoNombre ||
      data.devueltoPorNombre ||
      data.procesadoPorNombre ||
      data.nombreEmpleado ||
      data.empleadoNombreTexto ||
      'Desconocido';

    return { codigo: String(codigo), nombre: String(nombre) };
  }

  private static esMovimientoLlenado(data: any): boolean {
    const t = String(data.tipo || '').toUpperCase();
    return t === 'LLENADO' || t === 'LLENADO_BOLSA' || t === 'LLENADO_MASIVO';
  }

  private static esMovimientoMerma(data: any): boolean {
    return String(data.tipo || '').toUpperCase() === 'MERMA';
  }

  private static esMovimientoDevolucion(data: any): boolean {
    const t = String(data.tipo || '').toUpperCase();
    return t.startsWith('DEVOLUCION');
  }

  private static obtenerFechaMovimiento(data: any): Date {
    return convertirTimestamp(data.fecha ?? data.createdAt ?? data.updatedAt);
  }

  // =====================================================
  // 1) REPORTE DIARIO
  // =====================================================
  static async generarReporteProduccionDiaria(
    fecha: Date = new Date()
  ): Promise<ReporteProduccionDiaria> {
    try {
      const ini = startOfDay(fecha);
      const fin = endOfDay(fecha);

      const qRef = query(
        collection(db, this.COLECCION_MOVIMIENTOS),
        where('fecha', '>=', Timestamp.fromDate(ini)),
        where('fecha', '<=', Timestamp.fromDate(fin))
      );

      const snap = await getDocs(qRef);

      const reporte: ReporteProduccionDiaria = {
        fecha: formatearFechaLarga(fecha),
        totalBolsasLlenadas: 0,
        totalCuartosUsadosEnBarras: 0,
        totalMermas: 0,
        totalDevoluciones: 0,
        porTipoHielo: {},
        eficienciaGeneral: 0,
        empleadosActivos: [],
      };

      const empleados = new Map<
        string,
        {
          empleadoCodigo: string;
          empleadoNombre: string;
          bolsasLlenadas: number;
          mermas: number;
          devoluciones: number;
        }
      >();

      snap.forEach((d) => {
        const data: any = d.data();
        const cantAbs = Math.abs(safeNumber(data.cantidad ?? 0));
        const { codigo, nombre } = this.extraerEmpleado(data);

        if (!empleados.has(codigo)) {
          empleados.set(codigo, {
            empleadoCodigo: codigo,
            empleadoNombre: nombre,
            bolsasLlenadas: 0,
            mermas: 0,
            devoluciones: 0,
          });
        }

        if (this.esMovimientoLlenado(data)) {
          const add = cantAbs || 1;
          reporte.totalBolsasLlenadas += add;
          empleados.get(codigo)!.bolsasLlenadas += add;

          const tipoHielo = data.tipoHielo || data.tipoHieloContenido;
          if (tipoHielo) {
            const key = String(tipoHielo);
            reporte.porTipoHielo[key] = (reporte.porTipoHielo[key] ?? 0) + add;
          }

          const cuartos = safeNumber(data.cuartosUsados ?? data.cuartos ?? 0);
          if (cuartos > 0) reporte.totalCuartosUsadosEnBarras += cuartos;
        }

        if (this.esMovimientoMerma(data)) {
          reporte.totalMermas += cantAbs;
          empleados.get(codigo)!.mermas += cantAbs;
        }

        if (this.esMovimientoDevolucion(data)) {
          const t = String(data.tipo || '').toUpperCase();
          const accion = String(data.accion || '').toUpperCase();
          const esAceptada = t.includes('PROCESADA') ? accion === 'ACEPTADA' : true;

          if (esAceptada) {
            reporte.totalDevoluciones += cantAbs;
            empleados.get(codigo)!.devoluciones += cantAbs;
          }
        }
      });

      reporte.empleadosActivos = Array.from(empleados.values()).sort(
        (a, b) => b.bolsasLlenadas - a.bolsasLlenadas
      );

      const totalProduccion = reporte.totalBolsasLlenadas;
      const perdidas = reporte.totalMermas + reporte.totalDevoluciones;
      reporte.eficienciaGeneral =
        totalProduccion > 0
          ? Math.max(0, Math.round((1 - perdidas / totalProduccion) * 100))
          : 0;

      return reporte;
    } catch (error) {
      console.error('❌ Error generarReporteProduccionDiaria:', error);
      return {
        fecha: formatearFechaLarga(fecha),
        totalBolsasLlenadas: 0,
        totalCuartosUsadosEnBarras: 0,
        totalMermas: 0,
        totalDevoluciones: 0,
        porTipoHielo: {},
        eficienciaGeneral: 0,
        empleadosActivos: [],
      };
    }
  }

  // =====================================================
  // 2) REPORTE MENSUAL
  // =====================================================
  static async generarReporteMensual(año: number, mes: number): Promise<ReporteMensual> {
    try {
      const inicioMes = new Date(año, mes - 1, 1, 0, 0, 0, 0);
      const finMes = new Date(año, mes, 0, 23, 59, 59, 999);

      const qRef = query(
        collection(db, this.COLECCION_MOVIMIENTOS),
        where('fecha', '>=', Timestamp.fromDate(inicioMes)),
        where('fecha', '<=', Timestamp.fromDate(finMes))
      );

      const snap = await getDocs(qRef);

      const diasEnMes = new Date(año, mes, 0).getDate();
      const dias = Array.from({ length: diasEnMes }).map((_, i) => ({
        dia: i + 1,
        bolsasLlenadas: 0,
        cuartosUsadosEnBarras: 0,
        mermas: 0,
        devoluciones: 0,
      }));

      const totales = {
        bolsasLlenadas: 0,
        cuartosUsadosEnBarras: 0,
        mermas: 0,
        devoluciones: 0,
        eficienciaPromedio: 0,
      };

      snap.forEach((d) => {
        const data: any = d.data();
        const f = this.obtenerFechaMovimiento(data);
        const idx = f.getDate() - 1;
        if (idx < 0 || idx >= dias.length) return;

        const cantAbs = Math.abs(safeNumber(data.cantidad ?? 0));

        if (this.esMovimientoLlenado(data)) {
          const add = cantAbs || 1;
          dias[idx].bolsasLlenadas += add;
          totales.bolsasLlenadas += add;

          const cuartos = safeNumber(data.cuartosUsados ?? data.cuartos ?? 0);
          dias[idx].cuartosUsadosEnBarras += cuartos;
          totales.cuartosUsadosEnBarras += cuartos;
        }

        if (this.esMovimientoMerma(data)) {
          dias[idx].mermas += cantAbs;
          totales.mermas += cantAbs;
        }

        if (this.esMovimientoDevolucion(data)) {
          const t = String(data.tipo || '').toUpperCase();
          const accion = String(data.accion || '').toUpperCase();
          const esAceptada = t.includes('PROCESADA') ? accion === 'ACEPTADA' : true;

          if (esAceptada) {
            dias[idx].devoluciones += cantAbs;
            totales.devoluciones += cantAbs;
          }
        }
      });

      const perdidas = totales.mermas + totales.devoluciones;
      totales.eficienciaPromedio =
        totales.bolsasLlenadas > 0
          ? Math.max(0, Math.round((1 - perdidas / totales.bolsasLlenadas) * 100))
          : 0;

      return {
        periodo: `${String(mes).padStart(2, '0')}/${año}`,
        dias,
        totales,
      };
    } catch (error) {
      console.error('❌ Error generarReporteMensual:', error);
      return {
        periodo: `${String(mes).padStart(2, '0')}/${año}`,
        dias: [],
        totales: {
          bolsasLlenadas: 0,
          cuartosUsadosEnBarras: 0,
          mermas: 0,
          devoluciones: 0,
          eficienciaPromedio: 0,
        },
      };
    }
  }

  // =====================================================
  // 3) REPORTE POR EMPLEADO
  // =====================================================
  static async generarReporteEmpleado(
    empleadoCodigo: string,
    fechaInicio: Date,
    fechaFin: Date
  ): Promise<ReporteEmpleado> {
    try {
      const qRef = query(
        collection(db, this.COLECCION_MOVIMIENTOS),
        where('fecha', '>=', Timestamp.fromDate(fechaInicio)),
        where('fecha', '<=', Timestamp.fromDate(fechaFin))
      );

      const snap = await getDocs(qRef);

      let empleadoNombre = 'Empleado';
      let totalBolsasLlenadas = 0;
      let totalCuartosUsadosEnBarras = 0;
      let totalMermas = 0;
      let totalDevoluciones = 0;

      const diasTrabajados = new Set<string>();

      snap.forEach((d) => {
        const data: any = d.data();

        const emp = this.extraerEmpleado(data);
        if (String(emp.codigo) !== String(empleadoCodigo)) return;

        if (emp.nombre && emp.nombre !== 'Desconocido') empleadoNombre = emp.nombre;

        const f = this.obtenerFechaMovimiento(data);
        diasTrabajados.add(f.toISOString().slice(0, 10));

        const cantAbs = Math.abs(safeNumber(data.cantidad ?? 0));

        if (this.esMovimientoLlenado(data)) {
          const add = cantAbs || 1;
          totalBolsasLlenadas += add;

          const cuartos = safeNumber(data.cuartosUsados ?? data.cuartos ?? 0);
          totalCuartosUsadosEnBarras += cuartos;
        }

        if (this.esMovimientoMerma(data)) totalMermas += cantAbs;

        if (this.esMovimientoDevolucion(data)) {
          const t = String(data.tipo || '').toUpperCase();
          const accion = String(data.accion || '').toUpperCase();
          const esAceptada = t.includes('PROCESADA') ? accion === 'ACEPTADA' : true;

          if (esAceptada) totalDevoluciones += cantAbs;
        }
      });

      const dias = diasTrabajados.size;
      const perdidas = totalMermas + totalDevoluciones;
      const eficiencia =
        totalBolsasLlenadas > 0
          ? Math.max(0, Math.round((1 - perdidas / totalBolsasLlenadas) * 100))
          : 0;
      const promedioDiarioBolsas = dias > 0 ? Math.round(totalBolsasLlenadas / dias) : 0;

      return {
        empleadoCodigo,
        empleadoNombre,
        periodo: formatearPeriodoCorto(fechaInicio, fechaFin),
        totalBolsasLlenadas,
        totalCuartosUsadosEnBarras,
        totalMermas,
        totalDevoluciones,
        eficiencia,
        promedioDiarioBolsas,
        diasTrabajados: dias,
      };
    } catch (error) {
      console.error('❌ Error generarReporteEmpleado:', error);
      return {
        empleadoCodigo,
        empleadoNombre: 'Empleado',
        periodo: formatearPeriodoCorto(fechaInicio, fechaFin),
        totalBolsasLlenadas: 0,
        totalCuartosUsadosEnBarras: 0,
        totalMermas: 0,
        totalDevoluciones: 0,
        eficiencia: 0,
        promedioDiarioBolsas: 0,
        diasTrabajados: 0,
      };
    }
  }

  // =====================================================
  // 4) REPORTE DE STOCK
  // =====================================================
  static async generarReporteStock(): Promise<{
    fecha: string;
    productos: Array<{
      codigo: string;
      nombre: string;
      tipo: string;
      stockActual: number;
      stockMinimo: number;
      estado: EstadoStock;
    }>;
    resumen: {
      totalProductos: number;
      productosBajoStock: number;
      productosCriticos: number;
    };
  }> {
    try {
      const snap = await getDocs(collection(db, this.COLECCION_PRODUCTOS));

      const productos: Array<{
        codigo: string;
        nombre: string;
        tipo: string;
        stockActual: number;
        stockMinimo: number;
        estado: EstadoStock;
      }> = [];

      let totalProductos = 0;
      let productosBajoStock = 0;
      let productosCriticos = 0;

      snap.forEach((d) => {
        const data: any = d.data();
        const tipo = String(data.tipo || 'DESCONOCIDO');

        const stockMinimo = safeNumber(data.stockMinimo ?? 0);

        let stockActual = 0;
        if (isTipo(tipo, 'BARRA')) stockActual = safeNumber(data.cuartosDisponibles ?? 0);
        else stockActual = safeNumber(data.cantidad ?? data.stockActual ?? 0);

        let estado: EstadoStock = 'NORMAL';
        if (stockMinimo > 0 && stockActual <= stockMinimo * 0.3) {
          estado = 'CRITICO';
          productosCriticos++;
        } else if (stockMinimo > 0 && stockActual <= stockMinimo) {
          estado = 'BAJO';
          productosBajoStock++;
        }

        productos.push({
          codigo: String(data.codigo ?? d.id),
          nombre: String(data.nombre ?? 'Sin nombre'),
          tipo,
          stockActual,
          stockMinimo,
          estado,
        });

        totalProductos++;
      });

      const ordenEstado: Record<EstadoStock, number> = { CRITICO: 0, BAJO: 1, NORMAL: 2 };
      productos.sort((a, b) => ordenEstado[a.estado] - ordenEstado[b.estado]);

      return {
        fecha: new Date().toLocaleDateString('es-ES'),
        productos,
        resumen: { totalProductos, productosBajoStock, productosCriticos },
      };
    } catch (error) {
      console.error('❌ Error generarReporteStock:', error);
      return {
        fecha: new Date().toLocaleDateString('es-ES'),
        productos: [],
        resumen: { totalProductos: 0, productosBajoStock: 0, productosCriticos: 0 },
      };
    }
  }

  // =====================================================
  // 5) REPORTE DE PÉRDIDAS (MERMA + DEVOLUCIONES)
  // ✅ FIX: lazy import para romper circular deps
  // =====================================================
  static async generarReportePerdidas(
    fechaInicio: Date,
    fechaFin: Date
  ): Promise<{
    periodo: string;
    mermas: any;
    devoluciones: any;
    totalPerdidas: number;
    valorEstimadoPerdido: number;
    comparativa: { bolsas: number; barras: number; bolsasVacias: number };
  }> {
    try {
      const { MermasService } = await import('./merma.service');
      const { DevolucionesService } = await import('./devoluciones.service');

      const mermasStats = await MermasService.obtenerEstadisticasMermas(fechaInicio, fechaFin);
      const devolucionesStats = await DevolucionesService.obtenerEstadisticasDevoluciones(
        fechaInicio,
        fechaFin
      );

      const totalDevoluciones = safeNumber((devolucionesStats as any).totalDevoluciones ?? 0);
      const totalPerdidas = safeNumber(mermasStats.totalCantidad ?? 0) + totalDevoluciones;

      const valorEstimadoPerdido = safeNumber(mermasStats.valorEstimadoPerdido ?? 0);
      const periodo = formatearPeriodoCorto(fechaInicio, fechaFin);

      const mBolsa = safeNumber(
        mermasStats.porTipoProducto.find((t: any) => t.tipo === 'BOLSA')?.cantidad ?? 0
      );
      const mBarra = safeNumber(
        mermasStats.porTipoProducto.find((t: any) => t.tipo === 'BARRA')?.cantidad ?? 0
      );
      const mBV = safeNumber(
        mermasStats.porTipoProducto.find((t: any) => t.tipo === 'BOLSA_VACIA')?.cantidad ?? 0
      );

      const dBolsa = safeNumber(
        (devolucionesStats as any).porTipoProducto?.find(
          (t: any) => t.tipoProducto === 'BOLSA' || t.tipo === 'BOLSA'
        )?.total ?? 0
      );
      const dBarra = safeNumber(
        (devolucionesStats as any).porTipoProducto?.find(
          (t: any) => t.tipoProducto === 'BARRA' || t.tipo === 'BARRA'
        )?.total ?? 0
      );

      return {
        periodo,
        mermas: mermasStats,
        devoluciones: devolucionesStats,
        totalPerdidas,
        valorEstimadoPerdido,
        comparativa: {
          bolsas: mBolsa + dBolsa,
          barras: mBarra + dBarra,
          bolsasVacias: mBV,
        },
      };
    } catch (error) {
      console.error('❌ Error generarReportePerdidas:', error);
      return {
        periodo: formatearPeriodoCorto(fechaInicio, fechaFin),
        mermas: {
          totalMermas: 0,
          totalCantidad: 0,
          valorEstimadoPerdido: 0,
          porMotivo: [],
          porTipoProducto: [],
          porEmpleado: [],
          tendenciaMensual: [],
          ultimaActualizacion: new Date(),
        },
        devoluciones: {
          totalDevoluciones: 0,
          devolucionesPendientes: 0,
          devolucionesAceptadas: 0,
          devolucionesRechazadas: 0,
          porMotivo: [],
          porTipoProducto: [],
          porTipoHielo: [],
          porEmpleado: [],
          tendenciaMensual: [],
          ultimaActualizacion: new Date(),
        },
        totalPerdidas: 0,
        valorEstimadoPerdido: 0,
        comparativa: { bolsas: 0, barras: 0, bolsasVacias: 0 },
      };
    }
  }

  // =====================================================
  // EXTRA: Movimientos recientes
  // =====================================================
  static async obtenerMovimientosRecientes(limiteN: number = 50): Promise<any[]> {
    try {
      const qRef = query(
        collection(db, this.COLECCION_MOVIMIENTOS),
        orderBy('fecha', 'desc'),
        limit(limiteN)
      );
      const snap = await getDocs(qRef);
      const out: any[] = [];
      snap.forEach((d) =>
        out.push({
          id: d.id,
          ...d.data(),
          fecha: convertirTimestamp((d.data() as any).fecha),
        })
      );
      return out;
    } catch (e) {
      console.error('❌ Error obtenerMovimientosRecientes:', e);
      return [];
    }
  }

  // =====================================================
  // EXTRA: Producción por tipo de hielo
  // =====================================================
  static async obtenerProduccionPorTipoHielo(
    fechaInicio: Date,
    fechaFin: Date
  ): Promise<Record<IceType, number>> {
    const result = {} as Record<IceType, number>;
    try {
      const qRef = query(
        collection(db, this.COLECCION_MOVIMIENTOS),
        where('fecha', '>=', Timestamp.fromDate(fechaInicio)),
        where('fecha', '<=', Timestamp.fromDate(fechaFin))
      );

      const snap = await getDocs(qRef);
      snap.forEach((d) => {
        const data: any = d.data();
        if (!this.esMovimientoLlenado(data)) return;
        const tipoHielo = data.tipoHielo || data.tipoHieloContenido;
        if (!tipoHielo) return;

        const add = Math.abs(safeNumber(data.cantidad ?? 0)) || 1;
        result[tipoHielo as IceType] = (result[tipoHielo as IceType] ?? 0) + add;
      });

      return result;
    } catch (e) {
      console.error('❌ Error obtenerProduccionPorTipoHielo:', e);
      return result;
    }
  }
}
