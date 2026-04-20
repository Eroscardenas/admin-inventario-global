'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SalidasService, type CrearSalidaDTO } from '@/lib/services/salidas.service';
import type { IceType } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO } from '@/lib/utils/types/product.types';

type Estado = 'idle' | 'loading' | 'saving' | 'error';

export function useSalidas() {
  const [estado, setEstado] = useState<Estado>('idle');
  const [error, setError] = useState('');

  const [productos, setProductos] = useState<any[]>([]);
  const [choferes, setChoferes] = useState<any[]>([]);

  const didLoad = useRef(false);

  const refresh = useCallback(async () => {
    setEstado('loading');
    setError('');
    try {
      const [prods, chofs] = await Promise.all([
        SalidasService.getProductosBolsaLlenas(),
        SalidasService.getChoferesActivos(),
      ]);

      setProductos(prods ?? []);
      setChoferes(chofs ?? []);
      setEstado('idle');
    } catch (e: any) {
      setEstado('error');
      setError(e?.message ?? 'Error cargando datos de salidas.');
    }
  }, []);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    refresh();
  }, [refresh]);

  // ✅ FIX: no intentes convertir readonly tuple a array mutable
  const tiposHielo = useMemo(() => TIPOS_HIELO as readonly IceType[], []);

  const crearSalida = useCallback(
    async (dto: CrearSalidaDTO) => {
      setEstado('saving');
      setError('');
      try {
        await SalidasService.crearSalida(dto);
        await refresh();
        setEstado('idle');
        return { ok: true as const };
      } catch (e: any) {
        setEstado('error');
        setError(e?.message ?? 'Error registrando salida.');
        return { ok: false as const };
      }
    },
    [refresh]
  );

  return {
    estado,
    error,
    refresh,

    productos,
    choferes,

    tiposHielo, // readonly IceType[]

    crearSalida,
  };
}
