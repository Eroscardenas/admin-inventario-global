// lib/utils/types/turno.types.ts

export type TurnoType = 'MATUTINO' | 'VESPERTINO' | 'NOCTURNO';

// ========== TURNO CON CÓDIGO ==========
export interface Turno {
  codigo: string;            // TUR001, TUR002
  nombre: TurnoType;
  horaInicio: string;        // "06:00" EXACTO
  horaFin: string;           // "13:00" EXACTO (MATUTINO termina a las 13:00)
  isActive: boolean;
  creadoPor: string;         // "admin"
  createdAt: Date;
  updatedAt: Date;
}

// ========== TURNO ACTUAL DE EMPLEADO ==========
export interface TurnoActual {
  empleadoCodigo: string;    // EMP001
  empleadoNombre: string;
  turno: TurnoType;
  fecha: Date;
  horaEntrada?: string;      // "06:05"
  horaSalida?: string;       // "12:55" (MATUTINO sale antes de las 13:00)
  horasTrabajadas?: number;  // 6.8 horas (13-6 = 7 horas menos descanso)
  isActive: boolean;         // true = en turno
}

// ========== REGISTRO DE ASISTENCIA ==========
export interface RegistroAsistencia {
  codigo: string;            // ASI001
  empleadoCodigo: string;    // EMP001
  empleadoNombre: string;
  turno: TurnoType;
  fecha: Date;
  tipo: 'ENTRADA' | 'SALIDA' | 'DESCANSO';
  hora: string;              // "06:05"
  ubicacion?: string;        // "Producción", "Almacén"
  observaciones?: string;
  registradoPor?: string;    // "admin" o "EMP001"
}

// ========== CONSTANTES CON HORARIOS EXACTOS ==========
export const TURNOS: TurnoType[] = ['MATUTINO', 'VESPERTINO', 'NOCTURNO'];

export const TURNO_LABELS: Record<TurnoType, string> = {
  MATUTINO: 'Matutino',
  VESPERTINO: 'Vespertino',
  NOCTURNO: 'Nocturno',
};

// HORARIOS CORREGIDOS:
export const TURNO_HORAS: Record<TurnoType, { inicio: string; fin: string }> = {
  MATUTINO: { inicio: '06:00', fin: '13:00' },   // 6 AM - 1 PM
  VESPERTINO: { inicio: '14:00', fin: '21:00' }, // 2 PM - 9 PM
  NOCTURNO: { inicio: '22:00', fin: '06:00' },   // 10 PM - 6 AM
};

export const TURNO_COLORS: Record<TurnoType, string> = {
  MATUTINO: 'bg-amber-100 text-amber-800 border-amber-300',
  VESPERTINO: 'bg-blue-100 text-blue-800 border-blue-300',
  NOCTURNO: 'bg-indigo-100 text-indigo-800 border-indigo-300',
};

// Duración de cada turno en horas
export const TURNO_DURACION: Record<TurnoType, number> = {
  MATUTINO: 7,    // 13 - 6 = 7 horas
  VESPERTINO: 7,  // 21 - 14 = 7 horas
  NOCTURNO: 8     // 6 (del día siguiente) + (24 - 22) = 8 horas
};

// ========== FUNCIONES CORREGIDAS ==========

// Determinar turno actual basado en hora EXACTA
export function getCurrentTurno(): TurnoType {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // MATUTINO: 06:00 - 12:59 (antes de las 13:00)
  if (totalMinutes >= 6 * 60 && totalMinutes < 13 * 60) {
    return 'MATUTINO';
  }
  
  // VESPERTINO: 14:00 - 20:59 (antes de las 21:00)
  if (totalMinutes >= 14 * 60 && totalMinutes < 21 * 60) {
    return 'VESPERTINO';
  }
  
  // NOCTURNO: 22:00 - 05:59 (antes de las 06:00)
  // O desde 22:00 hasta 23:59, o desde 00:00 hasta 05:59
  if (totalMinutes >= 22 * 60 || totalMinutes < 6 * 60) {
    return 'NOCTURNO';
  }
  
  // Horas muertas (13:00 - 13:59 y 21:00 - 21:59)
  // Retornar el turno más cercano
  if (totalMinutes >= 13 * 60 && totalMinutes < 14 * 60) {
    return 'VESPERTINO'; // Próximo turno
  }
  
  return 'MATUTINO'; // Por defecto
}

// Obtener próximo turno
export function getNextTurno(current?: TurnoType): TurnoType {
  const turnos = TURNOS;
  const currentIdx = turnos.indexOf(current || getCurrentTurno());
  return turnos[(currentIdx + 1) % turnos.length];
}

// Verificar si hora está dentro del turno EXACTO
export function isInTurnoTime(turno: TurnoType, hora: string): boolean {
  const turnoHoras = TURNO_HORAS[turno];
  const [horaActual, minutoActual] = hora.split(':').map(Number);
  const [inicioHora, inicioMinuto] = turnoHoras.inicio.split(':').map(Number);
  const [finHora, finMinuto] = turnoHoras.fin.split(':').map(Number);
  
  const actualTotal = horaActual * 60 + minutoActual;
  const inicioTotal = inicioHora * 60 + inicioMinuto;
  const finTotal = finHora * 60 + finMinuto;
  
  if (turno === 'NOCTURNO') {
    // NOCTURNO: 22:00 - 06:00 (cruza medianoche)
    return actualTotal >= inicioTotal || actualTotal < finTotal;
  } else {
    // MATUTINO y VESPERTINO: no cruzan medianoche
    return actualTotal >= inicioTotal && actualTotal < finTotal;
  }
}

// Verificar si empleado está en su turno
export function isEmpleadoInTurno(
  empleadoTurno: TurnoType,
  horaActual?: string
): boolean {
  const hora = horaActual || new Date().toTimeString().slice(0, 5);
  return isInTurnoTime(empleadoTurno, hora);
}

// Calcular minutos hasta próximo turno
export function minutosHastaProximoTurno(): number {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTotal = currentHour * 60 + currentMinute;
  
  // Horarios de inicio de cada turno
  const iniciosTurnos = [
    { turno: 'MATUTINO', inicio: 6 * 60 },    // 06:00
    { turno: 'VESPERTINO', inicio: 14 * 60 }, // 14:00
    { turno: 'NOCTURNO', inicio: 22 * 60 }    // 22:00
  ];
  
  // Ordenar por hora de inicio
  iniciosTurnos.sort((a, b) => a.inicio - b.inicio);
  
  // Encontrar próximo turno
  for (const turno of iniciosTurnos) {
    if (currentTotal < turno.inicio) {
      return turno.inicio - currentTotal;
    }
  }
  
  // Si ya pasaron todos, calcular hasta mañana 6:00
  return (24 * 60 - currentTotal) + (6 * 60); // Hasta mañana 6:00
}

// Crear turno actual para empleado
export function crearTurnoActual(
  empleadoCodigo: string,
  empleadoNombre: string,
  turnoAsignado?: TurnoType
): TurnoActual {
  const turnoActual = getCurrentTurno();
  const turnoParaEmpleado = turnoAsignado || turnoActual;
  
  return {
    empleadoCodigo,
    empleadoNombre,
    turno: turnoParaEmpleado,
    fecha: new Date(),
    isActive: isEmpleadoInTurno(turnoParaEmpleado)
  };
}

// Registrar asistencia con validación de horario
export function registrarAsistencia(
  empleadoCodigo: string,
  empleadoNombre: string,
  tipo: 'ENTRADA' | 'SALIDA' | 'DESCANSO',
  turnoAsignado: TurnoType,
  datosAdicionales?: {
    ubicacion?: string;
    observaciones?: string;
    registradoPor?: string;
  }
): {
  registro: RegistroAsistencia;
  valido: boolean;
  mensaje: string;
} {
  const now = new Date();
  const hora = now.toTimeString().slice(0, 5);
  const turnoActual = getCurrentTurno();
  
  // Validar que el empleado está en su turno asignado
  const enTurnoCorrecto = turnoActual === turnoAsignado;
  const enHorarioTurno = isInTurnoTime(turnoAsignado, hora);
  
  let mensaje = '';
  let valido = true;
  
  if (!enTurnoCorrecto) {
    valido = false;
    mensaje = `No está en su turno asignado (${turnoAsignado}). Turno actual: ${turnoActual}`;
  } else if (!enHorarioTurno) {
    valido = false;
    mensaje = `Fuera del horario del turno ${turnoAsignado} (${TURNO_HORAS[turnoAsignado].inicio} - ${TURNO_HORAS[turnoAsignado].fin})`;
  } else {
    mensaje = `Asistencia ${tipo.toLowerCase()} registrada correctamente en turno ${turnoAsignado}`;
  }
  
  const registro: RegistroAsistencia = {
    codigo: '', // ASI001
    empleadoCodigo,
    empleadoNombre,
    turno: turnoAsignado,
    fecha: now,
    tipo,
    hora,
    ubicacion: datosAdicionales?.ubicacion,
    observaciones: datosAdicionales?.observaciones || (valido ? '' : mensaje),
    registradoPor: datosAdicionales?.registradoPor || empleadoCodigo
  };
  
  return { registro, valido, mensaje };
}

// Validar si puede registrar movimiento en este turno
export function puedeRegistrarMovimiento(
  empleadoCodigo: string,
  empleadoNombre: string,
  empleadoTurno: TurnoType,
  tipoMovimiento: string
): {
  permitido: boolean;
  mensaje: string;
  turnoActual: TurnoType;
  enHorario: boolean;
} {
  const turnoActual = getCurrentTurno();
  const horaActual = new Date().toTimeString().slice(0, 5);
  const enHorario = isInTurnoTime(empleadoTurno, horaActual);
  const enTurnoCorrecto = turnoActual === empleadoTurno;
  
  if (!enTurnoCorrecto) {
    return {
      permitido: false,
      mensaje: `${empleadoNombre} (${empleadoCodigo}) no puede registrar ${tipoMovimiento}. Turno actual: ${turnoActual}, su turno: ${empleadoTurno}`,
      turnoActual,
      enHorario
    };
  }
  
  if (!enHorario) {
    return {
      permitido: false,
      mensaje: `${empleadoNombre} está fuera del horario del turno ${empleadoTurno} (${TURNO_HORAS[empleadoTurno].inicio} - ${TURNO_HORAS[empleadoTurno].fin})`,
      turnoActual,
      enHorario
    };
  }
  
  return {
    permitido: true,
    mensaje: `Movimiento permitido para ${empleadoNombre} en turno ${empleadoTurno}`,
    turnoActual,
    enHorario
  };
}

// Formatear turno para mostrar
export function formatearTurno(turno: TurnoType): string {
  return `${TURNO_LABELS[turno]} (${TURNO_HORAS[turno].inicio} - ${TURNO_HORAS[turno].fin})`;
}

// Obtener turno por hora específica
export function getTurnoByHour(hour: number, minute: number = 0): TurnoType {
  const totalMinutes = hour * 60 + minute;
  
  if (totalMinutes >= 6 * 60 && totalMinutes < 13 * 60) {
    return 'MATUTINO';
  }
  
  if (totalMinutes >= 14 * 60 && totalMinutes < 21 * 60) {
    return 'VESPERTINO';
  }
  
  // NOCTURNO: 22:00 - 05:59
  if (totalMinutes >= 22 * 60 || totalMinutes < 6 * 60) {
    return 'NOCTURNO';
  }
  
  // Horas entre turnos (13:00-13:59 y 21:00-21:59)
  // Retornar el turno más cercano
  if (totalMinutes >= 13 * 60 && totalMinutes < 14 * 60) {
    return 'VESPERTINO'; // Próximo turno
  }
  
  return 'MATUTINO'; // Por defecto (para 21:00-21:59)
}

// Calcular horas trabajadas en un turno
export function calcularHorasTrabajadas(
  horaEntrada: string,
  horaSalida: string,
  turno: TurnoType
): number {
  const [horaE, minutoE] = horaEntrada.split(':').map(Number);
  const [horaS, minutoS] = horaSalida.split(':').map(Number);
  
  let entradaTotal = horaE * 60 + minutoE;
  let salidaTotal = horaS * 60 + minutoS;
  
  // Ajustar para turno nocturno (puede cruzar medianoche)
  if (turno === 'NOCTURNO' && salidaTotal < entradaTotal) {
    salidaTotal += 24 * 60; // Agregar un día
  }
  
  const minutosTrabajados = salidaTotal - entradaTotal;
  const horasTrabajadas = minutosTrabajados / 60;
  
  // Restar descanso si aplica (ej: 30 minutos de descanso)
  const descanso = 0.5; // 30 minutos
  return Math.max(0, horasTrabajadas - descanso);
}