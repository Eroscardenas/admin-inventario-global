// lib/utils/validators.ts
import { IceType, ProductType } from './types/product.types';
import { EmpleadoRole } from './types/user.types';
import { CODIGO_PREFIJOS } from './constants';

// ========== VALIDACIONES GENERALES ==========

// Validar email
export function validarEmail(email: string): { valido: boolean; mensaje: string } {
  if (!email || email.trim() === '') {
    return { valido: false, mensaje: 'El email es requerido' };
  }
  
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const valido = regex.test(email);
  
  return {
    valido,
    mensaje: valido ? '' : 'Email inválido. Ejemplo: usuario@correo.com'
  };
}

// Validar que no esté vacío
export function validarRequerido(valor: any, campo: string): { valido: boolean; mensaje: string } {
  if (valor === undefined || valor === null || valor === '') {
    return { valido: false, mensaje: `${campo} es requerido` };
  }
  
  if (typeof valor === 'string' && valor.trim() === '') {
    return { valido: false, mensaje: `${campo} no puede estar vacío` };
  }
  
  return { valido: true, mensaje: '' };
}

// Validar número positivo
export function validarNumeroPositivo(numero: number, campo: string): { valido: boolean; mensaje: string } {
  if (numero === undefined || numero === null || isNaN(numero)) {
    return { valido: false, mensaje: `${campo} debe ser un número` };
  }
  
  if (numero < 0) {
    return { valido: false, mensaje: `${campo} no puede ser negativo` };
  }
  
  if (numero === 0) {
    return { valido: false, mensaje: `${campo} debe ser mayor a 0` };
  }
  
  return { valido: true, mensaje: '' };
}

// ========== VALIDACIONES DE STOCK ==========

// Validar stock (no exceder máximo, no negativo)
export function validarStock(
  stockActual: number, 
  stockMaximo: number,
  stockMinimo?: number
): { valido: boolean; mensaje: string } {
  // Validar stock actual
  if (stockActual < 0) {
    return { valido: false, mensaje: 'El stock no puede ser negativo' };
  }
  
  // Validar stock máximo
  if (stockMaximo <= 0) {
    return { valido: false, mensaje: 'El stock máximo debe ser mayor a 0' };
  }
  
  // Validar que stock actual no exceda máximo
  if (stockActual > stockMaximo) {
    return {
      valido: false,
      mensaje: `Stock actual (${stockActual}) excede el máximo permitido (${stockMaximo})`
    };
  }
  
  // Validar stock mínimo si se proporciona
  if (stockMinimo !== undefined) {
    if (stockMinimo < 0) {
      return { valido: false, mensaje: 'El stock mínimo no puede ser negativo' };
    }
    
    if (stockMinimo > stockMaximo) {
      return {
        valido: false,
        mensaje: `Stock mínimo (${stockMinimo}) no puede ser mayor al máximo (${stockMaximo})`
      };
    }
  }
  
  return { valido: true, mensaje: '' };
}

// Validar cantidad para movimiento
export function validarCantidadMovimiento(
  cantidad: number,
  stockDisponible: number,
  tipoMovimiento: 'ENTRADA' | 'SALIDA'
): { valido: boolean; mensaje: string } {
  const requerido = validarNumeroPositivo(cantidad, 'Cantidad');
  if (!requerido.valido) return requerido;
  
  if (tipoMovimiento === 'SALIDA') {
    if (cantidad > stockDisponible) {
      return {
        valido: false,
        mensaje: `Cantidad solicitada (${cantidad}) excede stock disponible (${stockDisponible})`
      };
    }
  }
  
  return { valido: true, mensaje: '' };
}

// ========== VALIDACIONES DE PRODUCTOS ==========

// Validar código de producto
export function validarCodigoProducto(codigo: string, tipoProducto?: ProductType): { valido: boolean; mensaje: string } {
  const requerido = validarRequerido(codigo, 'Código');
  if (!requerido.valido) return requerido;
  
  // Validar formato básico (letras + números)
  const formatoValido = /^[A-Z]{2,3}\d{3,}$/.test(codigo);
  if (!formatoValido) {
    return { 
      valido: false, 
      mensaje: 'Formato de código inválido. Ejemplo: BV001, BR001, BL001' 
    };
  }
  
  // Extraer prefijo
  const prefijo = codigo.match(/^[A-Z]{2,3}/)?.[0] || '';
  
  // Validar prefijo según tipo de producto si se proporciona
  if (tipoProducto) {
    const prefijosValidos = {
      'BARRA': ['BR'],
      'BOLSA': ['BV', 'BA', 'BL'] // BV=vacía, BA=asignada, BL=llena
    };
    
    const prefijosParaTipo = prefijosValidos[tipoProducto] || [];
    if (prefijosParaTipo.length > 0 && !prefijosParaTipo.includes(prefijo)) {
      return {
        valido: false,
        mensaje: `Código inválido para ${tipoProducto.toLowerCase()}. Prefijos válidos: ${prefijosParaTipo.join(', ')}`
      };
    }
  }
  
  return { valido: true, mensaje: '' };
}

// Validar datos de producto
export function validarProducto(producto: any): { valido: boolean; errores: string[] } {
  const errores: string[] = [];
  
  // Nombre
  if (!producto.nombre || producto.nombre.trim().length < 2) {
    errores.push('El nombre debe tener al menos 2 caracteres');
  }
  
  // Código
  const codigoValido = validarCodigoProducto(producto.codigo, producto.tipo);
  if (!codigoValido.valido) {
    errores.push(codigoValido.mensaje);
  }
  
  // Stock mínimo/máximo
  if (producto.stockMinimo !== undefined) {
    if (producto.stockMinimo < 0) {
      errores.push('El stock mínimo no puede ser negativo');
    }
  }
  
  if (producto.stockMaximo !== undefined) {
    if (producto.stockMaximo <= 0) {
      errores.push('El stock máximo debe ser mayor a 0');
    }
    
    if (producto.stockMinimo !== undefined && producto.stockMinimo > producto.stockMaximo) {
      errores.push('El stock mínimo no puede ser mayor al máximo');
    }
  }
  
  // Validaciones específicas por tipo
  if (producto.tipo === 'BOLSA') {
    // Peso
    if (!producto.pesoKg || producto.pesoKg <= 0) {
      errores.push('El peso debe ser mayor a 0');
    } else if (![3, 5, 10, 15, 17, 20].includes(producto.pesoKg)) {
      errores.push('El peso debe ser 3, 5 o 10 kg');
    }
    
    // Tipos de hielo
    if (!producto.tiposHielo || producto.tiposHielo.length === 0) {
      errores.push('Debe seleccionar al menos un tipo de hielo');
    } else {
      // Validar que todos los tipos sean válidos
      const tiposInvalidos = producto.tiposHielo.filter((tipo: string) => 
        !['ROLITO', 'FRAPPE', 'GOURMET', 'ENFRIAR'].includes(tipo)
      );
      if (tiposInvalidos.length > 0) {
        errores.push(`Tipos de hielo inválidos: ${tiposInvalidos.join(', ')}`);
      }
    }
  }
  
  if (producto.tipo === 'BARRA') {
    // Peso (opcional para barras)
    if (producto.peso !== undefined && producto.peso <= 0) {
      errores.push('El peso de la barra debe ser mayor a 0');
    }
  }
  
  return {
    valido: errores.length === 0,
    errores
  };
}

// ========== VALIDACIONES DE EMPLEADOS ==========

// Validar PIN (4 dígitos)
export function validarPin(pin: string): { valido: boolean; mensaje: string } {
  if (!pin || pin.trim() === '') {
    return { valido: false, mensaje: 'El PIN es requerido' };
  }
  
  // Solo dígitos
  if (!/^\d+$/.test(pin)) {
    return { valido: false, mensaje: 'El PIN debe contener solo números' };
  }
  
  // Exactamente 4 dígitos
  if (pin.length !== 4) {
    return { valido: false, mensaje: 'El PIN debe tener exactamente 4 dígitos' };
  }
  
  // No todos iguales (ej: 1111, 2222)
  if (/^(\d)\1{3}$/.test(pin)) {
    return { valido: false, mensaje: 'El PIN no puede tener todos los dígitos iguales' };
  }
  
  // No números consecutivos (ej: 1234, 4321)
  const esConsecutivoAsc = '0123456789'.includes(pin);
  const esConsecutivoDesc = '9876543210'.includes(pin);
  if (esConsecutivoAsc || esConsecutivoDesc) {
    return { valido: false, mensaje: 'El PIN no puede ser números consecutivos' };
  }
  
  return { valido: true, mensaje: '' };
}

// Validar datos de empleado
export function validarEmpleado(empleado: any): { valido: boolean; errores: string[] } {
  const errores: string[] = [];
  
  // Nombre
  if (!empleado.nombre || empleado.nombre.trim().length < 3) {
    errores.push('El nombre debe tener al menos 3 caracteres');
  }
  
  // Rol
  if (!empleado.role || !['PRODUCCION', 'TRANSPORTE'].includes(empleado.role)) {
    errores.push('Rol inválido. Debe ser PRODUCCION o TRANSPORTE');
  }
  
  // PIN
  const pinValido = validarPin(empleado.pin || '');
  if (!pinValido.valido) {
    errores.push(pinValido.mensaje);
  }
  
  // Código (si se proporciona)
  if (empleado.codigo) {
    const codigoValido = validarCodigoEmpleado(empleado.codigo);
    if (!codigoValido.valido) {
      errores.push(codigoValido.mensaje);
    }
  }
  
  return {
    valido: errores.length === 0,
    errores
  };
}

// Validar código de empleado
export function validarCodigoEmpleado(codigo: string): { valido: boolean; mensaje: string } {
  const requerido = validarRequerido(codigo, 'Código de empleado');
  if (!requerido.valido) return requerido;
  
  // Formato: EMP001, EMP002, etc.
  const formatoValido = /^EMP\d{3,}$/.test(codigo);
  if (!formatoValido) {
    return { 
      valido: false, 
      mensaje: 'Formato de código inválido. Debe ser EMP seguido de números (ej: EMP001)' 
    };
  }
  
  return { valido: true, mensaje: '' };
}

// ========== VALIDACIONES DE TURNOS ==========

// Validar formato de hora (HH:mm)
export function validarHora(hora: string): { valido: boolean; mensaje: string } {
  if (!hora || hora.trim() === '') {
    return { valido: false, mensaje: 'La hora es requerida' };
  }
  
  const regex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  const valido = regex.test(hora);
  
  if (!valido) {
    return { valido: false, mensaje: 'Formato de hora inválido. Use HH:mm (ej: 06:00, 14:30)' };
  }
  
  return { valido: true, mensaje: '' };
}

// Validar que hora de fin sea mayor que hora de inicio
export function validarHorarioTurno(
  horaInicio: string,
  horaFin: string,
  turno?: string
): { valido: boolean; mensaje: string } {
  const inicioValido = validarHora(horaInicio);
  const finValido = validarHora(horaFin);
  
  if (!inicioValido.valido) return inicioValido;
  if (!finValido.valido) return finValido;
  
  const [horaIni, minutoIni] = horaInicio.split(':').map(Number);
  const [horaFinNum, minutoFin] = horaFin.split(':').map(Number);
  
  const inicioTotal = horaIni * 60 + minutoIni;
  const finTotal = horaFinNum * 60 + minutoFin;
  
  // Para turno nocturno (cruza medianoche), fin puede ser menor
  if (turno === 'NOCTURNO') {
    if (inicioTotal >= finTotal && finTotal > 6 * 60) {
      return { 
        valido: true, 
        mensaje: 'Horario válido para turno nocturno' 
      };
    }
  } else {
    // Para otros turnos, fin debe ser mayor que inicio
    if (finTotal <= inicioTotal) {
      return { 
        valido: false, 
        mensaje: 'La hora de fin debe ser mayor que la hora de inicio' 
      };
    }
  }
  
  return { valido: true, mensaje: '' };
}

// ========== VALIDACIONES DE MOVIMIENTOS ==========

// Validar tipo de movimiento
export function validarTipoMovimiento(tipo: string): { valido: boolean; mensaje: string } {
  const tiposValidos = [
    'CREACION_BARRA',
    'CREACION_BOLSA_VACIA',
    'ASIGNACION_BOLSA',
    'LLENADO_BOLSA',
    'VENTA_BOLSA',
    'VENTA_BARRA',
    'DEVOLUCION_BOLSA',
    'DEVOLUCION_BARRA',
    'MERMA_BOLSA',
    'MERMA_BARRA',
    'USO_CUARTOS_BARRA',
    'ACTUALIZACION_STOCK'
  ];
  
  if (!tiposValidos.includes(tipo)) {
    return { 
      valido: false, 
      mensaje: `Tipo de movimiento inválido. Tipos válidos: ${tiposValidos.join(', ')}` 
    };
  }
  
  return { valido: true, mensaje: '' };
}

// Validar movimiento completo
export function validarMovimiento(movimiento: any): { valido: boolean; errores: string[] } {
  const errores: string[] = [];
  
  // Tipo de movimiento
  const tipoValido = validarTipoMovimiento(movimiento.tipo);
  if (!tipoValido.valido) {
    errores.push(tipoValido.mensaje);
  }
  
  // Producto
  if (!movimiento.productoCodigo) {
    errores.push('Código de producto es requerido');
  }
  
  // Cantidad
  if (movimiento.cantidad === undefined || movimiento.cantidad === null) {
    errores.push('Cantidad es requerida');
  } else if (movimiento.cantidad === 0) {
    errores.push('Cantidad no puede ser 0');
  }
  
  // Usuario
  if (!movimiento.usuarioCodigo) {
    errores.push('Código de usuario es requerido');
  }
  
  // Stock anterior/nuevo
  if (movimiento.stockAnterior === undefined || movimiento.stockAnterior === null) {
    errores.push('Stock anterior es requerido');
  }
  
  if (movimiento.stockNuevo === undefined || movimiento.stockNuevo === null) {
    errores.push('Stock nuevo es requerido');
  }
  
  // Validar consistencia de stocks
  if (movimiento.stockAnterior !== undefined && movimiento.stockNuevo !== undefined) {
    const diferenciaEsperada = movimiento.stockNuevo - movimiento.stockAnterior;
    if (Math.abs(diferenciaEsperada - movimiento.cantidad) > 0.001) {
      errores.push(`Inconsistencia en stocks: ${movimiento.stockAnterior} → ${movimiento.stockNuevo} debería ser cambio de ${diferenciaEsperada}, no ${movimiento.cantidad}`);
    }
  }
  
  return {
    valido: errores.length === 0,
    errores
  };
}


// ========== VALIDACIONES DE CUARTOS ==========

// Validar cuartos de barra
export function validarCuartos(cuartos: number, barrasDisponibles?: number): { valido: boolean; mensaje: string } {
  const numeroValido = validarNumeroPositivo(cuartos, 'Cuartos');
  if (!numeroValido.valido) return numeroValido;
  
  // Debe ser número entero
  if (!Number.isInteger(cuartos)) {
    return { valido: false, mensaje: 'Los cuartos deben ser un número entero' };
  }
  
  // Validar contra barras disponibles si se proporciona
  if (barrasDisponibles !== undefined) {
    const cuartosDisponibles = barrasDisponibles * 4;
    if (cuartos > cuartosDisponibles) {
      return {
        valido: false,
        mensaje: `Cuartos solicitados (${cuartos}) exceden disponibles (${cuartosDisponibles})`
      };
    }
  }
  
  return { valido: true, mensaje: '' };
}

// Validar que cuartos sean múltiplo de 1 (enteros)
export function validarCuartosEnteros(cuartos: number): { valido: boolean; mensaje: string } {
  if (!Number.isInteger(cuartos)) {
    return { valido: false, mensaje: 'Los cuartos deben ser un número entero' };
  }
  
  return { valido: true, mensaje: '' };
}