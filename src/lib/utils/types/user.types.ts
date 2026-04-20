// lib/utils/types/user.types.ts  ✅ PRODUCTION (PIN hash/salt compatible + isActive en Create DTO)
// =====================================================
// Tipos y helpers de EMPLEADOS (no admin).
// Admin usa Firebase Auth; empleados entran por CÓDIGO + PIN.
// =====================================================

// ========== ROLES SOLO PARA EMPLEADOS ==========
export type EmpleadoRole = 'PRODUCCION' | 'TRANSPORTE';

// ========== FECHAS COMPATIBLES CON FIRESTORE ==========
/**
 * En Firestore normalmente guardarás `Timestamp`,
 * pero en UI muchas veces trabajas con `Date`.
 */
export type FireDate = Date | import('firebase/firestore').Timestamp;

// ========== ENTIDAD EMPLEADO ==========
export interface Empleado {
  codigo: string; // EMP001, EMP002, etc.
  nombre: string; // "Juan Pérez"
  role: EmpleadoRole; // PRODUCCION o TRANSPORTE
  isActive: boolean; // true = trabaja, false = inactivo

  /**
   * Seguridad:
   * - UI NO debe manejar el PIN real.
   * - En Firestore guardamos pinHash + pinSalt.
   * - "pin" aquí se deja vacío en UI.
   */
  pin: string; // SIEMPRE '' en UI
  pinHash?: string; // opcional: indicador de que tiene PIN configurado

  createdAt: FireDate; // Date o Timestamp
  updatedAt: FireDate; // Date o Timestamp
  creadoPor?: string; // email/admin (opcional)
}

// ========== DTOs ==========
export interface CrearEmpleadoDTO {
  nombre: string;
  role: EmpleadoRole;
  pin: string; // 4 dígitos
  isActive?: boolean; // ✅ opcional (para alta inactiva sin 2da escritura)
}

export interface ActualizarEmpleadoDTO {
  nombre?: string;
  role?: EmpleadoRole;
  isActive?: boolean;

  // ⚠️ PIN fijo: el service ignora estos en actualizar()
  pin?: string;
  pinHash?: string;
}

// ========== VALIDACIONES ==========
export function esPinValido(pin: string): boolean {
  return /^\d{4}$/.test((pin || '').trim());
}

export function normalizarNombre(nombre: string): string {
  return (nombre || '').trim().replace(/\s+/g, ' ');
}

/**
 * Validación simple: útil antes de mandar a service/Firestore.
 * Regresa lista de errores (vacía = OK).
 */
export function validarCrearEmpleadoDTO(data: CrearEmpleadoDTO): string[] {
  const errores: string[] = [];

  const nombre = normalizarNombre(data.nombre ?? '');
  if (!nombre) errores.push('El nombre es obligatorio.');
  if (nombre.length < 2) errores.push('El nombre es muy corto.');

  if (data.role !== 'PRODUCCION' && data.role !== 'TRANSPORTE') {
    errores.push('El rol es inválido.');
  }

  if (!esPinValido(data.pin ?? '')) {
    errores.push('El PIN debe ser de 4 dígitos.');
  }

  if (data.isActive !== undefined && typeof data.isActive !== 'boolean') {
    errores.push('isActive debe ser boolean.');
  }

  return errores;
}

// ========== HELPERS DE CREACIÓN ==========
/**
 * Crea el objeto Empleado base (sin código asignado aún).
 * El código lo asigna tu lógica (SimpleCode / contador / etc.).
 */
export function crearEmpleado(data: CrearEmpleadoDTO, creadoPor?: string): Empleado {
  const nombre = normalizarNombre(data.nombre);

  return {
    codigo: '', // Se asignará con SimpleCode (EMP001...)
    nombre,
    role: data.role,
    isActive: data.isActive ?? true, // ✅ respeta alta inactiva
    pin: (data.pin || '').trim(),
    createdAt: new Date(),
    updatedAt: new Date(),
    creadoPor,
  };
}

/**
 * Aplica un patch de actualización y refresca updatedAt.
 * Útil en services para mantener consistencia.
 */
export function aplicarActualizacionEmpleado(empleado: Empleado, patch: ActualizarEmpleadoDTO): Empleado {
  return {
    ...empleado,
    ...(patch.nombre !== undefined ? { nombre: normalizarNombre(patch.nombre) } : {}),
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    ...(patch.pin !== undefined ? { pin: patch.pin } : {}),
    ...(patch.pinHash !== undefined ? { pinHash: patch.pinHash } : {}),
    updatedAt: new Date(),
  };
}

// ========== UI CONSTANTS ==========
export const ROLES_UI: Record<EmpleadoRole, { label: string; color: string; icon: string }> = {
  PRODUCCION: { label: 'Producción', color: 'bg-blue-500', icon: '🏭' },
  TRANSPORTE: { label: 'Transporte', color: 'bg-green-500', icon: '🚚' },
};

// ========== UTILIDADES DE PRESENTACIÓN ==========
export function formatearEmpleado(empleado: Empleado): string {
  return `${empleado.codigo} - ${empleado.nombre} (${empleado.role})`;
}
