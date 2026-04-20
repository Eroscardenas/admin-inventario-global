export type TurnoType = 'MATUTINO' | 'VESPERTINO' | 'NOCTURNO';

export interface TurnoInfo {
  tipo: TurnoType;
  label: string;
  horas: string;
  horaInicio: number;
  horaFin: number;
}

// Configuración de turnos (horas en formato 24h)
export const TURNOS: TurnoInfo[] = [
  {
    tipo: 'MATUTINO',
    label: 'Matutino',
    horas: '06:00 - 13:00',
    horaInicio: 6,  // 6:00 AM
    horaFin: 13     // 2:00 PM
  },
  {
    tipo: 'VESPERTINO',
    label: 'Vespertino',
    horas: '14:00 - 20:00',
    horaInicio: 14, // 2:00 PM
    horaFin: 20     // 10:00 PM
  },
  {
    tipo: 'NOCTURNO',
    label: 'Nocturno',
    horas: '22:00 - 06:00',
    horaInicio: 22, // 10:00 PM
    horaFin: 6      // 6:00 AM (del día siguiente)
  }
];

// 🔹 Determinar el turno actual basado en la hora
export function obtenerTurnoActual(fechaValida?: Date): TurnoInfo {
  const ahora = new Date();
  const horaActual = ahora.getHours();
  
  // Buscar el turno que coincide con la hora actual
  for (const turno of TURNOS) {
    if (turno.tipo === 'NOCTURNO') {
      // El nocturno cruza la medianoche
      if (horaActual >= turno.horaInicio || horaActual < turno.horaFin) {
        return turno;
      }
    } else {
      // Turnos normales (matutino y vespertino)
      if (horaActual >= turno.horaInicio && horaActual < turno.horaFin) {
        return turno;
      }
    }
  }
  
  // Por defecto, retornar matutino (aunque debería siempre encontrar uno)
  return TURNOS[0];
}

// 🔹 Formatear hora actual para mostrar
export function formatearHoraActual(): string {
  const ahora = new Date();
  return ahora.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// 🔹 Obtener información completa del turno actual
export function obtenerInfoTurnoActual() {
  const turno = obtenerTurnoActual();
  const hora = formatearHoraActual();
  const fecha = new Date().toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  return {
    turno: turno.tipo,
    turnoLabel: turno.label,
    horasTurno: turno.horas,
    horaActual: hora,
    fechaActual: fecha,
    esTurnoActivo: true
  };
}

// 🔹 Verificar si estamos en un cambio de turno (últimos 15 minutos)
export function esCambioDeTurnoProximo(): boolean {
  const ahora = new Date();
  const minutos = ahora.getMinutes();
  
  // Si faltan 15 minutos o menos para el cambio
  return minutos >= 45;
}

// 🔹 Obtener el próximo turno
export function obtenerProximoTurno(): TurnoInfo {
  const turnoActual = obtenerTurnoActual();
  const turnoIndex = TURNOS.findIndex(t => t.tipo === turnoActual.tipo);
  const proximoIndex = (turnoIndex + 1) % TURNOS.length;
  
  return TURNOS[proximoIndex];
}

// 🔹 Calcular minutos restantes en el turno actual
export function minutosRestantesTurno(): number {
  const ahora = new Date();
  const turnoActual = obtenerTurnoActual();
  const horaActual = ahora.getHours();
  const minutosActual = ahora.getMinutes();
  
  let minutosRestantes = 0;
  
  if (turnoActual.tipo === 'NOCTURNO' && horaActual < turnoActual.horaFin) {
    // Si es nocturno y aún no son las 6 AM
    const horasRestantes = turnoActual.horaFin - horaActual;
    minutosRestantes = (horasRestantes * 60) - minutosActual;
  } else if (turnoActual.tipo === 'NOCTURNO') {
    // Si es nocturno después de medianoche
    const horasRestantes = 24 - horaActual + turnoActual.horaFin;
    minutosRestantes = (horasRestantes * 60) - minutosActual;
  } else {
    // Turnos normales
    const horasRestantes = turnoActual.horaFin - horaActual;
    minutosRestantes = (horasRestantes * 60) - minutosActual;
  }
  
  return Math.max(0, minutosRestantes);
}