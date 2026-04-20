'use client';

import { useMemo, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  Legend,
  XAxis,
  YAxis,
  Area,
  ComposedChart,
  Bar,
} from 'recharts';

import { useMovementChart } from '@/lib/hooks/useMovementChart';
import type { TipoMovimiento } from '@/lib/utils/types/transaction.types';
import { getMovimientoMeta } from '@/lib/utils/types/transaction.types';

interface MovementChartProps {
  days?: 7 | 30 | 90 | number;
  movementTypes?: TipoMovimiento[];
  userId?: string;
  showComparison?: boolean;
}

function safeNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function rangeLabel(days: number) {
  if (days <= 7) return 'Última semana';
  if (days <= 30) return 'Último mes';
  return 'Último trimestre';
}

/**
 * Mapea el color semántico (meta.color) a un HEX estable
 * (No dependemos del theme ni de Tailwind dentro de Recharts)
 */
const COLOR_MAP: Record<string, string> = {
  green: '#16a34a',
  blue: '#2563eb',
  cyan: '#06b6d4',
  orange: '#f97316',
  yellow: '#eab308',
  red: '#ef4444',
  purple: '#a855f7',
  gray: '#6b7280',
  indigo: '#4f46e5',
  teal: '#14b8a6',
};

function getTipoColorHex(tipo: TipoMovimiento) {
  const meta = getMovimientoMeta(tipo);
  return COLOR_MAP[meta.color] ?? '#111827';
}

function getTipoLabel(tipo: TipoMovimiento) {
  return getMovimientoMeta(tipo).texto ?? tipo;
}

function isEntrada(tipo: TipoMovimiento) {
  return !!getMovimientoMeta(tipo).esEntrada;
}

/** UI simple tipo “card” sin depender de componentes externos */
function Panel({
  title,
  badge,
  children,
}: {
  title: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="p-4 border-b border-zinc-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-zinc-900">{title}</div>
          {badge ? <div>{badge}</div> : null}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function MovementChart({
  days: daysProp = 7,
  movementTypes,
  userId,
  showComparison = true,
}: MovementChartProps) {
  const [days, setDays] = useState<number>(daysProp);
  const [selectedMovement, setSelectedMovement] = useState<TipoMovimiento | 'TODOS'>('TODOS');

  const { chartData, loading, error, stats, refresh } = useMovementChart({
    days,
    movementTypes,
    userId,
    showComparison,
  } as any);

  /**
   * Tipos presentes en el rango actual (seguro)
   */
  const movementTypesPresent = useMemo<TipoMovimiento[]>(() => {
    if (!chartData?.length) return [];

    const base = movementTypes?.length
      ? movementTypes
      : (Object.keys(getAllTiposFromData(chartData)) as TipoMovimiento[]);

    return base.filter((t) => chartData.some((day: any) => safeNum(day?.[t], 0) > 0));
  }, [chartData, movementTypes]);

  /**
   * Data filtrada si seleccionas un tipo específico
   */
  const filteredData = useMemo(() => {
    if (!chartData?.length) return [];
    if (selectedMovement === 'TODOS') return chartData;

    return chartData.map((item: any) => ({
      ...item,
      [selectedMovement]: safeNum(item?.[selectedMovement], 0),
    }));
  }, [chartData, selectedMovement]);

  const bestDay = useMemo(() => {
    if (!chartData?.length) return null;
    return chartData.reduce(
      (max: any, day: any) => (safeNum(day.total) > safeNum(max.total) ? day : max),
      chartData[0]
    );
  }, [chartData]);

  const onChangeRange = useCallback((value: 'week' | 'month' | 'quarter') => {
    setSelectedMovement('TODOS');
    setDays(value === 'week' ? 7 : value === 'month' ? 30 : 90);
  }, []);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0]?.payload ?? {};

    return (
      <div className="bg-white p-4 border border-zinc-200 rounded-xl shadow-lg min-w-[280px]">
        <p className="font-semibold text-zinc-900">
          {data.fechaCompleta ?? data.fecha ?? '—'}
        </p>

        <div className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-600">Total</span>
            <span className="font-semibold">{safeNum(data.total)}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-zinc-600">Ingresos</span>
            <span className="font-semibold text-emerald-600">+{safeNum(data.ingresos)}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-zinc-600">Salidas</span>
            <span className="font-semibold text-rose-600">-{safeNum(data.salidas)}</span>
          </div>

          {movementTypesPresent.length ? (
            <div className="mt-2 pt-2 border-t border-zinc-200">
              <p className="text-xs font-medium text-zinc-700 mb-1">Detalle por tipo</p>
              <div className="space-y-1">
                {movementTypesPresent.map((t) => {
                  const val = safeNum(data?.[t], 0);
                  if (val <= 0) return null;
                  return (
                    <div key={t} className="flex justify-between text-xs text-zinc-700">
                      <span>{getTipoLabel(t)}</span>
                      <span className="font-semibold">{val}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const currentRange = days <= 7 ? 'week' : days <= 30 ? 'month' : 'quarter';

  if (loading) {
    return (
      <Panel title="Cargando movimientos...">
        <div className="h-[420px] animate-pulse bg-zinc-200 rounded-xl" />
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel title={<span className="text-rose-600">Error</span>}>
        <p className="text-rose-600 text-sm">{String(error)}</p>
        <button
          onClick={refresh}
          className="mt-3 px-4 py-2 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 text-sm"
        >
          Reintentar
        </button>
      </Panel>
    );
  }

  if (!chartData?.length) {
    return (
      <Panel title="📈 Movimientos del Sistema">
        <div className="h-[420px] flex items-center justify-center">
          <p className="text-zinc-500">No hay datos de movimientos para mostrar</p>
        </div>
      </Panel>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="p-4 border-b border-zinc-100">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="font-semibold text-zinc-900">📈 Movimientos del Sistema</div>
            {stats ? (
              <span className="text-xs bg-zinc-100 text-zinc-800 px-2 py-1 rounded-lg border border-zinc-200">
                Total: <b>{safeNum(stats.total)}</b> · {rangeLabel(days)}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              className="text-sm border border-zinc-300 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-200"
              value={selectedMovement}
              onChange={(e) => setSelectedMovement(e.target.value as any)}
            >
              <option value="TODOS">Todos</option>
              {movementTypesPresent.map((t) => (
                <option key={t} value={t}>
                  {getTipoLabel(t)}
                </option>
              ))}
            </select>

            <select
              className="text-sm border border-zinc-300 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-200"
              value={currentRange}
              onChange={(e) => onChangeRange(e.target.value as any)}
            >
              <option value="week">Última semana</option>
              <option value="month">Último mes</option>
              <option value="quarter">Último trimestre</option>
            </select>

            <button
              onClick={refresh}
              className="text-sm border border-zinc-300 rounded-xl px-3 py-2 hover:bg-zinc-50"
            >
              ⟳ Actualizar
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Stats rápidas */}
        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200">
              <div className="text-xs text-zinc-600 font-medium">Total</div>
              <div className="text-2xl font-bold text-zinc-900">{safeNum(stats.total)}</div>
            </div>

            <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
              <div className="text-xs text-emerald-700 font-medium">Ingresos</div>
              <div className="text-2xl font-bold text-emerald-700">+{safeNum(stats.ingresos)}</div>
            </div>

            <div className="bg-rose-50 p-4 rounded-xl border border-rose-100">
              <div className="text-xs text-rose-700 font-medium">Salidas</div>
              <div className="text-2xl font-bold text-rose-700">-{safeNum(stats.salidas)}</div>
            </div>

            <div className="bg-purple-50 p-4 rounded-xl border border-purple-100">
              <div className="text-xs text-purple-700 font-medium">Día con más actividad</div>
              <div className="text-sm font-bold text-purple-900 mt-1">
                {bestDay?.fechaCompleta ?? bestDay?.fecha ?? '—'}
              </div>
            </div>
          </div>
        ) : null}

        {/* Chart */}
        <div className="h-[440px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={filteredData} margin={{ top: 20, right: 24, left: 8, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="fecha"
                angle={-35}
                textAnchor="end"
                height={60}
                tick={{ fontSize: 12 }}
              />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} />

              {selectedMovement === 'TODOS' ? (
                <>
                  <Area
                    type="monotone"
                    dataKey="ingresos"
                    name="Ingresos"
                    fill="#22c55e"
                    stroke="#22c55e"
                    fillOpacity={0.20}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="salidas"
                    name="Salidas"
                    fill="#ef4444"
                    stroke="#ef4444"
                    fillOpacity={0.18}
                    strokeWidth={2}
                  />
                  <Bar
                    dataKey="total"
                    name="Total"
                    fill="#3b82f6"
                    radius={[6, 6, 0, 0]}
                    opacity={0.70}
                  />
                </>
              ) : (
                <Bar
                  dataKey={selectedMovement}
                  name={getTipoLabel(selectedMovement)}
                  fill={getTipoColorHex(selectedMovement)}
                  radius={[6, 6, 0, 0]}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Lista de tipos presentes (click para filtrar) */}
        {selectedMovement === 'TODOS' && movementTypesPresent.length ? (
          <div>
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-zinc-800">📋 Tipos registrados</h4>
              <p className="text-xs text-zinc-500">Toca uno para ver sólo ese tipo</p>
            </div>

            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {movementTypesPresent.map((t) => {
                const totalType = chartData.reduce(
                  (sum: number, day: any) => sum + safeNum(day?.[t], 0),
                  0
                );
                const color = getTipoColorHex(t);
                const entrada = isEntrada(t);

                return (
                  <button
                    key={t}
                    onClick={() => setSelectedMovement(t)}
                    className="text-left p-3 rounded-xl border border-zinc-200 hover:bg-zinc-50 transition"
                    style={{ borderLeftWidth: 4, borderLeftColor: color }}
                    title={t}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1 inline-block w-3 h-3 rounded"
                        style={{ backgroundColor: color }}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-800 truncate">{getTipoLabel(t)}</div>
                        <div className="text-xs text-zinc-500">
                          {totalType} · {entrada ? 'Entrada' : 'Salida'}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Info */}
        <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 text-sm text-zinc-700">
          <p className="font-medium mb-2">ℹ️ Cómo se calcula</p>
          <ul className="space-y-1 text-sm text-zinc-600">
            <li>
              • <b>Ingresos</b>: suma por día de movimientos donde{' '}
              <code>getMovimientoMeta(tipo).esEntrada</code> es <b>true</b>.
            </li>
            <li>
              • <b>Salidas</b>: suma por día de movimientos donde <code>esEntrada</code> es <b>false</b>.
            </li>
            <li>• <b>Total</b>: ingresos + salidas.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * Helper para inferir keys de tipo movimiento presentes en chartData
 * sin reventar TS si el hook trae más campos.
 */
function getAllTiposFromData(chartData: any[]) {
  const out: Record<string, true> = {};
  for (const row of chartData || []) {
    for (const k of Object.keys(row || {})) {
      // Heurística: sólo nos interesan keys tipo string que parezcan TipoMovimiento
      // (Se filtra después con movementTypesPresent)
      if (typeof k === 'string' && k.includes('_')) out[k] = true;
    }
  }
  return out;
}
