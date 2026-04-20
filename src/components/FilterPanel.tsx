'use client';

// src/components/admin/FilterPanel.tsx - ✅ PRODUCTION (Inventario Hielos)
// - Alineado a historial/movimientos del Admin
// - Sin tipos legacy (CREACION_USUARIO, ROLITO, etc.)
// - Filtros realmente útiles: búsqueda, tipos, fechas, máquina, tipo producto, tipo hielo, cantidad

import React from 'react';
import {
  Filter,
  X,
  Calendar,
  RefreshCw,
  Search,
  Package,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export type MovimientoTipo =
  | 'ENTRADA'
  | 'SALIDA'
  | 'TRANSFERENCIA'
  | 'CONVERSION'
  | 'LLENADO'
  | 'MERMA'
  | 'DEVOLUCION'
  | 'AJUSTE';

export type TurnoType = 'MATUTINO' | 'VESPERTINO' | 'NOCTURNO';

// Ajusta esto a tu app real si ya tienes enums:
// - BOLSA_VACIA, BOLSA_LLENA, BARRA
export type TipoProductoFiltro = 'BOLSA_VACIA' | 'BOLSA_LLENA' | 'BARRA';

// Tus máquinas/ubicaciones (lo que ya manejas M1/M2/M3)
export type UbicacionFiltro = 'M1' | 'M2' | 'M3' | 'BODEGA';

// Si quieres usar el IceType real tuyo, cámbialo a import:
// import type { IceType } from '@/lib/utils/types/product.types';
// y elimina esta unión.
export type IceType = string;

export type FilterState = {
  searchTerm: string;

  tipos: MovimientoTipo[];
  turnos: TurnoType[];
  iceTypes: IceType[];
  tiposProducto: TipoProductoFiltro[];
  ubicaciones: UbicacionFiltro[];

  dateRange: { start: Date | null; end: Date | null };

  minCantidad: number | null;
  maxCantidad: number | null;
};

interface FilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterState) => void;
  onClearFilters: () => void;
  initialFilters?: FilterState;

  // Opcional: permitir que el page inyecte catálogos reales
  availableIceTypes?: IceType[];
  availableUbicaciones?: UbicacionFiltro[];
}

const DEFAULT_FILTERS: FilterState = {
  searchTerm: '',
  tipos: [],
  turnos: [],
  iceTypes: [],
  tiposProducto: [],
  ubicaciones: [],
  dateRange: { start: null, end: null },
  minCantidad: null,
  maxCantidad: null,
};

const TIPOS: MovimientoTipo[] = [
  'ENTRADA',
  'SALIDA',
  'TRANSFERENCIA',
  'CONVERSION',
  'LLENADO',
  'MERMA',
  'DEVOLUCION',
  'AJUSTE',
];

const TURNOS: TurnoType[] = ['MATUTINO', 'VESPERTINO', 'NOCTURNO'];

const TIPOS_PRODUCTO: TipoProductoFiltro[] = ['BOLSA_VACIA', 'BOLSA_LLENA', 'BARRA'];

const UBICACIONES_DEFAULT: UbicacionFiltro[] = ['M1', 'M2', 'M3', 'BODEGA'];

const labelsTipo: Record<MovimientoTipo, string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  TRANSFERENCIA: 'Transferencia',
  CONVERSION: 'Conversión',
  LLENADO: 'Llenado',
  MERMA: 'Merma',
  DEVOLUCION: 'Devolución',
  AJUSTE: 'Ajuste',
};

const labelsTipoProducto: Record<TipoProductoFiltro, string> = {
  BOLSA_VACIA: 'Bolsa vacía',
  BOLSA_LLENA: 'Bolsa llena',
  BARRA: 'Barra',
};

export default function FilterPanel({
  isOpen,
  onClose,
  onApplyFilters,
  onClearFilters,
  initialFilters,
  availableIceTypes,
  availableUbicaciones,
}: FilterPanelProps) {
  const [filters, setFilters] = React.useState<FilterState>(DEFAULT_FILTERS);

  const [expanded, setExpanded] = React.useState({
    tipos: true,
    fechas: true,
    cantidad: false,
    ubicacion: true,
    producto: true,
    hielo: true,
    turno: false,
  });

  React.useEffect(() => {
    if (initialFilters) setFilters(initialFilters);
  }, [initialFilters]);

  if (!isOpen) return null;

  const iceTypes = (availableIceTypes ?? []).length ? (availableIceTypes ?? []) : [];
  const ubicaciones = (availableUbicaciones ?? []).length ? (availableUbicaciones ?? []) : UBICACIONES_DEFAULT;

  const toggle = (k: keyof typeof expanded) => setExpanded((p) => ({ ...p, [k]: !p[k] }));

  const toggleArr = <T,>(key: keyof FilterState, value: T) => {
    setFilters((p) => {
      const arr = (p[key] as unknown as T[]) ?? [];
      const exists = arr.includes(value);
      const next = exists ? arr.filter((x) => x !== value) : [...arr, value];
      return { ...p, [key]: next } as FilterState;
    });
  };

  const handleClear = () => {
    setFilters(DEFAULT_FILTERS);
    onClearFilters();
  };

  const handleApply = () => {
    onApplyFilters(filters);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 rounded-xl p-6 max-w-4xl w-full border border-gray-700 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-900 rounded-lg">
              <Filter className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white">Filtros</h3>
              <p className="text-gray-400 text-sm">Filtra el historial de movimientos</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2 hover:bg-gray-700 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">Búsqueda</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
            <input
              type="text"
              placeholder="Producto, empleado, motivo, cliente..."
              value={filters.searchTerm}
              onChange={(e) => setFilters((p) => ({ ...p, searchTerm: e.target.value }))}
              className="w-full pl-10 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left */}
          <div className="space-y-6">
            {/* Tipos */}
            <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <button onClick={() => toggle('tipos')} className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-blue-400" />
                  <h4 className="font-semibold text-white">Tipos de movimiento</h4>
                </div>
                {expanded.tipos ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {expanded.tipos && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {TIPOS.map((t) => (
                    <label
                      key={t}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                        filters.tipos.includes(t) ? 'bg-blue-900/30 border border-blue-700' : 'hover:bg-gray-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={filters.tipos.includes(t)}
                        onChange={() => toggleArr('tipos', t)}
                        className="rounded border-gray-600 bg-gray-800 text-blue-500"
                      />
                      <span className="text-sm text-gray-300">{labelsTipo[t]}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Fechas */}
            <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <button onClick={() => toggle('fechas')} className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-purple-400" />
                  <h4 className="font-semibold text-white">Rango de fechas</h4>
                </div>
                {expanded.fechas ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {expanded.fechas && (
                <div className="space-y-3 mt-3">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Desde</label>
                    <input
                      type="date"
                      value={filters.dateRange.start ? filters.dateRange.start.toISOString().split('T')[0] : ''}
                      onChange={(e) =>
                        setFilters((p) => ({
                          ...p,
                          dateRange: { ...p.dateRange, start: e.target.value ? new Date(e.target.value) : null },
                        }))
                      }
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Hasta</label>
                    <input
                      type="date"
                      value={filters.dateRange.end ? filters.dateRange.end.toISOString().split('T')[0] : ''}
                      onChange={(e) =>
                        setFilters((p) => ({
                          ...p,
                          dateRange: { ...p.dateRange, end: e.target.value ? new Date(e.target.value) : null },
                        }))
                      }
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Cantidad */}
            <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <button onClick={() => toggle('cantidad')} className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-amber-400" />
                  <h4 className="font-semibold text-white">Rango de cantidad</h4>
                </div>
                {expanded.cantidad ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {expanded.cantidad && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Mín</label>
                    <input
                      type="number"
                      min="0"
                      value={filters.minCantidad ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, minCantidad: e.target.value ? Number(e.target.value) : null }))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Máx</label>
                    <input
                      type="number"
                      min="0"
                      value={filters.maxCantidad ?? ''}
                      onChange={(e) => setFilters((p) => ({ ...p, maxCantidad: e.target.value ? Number(e.target.value) : null }))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right */}
          <div className="space-y-6">
            {/* Ubicación */}
            <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <button onClick={() => toggle('ubicacion')} className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-cyan-400" />
                  <h4 className="font-semibold text-white">Máquina / Ubicación</h4>
                </div>
                {expanded.ubicacion ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {expanded.ubicacion && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {ubicaciones.map((u) => (
                    <label
                      key={u}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                        filters.ubicaciones.includes(u) ? 'bg-cyan-900/30 border border-cyan-700' : 'hover:bg-gray-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={filters.ubicaciones.includes(u)}
                        onChange={() => toggleArr('ubicaciones', u)}
                        className="rounded border-gray-600 bg-gray-800 text-cyan-500"
                      />
                      <span className="text-sm text-gray-300">{u}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Tipo producto */}
            <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <button onClick={() => toggle('producto')} className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-green-400" />
                  <h4 className="font-semibold text-white">Tipo de producto</h4>
                </div>
                {expanded.producto ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {expanded.producto && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {TIPOS_PRODUCTO.map((tp) => (
                    <label
                      key={tp}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                        filters.tiposProducto.includes(tp) ? 'bg-green-900/30 border border-green-700' : 'hover:bg-gray-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={filters.tiposProducto.includes(tp)}
                        onChange={() => toggleArr('tiposProducto', tp)}
                        className="rounded border-gray-600 bg-gray-800 text-green-500"
                      />
                      <span className="text-sm text-gray-300">{labelsTipoProducto[tp]}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Tipo hielo */}
            <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <button onClick={() => toggle('hielo')} className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-blue-200" />
                  <h4 className="font-semibold text-white">Tipo de hielo</h4>
                </div>
                {expanded.hielo ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {expanded.hielo && (
                <div className="mt-3">
                  {iceTypes.length === 0 ? (
                    <p className="text-sm text-gray-400">
                      (Opcional) Pásame `availableIceTypes` desde tu page para mostrar opciones reales.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {iceTypes.map((it) => (
                        <label
                          key={it}
                          className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                            filters.iceTypes.includes(it) ? 'bg-blue-900/30 border border-blue-700' : 'hover:bg-gray-800'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={filters.iceTypes.includes(it)}
                            onChange={() => toggleArr('iceTypes', it)}
                            className="rounded border-gray-600 bg-gray-800 text-blue-500"
                          />
                          <span className="text-sm text-gray-300">{it}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Turno (opcional) */}
            <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <button onClick={() => toggle('turno')} className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-300" />
                  <h4 className="font-semibold text-white">Turno (opcional)</h4>
                </div>
                {expanded.turno ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {expanded.turno && (
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {TURNOS.map((t) => (
                    <label
                      key={t}
                      className={`flex flex-col items-center p-3 rounded cursor-pointer transition-colors ${
                        filters.turnos.includes(t) ? 'bg-amber-900/30 border border-amber-700' : 'hover:bg-gray-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={filters.turnos.includes(t)}
                        onChange={() => toggleArr('turnos', t)}
                        className="rounded border-gray-600 bg-gray-800 text-amber-500 mb-2"
                      />
                      <span className="text-sm text-gray-300 text-center">
                        {t.charAt(0) + t.slice(1).toLowerCase()}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-between mt-8 pt-6 border-t border-gray-700">
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
          >
            <RefreshCw className="w-4 h-4" />
            Limpiar
          </button>

          <div className="flex gap-3">
            <button onClick={onClose} className="px-6 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600">
              Cancelar
            </button>
            <button onClick={handleApply} className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500">
              <Filter className="w-4 h-4" />
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
