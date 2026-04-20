// lib/utils/turnoUtils.ts - VERSIÓN CORREGIDA
export type Turno = 'matutino' | 'vespertino' | 'nocturno';

// 1. Función principal para obtener turno actual
export function obtenerTurnoActual(fecha: Date = new Date()): Turno {
  const hora = fecha.getHours();
  
  if (hora >= 6 && hora < 14) {
    return 'matutino';
  } else if (hora >= 14 && hora < 22) {
    return 'vespertino';
  } else {
    return 'nocturno';
  }
}

// 2. Obtener horas del turno
export function obtenerHoraTurno(turno: Turno): string {
  switch(turno) {
    case 'matutino': return '06:00 - 13:00';
    case 'vespertino': return '14:00 - 20:00';
    case 'nocturno': return '22:00 - 06:00';
    default: return '--:-- - --:--';
  }
}

// 3. Obtener label del turno (¡ESTA FALTABA!)
export function obtenerLabelTurno(turno: Turno): string {
  switch(turno) {
    case 'matutino': return 'Turno Matutino';
    case 'vespertino': return 'Turno Vespertino';
    case 'nocturno': return 'Turno Nocturno';
    default: return 'Turno Desconocido';
  }
}

// 4. Verificar si el turno está activo
export function esTurnoActivo(turno: Turno): boolean {
  const ahora = new Date();
  const hora = ahora.getHours();
  
  switch(turno) {
    case 'matutino': return hora >= 6 && hora < 13;
    case 'vespertino': return hora >= 14 && hora < 20;
    case 'nocturno': return hora >= 22 || hora < 6;
    default: return false;
  }
}

// 5. Calcular minutos restantes del turno (¡ESTA FALTABA!)
export function minutosRestantesTurno(turno: Turno): number {
  const ahora = new Date();
  const hora = ahora.getHours();
  const minutos = ahora.getMinutes();
  
  let finTurnoHora = 0;
  
  switch(turno) {
    case 'matutino':
      finTurnoHora = 13; // 2:00 PM
      break;
    case 'vespertino':
      finTurnoHora = 20; // 10:00 PM
      break;
    case 'nocturno':
      // Si es después de las 22:00, termina a las 6:00 del siguiente día
      finTurnoHora = hora < 6 ? 6 : 30; // 30 = 6:00 + 24 horas
      break;
    default:
      return 0;
  }
  
  // Calcular minutos restantes
  const minutosActuales = hora * 60 + minutos;
  const minutosFinTurno = finTurnoHora * 60;
  
  let minutosRestantes = minutosFinTurno - minutosActuales;
  
  // Para el turno nocturno que cruza medianoche
  if (turno === 'nocturno' && hora >= 22) {
    minutosRestantes = (24 * 60 - minutosActuales) + (6 * 60);
  }
  
  return Math.max(0, minutosRestantes);
}

// 6. Obtener icono del turno
export function obtenerIconoTurno(turno: Turno): string {
  switch(turno) {
    case 'matutino': return '☀️';
    case 'vespertino': return '🌇';
    case 'nocturno': return '🌙';
    default: return '⏰';
  }
}

// 7. Obtener clases CSS para el turno
export function obtenerColorTurno(turno: Turno): string {
  switch(turno) {
    case 'matutino': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'vespertino': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'nocturno': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

// 8. Función completa que devuelve toda la info del turno
export function obtenerInfoTurnoActual() {
  const turno = obtenerTurnoActual();
  return {
    turno,
    turnoLabel: obtenerLabelTurno(turno),
    horasTurno: obtenerHoraTurno(turno),
    horaActual: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    minutosRestantes: minutosRestantesTurno(turno),
    fechaActual: new Date().toLocaleDateString('es-ES'),
    esTurnoActivo: esTurnoActivo(turno)
  };
}