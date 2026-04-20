// lib/services/devoluciones.service.ts
'use client';

import { db } from '@/lib/firebase/config.client';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  limit,
  runTransaction,
} from 'firebase/firestore';

import {
  Devolucion,
  DevolucionRequest,
  ProcesarDevolucionRequest,
  DevolucionResultado,
  DevolucionStats,
  DevolucionEstado,
  MOTIVOS_DEVOLUCION,
  crearDevolucion,
  procesarDevolucion,
  calcularDevolucionResultado,
  calcularStatsDevoluciones,
  validarProductoParaDevolucion,
} from '@/lib/utils/types/devolucion.types';

import type { IceType } from '@/lib/utils/types/product.types';

// ==============================
// COLECCIONES (tu naming)
// ==============================
const DEVOLUCIONES_COLLECTION = 'devoluciones';
const PRODUCTOS_COLLECTION = 'productos';
const MOVIMIENTOS_COLLECTION = 'movimientos';

// ==============================
// HELPERS
// ==============================
const convertirTimestamp = (timestamp: any): Date => {
  if (!timestamp) return new Date();
  if (timestamp instanceof Date) return timestamp;
  if (timestamp?.toDate && typeof timestamp.toDate === 'function') return timestamp.toDate();
  return new Date(timestamp);
};

const prepararParaFirestore = (data: any): any => {
  const result: any = {};
  for (const key in data) {
    const value = data[key];
    if (value instanceof Date) result[key] = Timestamp.fromDate(value);
    else result[key] = value;
  }
  return result;
};

function asDate(v: any): Date {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (v?.toDate) return v.toDate();
  return new Date(v);
}

function safeNumber(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ==============================
// SERVICE
// ==============================
export class DevolucionesService {
  static readonly MOTIVOS = MOTIVOS_DEVOLUCION;

  // =====================================================
  // 1) REGISTRAR DEVOLUCIÓN (PENDIENTE)
  // =====================================================
  static async registrarDevolucion(
    request: DevolucionRequest,
    devueltoPorCodigo: string,
    devueltoPorNombre: string
  ): Promise<DevolucionResultado> {
    try {
      // Validaciones mínimas (tu types ya trae validador base)
      if (!request?.productoCodigo?.trim()) throw new Error('Código de producto requerido');
      if (!request?.productoNombre?.trim()) throw new Error('Nombre de producto requerido');
      if (!safeNumber(request?.cantidad) || safeNumber(request?.cantidad) <= 0)
        throw new Error('Cantidad debe ser mayor a 0');
      if (!request?.motivo) throw new Error('Motivo de devolución requerido');
      if (!devueltoPorCodigo?.trim()) throw new Error('Empleado (devueltoPorCodigo) requerido');

      // Bolsas requieren tipoHielo en tu lógica
      if (request.tipoProducto === 'BOLSA' && !request.tipoHielo) {
        throw new Error('Tipo de hielo es requerido para bolsas');
      }

      // Validación base (no depende de prefijos)
      const validacion = validarProductoParaDevolucion(
        request.productoCodigo,
        request.tipoProducto,
        request.cantidad
      );
      if (!validacion.valido) throw new Error(validacion.mensaje);

      // Crear devolución (helper del type)
      const devolucionBase = crearDevolucion(request, devueltoPorCodigo, devueltoPorNombre);

      // Generar código secuencial tipo DEV001
      const codigoDevolucion = await this.generarSiguienteCodigo();
      devolucionBase.codigo = codigoDevolucion;

      // Transacción: guardar devolución + movimiento (y opcionalmente “marcar en revisión”)
      return await runTransaction(db, async (tx) => {
        // Guardar devolución
        const devolucionRef = doc(collection(db, DEVOLUCIONES_COLLECTION));
        tx.set(devolucionRef, prepararParaFirestore(devolucionBase));

        // Si afectaStock: (industrial) no bloqueamos inventario con un status inventado.
        // Tu sistema maneja stock con cantidad / stockPorHielo; así que SOLO auditamos en movimientos.
        // Si tú sí tienes un status real, aquí lo puedes habilitar.
        // (lo dejo neutro para evitar romper types existentes)

        // Movimiento
        const movimiento = {
          tipo: 'DEVOLUCION_REGISTRADA',
          devolucionCodigo: codigoDevolucion,
          productoCodigo: request.productoCodigo,
          productoNombre: request.productoNombre,
          tipoProducto: request.tipoProducto,
          tipoHielo: request.tipoHielo,
          cantidad: request.cantidad,
          motivo: request.motivo,
          motivoDetallado: request.motivoDetallado ?? null,
          afectaStock: Boolean(request.afectaStock),
          devueltoPorCodigo,
          devueltoPorNombre,
          fecha: new Date(),
        };

        const movRef = doc(collection(db, MOVIMIENTOS_COLLECTION));
        tx.set(movRef, prepararParaFirestore(movimiento));

        return {
          exito: true,
          devolucionCodigo: codigoDevolucion,
          productoCodigo: request.productoCodigo,
          productoNombre: request.productoNombre,
          tipoProducto: request.tipoProducto,
          tipoHielo: request.tipoHielo,
          cantidad: request.cantidad,
          estado: 'PENDIENTE',
          mensaje: 'Devolución registrada exitosamente',
          fecha: new Date(),
        };
      });
    } catch (error: any) {
      console.error('❌ Error al registrar devolución:', error);
      throw new Error(error?.message || 'Error al registrar devolución');
    }
  }

  // =====================================================
  // 2) OBTENER DEVOLUCIONES (LISTA)
  // =====================================================
  static async obtenerDevoluciones(filtros?: {
    estado?: DevolucionEstado;
    devueltoPorCodigo?: string;
    productoCodigo?: string;
    tipoProducto?: 'BOLSA' | 'BARRA';
    fechaInicio?: Date;
    fechaFin?: Date;
    limit?: number;
  }): Promise<Devolucion[]> {
    try {
      let qRef: any = query(collection(db, DEVOLUCIONES_COLLECTION), orderBy('createdAt', 'desc'));

      if (filtros?.estado) qRef = query(qRef, where('estado', '==', filtros.estado));
      if (filtros?.devueltoPorCodigo)
        qRef = query(qRef, where('devueltoPorCodigo', '==', filtros.devueltoPorCodigo));
      if (filtros?.productoCodigo)
        qRef = query(qRef, where('productoCodigo', '==', filtros.productoCodigo));
      if (filtros?.tipoProducto)
        qRef = query(qRef, where('tipoProducto', '==', filtros.tipoProducto));

      if (filtros?.fechaInicio && filtros?.fechaFin) {
        qRef = query(
          qRef,
          where('createdAt', '>=', Timestamp.fromDate(filtros.fechaInicio)),
          where('createdAt', '<=', Timestamp.fromDate(filtros.fechaFin))
        );
      }

      if (filtros?.limit) qRef = query(qRef, limit(filtros.limit));

      const snap = await getDocs(qRef);
      const out: Devolucion[] = [];

      snap.forEach((d) => {
        const data: any = d.data();
        out.push({
          codigo: data.codigo,
          productoCodigo: data.productoCodigo,
          productoNombre: data.productoNombre,
          tipoProducto: data.tipoProducto,
          tipoHielo: data.tipoHielo,
          cantidad: safeNumber(data.cantidad),
          unidad: data.unidad,
          motivo: data.motivo,
          motivoDetallado: data.motivoDetallado,
          devueltoPorCodigo: data.devueltoPorCodigo,
          devueltoPorNombre: data.devueltoPorNombre,
          recibidoPor: data.recibidoPor,
          fechaRecepcion: data.fechaRecepcion ? convertirTimestamp(data.fechaRecepcion) : undefined,
          estado: data.estado,
          motivoRechazo: data.motivoRechazo,
          accionesTomadas: data.accionesTomadas,
          afectaStock: Boolean(data.afectaStock),
          stockDevuelto: data.stockDevuelto,
          stockAnterior: data.stockAnterior,
          stockNuevo: data.stockNuevo,
          createdAt: convertirTimestamp(data.createdAt),
          updatedAt: convertirTimestamp(data.updatedAt),
        });
      });

      return out;
    } catch (error) {
      console.error('❌ Error obteniendo devoluciones:', error);
      return [];
    }
  }

  // =====================================================
  // 3) OBTENER DEVOLUCIÓN POR CÓDIGO
  // =====================================================
  static async obtenerDevolucionPorCodigo(codigo: string): Promise<Devolucion | null> {
    try {
      const qRef = query(
        collection(db, DEVOLUCIONES_COLLECTION),
        where('codigo', '==', codigo),
        limit(1)
      );
      const snap = await getDocs(qRef);
      if (snap.empty) return null;

      const data: any = snap.docs[0].data();
      return {
        codigo: data.codigo,
        productoCodigo: data.productoCodigo,
        productoNombre: data.productoNombre,
        tipoProducto: data.tipoProducto,
        tipoHielo: data.tipoHielo,
        cantidad: safeNumber(data.cantidad),
        unidad: data.unidad,
        motivo: data.motivo,
        motivoDetallado: data.motivoDetallado,
        devueltoPorCodigo: data.devueltoPorCodigo,
        devueltoPorNombre: data.devueltoPorNombre,
        recibidoPor: data.recibidoPor,
        fechaRecepcion: data.fechaRecepcion ? convertirTimestamp(data.fechaRecepcion) : undefined,
        estado: data.estado,
        motivoRechazo: data.motivoRechazo,
        accionesTomadas: data.accionesTomadas,
        afectaStock: Boolean(data.afectaStock),
        stockDevuelto: data.stockDevuelto,
        stockAnterior: data.stockAnterior,
        stockNuevo: data.stockNuevo,
        createdAt: convertirTimestamp(data.createdAt),
        updatedAt: convertirTimestamp(data.updatedAt),
      };
    } catch (error) {
      console.error('❌ Error obteniendo devolución por código:', error);
      return null;
    }
  }

  // =====================================================
  // 4) PROCESAR DEVOLUCIÓN (ACEPTAR / RECHAZAR)
  //
  // ✅ LÓGICA TU SISTEMA:
  // - Si ACEPATADA y afectaStock=true y stockDevuelto=true:
  //   - BOLSA: suma a producto.cantidad y también a stockPorHielo[tipoHielo].stockActual
  //   - BARRA: suma a cuartosDisponibles (y opcionalmente cantidad si tú la usas)
  // - Registrar movimiento de procesamiento
  // - Guardar auditoría stockAnterior/stockNuevo en la devolución
  // =====================================================
  static async procesarDevolucion(
    request: ProcesarDevolucionRequest,
    recibidoPor: string
  ): Promise<DevolucionResultado> {
    try {
      if (!request?.devolucionCodigo?.trim()) throw new Error('devolucionCodigo requerido');
      if (request.accion !== 'ACEPTADA' && request.accion !== 'RECHAZADA')
        throw new Error('Acción inválida');

      const devolucion = await this.obtenerDevolucionPorCodigo(request.devolucionCodigo);
      if (!devolucion) throw new Error(`Devolución ${request.devolucionCodigo} no encontrada`);
      if (devolucion.estado !== 'PENDIENTE') throw new Error('La devolución ya fue procesada');

      // En tu type, esto existe como bandera (si no viene, default true cuando aceptas)
      const stockDevueltoFlag =
        request.accion === 'ACEPTADA' ? (request.stockDevuelto ?? true) : false;

      // Ejecutamos TODO en una transacción para consistencia
      const resultado = await runTransaction(db, async (tx) => {
        // 1) Encontrar doc devolución (por codigo)
        const qDev = query(
          collection(db, DEVOLUCIONES_COLLECTION),
          where('codigo', '==', devolucion.codigo),
          limit(1)
        );
        const devSnap = await getDocs(qDev);
        if (devSnap.empty) throw new Error(`No se encontró doc firestore para ${devolucion.codigo}`);
        const devDoc = devSnap.docs[0];

        // 2) Preparar update de producto si aplica
        let stockAnterior: number | undefined = undefined;
        let stockNuevo: number | undefined = undefined;

        let stockHieloAnterior: number | undefined = undefined;
        let stockHieloNuevo: number | undefined = undefined;

        let cuartosAnteriores: number | undefined = undefined;
        let cuartosNuevos: number | undefined = undefined;

        // Solo si: aceptada + afectaStock + stockDevueltoFlag
        if (request.accion === 'ACEPTADA' && devolucion.afectaStock && stockDevueltoFlag) {
          const prodRef = doc(db, PRODUCTOS_COLLECTION, devolucion.productoCodigo);
          const prodSnap = await tx.get(prodRef);

          if (!prodSnap.exists()) {
            // si no existe el doc, no podemos ajustar stock — igual procesamos la devolución
            console.warn(`⚠️ Producto ${devolucion.productoCodigo} no existe; no se ajusta stock.`);
          } else {
            const p: any = prodSnap.data();
            const inc = safeNumber(devolucion.cantidad);

            if (devolucion.tipoProducto === 'BOLSA') {
              // ===== BOLSA =====
              const anterior = safeNumber(p.cantidad);
              const nuevo = anterior + inc;
              stockAnterior = anterior;
              stockNuevo = nuevo;

              const tipo = (devolucion.tipoHielo ?? undefined) as IceType | undefined;

              // stockPorHielo: preservar el objeto y solo sumar stockActual del hielo
              const stockPorHielo = { ...(p.stockPorHielo ?? {}) } as Record<string, any>;

              if (tipo) {
                const cfgActual = stockPorHielo[tipo] ?? {};
                const prev = safeNumber(cfgActual.stockActual);
                const next = prev + inc;

                stockHieloAnterior = prev;
                stockHieloNuevo = next;

                stockPorHielo[tipo] = {
                  ...cfgActual,
                  stockActual: next,
                  ultimaActualizacion: new Date(),
                };
              }

              tx.update(prodRef, {
                cantidad: nuevo,
                ...(tipo ? { stockPorHielo } : {}),
                ultimaModificacion: Timestamp.fromDate(new Date()),
              });
            } else if (devolucion.tipoProducto === 'BARRA') {
              // ===== BARRA (cuartos) =====
              // tu request puede traer cuartosNuevos; si no, usamos cantidad como “cuartos”
              const incCuartos = safeNumber(request.cuartosNuevos ?? devolucion.cantidad);

              const prevDisp = safeNumber(p.cuartosDisponibles);
              const nextDisp = prevDisp + incCuartos;

              cuartosAnteriores = prevDisp;
              cuartosNuevos = nextDisp;

              // Si en tu modelo también manejas cantidad de barras, NO la toco para no romperte.
              tx.update(prodRef, {
                cuartosDisponibles: nextDisp,
                ultimaModificacion: Timestamp.fromDate(new Date()),
              });
            }
          }
        }

        // 3) Actualizar devolución (usando helper del type)
        const devolucionActualizada: Devolucion = procesarDevolucion(
          devolucion,
          {
            ...request,
            stockDevuelto: stockDevueltoFlag,
            stockAnterior: request.stockAnterior ?? stockAnterior,
            stockNuevo: request.stockNuevo ?? stockNuevo,
            cuartosNuevos: request.cuartosNuevos,
          },
          recibidoPor
        );

        // Inyectar auditoría calculada si aplica
        if (request.accion === 'ACEPTADA' && devolucion.afectaStock && stockDevueltoFlag) {
          // BOLSA
          if (devolucion.tipoProducto === 'BOLSA') {
            devolucionActualizada.stockAnterior =
              request.stockAnterior ?? (stockAnterior as any) ?? devolucionActualizada.stockAnterior;
            devolucionActualizada.stockNuevo =
              request.stockNuevo ?? (stockNuevo as any) ?? devolucionActualizada.stockNuevo;
          }
          // BARRA (guardamos en stockAnterior/stockNuevo como fallback si tu UI lo usa)
          if (devolucion.tipoProducto === 'BARRA' && cuartosAnteriores !== undefined) {
            devolucionActualizada.stockAnterior =
              request.stockAnterior ?? cuartosAnteriores ?? devolucionActualizada.stockAnterior;
            devolucionActualizada.stockNuevo =
              request.stockNuevo ?? cuartosNuevos ?? devolucionActualizada.stockNuevo;
          }
        }

        // Guardar en doc devolución
        tx.update(devDoc.ref, prepararParaFirestore(devolucionActualizada));

        // 4) Movimiento de procesamiento
        const mov = {
          tipo: 'DEVOLUCION_PROCESADA',
          devolucionCodigo: devolucionActualizada.codigo,
          productoCodigo: devolucionActualizada.productoCodigo,
          productoNombre: devolucionActualizada.productoNombre,
          tipoProducto: devolucionActualizada.tipoProducto,
          tipoHielo: devolucionActualizada.tipoHielo,
          cantidad: devolucionActualizada.cantidad,

          accion: request.accion,
          motivoRechazo: request.motivoRechazo ?? null,
          accionesTomadas: request.accionesTomadas ?? null,

          procesadoPor: recibidoPor,
          fecha: new Date(),

          afectaStock: Boolean(devolucionActualizada.afectaStock),
          stockDevuelto: Boolean(stockDevueltoFlag),

          // auditoría útil (sin romper nada si no aplica)
          stockAnterior: request.stockAnterior ?? stockAnterior ?? null,
          stockNuevo: request.stockNuevo ?? stockNuevo ?? null,

          stockHieloAnterior: stockHieloAnterior ?? null,
          stockHieloNuevo: stockHieloNuevo ?? null,

          cuartosAnteriores: cuartosAnteriores ?? null,
          cuartosNuevos: cuartosNuevos ?? null,
        };

        const movRef = doc(collection(db, MOVIMIENTOS_COLLECTION));
        tx.set(movRef, prepararParaFirestore(mov));

        // 5) Resultado (helper del type)
        const res = calcularDevolucionResultado(devolucionActualizada, request);

        return res;
      });

      return resultado;
    } catch (error: any) {
      console.error('❌ Error al procesar devolución:', error);
      throw new Error(error?.message || 'Error al procesar devolución');
    }
  }

  // =====================================================
  // 5) ESTADÍSTICAS
  // =====================================================
  static async obtenerEstadisticasDevoluciones(
    fechaInicio?: Date,
    fechaFin?: Date
  ): Promise<DevolucionStats> {
    try {
      const devoluciones = await this.obtenerDevoluciones({ fechaInicio, fechaFin });
      return calcularStatsDevoluciones(devoluciones);
    } catch (error) {
      console.error('❌ Error estadísticas devoluciones:', error);
      return {
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
      };
    }
  }

  // =====================================================
  // 6) HELPERS DE UI
  // =====================================================
  static async obtenerDevolucionesPendientesEmpleado(empleadoCodigo: string): Promise<Devolucion[]> {
    return this.obtenerDevoluciones({ devueltoPorCodigo: empleadoCodigo, estado: 'PENDIENTE' });
  }

  static async obtenerDevolucionesAceptadasEmpleado(empleadoCodigo: string): Promise<Devolucion[]> {
    return this.obtenerDevoluciones({ devueltoPorCodigo: empleadoCodigo, estado: 'ACEPTADA' });
  }

  // =====================================================
  // 7) VALIDAR PRODUCTO PARA DEVOLUCIÓN (CONSULTA STOCK)
  // =====================================================
  static async validarDevolucionProducto(
    productoCodigo: string,
    tipoProducto: 'BOLSA' | 'BARRA',
    cantidad: number
  ): Promise<{ valido: boolean; mensaje: string; stockActual?: number; productoExiste?: boolean }> {
    try {
      const prodRef = doc(db, PRODUCTOS_COLLECTION, productoCodigo);
      const snap = await getDocCompat(prodRef);

      if (!snap.exists()) {
        return { valido: false, mensaje: 'Producto no encontrado en inventario', productoExiste: false };
      }

      const p: any = snap.data();
      const stockActual = safeNumber(p.cantidad ?? p.stockActual);

      const base = validarProductoParaDevolucion(productoCodigo, tipoProducto, cantidad, stockActual);

      return { ...base, productoExiste: true, stockActual };
    } catch (error) {
      console.error('❌ Error validarDevolucionProducto:', error);
      return { valido: false, mensaje: 'Error al validar producto' };
    }
  }

  // =====================================================
  // 8) CANCELAR DEVOLUCIÓN (PENDIENTE -> RECHAZADA)
  // =====================================================
  static async cancelarDevolucion(
    devolucionCodigo: string,
    empleadoCodigo: string
  ): Promise<{ exito: boolean; mensaje: string }> {
    try {
      const devolucion = await this.obtenerDevolucionPorCodigo(devolucionCodigo);
      if (!devolucion) throw new Error('Devolución no encontrada');
      if (devolucion.estado !== 'PENDIENTE') throw new Error('Solo se pueden cancelar pendientes');
      if (devolucion.devueltoPorCodigo !== empleadoCodigo)
        throw new Error('Solo el creador puede cancelar la devolución');

      await runTransaction(db, async (tx) => {
        const qDev = query(
          collection(db, DEVOLUCIONES_COLLECTION),
          where('codigo', '==', devolucionCodigo),
          limit(1)
        );
        const devSnap = await getDocs(qDev);
        if (devSnap.empty) throw new Error('Doc de devolución no encontrado');

        const devDoc = devSnap.docs[0];

        tx.update(devDoc.ref, {
          estado: 'RECHAZADA',
          motivoRechazo: 'Cancelada por el empleado',
          recibidoPor: empleadoCodigo,
          fechaRecepcion: Timestamp.fromDate(new Date()),
          updatedAt: Timestamp.fromDate(new Date()),
        });

        const mov = {
          tipo: 'DEVOLUCION_CANCELADA',
          devolucionCodigo,
          productoCodigo: devolucion.productoCodigo,
          productoNombre: devolucion.productoNombre,
          canceladoPor: empleadoCodigo,
          fecha: new Date(),
        };

        const movRef = doc(collection(db, MOVIMIENTOS_COLLECTION));
        tx.set(movRef, prepararParaFirestore(mov));
      });

      return { exito: true, mensaje: 'Devolución cancelada exitosamente' };
    } catch (error: any) {
      console.error('❌ Error cancelarDevolucion:', error);
      throw new Error(error?.message || 'Error al cancelar devolución');
    }
  }

  // =====================================================
  // PRIVATE: GENERAR CÓDIGO DEV###
  // =====================================================
  private static async generarSiguienteCodigo(): Promise<string> {
    try {
      const qRef = query(
        collection(db, DEVOLUCIONES_COLLECTION),
        orderBy('codigo', 'desc'),
        limit(1)
      );
      const snap = await getDocs(qRef);

      if (snap.empty) return 'DEV001';

      const ultimo = String(snap.docs[0].data().codigo ?? 'DEV000');
      const n = parseInt(ultimo.replace('DEV', ''), 10);
      const next = Number.isFinite(n) ? n + 1 : 1;

      return `DEV${String(next).padStart(3, '0')}`;
    } catch (e) {
      const t = Date.now();
      return `DEV${String(t % 1000).padStart(3, '0')}`;
    }
  }
}

// =====================================================
// Compat: tu archivo original importaba getDoc, pero a veces lo quitan.
// Para no romper copy/paste si tu import cambia, lo hago helper.
// Si ya tienes getDoc importado arriba, puedes borrar esto y usar getDoc directo.
// =====================================================
async function getDocCompat(ref: any) {
  // Si ya existe getDoc en el runtime, úsalo.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getDoc } = await import('firebase/firestore');
  return getDoc(ref);
}
