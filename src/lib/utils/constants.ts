// lib/utils/constants.ts
import { IceType, ProductType } from './types/product.types';
import { EmpleadoRole } from './types/user.types';
import { TipoMovimiento } from './types/transaction.types';
import {Prefijos} from './simpleCode';

// Importar iconos de Lucide React
import { 
  IceCream, 
  Snowflake, 
  Thermometer, 
  Droplets, 
  Cuboid,
  Factory,
  Truck,
  User,
  Package,
  BarChart,
  Settings,
  Home,
  LogOut
} from 'lucide-react';

// Re-exportar tipos CORRECTAMENTE (usando export type)
export type { TurnoType } from './types/turno.types';

// ========== ROLES DE USUARIO (EMPLEADO) ==========
export const EMPLEADO_ROLES: Record<EmpleadoRole, { 
  label: string; 
  description: string;
  icon: any;
  color: string;
}> = {
  PRODUCCION: {
    label: 'Producción',
    description: 'Llenado y manejo de inventario',
    icon: Factory,
    color: 'bg-blue-500'
  },
  TRANSPORTE: {
    label: 'Transporte',
    description: 'Distribución y entregas',
    icon: Truck,
    color: 'bg-green-500'
  },
};

// ========== TIPOS DE HIELO ==========
export const ICE_TYPES: Record<IceType, {
  icon: any; 
  label: string; 
  descripcion: string;
  color: string;
}> = {
  ROLITO: {
    label: 'Rolito',
    descripcion: 'Hielo Rolito',
    icon: Droplets,
    color: 'blue'
  },
  FRAPPE: {
    label: 'Frappe',
    descripcion: 'Hielo Frappe',
    icon: Snowflake,
    color: 'purple'
  },
  GOURMET: {
    label: 'Gourmet',
    descripcion: 'Hielo premium',
    icon: IceCream,
    color: 'amber'
  },
  ENFRIAR: {
    label: 'Para Enfriar',
    descripcion: 'Hielo para conservación',
    icon: Thermometer,
    color: 'emerald'
  },
  BARRA: {
    label: 'Barra (Cuartos)',
    descripcion: 'Cuartos de barra para distribución',
    icon: Cuboid,
    color: 'orange'
  }
};

// ========== COLORES POR TIPO DE HIELO ==========
export const ICE_TYPE_COLORS: Record<IceType, string> = {
  ROLITO: 'border-blue-500 bg-blue-900 bg-opacity-30',
  FRAPPE: 'border-purple-500 bg-purple-900 bg-opacity-30',
  GOURMET: 'border-amber-500 bg-amber-900 bg-opacity-30',
  ENFRIAR: 'border-emerald-500 bg-emerald-900 bg-opacity-30',
  BARRA: 'border-orange-500 bg-orange-900 bg-opacity-30'
};

export const ICE_TYPE_BG_COLORS: Record<IceType, string> = {
  ROLITO: 'bg-blue-500',
  FRAPPE: 'bg-purple-500',
  GOURMET: 'bg-amber-500',
  ENFRIAR: 'bg-emerald-500',
  BARRA: 'bg-orange-500'
};

export const ICE_TYPE_TEXT_COLORS: Record<IceType, string> = {
  ROLITO: 'text-blue-300',
  FRAPPE: 'text-purple-300',
  GOURMET: 'text-amber-300',
  ENFRIAR: 'text-emerald-300',
  BARRA: 'text-orange-300'
};

// ========== PESOS DE BOLSAS ==========
export const BOLSA_PESOS = [3, 5, 10, 15, 19,20]; // kg


// ========== ESTADOS DE PRODUCTO ==========
export const PRODUCT_STATUS = {
  VACIA: 'VACIA',
  ASIGNADA: 'ASIGNADA', 
  LLENA: 'LLENA'
} as const;

export const PRODUCT_STATUS_COLORS: Record<string, string> = {
  VACIA: 'border-blue-500 bg-blue-900 bg-opacity-30 text-blue-300',
  ASIGNADA: 'border-yellow-500 bg-yellow-900 bg-opacity-30 text-yellow-300',
  LLENA: 'border-green-500 bg-green-900 bg-opacity-30 text-green-300'
};

export const PRODUCT_STATUS_ICONS: Record<string, any> = {
  VACIA: Package,
  ASIGNADA: User,
  LLENA: Factory
};

// ========== TURNOS ==========
// NOTA: TurnoType se importa arriba con 'export type'

// ========== TIPOS DE PRODUCTO ==========
export const PRODUCT_TYPE_COLORS: Record<ProductType, string> = {
  BARRA: 'border-orange-500 bg-orange-900 bg-opacity-30 text-orange-300',
  BOLSA: 'border-indigo-500 bg-indigo-900 bg-opacity-30 text-indigo-300'
};

export const PRODUCT_TYPE_ICONS: Record<ProductType, any> = {
  BARRA: Cuboid,
  BOLSA: Package
};

// ========== NAVEGACIÓN ADMIN ==========
export const ADMIN_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: Home, path: '/admin' },
  { id: 'empleados', label: 'Empleados', icon: User, path: '/admin/empleados' },
  { id: 'productos', label: 'Productos', icon: Package, path: '/admin/productos' },
  { id: 'asignacion', label: 'Asignación', icon: Factory, path: '/admin/asignacion' },
  { id: 'inventario', label: 'Inventario', icon: BarChart, path: '/admin/inventario' },
  { id: 'reportes', label: 'Reportes', icon: BarChart, path: '/admin/reportes' },
  { id: 'config', label: 'Configuración', icon: Settings, path: '/admin/config' },
  { id: 'logout', label: 'Cerrar Sesión', icon: LogOut, path: '/logout' }
];

// ========== NAVEGACIÓN PRODUCCIÓN ==========
export const PRODUCCION_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: Home, path: '/produccion' },
  { id: 'llenar', label: 'Llenar Bolsas', icon: Factory, path: '/produccion/llenar' },
  { id: 'ventas', label: 'Registrar Ventas', icon: Truck, path: '/produccion/ventas' },
  { id: 'devoluciones', label: 'Devoluciones', icon: '↩️', path: '/produccion/devoluciones' },
  { id: 'logout', label: 'Cerrar Sesión', icon: LogOut, path: '/logout' }
];

// ========== TIPOS DE MOVIMIENTO ==========
export const TIPO_MOVIMIENTO_COLORS: Partial<Record<TipoMovimiento, string>> = {
  CREACION_BARRA: 'bg-green-100 text-green-800 border-green-300',
  CREACION_BOLSA_VACIA: 'bg-green-100 text-green-800 border-green-300',
  ASIGNACION_BOLSA: 'bg-blue-100 text-blue-800 border-blue-300',
  LLENADO_BOLSA: 'bg-cyan-100 text-cyan-800 border-cyan-300',
  VENTA_BOLSA: 'bg-orange-100 text-orange-800 border-orange-300',
  VENTA_BARRA: 'bg-orange-100 text-orange-800 border-orange-300',
  DEVOLUCION_BOLSA: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  DEVOLUCION_BARRA: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  MERMA_BOLSA: 'bg-red-100 text-red-800 border-red-300',
  MERMA_BARRA: 'bg-red-100 text-red-800 border-red-300',
  USO_CUARTOS_BARRA: 'bg-purple-100 text-purple-800 border-purple-300',
  ACTUALIZACION_STOCK: 'bg-gray-100 text-gray-800 border-gray-300'
};

// ========== CONFIGURACIÓN DE STOCK ==========
export const STOCK_CONFIG = {
  // Porcentajes para alertas
  ALERTA_BAJA: 0.3,    // 30% del stock máximo
  ALERTA_CRITICA: 0.1, // 10% del stock máximo
  
  // Valores por defecto para nuevos productos
  STOCK_MINIMO_DEFAULT: 20,
  STOCK_MAXIMO_DEFAULT: 100,
  
  // Para barras
  CUARTOS_POR_BARRA: 4,
  
  // Tiempo de actualización en milisegundos
  ACTUALIZACION_TIEMPO: 30000 // 30 segundos
};

// ========== MÓDULOS DEL SISTEMA ==========
export const MODULOS_SISTEMA = {
  ADMIN: {
    nombre: 'Administración',
    descripcion: 'Control total del sistema',
    color: 'bg-purple-500'
  },
  PRODUCCION: {
    nombre: 'Producción',
    descripcion: 'Llenado y control de bolsas',
    color: 'bg-blue-500'
  },
  TRANSPORTE: {
    nombre: 'Transporte',
    descripcion: 'Distribución y entregas',
    color: 'bg-green-500'
  }
};

// ========== PREFIJOS DE CÓDIGOS ==========
export const CODIGO_PREFIJOS = {
  USUARIO: Prefijos.USUARIO,
  BOLSA_VACIA: Prefijos.BOLSA_VACIA,
  BOLSA_ASIGNADA: Prefijos.BOLSA_ASIGNADA,
  BOLSA_LLENA: Prefijos.BOLSA_LLENA,
  BARRA: Prefijos.BARRA,
  MOVIMIENTO: Prefijos.MOVIMIENTO,
  MERMA: Prefijos.MERMA,
  DEVOLUCION: Prefijos.DEVOLUCION,
  HISTORICO: Prefijos.HISTORICO,
} as const;

// ========== VALORES POR DEFECTO ==========
export const DEFAULTS = {
  // Formularios
  PESO_BOLSA: 3,
  CANTIDAD_INICIAL: 0,
  
  // Usuarios
  PIN_LENGTH: 4,
  
  // Tiempos
  SESSION_TIMEOUT: 30, // minutos
  AUTO_LOGOUT: 60 // minutos
};

// ========== MENSAJES DEL SISTEMA ==========
export const SYSTEM_MESSAGES = {
  // Éxito
  EXITO: 'Operación completada correctamente',
  GUARDADO: 'Datos guardados correctamente',
  ACTUALIZADO: 'Datos actualizados correctamente',
  ELIMINADO: 'Registro eliminado correctamente',
  
  // Error
  ERROR: 'Ocurrió un error',
  SIN_DATOS: 'No se encontraron datos',
  NO_AUTORIZADO: 'No tiene permisos para esta acción',
  VALIDACION_ERROR: 'Por favor complete todos los campos requeridos',
  
  // Advertencias
  ADVERTENCIA_STOCK_BAJO: 'Stock bajo, considere reabastecer',
  ADVERTENCIA_STOCK_CRITICO: '¡Stock crítico! Reabastecer inmediatamente',
  
  // Información
  CARGANDO: 'Cargando...',
  PROCESANDO: 'Procesando...',
  ESPERE: 'Por favor espere'
};

// ========== FUNCIONES HELPER ==========

// Verificar si es un IceType válido
export function isIceType(tipo: any): tipo is IceType {
  return ['ROLITO', 'FRAPPE', 'GOURMET', 'ENFRIAR', 'BARRA'].includes(tipo);
}

// Obtener información de tipo de hielo
export function getIceTypeInfo(tipo: string) {
  if (isIceType(tipo)) {
    return ICE_TYPES[tipo];
  }
  return { 
    label: tipo, 
    descripcion: 'Tipo de hielo',
    icon: IceCream,
    color: 'gray'
  };
}

// Obtener color por tipo de hielo
export function getIceTypeColor(tipo: string): string {
  if (isIceType(tipo)) {
    return ICE_TYPE_COLORS[tipo];
  }
  return 'border-gray-500 bg-gray-900 bg-opacity-30';
}

// Calcular cuartos de barras
export function calcularCuartosDeBarras(cantidadBarras: number): number {
  return cantidadBarras * STOCK_CONFIG.CUARTOS_POR_BARRA;
}

// Calcular barras de cuartos
export function calcularBarrasDeCuartos(cantidadCuartos: number): {
  barrasCompletas: number;
  cuartosRestantes: number;
} {
  const cuartosPorBarra = STOCK_CONFIG.CUARTOS_POR_BARRA;
  const barrasCompletas = Math.floor(cantidadCuartos / cuartosPorBarra);
  const cuartosRestantes = cantidadCuartos % cuartosPorBarra;
  
  return { barrasCompletas, cuartosRestantes };
}

// ========== ARRAYS PARA FORMULARIOS ==========
export const ALL_ICE_TYPES: IceType[] = ['ROLITO', 'FRAPPE', 'GOURMET', 'ENFRIAR', 'BARRA'];
export const ALL_PRODUCT_TYPES: ProductType[] = ['BARRA', 'BOLSA'];
export const ALL_PRODUCT_STATUS = ['VACIA', 'ASIGNADA', 'LLENA'] as const;

// Si necesitas TURNOS como array, puedes crearlo aquí:
export const ALL_TURNOS = ['MATUTINO', 'VESPERTINO', 'NOCTURNO'] as const;