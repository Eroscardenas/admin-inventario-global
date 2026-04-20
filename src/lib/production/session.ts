'use client';

export type EmpleadoRole = 'ADMIN' | 'PRODUCCION' | 'TRANSPORTE' | 'CHOFER' | string;

export type ProductionEmpleado = {
  codigo: string;       // USR001
  nombre: string;
  role: EmpleadoRole;
  isActive: boolean;
  pin?: string;         // 4 dígitos (asignado por admin)
  createdAt?: unknown;
};

export type ProductionSessionData = {
  codigo: string;
  nombre: string;
  role: EmpleadoRole;
  isActive: boolean;
  loggedInAt: string;
  lastActivity: number;
};

export type ObtenerEmpleadosFn = () => Promise<unknown[]>;

const normalizeCodigo = (v: string) => String(v || '').trim().toUpperCase();
const esPinValido = (pin: string) => /^\d{4}$/.test(String(pin || ''));

function toEmpleado(u: unknown): ProductionEmpleado | null {
  const obj = u as Record<string, any>;
  const codigo = normalizeCodigo(obj?.codigo || obj?.id);
  const nombre = String(obj?.nombre || obj?.name || '').trim();
  if (!codigo || !nombre) return null;

  const status = String(obj?.status || obj?.estado || 'ACTIVO').toUpperCase();
  const isActive = obj?.isActive !== false && status !== 'INACTIVO';

  return {
    codigo,
    nombre,
    role: obj?.role,
    isActive,
    pin: obj?.pin, // ✅ el pin fijo debe venir aquí
    createdAt: obj?.createdAt,
  };
}

class ProductionSession {
  private static STORAGE_KEY = 'production_session';
  private static EMPLEADOS_KEY = 'production_empleados';
  private static LAST_SYNC_KEY = 'production_last_sync';

  private static obtenerEmpleadosFn: ObtenerEmpleadosFn | null = null;

  /** ✅ Inyecta tu función real (UserService/EmpleadoService) */
  static configure(getter: ObtenerEmpleadosFn) {
    this.obtenerEmpleadosFn = getter;
  }

  static async getEmpleados(forceSync = false): Promise<ProductionEmpleado[]> {
    try {
      if (forceSync) return await this.syncWithBackend();

      const lastSync = localStorage.getItem(this.LAST_SYNC_KEY);
      const needsSync = !lastSync || Date.now() - Number(lastSync) > 5 * 60 * 1000;

      if (needsSync) {
        try {
          return await this.syncWithBackend();
        } catch {
          // fallback a cache
        }
      }

      const stored = localStorage.getItem(this.EMPLEADOS_KEY);
      if (stored) return JSON.parse(stored) as ProductionEmpleado[];

      return await this.syncWithBackend();
    } catch {
      return [];
    }
  }

  static async login(codigoInput: string, pinInput: string) {
    try {
      const codigo = normalizeCodigo(codigoInput);
      const pin = String(pinInput || '').replace(/\D/g, '').slice(0, 4);

      if (!codigo) return { success: false, message: 'Selecciona tu nombre o ingresa tu código.' };
      if (!esPinValido(pin)) return { success: false, message: 'El PIN debe ser numérico de 4 dígitos.' };

      const empleados = await this.getEmpleados(true);
      const empleado = empleados.find((e) => normalizeCodigo(e.codigo) === codigo);

      if (!empleado) return { success: false, message: 'Empleado no encontrado.' };
      if (!empleado.isActive) return { success: false, message: 'Empleado inactivo. Contacta al administrador.' };

      const expectedPin = empleado.pin && esPinValido(empleado.pin) ? empleado.pin : codigo.slice(-4);

      if (pin !== expectedPin) return { success: false, message: 'PIN incorrecto.' };

      const sessionData: ProductionSessionData = {
        codigo: empleado.codigo,
        nombre: empleado.nombre,
        role: empleado.role,
        isActive: empleado.isActive,
        loggedInAt: new Date().toISOString(),
        lastActivity: Date.now(),
      };

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(sessionData));
      return { success: true, user: sessionData, empleado };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Error en autenticación' };
    }
  }

  static async syncWithBackend(): Promise<ProductionEmpleado[]> {
    if (!this.obtenerEmpleadosFn) {
      // Sin fetcher configurado, intentamos cache
      const stored = localStorage.getItem(this.EMPLEADOS_KEY);
      return stored ? (JSON.parse(stored) as ProductionEmpleado[]) : [];
    }

    const raw = await this.obtenerEmpleadosFn();

    const empleados: ProductionEmpleado[] = (raw || [])
      .map(toEmpleado)
      .filter((x): x is ProductionEmpleado => !!x)
      .filter((e) => e.isActive);

    empleados.sort((a: ProductionEmpleado, b: ProductionEmpleado) =>
      a.nombre.localeCompare(b.nombre, 'es')
    );

    localStorage.setItem(this.EMPLEADOS_KEY, JSON.stringify(empleados));
    localStorage.setItem(this.LAST_SYNC_KEY, Date.now().toString());

    return empleados;
  }

  static isLoggedIn(): boolean {
    try {
      const session = localStorage.getItem(this.STORAGE_KEY);
      if (!session) return false;

      const data = JSON.parse(session) as ProductionSessionData;

      const lastActivity = data.lastActivity || 0;
      const maxInactiveTime = 8 * 60 * 60 * 1000;

      if (Date.now() - lastActivity > maxInactiveTime) {
        this.logout();
        return false;
      }

      return !!data.codigo && data.isActive !== false;
    } catch {
      return false;
    }
  }

  static getCurrentUser(): ProductionSessionData | null {
    try {
      const session = localStorage.getItem(this.STORAGE_KEY);
      if (!session) return null;

      const data = JSON.parse(session) as ProductionSessionData;
      data.lastActivity = Date.now();
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      return data;
    } catch {
      return null;
    }
  }

  static logout() {
    localStorage.removeItem(this.STORAGE_KEY);
  }
}

export { ProductionSession };
