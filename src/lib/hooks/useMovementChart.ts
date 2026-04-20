// lib/hooks/useMovementChart.ts - VERSIÓN CORREGIDA
'use client';

import { useState, useEffect, useCallback } from 'react';
import { TransactionService } from '@/lib/services/transaction.service';
import { TipoMovimiento } from '@/lib/utils/types/transaction.types';
import { format, subDays, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale';

interface UseMovementChartProps {
  days?: number;
  movementTypes?: TipoMovimiento[];
  productType?: string;
  employeeCode?: string;
}

interface ChartDataPoint {
  fecha: string;            // "01/03"
  fechaCompleta: string;    // "1 Mar 2024"
  fechaISO: string;         // "2024-03-01"
  total: number;            // Total de movimientos
  ingresos: number;         // Movimientos de entrada
  salidas: number;          // Movimientos de salida
  [key: string]: any;       // Tipos de movimiento específicos
}

interface MovementStats {
  total: number;
  ingresos: number;
  salidas: number;
  promedioDiario: number;
  diaMaximo: ChartDataPoint | null;
  diaMinimo: ChartDataPoint | null;
  tendencia: 'ascendente' | 'descendente' | 'estable';
}

export function useMovementChart({
  days = 7,
  movementTypes,
  productType,
  employeeCode
}: UseMovementChartProps = {}) {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<MovementStats>({
    total: 0,
    ingresos: 0,
    salidas: 0,
    promedioDiario: 0,
    diaMaximo: null,
    diaMinimo: null,
    tendencia: 'estable'
  });

  // Definir qué tipos son ingresos y cuáles son salidas
  const TIPOS_INGRESOS: TipoMovimiento[] = [
    'CREACION_BARRA',
    'CREACION_BOLSA_VACIA',
    'DEVOLUCION_BOLSA',
    'DEVOLUCION_BARRA'
  ];

  const TIPOS_SALIDAS: TipoMovimiento[] = [
    'VENTA_BARRA',
    'VENTA_BOLSA',
    'MERMA_BARRA',
    'MERMA_BOLSA'
  ];

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log(`📊 Cargando datos para gráfico (${days} días)...`);
      
      // Calcular fechas
      const fechaHasta = endOfDay(new Date());
      const fechaDesde = startOfDay(subDays(new Date(), days - 1));
      
      // Obtener movimientos - MANEJANDO MÚLTIPLES TIPOS
      let allMovements: any[] = [];
      
      if (movementTypes && movementTypes.length > 0) {
        // Si hay tipos específicos, hacer una llamada por cada tipo
        const movementPromises = movementTypes.map(async (tipo) => {
          try {
            const movements = await TransactionService.obtenerMovimientos({
              fechaInicio: fechaDesde,
              fechaFin: fechaHasta,
              tipo: tipo, // ENVIAR TIPO INDIVIDUAL
              tipoProducto: productType as any,
              usuarioCodigo: employeeCode,
              limit: 1000
            });
            return movements;
          } catch (err) {
            console.warn(`Error obteniendo movimientos tipo ${tipo}:`, err);
            return [];
          }
        });
        
        const results = await Promise.all(movementPromises);
        allMovements = results.flat();
      } else {
        // Si no hay tipos específicos, obtener todos los movimientos
        allMovements = await TransactionService.obtenerMovimientos({
          fechaInicio: fechaDesde,
          fechaFin: fechaHasta,
          tipoProducto: productType as any,
          usuarioCodigo: employeeCode,
          limit: 1000
        });
      }
      
      console.log(`✅ ${allMovements.length} movimientos obtenidos para gráfico`);
      
      // Procesar datos para el gráfico
      const processedData = processDataForChart(allMovements, fechaDesde, fechaHasta);
      const calculatedStats = calculateStats(processedData);
      
      setChartData(processedData);
      setStats(calculatedStats);
      
    } catch (err: any) {
      console.error('❌ Error al cargar datos para gráfico:', err);
      setError(err.message || 'Error al cargar datos del gráfico');
    } finally {
      setLoading(false);
    }
  }, [days, movementTypes, productType, employeeCode]);

  const processDataForChart = useCallback((
    movements: any[], 
    fechaDesde: Date, 
    fechaHasta: Date
  ): ChartDataPoint[] => {
    // Crear array de días en el rango
    const daysInRange = eachDayOfInterval({ start: fechaDesde, end: fechaHasta });
    
    // Inicializar datos para cada día
    const initialData: Record<string, ChartDataPoint> = {};
    
    daysInRange.forEach(date => {
      const dateKey = format(date, 'yyyy-MM-dd');
      initialData[dateKey] = {
        fecha: format(date, 'dd/MM'),
        fechaCompleta: format(date, 'dd MMM yyyy', { locale: es }),
        fechaISO: dateKey,
        total: 0,
        ingresos: 0,
        salidas: 0
      };
      
      // Inicializar contadores por tipo de movimiento
      // Siempre inicializar todos los tipos posibles para consistencia
      const allTypes: TipoMovimiento[] = [
        'VENTA_BARRA', 'VENTA_BOLSA', 
        'CREACION_BARRA', 'CREACION_BOLSA_VACIA',
        'MERMA_BARRA', 'MERMA_BOLSA',
        'DEVOLUCION_BARRA', 'DEVOLUCION_BOLSA',
        'ASIGNACION_BOLSA', 'LLENADO_BOLSA',
        'USO_CUARTOS_BARRA', 'ACTUALIZACION_STOCK'
      ];
      
      allTypes.forEach(type => {
        initialData[dateKey][type] = 0;
      });
    });

    // Llenar con datos reales
    movements.forEach(movement => {
      const dateKey = format(movement.fecha, 'yyyy-MM-dd');
      
      if (initialData[dateKey]) {
        const cantidad = Math.abs(movement.cantidad || 1);
        
        // Contar movimiento
        initialData[dateKey].total += cantidad;
        
        // Clasificar como ingreso o salida
        if (TIPOS_INGRESOS.includes(movement.tipo)) {
          initialData[dateKey].ingresos += cantidad;
        } else if (TIPOS_SALIDAS.includes(movement.tipo)) {
          initialData[dateKey].salidas += cantidad;
        }
        
        // Contar por tipo específico
        if (initialData[dateKey][movement.tipo] !== undefined) {
          initialData[dateKey][movement.tipo] += cantidad;
        }
      }
    });

    // Convertir a array y ordenar por fecha
    return Object.values(initialData).sort((a, b) => 
      a.fechaISO.localeCompare(b.fechaISO)
    );
  }, []);

  const calculateStats = useCallback((data: ChartDataPoint[]): MovementStats => {
    if (data.length === 0) {
      return {
        total: 0,
        ingresos: 0,
        salidas: 0,
        promedioDiario: 0,
        diaMaximo: null,
        diaMinimo: null,
        tendencia: 'estable'
      };
    }

    const total = data.reduce((sum, day) => sum + day.total, 0);
    const ingresos = data.reduce((sum, day) => sum + day.ingresos, 0);
    const salidas = data.reduce((sum, day) => sum + day.salidas, 0);
    const promedioDiario = total / data.length;

    // Encontrar día con máximo y mínimo movimiento
    const diaMaximo = data.reduce((max, day) => day.total > max.total ? day : max, data[0]);
    const diaMinimo = data.reduce((min, day) => day.total < min.total ? day : min, data[0]);

    // Calcular tendencia (comparar primeros y últimos 3 días)
    let tendencia: 'ascendente' | 'descendente' | 'estable' = 'estable';
    
    if (data.length >= 6) {
      const primerosDias = data.slice(0, 3).reduce((sum, day) => sum + day.total, 0) / 3;
      const ultimosDias = data.slice(-3).reduce((sum, day) => sum + day.total, 0) / 3;
      
      if (ultimosDias > primerosDias * 1.2) {
        tendencia = 'ascendente';
      } else if (ultimosDias < primerosDias * 0.8) {
        tendencia = 'descendente';
      }
    }

    return {
      total,
      ingresos,
      salidas,
      promedioDiario,
      diaMaximo,
      diaMinimo,
      tendencia
    };
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Métodos para formatear datos para diferentes tipos de gráficos
  const getBarChartData = useCallback(() => {
    return {
      labels: chartData.map(d => d.fecha),
      datasets: [
        {
          label: 'Ingresos',
          data: chartData.map(d => d.ingresos),
          backgroundColor: '#10b981', // verde
          borderColor: '#10b981',
          borderWidth: 1
        },
        {
          label: 'Salidas',
          data: chartData.map(d => d.salidas),
          backgroundColor: '#ef4444', // rojo
          borderColor: '#ef4444',
          borderWidth: 1
        }
      ]
    };
  }, [chartData]);

  const getLineChartData = useCallback(() => {
    return {
      labels: chartData.map(d => d.fecha),
      datasets: [
        {
          label: 'Total Movimientos',
          data: chartData.map(d => d.total),
          borderColor: '#3b82f6', // azul
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4
        }
      ]
    };
  }, [chartData]);

  const getDoughnutChartData = useCallback(() => {
    const tiposUnicos = new Set<string>();
    
    chartData.forEach(day => {
      Object.keys(day).forEach(key => {
        if (key !== 'fecha' && key !== 'fechaCompleta' && key !== 'fechaISO' && 
            key !== 'total' && key !== 'ingresos' && key !== 'salidas') {
          if (day[key] > 0) {
            tiposUnicos.add(key);
          }
        }
      });
    });

    const labels = Array.from(tiposUnicos);
    const data = labels.map(label => 
      chartData.reduce((sum, day) => sum + (day[label] || 0), 0)
    );

    const colors = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
      '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'
    ];

    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: labels.map((_, i) => colors[i % colors.length]),
          borderWidth: 1
        }
      ]
    };
  }, [chartData]);

  const getStackedBarChartData = useCallback(() => {
    // Filtrar solo tipos que tienen datos
    const tiposConDatos = new Set<string>();
    
    chartData.forEach(day => {
      Object.keys(day).forEach(key => {
        if (key !== 'fecha' && key !== 'fechaCompleta' && key !== 'fechaISO' && 
            key !== 'total' && key !== 'ingresos' && key !== 'salidas' &&
            day[key] > 0) {
          tiposConDatos.add(key);
        }
      });
    });

    const tiposArray = Array.from(tiposConDatos);
    
    const datasets = tiposArray.map(type => {
      const colorMap: Record<string, string> = {
        'VENTA_BARRA': '#ef4444',
        'VENTA_BOLSA': '#f87171',
        'CREACION_BARRA': '#10b981',
        'CREACION_BOLSA_VACIA': '#34d399',
        'MERMA_BARRA': '#f59e0b',
        'MERMA_BOLSA': '#fbbf24',
        'DEVOLUCION_BARRA': '#8b5cf6',
        'DEVOLUCION_BOLSA': '#a78bfa',
        'ASIGNACION_BOLSA': '#06b6d4',
        'LLENADO_BOLSA': '#22d3ee',
        'USO_CUARTOS_BARRA': '#f97316',
        'ACTUALIZACION_STOCK': '#6b7280'
      };

      const labelMap: Record<string, string> = {
        'VENTA_BARRA': 'Venta Barras',
        'VENTA_BOLSA': 'Venta Bolsas',
        'CREACION_BARRA': 'Creación Barras',
        'CREACION_BOLSA_VACIA': 'Creación Bolsas Vacías',
        'MERMA_BARRA': 'Merma Barras',
        'MERMA_BOLSA': 'Merma Bolsas',
        'DEVOLUCION_BARRA': 'Devolución Barras',
        'DEVOLUCION_BOLSA': 'Devolución Bolsas',
        'ASIGNACION_BOLSA': 'Asignación Bolsas',
        'LLENADO_BOLSA': 'Llenado Bolsas',
        'USO_CUARTOS_BARRA': 'Uso Cuartos',
        'ACTUALIZACION_STOCK': 'Ajuste Stock'
      };

      return {
        label: labelMap[type] || type,
        data: chartData.map(d => d[type] || 0),
        backgroundColor: colorMap[type] || '#6b7280',
        borderColor: colorMap[type] || '#6b7280',
        borderWidth: 1
      };
    });

    return {
      labels: chartData.map(d => d.fecha),
      datasets
    };
  }, [chartData]);

  // Métodos para obtener datos resumidos
  const getSummary = useCallback(() => {
    return {
      period: `${days} días`,
      startDate: chartData.length > 0 ? chartData[0].fechaCompleta : '',
      endDate: chartData.length > 0 ? chartData[chartData.length - 1].fechaCompleta : '',
      totalDays: chartData.length,
      ...stats
    };
  }, [chartData, stats, days]);

  const getDailyAverage = useCallback((type?: 'total' | 'ingresos' | 'salidas') => {
    if (chartData.length === 0) return 0;
    
    const total = type ? 
      chartData.reduce((sum, day) => sum + day[type], 0) : 
      stats.total;
    
    return total / chartData.length;
  }, [chartData, stats]);

  const getTopDays = useCallback((limit: number = 3) => {
    return [...chartData]
      .sort((a, b) => b.total - a.total)
      .slice(0, limit)
      .map(day => ({
        fecha: day.fechaCompleta,
        total: day.total,
        ingresos: day.ingresos,
        salidas: day.salidas
      }));
  }, [chartData]);

  const getMovementTypeDistribution = useCallback(() => {
    const distribution: Record<string, number> = {};
    
    chartData.forEach(day => {
      Object.keys(day).forEach(key => {
        if (key !== 'fecha' && key !== 'fechaCompleta' && key !== 'fechaISO' && 
            key !== 'total' && key !== 'ingresos' && key !== 'salidas') {
          const value = day[key] || 0;
          if (value > 0) {
            distribution[key] = (distribution[key] || 0) + value;
          }
        }
      });
    });

    // Convertir a array y ordenar
    return Object.entries(distribution)
      .map(([type, cantidad]) => ({ type, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }, [chartData]);

  return {
    // Datos básicos
    chartData,
    loading,
    error,
    stats,
    
    // Método para recargar
    refresh: fetchData,
    
    // Datos formateados para diferentes gráficos
    barChartData: getBarChartData(),
    lineChartData: getLineChartData(),
    doughnutChartData: getDoughnutChartData(),
    stackedBarChartData: getStackedBarChartData(),
    
    // Métodos para obtener datos específicos
    getSummary,
    getDailyAverage,
    getTopDays,
    getMovementTypeDistribution,
    
    // Métodos para formatear (para usar con diferentes librerías de gráficos)
    getFormattedData: (chartType: 'bar' | 'line' | 'doughnut' | 'stacked') => {
      switch (chartType) {
        case 'bar': return getBarChartData();
        case 'line': return getLineChartData();
        case 'doughnut': return getDoughnutChartData();
        case 'stacked': return getStackedBarChartData();
        default: return getBarChartData();
      }
    },
    
    // Utilidades
    formatNumber: (num: number) => {
      if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
      return num.toString();
    },
    
    formatCurrency: (num: number) => {
      return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
      }).format(num);
    },
    
    // Información del período
    dateRange: {
      start: chartData.length > 0 ? chartData[0].fechaCompleta : '',
      end: chartData.length > 0 ? chartData[chartData.length - 1].fechaCompleta : '',
      days: chartData.length
    },
    
    // Debug
    debugInfo: () => {
      console.log('=== MOVEMENT CHART DEBUG ===');
      console.log('Datos:', chartData.length, 'días');
      console.log('Estadísticas:', stats);
      console.log('Rango de fechas:', {
        start: chartData[0]?.fechaCompleta,
        end: chartData[chartData.length - 1]?.fechaCompleta
      });
    }
  };
}