// lib/utils/simpleCode.ts

export class SimpleCode {
  // Contadores por tipo
  private static counters: { [key: string]: number } = {
    USR: 1,  // Usuarios
    BV: 1,   // Bolsas Vacías
    BA: 1,   // Bolsas Asignadas
    BL: 1,   // Bolsas Llenas
    BR: 1,   // Barras
    MOV: 1,  // Movimientos
    MER: 1,  // Mermas
    DEV: 1,  // Devoluciones
    HST: 1,  // Histórico de stock (NUEVO)
  };

  // Generar: USR001, BV001, etc.
  static generar(prefijo: string): string {
    const contador = this.counters[prefijo] || 1;
    const numero = contador.toString().padStart(3, '0');

    // Incrementar para el próximo
    this.counters[prefijo] = contador + 1;

    return `${prefijo}${numero}`;
  }

  // Reiniciar contador (para nuevo día/mes)
  static reiniciar(prefijo: string): void {
    this.counters[prefijo] = 1;
  }
}

// Prefijos predefinidos
export const Prefijos = {
  USUARIO: 'USR',
  BOLSA_VACIA: 'BV',
  BOLSA_ASIGNADA: 'BA',
  BOLSA_LLENA: 'BL',
  BARRA: 'BR',
  MOVIMIENTO: 'MOV',
  MERMA: 'MER',
  DEVOLUCION: 'DEV',
  HISTORICO: 'HST', // NUEVO
} as const;
