// lib/utils/formatters.ts

// ========== FECHAS ==========

// Formatear fecha completa (día, mes, año, hora, minuto)
export function formatFechaCompleta(fecha: Date | string): string {
  const date = typeof fecha === 'string' ? new Date(fecha) : fecha;
  
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

// Formatear fecha corta (solo día, mes, año)
export function formatFechaCorta(fecha: Date | string): string {
  const date = typeof fecha === 'string' ? new Date(fecha) : fecha;
  
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

// Formatear hora (solo hora:minuto)
export function formatHora(fecha: Date | string): string {
  const date = typeof fecha === 'string' ? new Date(fecha) : fecha;
  
  return new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

// Formatear fecha relativa (hace X tiempo)
export function formatFechaRelativa(fecha: Date | string): string {
  const date = typeof fecha === 'string' ? new Date(fecha) : fecha;
  const ahora = new Date();
  const diferenciaMs = ahora.getTime() - date.getTime();
  const diferenciaMin = Math.floor(diferenciaMs / (1000 * 60));
  const diferenciaHoras = Math.floor(diferenciaMin / 60);
  const diferenciaDias = Math.floor(diferenciaHoras / 24);
  
  if (diferenciaMin < 1) return 'Ahora mismo';
  if (diferenciaMin < 60) return `Hace ${diferenciaMin} min`;
  if (diferenciaHoras < 24) return `Hace ${diferenciaHoras} h`;
  if (diferenciaDias < 7) return `Hace ${diferenciaDias} días`;
  
  return formatFechaCorta(date);
}

// ========== NÚMEROS ==========

// Formatear número con separadores de miles
export function formatNumero(numero: number | string): string {
  const num = typeof numero === 'string' ? parseFloat(numero) : numero;
  
  if (isNaN(num)) return '0';
  
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(num);
}

// Formatear número entero (sin decimales)
export function formatEntero(numero: number | string): string {
  const num = typeof numero === 'string' ? parseFloat(numero) : numero;
  
  if (isNaN(num)) return '0';
  
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(num);
}

// Formatear porcentaje
export function formatPorcentaje(numero: number | string, decimales: number = 1): string {
  const num = typeof numero === 'string' ? parseFloat(numero) : numero;
  
  if (isNaN(num)) return '0%';
  
  const porcentaje = num * 100;
  
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  }).format(porcentaje) + '%';
}

// ========== PESOS Y MEDIDAS ==========

// Formatear peso (kg)
export function formatPeso(kg: number | string): string {
  const peso = typeof kg === 'string' ? parseFloat(kg) : kg;
  
  if (isNaN(peso)) return '0 kg';
  
  return `${formatNumero(peso)} kg`;
}

// Formatear cuartos de barra
export function formatCuartos(cuartos: number | string): string {
  const num = typeof cuartos === 'string' ? parseInt(cuartos) : cuartos;
  
  if (isNaN(num)) return '0 cuartos';
  
  if (num === 1) return '1 cuarto';
  return `${formatEntero(num)} cuartos`;
}

// Formatear barras completas
export function formatBarras(barras: number | string): string {
  const num = typeof barras === 'string' ? parseInt(barras) : barras;
  
  if (isNaN(num)) return '0 barras';
  
  if (num === 1) return '1 barra';
  return `${formatEntero(num)} barras`;
}

// ========== MONEDA ==========

// Formatear moneda (pesos mexicanos)
export function formatMoneda(monto: number | string): string {
  const cantidad = typeof monto === 'string' ? parseFloat(monto) : monto;
  
  if (isNaN(cantidad)) return '$0.00';
  
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(cantidad);
}

// Formatear moneda sin símbolo
export function formatMonedaSinSimbolo(monto: number | string): string {
  const cantidad = typeof monto === 'string' ? parseFloat(monto) : monto;
  
  if (isNaN(cantidad)) return '0.00';
  
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(cantidad);
}

// ========== CÓDIGOS ==========

// Formatear código para mostrar (agrega espacios para legibilidad)
export function formatCodigo(codigo: string): string {
  if (!codigo) return '';
  
  // Si es un código simple como BV001, BA001, etc.
  if (/^[A-Z]{2,3}\d{3,}$/.test(codigo)) {
    const letras = codigo.match(/^[A-Z]{2,3}/)?.[0] || '';
    const numeros = codigo.replace(letras, '');
    return `${letras}-${numeros}`;
  }
  
  return codigo;
}

// Extraer prefijo de código
export function extraerPrefijoCodigo(codigo: string): string {
  if (!codigo) return '';
  
  const match = codigo.match(/^[A-Z]{2,3}/);
  return match ? match[0] : '';
}

// Extraer número de código
export function extraerNumeroCodigo(codigo: string): string {
  if (!codigo) return '';
  
  const match = codigo.match(/\d+$/);
  return match ? match[0] : '';
}

// ========== NOMBRES Y TEXTO ==========

// Capitalizar primera letra de cada palabra
export function capitalizarTexto(texto: string): string {
  if (!texto) return '';
  
  return texto
    .toLowerCase()
    .split(' ')
    .map(palabra => palabra.charAt(0).toUpperCase() + palabra.slice(1))
    .join(' ');
}

// Truncar texto muy largo
export function truncarTexto(texto: string, maxLength: number = 50): string {
  if (!texto) return '';
  
  if (texto.length <= maxLength) return texto;
  
  return texto.substring(0, maxLength) + '...';
}

// Formatear nombre de producto
export function formatNombreProducto(nombre: string, tipo?: string, peso?: number): string {
  let resultado = capitalizarTexto(nombre);
  
  if (tipo === 'BOLSA' && peso) {
    resultado += ` ${peso}kg`;
  }
  
  if (tipo === 'BARRA') {
    resultado += ' (Barra)';
  }
  
  return resultado;
}

// ========== VALIDACIONES Y NORMALIZACIONES ==========

// Normalizar PIN (4 dígitos)
export function normalizarPin(pin: string): string {
  if (!pin) return '';
  
  // Solo mantener dígitos
  const digitos = pin.replace(/\D/g, '');
  
  // Limitar a 4 dígitos
  return digitos.slice(0, 4);
}

// Validar formato de hora (HH:mm)
export function validarFormatoHora(hora: string): boolean {
  const regex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return regex.test(hora);
}

// Normalizar hora (asegurar formato HH:mm)
export function normalizarHora(hora: string): string {
  if (!validarFormatoHora(hora)) return '00:00';
  
  const [horas, minutos] = hora.split(':').map(Number);
  return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;
}

// ========== ESTADOS Y BADGES ==========

// Formatear estado para mostrar
export function formatEstado(estado: string): string {
  const estados: Record<string, string> = {
    'VACIA': 'Vacía',
    'ASIGNADA': 'Asignada',
    'LLENA': 'Llena',
    'PENDIENTE': 'Pendiente',
    'ACEPTADA': 'Aceptada',
    'RECHAZADA': 'Rechazada',
    'NORMAL': 'Normal',
    'BAJO': 'Bajo',
    'CRITICO': 'Crítico',
    'EXCESO': 'Exceso',
    'MATUTINO': 'Matutino',
    'VESPERTINO': 'Vespertino',
    'NOCTURNO': 'Nocturno',
    'PRODUCCION': 'Producción',
    'TRANSPORTE': 'Transporte'
  };
  
  return estados[estado] || capitalizarTexto(estado);
}

// Formatear tipo de movimiento
export function formatTipoMovimiento(tipo: string): string {
  const tipos: Record<string, string> = {
    'CREACION_BARRA': 'Creación Barra',
    'CREACION_BOLSA_VACIA': 'Creación Bolsa',
    'ASIGNACION_BOLSA': 'Asignación',
    'LLENADO_BOLSA': 'Llenado',
    'VENTA_BOLSA': 'Venta Bolsa',
    'VENTA_BARRA': 'Venta Barra',
    'DEVOLUCION_BOLSA': 'Devolución Bolsa',
    'DEVOLUCION_BARRA': 'Devolución Barra',
    'MERMA_BOLSA': 'Merma Bolsa',
    'MERMA_BARRA': 'Merma Barra',
    'USO_CUARTOS_BARRA': 'Uso Cuartos',
    'ACTUALIZACION_STOCK': 'Ajuste Stock'
  };
  
  return tipos[tipo] || capitalizarTexto(tipo.replace(/_/g, ' '));
}

// ========== FUNCIONES DE CÁLCULO ==========

// Calcular total de una lista de items
export function calcularTotal(
  items: Array<{ cantidad: number; precio?: number }>
): { cantidadTotal: number; valorTotal: number } {
  let cantidadTotal = 0;
  let valorTotal = 0;
  
  items.forEach(item => {
    cantidadTotal += item.cantidad || 0;
    valorTotal += (item.cantidad || 0) * (item.precio || 0);
  });
  
  return { cantidadTotal, valorTotal };
}

// Calcular porcentaje
export function calcularPorcentaje(parte: number, total: number): number {
  if (total === 0) return 0;
  return (parte / total) * 100;
}

// Formatear duración (minutos a horas:minutos)
export function formatDuracion(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const mins = minutos % 60;
  
  if (horas === 0) return `${mins} min`;
  if (mins === 0) return `${horas} h`;
  
  return `${horas}h ${mins}m`;
}