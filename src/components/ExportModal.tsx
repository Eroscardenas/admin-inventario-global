'use client';

// src/components/admin/ExportModal.tsx - ✅ PRODUCTION (Inventario Hielos)
// - Desacoplado: NO depende de useTransactions / SimpleTransaction
// - Admin-only: exporta historial/reportes
// - CSV / JSON / "PDF" (ventana para imprimir)

import React, { useMemo, useState } from 'react';
import { X, FileText, Download, Printer, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// ============================
// Tipo exportable (estándar)
// ============================
export type ExportFormat = 'csv' | 'pdf' | 'json';

export type ExportMovimiento = {
  fecha: Date;

  // tipado libre para que encaje con tus "movimientos tipados"
  tipo: string; // ENTRADA | SALIDA | TRANSFERENCIA | CONVERSION | MERMA | DEVOLUCION | AJUSTE | LLENADO | etc.

  // producto
  productoNombre?: string;
  productoCodigo?: string;
  tipoProducto?: string; // BOLSA_LLENA / BOLSA_VACIA / BARRA / INSUMO etc.
  pesoKg?: number | null; // para bolsas llenas (si aplica)
  tipoHielo?: string; // completa/media/cuarto o tu etiqueta
  ubicacion?: string; // M1/M2/M3 o bodega etc.

  // cantidad
  cantidad?: number; // puede ser positiva/negativa o siempre positiva + signo por tipo
  unidad?: string; // pzas/kg/cuarto/etc

  // trazabilidad
  registradoPorNombre?: string; // admin/empleado
  empleadoNombre?: string; // si aplica
  clienteNombre?: string; // si aplica
  destinatario?: string; // salida
  motivo?: string; // merma/devolucion/ajuste
  turno?: string; // si lo usas

  // extras opcionales
  stockAnterior?: number;
  stockNuevo?: number;

  // cualquier extra que quieras conservar en JSON
  meta?: Record<string, any>;
};

type ExportConfig = {
  includeHeaders: boolean;
  dateFormat: string;
  separator: string;
  includeDetails: boolean;
  filterByType: string; // "all" o un tipo real
};

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;

  // ✅ esto lo llenas desde tu page (historial/reportes)
  items: ExportMovimiento[];

  // UX
  title?: string;
  onExportComplete?: () => void;

  // Etiquetas bonitas por tipo
  tiposLabel?: Record<string, string>;
}

function escapeCSV(v: any): string {
  if (v === null || v === undefined) return '""';
  const s = String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

const DEFAULT_LABELS: Record<string, string> = {
  all: 'Todos',
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  TRANSFERENCIA: 'Transferencia',
  CONVERSION: 'Conversión',
  LLENADO: 'Llenado',
  MERMA: 'Merma',
  DEVOLUCION: 'Devolución',
  AJUSTE: 'Ajuste',
};

export default function ExportModal({
  isOpen,
  onClose,
  items,
  title = 'Exportar Historial',
  onExportComplete,
  tiposLabel,
}: ExportModalProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('csv');
  const [exporting, setExporting] = useState(false);

  const labels = useMemo(() => ({ ...DEFAULT_LABELS, ...(tiposLabel ?? {}) }), [tiposLabel]);

  const [config, setConfig] = useState<ExportConfig>({
    includeHeaders: true,
    dateFormat: 'dd/MM/yyyy HH:mm',
    separator: ',',
    includeDetails: false,
    filterByType: 'all',
  });

  if (!isOpen) return null;

  const tiposDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) set.add(it.tipo);
    return ['all', ...Array.from(set).sort()];
  }, [items]);

  const formatDate = (d: Date): string => {
    try {
      return format(d, config.dateFormat, { locale: es });
    } catch {
      return d.toLocaleString('es-MX');
    }
  };

  const formatTipo = (tipo: string) => labels[tipo] ?? tipo;

  const datosFiltrados = useMemo(() => {
    if (config.filterByType === 'all') return items;
    return items.filter((x) => x.tipo === config.filterByType);
  }, [items, config.filterByType]);

  const formatos = [
    {
      id: 'csv' as const,
      nombre: 'CSV (Excel)',
      descripcion: 'Excel / Google Sheets',
      icon: <FileSpreadsheet className="w-5 h-5" />,
      color: 'bg-green-900/30 text-green-400',
    },
    {
      id: 'pdf' as const,
      nombre: 'Imprimir',
      descripcion: 'Reporte para imprimir',
      icon: <Printer className="w-5 h-5" />,
      color: 'bg-red-900/30 text-red-400',
    },
    {
      id: 'json' as const,
      nombre: 'JSON',
      descripcion: 'Datos estructurados',
      icon: <FileText className="w-5 h-5" />,
      color: 'bg-amber-900/30 text-amber-400',
    },
  ];

  const exportarCSV = () => {
    try {
      setExporting(true);

      const colsBase = [
        'Fecha',
        'Tipo',
        'Producto',
        'Código',
        'Tipo Producto',
        'Peso Kg',
        'Tipo Hielo',
        'Ubicación',
        'Cantidad',
        'Unidad',
        'Registrado Por',
        'Empleado',
        'Cliente',
        'Destinatario',
        'Motivo',
        'Turno',
      ];

      const colsDet = ['Stock Anterior', 'Stock Nuevo'];

      const cols = config.includeDetails ? [...colsBase, ...colsDet] : colsBase;

      let csv = '';
      if (config.includeHeaders) csv += cols.join(config.separator) + '\n';

      for (const it of datosFiltrados) {
        const filaBase = [
          escapeCSV(formatDate(it.fecha)),
          escapeCSV(formatTipo(it.tipo)),
          escapeCSV(it.productoNombre ?? ''),
          escapeCSV(it.productoCodigo ?? ''),
          escapeCSV(it.tipoProducto ?? ''),
          escapeCSV(it.pesoKg ?? ''),
          escapeCSV(it.tipoHielo ?? ''),
          escapeCSV(it.ubicacion ?? ''),
          escapeCSV(it.cantidad ?? 0),
          escapeCSV(it.unidad ?? ''),
          escapeCSV(it.registradoPorNombre ?? ''),
          escapeCSV(it.empleadoNombre ?? ''),
          escapeCSV(it.clienteNombre ?? ''),
          escapeCSV(it.destinatario ?? ''),
          escapeCSV(it.motivo ?? ''),
          escapeCSV(it.turno ?? ''),
        ];

        const filaDet = config.includeDetails
          ? [escapeCSV(it.stockAnterior ?? ''), escapeCSV(it.stockNuevo ?? '')]
          : [];

        csv += [...filaBase, ...filaDet].join(config.separator) + '\n';
      }

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `historial_${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      onExportComplete?.();
    } catch (e) {
      console.error('❌ Error exportando CSV:', e);
      alert('Error al exportar CSV');
    } finally {
      setExporting(false);
      onClose();
    }
  };

  const exportarJSON = () => {
    try {
      setExporting(true);

      const out = datosFiltrados.map((it) => ({
        ...it,
        fecha: it.fecha.toISOString(),
        tipoDescripcion: formatTipo(it.tipo),
        fechaFormateada: formatDate(it.fecha),
        ...(config.includeDetails ? {} : { stockAnterior: undefined, stockNuevo: undefined }),
      }));

      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `historial_${format(new Date(), 'yyyy-MM-dd')}.json`;
      a.click();
      URL.revokeObjectURL(url);

      onExportComplete?.();
    } catch (e) {
      console.error('❌ Error exportando JSON:', e);
      alert('Error al exportar JSON');
    } finally {
      setExporting(false);
      onClose();
    }
  };

  const exportarPDF = () => {
    try {
      setExporting(true);

      const win = window.open('', '_blank');
      if (!win) {
        alert('Permite ventanas emergentes para imprimir');
        return;
      }

      const hoy = format(new Date(), 'dd/MM/yyyy');
      const titulo = `Reporte Historial - ${hoy}`;

      win.document.write(`
        <html>
          <head>
            <title>${titulo}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
              h1 { border-bottom: 2px solid #111; padding-bottom: 10px; }
              .meta { margin-top: 10px; color: #333; font-size: 12px; }
              table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
              th { background: #f2f2f2; padding: 8px; text-align: left; border: 1px solid #ddd; }
              td { padding: 8px; border: 1px solid #ddd; vertical-align: top; }
              .pos { color: #0a7; font-weight: 700; }
              .neg { color: #c00; font-weight: 700; }
              .footer { margin-top: 24px; font-size: 12px; color: #666; border-top: 1px solid #ccc; padding-top: 10px; }
              @media print { button { display: none; } body { margin: 0; } }
            </style>
          </head>
          <body>
            <h1>📊 ${titulo}</h1>
            <div class="meta">
              <div><strong>Total:</strong> ${datosFiltrados.length}</div>
              <div><strong>Filtro:</strong> ${config.filterByType === 'all' ? 'Todos' : (labels[config.filterByType] ?? config.filterByType)}</div>
              <div><strong>Detalles:</strong> ${config.includeDetails ? 'Sí' : 'No'}</div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Producto</th>
                  <th>Ubicación</th>
                  <th>Cantidad</th>
                  <th>Registró</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                ${datosFiltrados
                  .map((it) => {
                    const qty = it.cantidad ?? 0;
                    const cls = qty > 0 ? 'pos' : qty < 0 ? 'neg' : '';
                    const prod = [
                      it.productoNombre ?? '',
                      it.tipoProducto ? `(${it.tipoProducto})` : '',
                      it.pesoKg ? `- ${it.pesoKg}kg` : '',
                      it.tipoHielo ? `- ${it.tipoHielo}` : '',
                    ].filter(Boolean).join(' ');
                    return `
                      <tr>
                        <td>${formatDate(it.fecha)}</td>
                        <td>${formatTipo(it.tipo)}</td>
                        <td>${prod}</td>
                        <td>${it.ubicacion ?? ''}</td>
                        <td class="${cls}">${qty > 0 ? '+' : ''}${qty} ${it.unidad ?? ''}</td>
                        <td>${it.registradoPorNombre ?? ''}</td>
                        <td>${it.motivo ?? ''}</td>
                      </tr>
                    `;
                  })
                  .join('')}
              </tbody>
            </table>

            <div class="footer">
              <div>Generado el ${hoy}</div>
              <div>${datosFiltrados.length} movimientos</div>
            </div>

            <div style="margin-top: 20px;">
              <button onclick="window.print()" style="padding: 10px 16px; background: #2563eb; color: #fff; border: 0; border-radius: 8px; cursor: pointer;">
                🖨️ Imprimir
              </button>
              <button onclick="window.close()" style="padding: 10px 16px; background: #6b7280; color: #fff; border: 0; border-radius: 8px; margin-left: 8px; cursor: pointer;">
                Cerrar
              </button>
            </div>
          </body>
        </html>
      `);

      win.document.close();
      win.focus();

      onExportComplete?.();
    } catch (e) {
      console.error('❌ Error exportando impresión:', e);
      alert('Error al generar impresión');
    } finally {
      setExporting(false);
      onClose();
    }
  };

  const handleExport = () => {
    if (selectedFormat === 'csv') return exportarCSV();
    if (selectedFormat === 'json') return exportarJSON();
    return exportarPDF();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 rounded-xl p-6 max-w-lg w-full border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-900 rounded-lg">
              <Download className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{title}</h3>
              <p className="text-sm text-gray-400">{datosFiltrados.length} registros disponibles</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 hover:bg-gray-700 rounded"
            disabled={exporting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Formato */}
        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-300 mb-3">Formato</h4>
          <div className="grid grid-cols-3 gap-2">
            {formatos.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedFormat(f.id)}
                disabled={exporting}
                className={`p-3 rounded-lg border text-sm ${
                  selectedFormat === f.id ? 'border-blue-500 bg-blue-900/20' : 'border-gray-700 bg-gray-900/50 hover:border-gray-600'
                }`}
              >
                <div className="flex flex-col items-center gap-1">
                  <div className={`p-1 rounded ${f.color}`}>{f.icon}</div>
                  <span className="font-medium text-white">{f.nombre}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Config */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Filtrar por tipo</label>
            <select
              value={config.filterByType}
              onChange={(e) => setConfig((p) => ({ ...p, filterByType: e.target.value }))}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
              disabled={exporting}
            >
              {tiposDisponibles.map((t) => (
                <option key={t} value={t}>
                  {formatTipo(t)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.includeHeaders}
                onChange={(e) => setConfig((p) => ({ ...p, includeHeaders: e.target.checked }))}
                className="rounded border-gray-600 bg-gray-800 text-blue-500"
                disabled={exporting}
              />
              <span className="text-gray-300">Incluir encabezados</span>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.includeDetails}
                onChange={(e) => setConfig((p) => ({ ...p, includeDetails: e.target.checked }))}
                className="rounded border-gray-600 bg-gray-800 text-blue-500"
                disabled={exporting}
              />
              <span className="text-gray-300">Incluir detalles completos</span>
            </label>
          </div>
        </div>

        {/* Preview */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-300">Vista previa</h4>
            <span className="text-xs text-gray-500">{datosFiltrados.length} registros</span>
          </div>

          <div className="bg-gray-900 rounded-lg p-3 border border-gray-700 text-sm">
            {datosFiltrados.length === 0 ? (
              <div className="text-center text-gray-500 py-2">
                <AlertCircle className="w-5 h-5 mx-auto mb-1 opacity-50" />
                <p>No hay datos</p>
              </div>
            ) : (
              <div className="space-y-2">
                {datosFiltrados.slice(0, 3).map((it, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <div className="min-w-0">
                      <span className="text-gray-300 truncate block">{it.productoNombre ?? '—'}</span>
                      <div className="text-xs text-gray-500 truncate">
                        {formatTipo(it.tipo)} • {it.registradoPorNombre ?? '—'}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        (it.cantidad ?? 0) > 0
                          ? 'bg-green-900/30 text-green-400'
                          : (it.cantidad ?? 0) < 0
                          ? 'bg-red-900/30 text-red-400'
                          : 'bg-gray-800 text-gray-400'
                      }`}
                    >
                      {(it.cantidad ?? 0) > 0 ? '+' : ''}
                      {it.cantidad ?? 0} {it.unidad ?? ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
          <button
            onClick={onClose}
            disabled={exporting}
            className="px-4 py-2 text-sm bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
          >
            Cancelar
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || datosFiltrados.length === 0}
            className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2"
          >
            {exporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Exportando...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Exportar
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
