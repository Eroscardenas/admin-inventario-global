'use client';

// components/charts/StockChart.tsx  ✅ PRODUCTION (alineado a TU MODELO REAL)
// - Barras: usa cuartosDisponibles
// - Bolsas vacías (BVxxx): usa bv.cantidad
// - Bolsas llenas: usa stockLlenoPorProducto.tipos[].stockActual (cámara fría real)
// - Timeframe REAL: usa useStock(timeframe) (sin reload de página)
// - Filtros funcionales: Todos | Barras | BV | Llenas | Críticos/Bajos
// - Evita divisiones por 0 y bugs de estados
// - ✅ SIN Card components (para evitar imports rotos)

import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

import { useProducts } from '@/lib/hooks/useProducts';
import { useStock } from '@/lib/hooks/useStock';

import type { IceType } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO } from '@/lib/utils/types/product.types';

type Timeframe = 'realtime' | 'daily' | 'hourly' | 'manual';

type StockEstado = 'NORMAL' | 'BAJO' | 'CRITICO' | 'EXCESO';

type ChartRow = {
  id: string;
  name: string; // label corto
  nombreCompleto: string;

  // valores
  stockActual: number;
  stockMinimo: number;
  stockMaximo: number;

  // meta
  estado: StockEstado;
  tipoVista: 'BARRA' | 'BOLSA_VACIA' | 'BOLSA_LLENA';
  tipoHielo?: IceType;
  pesoKg?: number;
  productoCodigo?: string;

  porcentaje: number; // contra max (si existe)
};

interface StockChartProps {
  showAlert?: boolean;
  timeframe?: Timeframe;
  limit?: number; // cuántos items mostrar (top más críticos primero)
}

const clampNum = (n: any) => {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x : 0;
};

function computeEstado(actual: number, min: number, max: number): StockEstado {
  const a = clampNum(actual);
  const mn = clampNum(min);
  const mx = clampNum(max);

  if (mx > 0 && a > mx) return 'EXCESO';
  if (mn > 0 && a < mn) return 'CRITICO';
  if (mn > 0 && a >= mn && a <= Math.ceil(mn * 1.2)) return 'BAJO';

  if (mn === 0 && mx > 0) {
    const p = (a / mx) * 100;
    if (p < 10) return 'CRITICO';
    if (p < 20) return 'BAJO';
  }

  return 'NORMAL';
}

function pct(actual: number, max: number) {
  const a = clampNum(actual);
  const mx = clampNum(max);
  if (mx <= 0) return 0;
  const p = (a / mx) * 100;
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(999, Math.round(p)));
}

function estadoColor(estado: StockEstado, tipoVista: ChartRow['tipoVista']) {
  if (estado === 'CRITICO') return '#ef4444';
  if (estado === 'BAJO') return '#f59e0b';
  if (estado === 'EXCESO') return '#8b5cf6';

  if (tipoVista === 'BARRA') return '#3b82f6';
  if (tipoVista === 'BOLSA_LLENA') return '#10b981';
  return '#64748b';
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d: ChartRow = payload[0].payload;

  return (
    <div className="bg-white p-4 border border-zinc-200 rounded-xl shadow-lg min-w-[260px]">
      <p className="font-bold text-zinc-900">{d.nombreCompleto}</p>

      <div className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-600">Actual</span>
          <span className="font-semibold">{d.stockActual}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-600">Mínimo</span>
          <span className="font-semibold">{d.stockMinimo}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-600">Máximo</span>
          <span className="font-semibold">{d.stockMaximo}</span>
        </div>

        <div className="flex justify-between pt-2 border-t border-zinc-200">
          <span className="text-zinc-600">% vs máx</span>
          <span className="font-semibold">{d.porcentaje}%</span>
        </div>

        <div className="flex justify-between">
          <span className="text-zinc-600">Estado</span>
          <span
            className={[
              'font-semibold',
              d.estado === 'CRITICO'
                ? 'text-rose-600'
                : d.estado === 'BAJO'
                ? 'text-amber-600'
                : d.estado === 'EXCESO'
                ? 'text-violet-600'
                : 'text-emerald-600',
            ].join(' ')}
          >
            {d.estado}
          </span>
        </div>

        <div className="pt-2 border-t border-zinc-200 text-xs text-zinc-500 space-y-0.5">
          <div>Tipo: {d.tipoVista}</div>
          {d.tipoHielo ? <div>Hielo: {d.tipoHielo}</div> : null}
          {typeof d.pesoKg === 'number' ? <div>Peso: {d.pesoKg} kg</div> : null}
          {d.productoCodigo ? <div>Código: {d.productoCodigo}</div> : null}
        </div>
      </div>
    </div>
  );
};

export default function StockChart({
  showAlert = true,
  timeframe: timeframeProp = 'daily',
  limit = 28,
}: StockChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(timeframeProp);

  const [filtroTipo, setFiltroTipo] = useState<'TODOS' | 'BARRA' | 'BV' | 'LLENA' | 'ATENCION'>(
    'ATENCION'
  );

  const { barras, bolsasVacias, stockLlenoPorProducto, loading: productsLoading } = useProducts();
  const { resumen, loading: stockLoading, reload, ultimaVerificacion } = useStock(timeframe);

  // =========================================
  // Construimos dataset REAL de stock (tu modelo)
  // =========================================
  const allRows = useMemo<ChartRow[]>(() => {
    const rows: ChartRow[] = [];

    // 1) BARRAS (cuartos)
    (barras || []).forEach((b: any) => {
      const actual = clampNum(b.cuartosDisponibles);
      const min = clampNum(b.stockMinimo ?? 0);
      const max = clampNum(b.stockMaximo ?? 0);

      const estado = computeEstado(actual, min, max);
      rows.push({
        id: `BARRA__${b.codigo}`,
        name: String(b.nombre || '').length > 14 ? `${String(b.nombre).slice(0, 12)}…` : String(b.nombre || 'Barra'),
        nombreCompleto: `${b.nombre ?? 'Barra'} (cuartos)`,
        stockActual: actual,
        stockMinimo: min,
        stockMaximo: max,
        estado,
        tipoVista: 'BARRA',
        porcentaje: pct(actual, max),
        productoCodigo: b.codigo,
      });
    });

    // 2) BOLSAS VACÍAS (BV.cantidad)
    (bolsasVacias || []).forEach((bv: any) => {
      const actual = clampNum(bv.cantidad);
      const min = clampNum(bv.stockMinimo ?? 0);
      const max = clampNum(bv.stockMaximo ?? 0);

      const estado = computeEstado(actual, min, max);
      rows.push({
        id: `BV__${bv.codigo}`,
        name: String(bv.nombre || '').length > 14 ? `${String(bv.nombre).slice(0, 12)}…` : String(bv.nombre || 'Bolsa vacía'),
        nombreCompleto: `${bv.nombre ?? 'Bolsa'} (vacías)`,
        stockActual: actual,
        stockMinimo: min,
        stockMaximo: max,
        estado,
        tipoVista: 'BOLSA_VACIA',
        porcentaje: pct(actual, max),
        pesoKg: bv.pesoKg,
        productoCodigo: bv.codigo,
      });
    });

    // 3) BOLSAS LLENAS (stockLlenoPorProducto.tipos[].stockActual)
    (stockLlenoPorProducto || []).forEach((p: any) => {
      const baseName = p.productoNombre ?? 'Bolsa';
      const pesoKg = p.pesoKg;

      (TIPOS_HIELO as readonly IceType[]).forEach((t) => {
        const cfg = (p.tipos || []).find((x: any) => x.tipoHielo === t);
        if (!cfg) return;

        const actual = clampNum(cfg.stockActual);
        const min = clampNum(cfg.stockMinimo);
        const max = clampNum(cfg.stockMaximo);
        const estado = computeEstado(actual, min, max);

        rows.push({
          id: `LLENA__${p.bolsaVaciaCodigo ?? p.productoCodigo ?? 'BV'}__${t}`,
          name: `${String(baseName).length > 10 ? String(baseName).slice(0, 10) + '…' : String(baseName)} • ${t}`,
          nombreCompleto: `${baseName}${typeof pesoKg === 'number' ? ` ${pesoKg}kg` : ''} • ${t} (llenas)`,
          stockActual: actual,
          stockMinimo: min,
          stockMaximo: max,
          estado,
          tipoVista: 'BOLSA_LLENA',
          tipoHielo: t,
          pesoKg,
          porcentaje: pct(actual, max),
          productoCodigo: p.bolsaVaciaCodigo ?? p.productoCodigo, // referencia BV
        });
      });
    });

    return rows;
  }, [barras, bolsasVacias, stockLlenoPorProducto]);

  // =========================================
  // Filtrado + orden (prioridad)
  // =========================================
  const filteredRows = useMemo(() => {
    let r = [...allRows];

    if (filtroTipo === 'BARRA') r = r.filter((x) => x.tipoVista === 'BARRA');
    if (filtroTipo === 'BV') r = r.filter((x) => x.tipoVista === 'BOLSA_VACIA');
    if (filtroTipo === 'LLENA') r = r.filter((x) => x.tipoVista === 'BOLSA_LLENA');
    if (filtroTipo === 'ATENCION') r = r.filter((x) => x.estado === 'CRITICO' || x.estado === 'BAJO');

    const prio = (e: StockEstado) => (e === 'CRITICO' ? 1 : e === 'BAJO' ? 2 : e === 'EXCESO' ? 3 : 99);

    r.sort((a, b) => prio(a.estado) - prio(b.estado) || a.porcentaje - b.porcentaje);

    return r.slice(0, Math.max(8, limit));
  }, [allRows, filtroTipo, limit]);

  // =========================================
  // Stats
  // =========================================
  const stats = useMemo(() => {
    const crit = allRows.filter((x) => x.estado === 'CRITICO').length;
    const bajo = allRows.filter((x) => x.estado === 'BAJO').length;
    const exc = allRows.filter((x) => x.estado === 'EXCESO').length;
    const normal = allRows.filter((x) => x.estado === 'NORMAL').length;

    const avg =
      allRows.length > 0
        ? Math.round(allRows.reduce((s, x) => s + (x.stockMaximo > 0 ? x.porcentaje : 0), 0) / allRows.length)
        : 0;

    return { crit, bajo, exc, normal, avg, total: allRows.length };
  }, [allRows]);

  const loading = productsLoading || stockLoading;

  if (loading) {
    return (
      <div className="w-full rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="p-4 border-b border-zinc-100">
          <div className="font-semibold text-zinc-900">Cargando datos de stock...</div>
        </div>
        <div className="p-4">
          <div className="animate-pulse space-y-4">
            <div className="h-48 bg-zinc-200 rounded-xl" />
            <div className="h-4 bg-zinc-200 rounded w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  if (!allRows.length) {
    return (
      <div className="w-full rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="p-4 border-b border-zinc-100">
          <div className="font-semibold text-zinc-900">📊 Niveles de Stock</div>
        </div>
        <div className="p-4">
          <p className="text-zinc-500">No hay datos de stock para mostrar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="p-4 border-b border-zinc-100">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="font-semibold text-zinc-900">📊 Niveles de Stock</div>
            <p className="text-sm text-zinc-500 mt-1">
              {resumen ? (
                <>
                  {resumen.totalProductos} productos · {resumen.productosCriticos} críticos · {resumen.productosBajoStock} bajos
                </>
              ) : (
                <>
                  {stats.total} items · {stats.crit} críticos · {stats.bajo} bajos
                </>
              )}
              {ultimaVerificacion ? (
                <span className="ml-2 text-xs text-zinc-400">
                  (verificado: {ultimaVerificacion.toLocaleTimeString()})
                </span>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              className="text-sm border border-zinc-300 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-200"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            >
              <option value="realtime">Realtime</option>
              <option value="daily">Diario</option>
              <option value="hourly">Cada hora</option>
              <option value="manual">Manual</option>
            </select>

            <button
              onClick={() => reload()}
              className="text-sm border border-zinc-300 rounded-xl px-3 py-2 hover:bg-zinc-50"
              type="button"
            >
              ⟳ Actualizar
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Estadísticas rápidas */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200">
            <div className="text-xs text-zinc-700 font-medium">Items</div>
            <div className="text-2xl font-bold text-zinc-900">{stats.total}</div>
          </div>

          <div className={`p-4 rounded-xl border ${stats.crit ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'}`}>
            <div className={`text-xs font-medium ${stats.crit ? 'text-rose-700' : 'text-emerald-700'}`}>Críticos</div>
            <div className={`text-2xl font-bold ${stats.crit ? 'text-rose-800' : 'text-emerald-800'}`}>{stats.crit}</div>
          </div>

          <div className="bg-amber-50 p-4 rounded-xl border border-amber-100">
            <div className="text-xs text-amber-700 font-medium">Bajos</div>
            <div className="text-2xl font-bold text-amber-800">{stats.bajo}</div>
          </div>

          <div className="bg-violet-50 p-4 rounded-xl border border-violet-100">
            <div className="text-xs text-violet-700 font-medium">Exceso</div>
            <div className="text-2xl font-bold text-violet-800">{stats.exc}</div>
          </div>

          <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200">
            <div className="text-xs text-zinc-700 font-medium">% Promedio</div>
            <div className="text-2xl font-bold text-zinc-900">{stats.avg}%</div>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFiltroTipo('ATENCION')}
            className={[
              'px-3 py-1 text-sm rounded-full border',
              filtroTipo === 'ATENCION'
                ? 'bg-rose-100 border-rose-200 text-rose-800'
                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50',
            ].join(' ')}
            type="button"
          >
            Atención
          </button>

          <button
            onClick={() => setFiltroTipo('TODOS')}
            className={[
              'px-3 py-1 text-sm rounded-full border',
              filtroTipo === 'TODOS'
                ? 'bg-blue-100 border-blue-200 text-blue-800'
                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50',
            ].join(' ')}
            type="button"
          >
            Todos
          </button>

          <button
            onClick={() => setFiltroTipo('BARRA')}
            className={[
              'px-3 py-1 text-sm rounded-full border',
              filtroTipo === 'BARRA'
                ? 'bg-blue-100 border-blue-200 text-blue-800'
                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50',
            ].join(' ')}
            type="button"
          >
            Barras
          </button>

          <button
            onClick={() => setFiltroTipo('BV')}
            className={[
              'px-3 py-1 text-sm rounded-full border',
              filtroTipo === 'BV'
                ? 'bg-slate-100 border-slate-200 text-slate-800'
                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50',
            ].join(' ')}
            type="button"
          >
            Bolsas vacías
          </button>

          <button
            onClick={() => setFiltroTipo('LLENA')}
            className={[
              'px-3 py-1 text-sm rounded-full border',
              filtroTipo === 'LLENA'
                ? 'bg-emerald-100 border-emerald-200 text-emerald-800'
                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50',
            ].join(' ')}
            type="button"
          >
            Bolsas llenas
          </button>
        </div>

        {/* Gráfico */}
        <div className="w-full h-[380px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredRows} margin={{ top: 20, right: 24, left: 10, bottom: 90 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />

              <XAxis dataKey="name" angle={-45} textAnchor="end" height={90} tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip content={<CustomTooltip />} />
              <Legend />

              <Bar dataKey="stockActual" name="Stock Actual" radius={[6, 6, 0, 0]}>
                {filteredRows.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={estadoColor(entry.estado, entry.tipoVista)} />
                ))}
              </Bar>

              <Bar dataKey="stockMaximo" name="Stock Máximo" fill="#94a3b8" opacity={0.25} radius={[6, 6, 0, 0]} />
              <Bar dataKey="stockMinimo" name="Stock Mínimo" fill="#dc2626" opacity={0.18} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Lista de atención (opcional) */}
        {showAlert ? (
          <div className="mt-2">
            <h4 className="font-semibold text-zinc-800 mb-2">⚠️ Requieren atención</h4>

            {allRows.filter((x) => x.estado === 'CRITICO' || x.estado === 'BAJO').length === 0 ? (
              <div className="text-sm text-zinc-500">Todo se ve bien por ahora ✅</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {allRows
                  .filter((x) => x.estado === 'CRITICO' || x.estado === 'BAJO')
                  .sort((a, b) =>
                    a.estado === b.estado ? a.porcentaje - b.porcentaje : a.estado === 'CRITICO' ? -1 : 1
                  )
                  .slice(0, 12)
                  .map((p) => (
                    <div
                      key={p.id}
                      className={[
                        'rounded-xl p-3 border',
                        p.estado === 'CRITICO' ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200',
                      ].join(' ')}
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div>
                          <p className={p.estado === 'CRITICO' ? 'text-rose-900 font-medium' : 'text-amber-900 font-medium'}>
                            {p.nombreCompleto}
                          </p>
                          <p className={p.estado === 'CRITICO' ? 'text-rose-700 text-sm' : 'text-amber-700 text-sm'}>
                            Actual: {p.stockActual} · Min: {p.stockMinimo} · Max: {p.stockMaximo} · {p.porcentaje}%
                          </p>
                        </div>
                        <span
                          className={[
                            'text-xs px-2 py-1 rounded-full font-semibold',
                            p.estado === 'CRITICO' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800',
                          ].join(' ')}
                        >
                          {p.estado}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
