'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';

import type { BarraProduct } from '@/lib/utils/types/product.types';
import { ProductService } from '@/lib/services/product.service';

import ModalDialog from '@/components/ui/Modal';

import {
  Database,
  Calculator,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PackageCheck,
  RefreshCw,
  BarChart,
  X,
  Info,
  Plus,
} from 'lucide-react';

/* ================= helpers ================= */
const safeInt = (n: any, f = 0) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return f;
  const i = Math.floor(v);
  return i < 0 ? f : i;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

interface ActualizarCuartosBarraModalProps {
  isOpen: boolean;
  onClose: () => void;
  barra: BarraProduct | null;
  usuarioNombre: string;
  onSuccess: () => void;
}

export default function ActualizarCuartosBarraModal({
  isOpen,
  onClose,
  barra,
  usuarioNombre,
  onSuccess,
}: ActualizarCuartosBarraModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'ajuste' | 'conversion' | 'produccion'>('ajuste');

  // ===== lock body + ESC (por si tu ModalDialog no lo hace) =====
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isProcessing) onClose();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, isProcessing, onClose]);

  const cuartosTotales = useMemo(() => {
    if (!barra) return 0;
    return safeInt((barra as any).cuartosTotales, 0);
  }, [barra]);

  const barraCantidad = useMemo(() => {
    if (!barra) return 0;
    return safeInt((barra as any).cantidad, 0);
  }, [barra]);

  const barraDisp = useMemo(() => {
    if (!barra) return 0;
    return safeInt((barra as any).cuartosDisponibles, 0);
  }, [barra]);

  // 👇 lo seguimos usando internamente, pero YA NO se muestra en UI
  const barraUsados = useMemo(() => {
    if (!barra) return 0;
    return safeInt((barra as any).cuartosUsados, 0);
  }, [barra]);

  // Solo dejamos editable "disponibles". "usados" se conserva (hidden).
  const [formData, setFormData] = useState({
    cuartosDisponibles: 0,
    motivo: 'Ajuste manual de inventario',
  });

  // reset al abrir / cambiar barra
  useEffect(() => {
    if (!isOpen) return;

    setError(null);
    setOkMsg(null);
    setActiveTab('ajuste');

    if (!barra) {
      setFormData({ cuartosDisponibles: 0, motivo: 'Ajuste manual de inventario' });
      return;
    }

    setFormData({
      cuartosDisponibles: barraDisp,
      motivo: 'Ajuste manual de inventario',
    });
  }, [isOpen, barra?.codigo, barraDisp, barra]);

  const porcentajeDisponible = useMemo(() => {
    if (!barra) return 0;
    return cuartosTotales > 0 ? Math.round((barraDisp / cuartosTotales) * 100) : 0;
  }, [barra, barraDisp, cuartosTotales]);

  const nuevoPorcentajeDisponible = useMemo(() => {
    return cuartosTotales > 0
      ? Math.round((safeInt(formData.cuartosDisponibles, 0) / cuartosTotales) * 100)
      : 0;
  }, [formData.cuartosDisponibles, cuartosTotales]);

  const maxCuartosDisponibles = useMemo(() => {
    // disponibles no puede exceder (totales - usados actuales)
    return Math.max(0, cuartosTotales - barraUsados);
  }, [cuartosTotales, barraUsados]);

  // clamp si se pasan
  useEffect(() => {
    if (!isOpen) return;
    if (safeInt(formData.cuartosDisponibles, 0) > maxCuartosDisponibles) {
      setFormData((prev) => ({ ...prev, cuartosDisponibles: maxCuartosDisponibles }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, maxCuartosDisponibles]);

  const handleClose = useCallback(() => {
    if (isProcessing) return;
    onClose();
  }, [isProcessing, onClose]);

  const canSubmit = !!barra && !isProcessing;

  /* ================= TAB: AJUSTE MANUAL (solo disponibles) ================= */
  const handleSubmitAjuste = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsProcessing(true);
    setError(null);
    setOkMsg(null);

    try {
      if (!barra) throw new Error('No hay barra seleccionada.');

      const disp = safeInt(formData.cuartosDisponibles, 0);

      if (disp < 0) throw new Error('Los cuartos no pueden ser negativos.');
      if (disp > maxCuartosDisponibles) {
        throw new Error(`No puedes exceder disponibles máx (${maxCuartosDisponibles}) porque ya hay usados registrados.`);
      }

      // 🔒 Conservamos usados (hidden) para que no rompa tu lógica interna
      await ProductService.actualizarCuartosBarra({
        codigo: String((barra as any).codigo),
        cuartosTotales,
        cuartosDisponibles: disp,
        cuartosUsados: barraUsados,
      });

      setOkMsg('✅ Disponibles actualizados correctamente.');
      onSuccess();
      handleClose();
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  /* ================= TAB: CONVERSION (SET) ================= */
  const [barrasFisicas, setBarrasFisicas] = useState<number>(0);

  useEffect(() => {
    if (!isOpen) return;
    if (!barra) return;

    const sugeridasPorCuartos = cuartosTotales > 0 ? Math.ceil(cuartosTotales / 4) : 0;
    const sugeridas = barraCantidad > 0 ? barraCantidad : sugeridasPorCuartos;

    setBarrasFisicas(safeInt(sugeridas, 0));
  }, [isOpen, barra?.codigo, cuartosTotales, barraCantidad, barra]);

  const handleSubmitConversion = async () => {
    setIsProcessing(true);
    setError(null);
    setOkMsg(null);

    try {
      if (!barra) throw new Error('No hay barra seleccionada.');

      const n = safeInt(barrasFisicas, 0);

      await ProductService.actualizarCuartosDesdeBarras({
        codigo: String((barra as any).codigo),
        barrasFisicas: n,
      });

      setOkMsg(`✅ Sincronizado (SET) a ${n} barras (${n * 4} cuartos totales).`);
      onSuccess();
      handleClose();
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  /* ================= TAB: PRODUCCIÓN (SUMA) ================= */
  const [barrasProducidas, setBarrasProducidas] = useState<number | ''>('');

  useEffect(() => {
    if (!isOpen) return;
    setBarrasProducidas('');
  }, [isOpen, barra?.codigo]);

  const handleSubmitProduccion = async () => {
    setIsProcessing(true);
    setError(null);
    setOkMsg(null);

    try {
      if (!barra) throw new Error('No hay barra seleccionada.');

      const n = barrasProducidas === '' ? 0 : safeInt(barrasProducidas, 0);
      if (!Number.isFinite(n) || n <= 0) throw new Error('Ingresa cuántas barras produjiste (>= 1).');

      await ProductService.agregarProduccionBarra({
        codigo: String((barra as any).codigo),
        barrasProducidas: n,
        usuario: usuarioNombre,
        observaciones: 'Producción registrada desde modal de inventario',
      });

      setOkMsg(`✅ Producción (SUMA): +${n} barras = +${n * 4} cuartos.`);
      onSuccess();
      handleClose();
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalDialog isOpen={isOpen} onClose={handleClose} title="🧊 Inventario — Barra (cuartos)" size="lg">
      {/* Scroll garantizado aunque tu ModalDialog no lo tenga */}
      <div className="max-h-[85vh] overflow-y-auto overscroll-contain p-0">
        <div className="rounded-2xl bg-gray-800 p-6">
          {!barra ? (
            <div className="rounded-2xl border border-gray-700 bg-gray-900/50 p-5">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-gray-300 mt-0.5" />
                <div>
                  <div className="text-white font-semibold">No hay barra seleccionada</div>
                  <div className="text-sm text-gray-400 mt-1">
                    Cierra este modal y selecciona una barra en el inventario para poder ajustarla.
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex items-center gap-2 rounded-xl bg-gray-700 px-5 py-3 text-gray-200 hover:bg-gray-600 transition"
                >
                  <X className="h-4 w-4" />
                  Cerrar
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Header card (sin “usados”) */}
              <div className="mb-6 rounded-xl border border-orange-700 bg-gradient-to-r from-orange-900 to-orange-800 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center">
                    <Database className="mr-3 h-6 w-6 text-orange-300" />
                    <div>
                      <h3 className="font-bold text-white">{String((barra as any).nombre ?? 'Barra')}</h3>
                      <p className="mt-1 text-sm text-orange-300">
                        Código: <span className="font-mono">{String((barra as any).codigo ?? '')}</span>
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-3xl font-bold text-orange-300">{barraCantidad}</div>
                    <div className="text-xs text-orange-200">barras completas</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-orange-950/50 p-3 text-center">
                    <div className="text-xl font-bold text-white">{cuartosTotales}</div>
                    <div className="text-xs text-orange-300">cuartos totales</div>
                  </div>
                  <div className="rounded-lg bg-orange-950/50 p-3 text-center">
                    <div className="text-xl font-bold text-green-400">{barraDisp}</div>
                    <div className="text-xs text-orange-300">disponibles</div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-orange-300">Disponibilidad actual</span>
                    <span className="font-bold text-white">{porcentajeDisponible}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-orange-950">
                    <div
                      className="h-full bg-gradient-to-r from-green-500 to-green-400"
                      style={{ width: `${porcentajeDisponible}%` }}
                    />
                  </div>

                  {/* Nota interna para evitar confusión (sin mostrar usados como métrica) */}
                  {barraUsados > 0 && (
                    <div className="text-[11px] text-orange-200/80">
                      Nota: ya hay consumos registrados, por eso el máximo de disponibles es{' '}
                      <b className="text-white">{maxCuartosDisponibles}</b>.
                    </div>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="mb-6 flex border-b border-gray-700">
                <button
                  type="button"
                  onClick={() => setActiveTab('ajuste')}
                  disabled={isProcessing}
                  className={cx(
                    'flex-1 px-4 py-3 text-center font-medium transition disabled:opacity-50',
                    activeTab === 'ajuste'
                      ? 'border-b-2 border-orange-500 text-orange-400'
                      : 'text-gray-400 hover:text-gray-300'
                  )}
                >
                  <Calculator className="inline h-4 w-4 mr-2" />
                  Ajuste
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('conversion')}
                  disabled={isProcessing}
                  className={cx(
                    'flex-1 px-4 py-3 text-center font-medium transition disabled:opacity-50',
                    activeTab === 'conversion'
                      ? 'border-b-2 border-blue-500 text-blue-400'
                      : 'text-gray-400 hover:text-gray-300'
                  )}
                >
                  <RefreshCw className="inline h-4 w-4 mr-2" />
                  Sync físico (SET)
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('produccion')}
                  disabled={isProcessing}
                  className={cx(
                    'flex-1 px-4 py-3 text-center font-medium transition disabled:opacity-50',
                    activeTab === 'produccion'
                      ? 'border-b-2 border-emerald-500 text-emerald-400'
                      : 'text-gray-400 hover:text-gray-300'
                  )}
                >
                  <Plus className="inline h-4 w-4 mr-2" />
                  Producción (SUMA)
                </button>
              </div>

              {/* Alerts */}
              {error && (
                <div className="mb-4 rounded-xl border border-red-700 bg-red-900/50 p-3 text-red-300">
                  <AlertTriangle className="inline h-4 w-4 mr-2" />
                  {error}
                </div>
              )}

              {okMsg && (
                <div className="mb-4 rounded-xl border border-emerald-700 bg-emerald-900/40 p-3 text-emerald-200">
                  <CheckCircle2 className="inline h-4 w-4 mr-2" />
                  {okMsg}
                </div>
              )}

              {/* ====== TAB CONTENT ====== */}
              {activeTab === 'ajuste' ? (
                <form onSubmit={handleSubmitAjuste}>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-300">
                        Cuartos Disponibles *{' '}
                        <span className="ml-2 text-xs text-gray-400">(Máx: {maxCuartosDisponibles})</span>
                      </label>
                      <input
                        type="number"
                        value={formData.cuartosDisponibles}
                        onChange={(e) => {
                          const value = safeInt(e.target.value, 0);
                          setFormData((prev) => ({
                            ...prev,
                            cuartosDisponibles: Math.min(Math.max(0, value), maxCuartosDisponibles),
                          }));
                        }}
                        min={0}
                        max={maxCuartosDisponibles}
                        required
                        disabled={!canSubmit}
                        className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-300">Motivo *</label>
                      <input
                        type="text"
                        value={formData.motivo}
                        onChange={(e) => setFormData((prev) => ({ ...prev, motivo: e.target.value }))}
                        required
                        disabled={!canSubmit}
                        className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50"
                      />
                    </div>

                    <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4">
                      <div className="mb-3 flex items-center">
                        <BarChart className="mr-2 h-4 w-4 text-gray-400" />
                        <span className="text-sm text-gray-300">Comparación</span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-lg bg-gray-800 p-3 text-center">
                          <div className="text-lg font-bold text-gray-300">ANTES</div>
                          <div className="mt-2 text-2xl font-bold text-white">{barraDisp}</div>
                          <div className="text-xs text-gray-400">disponibles</div>
                          <div className="mt-2 text-xs text-gray-500">{porcentajeDisponible}%</div>
                        </div>

                        <div className="rounded-lg border border-orange-700 bg-orange-900/30 p-3 text-center">
                          <div className="text-lg font-bold text-orange-300">DESPUÉS</div>
                          <div className="mt-2 text-2xl font-bold text-orange-400">
                            {safeInt(formData.cuartosDisponibles, 0)}
                          </div>
                          <div className="text-xs text-orange-300">disponibles</div>
                          <div className="mt-2 text-xs text-orange-400">{nuevoPorcentajeDisponible}%</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 flex justify-end gap-3 border-t border-gray-700 pt-6">
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={isProcessing}
                      className="rounded-xl bg-gray-700 px-6 py-3 font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-50 transition"
                    >
                      Cancelar
                    </button>

                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="flex items-center rounded-xl bg-gradient-to-r from-orange-600 to-orange-700 px-6 py-3 font-medium text-white shadow-lg hover:from-orange-700 hover:to-orange-800 disabled:opacity-50 transition"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Procesando...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="mr-2 h-5 w-5" />
                          Guardar
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : activeTab === 'conversion' ? (
                <div className="space-y-6">
                  <div className="rounded-xl border border-blue-700/30 bg-gradient-to-r from-blue-900/30 to-blue-800/20 p-5">
                    <div className="flex items-start">
                      <PackageCheck className="mr-3 mt-0.5 h-5 w-5 text-blue-400" />
                      <div>
                        <h4 className="mb-2 text-sm font-medium text-blue-300">Conteo físico → sistema (SET)</h4>
                        <ul className="space-y-1 text-xs text-blue-400/80">
                          <li>• Esto corrige inventario por conteo físico</li>
                          <li>• 1 barra = 4 cuartos</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-5">
                    <div className="mb-4 text-center">
                      <div className="text-4xl font-bold text-white">{barraCantidad}</div>
                      <div className="text-gray-400">barras actuales en sistema</div>
                    </div>

                    <div className="mt-5">
                      <label className="mb-2 block text-sm font-medium text-gray-300">Barras físicas (conteo)</label>
                      <input
                        type="number"
                        value={barrasFisicas}
                        onChange={(e) => setBarrasFisicas(Math.max(0, safeInt(e.target.value, 0)))}
                        min={0}
                        disabled={!canSubmit}
                        className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <div className="mt-2 text-xs text-gray-400">
                        Resultado: <span className="font-semibold text-white">{safeInt(barrasFisicas, 0) * 4}</span> cuartos
                        totales
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 border-t border-gray-700 pt-6">
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={isProcessing}
                      className="rounded-xl bg-gray-700 px-6 py-3 font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-50 transition"
                    >
                      Cancelar
                    </button>

                    <button
                      type="button"
                      onClick={handleSubmitConversion}
                      disabled={!canSubmit}
                      className="flex items-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-3 font-bold text-white shadow-lg hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 transition"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                          Procesando...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-3 h-6 w-6" />
                          Sincronizar (SET)
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="rounded-xl border border-emerald-700/30 bg-emerald-900/15 p-5">
                    <div className="flex items-start">
                      <Plus className="mr-3 mt-0.5 h-5 w-5 text-emerald-400" />
                      <div>
                        <h4 className="mb-2 text-sm font-medium text-emerald-300">Producción real (SUMA)</h4>
                        <ul className="space-y-1 text-xs text-emerald-200/80">
                          <li>• Cuando “hiciste más barras”</li>
                          <li>• Suma: cantidad += N</li>
                          <li>• Suma: cuartos += N×4</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-5">
                    <label className="mb-2 block text-sm font-medium text-gray-300">Barras producidas *</label>
                    <input
                      type="number"
                      min={1}
                      value={barrasProducidas}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '') return setBarrasProducidas('');
                        const n = safeInt(raw, 0);
                        if (!Number.isFinite(n) || n <= 0) return setBarrasProducidas('');
                        setBarrasProducidas(n);
                      }}
                      disabled={!canSubmit}
                      className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                      placeholder="Ej: 8"
                    />

                    <div className="mt-2 text-xs text-gray-400">
                      Cuartos que se agregarán:{' '}
                      <span className="font-semibold text-white">
                        {(barrasProducidas === '' ? 0 : safeInt(barrasProducidas, 0)) * 4}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 border-t border-gray-700 pt-6">
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={isProcessing}
                      className="rounded-xl bg-gray-700 px-6 py-3 font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-50 transition"
                    >
                      Cancelar
                    </button>

                    <button
                      type="button"
                      onClick={handleSubmitProduccion}
                      disabled={!canSubmit || barrasProducidas === ''}
                      className="flex items-center rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-3 font-bold text-white shadow-lg hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-50 transition"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                          Procesando...
                        </>
                      ) : (
                        <>
                          <Plus className="mr-3 h-6 w-6" />
                          Registrar (SUMA)
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ModalDialog>
  );
}
