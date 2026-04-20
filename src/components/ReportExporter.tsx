// src/components/reports/ReportPDFExporter.tsx - ✅ PRODUCTION
// - PDF real descargable (jsPDF + autotable)
// - Desacoplado de "Movement" legacy
// - Usa un tipo genérico que tú mapeas desde tus movimientos reales

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export type PDFExportRow = {
  fecha: Date;
  tipo: string;

  productoNombre?: string;
  tipoProducto?: string;
  pesoKg?: number | null;
  tipoHielo?: string;
  ubicacion?: string;

  cantidad?: number;
  unidad?: string;

  registradoPorNombre?: string;
  empleadoNombre?: string;
  clienteNombre?: string;
  destinatario?: string;
  motivo?: string;
  turno?: string;

  stockAnterior?: number;
  stockNuevo?: number;
};

export type ExportOptions = {
  fechaInicio?: Date | null;
  fechaFin?: Date | null;
  tiposSeleccionados?: string[];
  incluirResumen?: boolean; // default true
  titulo?: string; // default "HISTORIAL DE MOVIMIENTOS"
  subtitulo?: string; // default "Sistema de Gestión de Inventario - Fábrica de Hielo"
};

function safeDate(d: any): Date {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  // Firestore Timestamp compat (si llegara)
  if (typeof d.toDate === 'function') return d.toDate();
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

class ReportPDFExporter {
  static async exportHistorialMovimientos(
    rows: PDFExportRow[],
    filename: string,
    options: ExportOptions = {}
  ): Promise<void> {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      const titulo = options.titulo ?? 'HISTORIAL DE MOVIMIENTOS';
      const subtitulo = options.subtitulo ?? 'Sistema de Gestión de Inventario - Fábrica de Hielo';

      // Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text(titulo, 148, 14, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(subtitulo, 148, 20, { align: 'center' });

      doc.setFontSize(9);
      doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: es })}`, 10, 28);

      if (options.fechaInicio || options.fechaFin) {
        const periodo = `Período: ${
          options.fechaInicio ? format(options.fechaInicio, 'dd/MM/yyyy', { locale: es }) : 'Inicio'
        } - ${
          options.fechaFin ? format(options.fechaFin, 'dd/MM/yyyy', { locale: es }) : 'Fin'
        }`;
        doc.text(periodo, 10, 33);
      }

      // Resumen (opcional)
      let startY = 40;
      if (options.incluirResumen !== false) {
        const porTipo = rows.reduce((acc, r) => {
          acc[r.tipo] = (acc[r.tipo] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Resumen', 10, startY);
        startY += 6;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`Total movimientos: ${rows.length}`, 10, startY);
        startY += 5;

        doc.text('Distribución por tipo:', 10, startY);
        startY += 5;

        const entries = Object.entries(porTipo);
        for (const [tipo, count] of entries) {
          doc.text(`• ${tipo}: ${count}`, 12, startY);
          startY += 4;
          // evita que se coma la página antes de la tabla
          if (startY > 55) break;
        }

        startY += 2;
      }

      // Tabla
      const body = rows.map((r) => {
        const qty = r.cantidad ?? 0;
        const stock = r.stockAnterior !== undefined || r.stockNuevo !== undefined
          ? `${r.stockAnterior ?? ''} → ${r.stockNuevo ?? ''}`
          : '';

        const prod = [
          r.productoNombre ?? '',
          r.tipoProducto ? `(${r.tipoProducto})` : '',
          r.pesoKg ? `${r.pesoKg}kg` : '',
          r.tipoHielo ? `• ${r.tipoHielo}` : '',
        ].filter(Boolean).join(' ');

        return [
          format(safeDate(r.fecha), 'dd/MM/yyyy HH:mm', { locale: es }),
          r.tipo,
          prod,
          r.ubicacion ?? '',
          `${qty > 0 ? '+' : ''}${qty} ${r.unidad ?? ''}`.trim(),
          r.registradoPorNombre ?? r.empleadoNombre ?? '',
          r.motivo ?? r.destinatario ?? r.clienteNombre ?? '',
          stock,
        ];
      });

      autoTable(doc, {
        startY,
        head: [['Fecha', 'Tipo', 'Producto', 'Ubicación', 'Cantidad', 'Registró', 'Nota', 'Stock']],
        body,
        theme: 'grid',
        styles: { fontSize: 8 },
        headStyles: { fillColor: [31, 41, 55] }, // gris oscuro (tailwind slate-800 aprox)
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 26 },
          2: { cellWidth: 70 },
          3: { cellWidth: 22 },
          4: { cellWidth: 26 },
          5: { cellWidth: 30 },
          6: { cellWidth: 55 },
          7: { cellWidth: 28 },
        },
        margin: { left: 8, right: 8, top: 10, bottom: 10 },
      });

      // Footer páginas
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(
          `Página ${i} de ${pageCount} • Sistema de Gestión de Hielo`,
          148,
          doc.internal.pageSize.height - 6,
          { align: 'center' }
        );
      }

      doc.save(`${filename}.pdf`);
    } catch (error) {
      console.error('Error al exportar PDF:', error);
      throw error;
    }
  }
}

export default ReportPDFExporter;
