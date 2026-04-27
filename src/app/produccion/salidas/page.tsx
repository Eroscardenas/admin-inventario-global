// app/produccion/salidas/page.tsx
// ✅ FUNCIONAL + PRO (usa tu guía de colores)
// - Registra salida REAL: decrementa stockPorHielo y crea 1 doc en /movimientos con items[] (batch)
// - Evita el error "transactions require all reads before all writes" usando ProductionService.registrarSalidaStockBatch()
// - Mantiene CLARO qué productos salen (tabla + modal con lista completa)
// - Soporta modoBatch (una sola salida con varios renglones) y modo individual
// - Transporte (elige chofer) o Venta público (cliente)
// - Fallback: si no existe hook batch, usa ProductionService directo (recomendado)
// - Vinculación Entregas PDF: manda productoCodigo, productoNombre, pesoKg e inventoryKey

'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { useAuthContext } from '@/context/AuthContext';
import { useProducts } from '@/lib/hooks/useProducts';

import { db } from '@/lib/firebase/config.client';
import { collection, getDocs, limit as qLimit, orderBy, query, where } from 'firebase/firestore';

import type { IceType, MaquinaId } from '@/lib/utils/types/product.types';
import { TIPOS_HIELO, ETIQUETAS_TIPO_HIELO } from '@/lib/utils/types/product.types';

import { ProductionService, type SalidaBatchItem } from '@/lib/services/production.service';

import {
  ArrowLeft,
  RefreshCw,
  Search,
  Loader2,
  AlertTriangle,
  ClipboardList,
  Truck,
  PackageMinus,
  X,
  CheckCircle2,
  CalendarDays,
  User,
  Users,
  ChevronRight,
  Factory,
  Droplets,
  BarChart3,
  Thermometer,
  Clock,
  PlusCircle,
  Trash2,
  Layers,
  Pencil,
} from 'lucide-react';

type SalidaSubtipo = 'ENTREGA_TRANSPORTE' | 'VENTA_PUBLICO';

type Chofer = {
  id: string;
  codigo: string;
  nombre: string;
  isActive?: boolean;
};

type BolsaVaciaProduct = {
  codigo: string;
  nombre: string;
  pesoKg?: number;
  isActive?: boolean;
};

type StockTipoRow = {
  tipoHielo: IceType;
  stockActual: number;
  ultimaActualizacion?: unknown;
};

type StockLlenoPorProductoRow = {
  bolsaVaciaCodigo: string;
  productoNombre?: string;
  pesoKg?: number;
  totalLlenas?: number;
  bolsasVaciasDisponibles?: number;
  tipos?: Array<{
    tipoHielo?: unknown;
    stockActual?: unknown;
    ultimaActualizacion?: unknown;
  }>;
};

type EntregaItem = {
  id: string;
  bolsaVaciaCodigo: string;
  tipoHielo: IceType;
  cantidad: number;
};

type Toast =
  | null
  | {
      type: 'ok' | 'err' | 'info';
      msg: string;
    };

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const fmtDateTime = (d: unknown) => {
  try {
    if (!d) return '—';
    const asAny = d as any;
    const dt =
      typeof asAny?.toDate === 'function'
        ? asAny.toDate()
        : d instanceof Date
          ? d
          : new Date(d as any);

    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString('es-MX');
  } catch {
    return '—';
  }
};

const safeStr = (v: unknown) => String(v ?? '').trim();

const clampInt = (n: number) => {
  const x = Math.floor(Number(n));
  return Number.isFinite(x) ? x : 0;
};

const isIceType = (v: unknown): v is IceType =>
  (TIPOS_HIELO as readonly string[]).includes(String(v));

const toIceTypeOrDefault = (v: unknown, fallback: IceType): IceType =>
  isIceType(v) ? (String(v) as IceType) : fallback;

const safeInt = (v: unknown, fallback = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
};

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const keyBVTipo = (bv: string, tipo: IceType) => `${safeStr(bv)}__${tipo}`;

const buildInventoryKey = (bv: string, tipo: IceType | string, pesoKg: number) =>
  `${safeStr(bv)}__${safeStr(tipo)}__${num(pesoKg)}`;

const MAQUINAS: MaquinaId[] = ['M1', 'M2', 'M3', 'Maquina Prueba', 'KLYR'];

function ModalShell({
  title,
  onClose,
  children,
  tone = 'purple',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  tone?: 'cyan' | 'purple';
}) {
  return (
    <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-gray-200 animate-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-xl ${
                  tone === 'cyan'
                    ? 'bg-gradient-to-br from-cyan-500 to-cyan-600'
                    : 'bg-gradient-to-br from-purple-500 to-purple-600'
                }`}
              >
                {tone === 'cyan' ? (
                  <CheckCircle2 className="w-5 h-5 text-white" />
                ) : (
                  <PackageMinus className="w-5 h-5 text-white" />
                )}
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-lg">{title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">Confirmación de salida</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-50 transition-all duration-200"
              aria-label="Cerrar"
              type="button"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          <div className="p-6 max-h-[75vh] overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}

function SlideOver({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-gradient-to-b from-white to-cyan-50 shadow-2xl border-l border-cyan-200/50">
        <div className="h-16 px-4 border-b border-cyan-200/50 flex items-center justify-between bg-gradient-to-r from-cyan-500 to-blue-500">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-white" />
            <div className="font-semibold text-white">{title}</div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-white/20 text-white hover:bg-white/30 transition-all duration-200"
            aria-label="Cerrar"
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6 h-[calc(100%-4rem)] overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export default function SalidasPage() {
  const router = useRouter();
  const { productionSession, loading: authLoading, updateLastActivity } = useAuthContext();

  const productsHook = useProducts();

  const bolsasVacias = (productsHook.bolsasVacias ?? []) as BolsaVaciaProduct[];
  const stockLlenoPorProducto = (productsHook.stockLlenoPorProducto ?? []) as StockLlenoPorProductoRow[];

  const loading = !!productsHook.loading;
  const error = productsHook.error as string | undefined;

  const safeReload = useCallback(() => {
    try {
      (productsHook.reload as undefined | (() => void))?.();
    } catch {
      // noop
    }
  }, [productsHook.reload]);

  const hookRegistrarSalidaStock = (productsHook.actions as any)?.registrarSalidaStock as
    | undefined
    | ((payload: any) => Promise<any>);

  const hookRegistrarSalidaStockBatch = (productsHook.actions as any)?.registrarSalidaStockBatch as
    | undefined
    | ((payload: any) => Promise<any>);

  const supportsHookBatch = typeof hookRegistrarSalidaStockBatch === 'function';

  useEffect(() => {
    if (authLoading) return;
    if (!productionSession) router.replace('/produccion/login');
  }, [authLoading, productionSession, router]);

  useEffect(() => {
    const t = setInterval(() => updateLastActivity?.(), 45_000);
    return () => clearInterval(t);
  }, [updateLastActivity]);

  const empleadoCodigo =
    (productionSession?.codigo as string | undefined) ||
    (productionSession as any)?.empleadoId ||
    (productionSession as any)?.id ||
    '';

  const empleadoNombre = (productionSession as any)?.nombre || 'Empleado';

  const [subtipo, setSubtipo] = useState<SalidaSubtipo>('ENTREGA_TRANSPORTE');

  const [chofer, setChofer] = useState<Chofer | null>(null);
  const [clienteNombre, setClienteNombre] = useState<string>('');
  const [observaciones, setObservaciones] = useState<string>('');

  const [maquina, setMaquina] = useState<MaquinaId>('M1');

  const [bvCodigo, setBvCodigo] = useState<string>('');
  const [tipoHielo, setTipoHielo] = useState<IceType>(TIPOS_HIELO[0]);
  const [cantidad, setCantidad] = useState<number | ''>('');

  const [items, setItems] = useState<EntregaItem[]>([]);
  const [modoBatch, setModoBatch] = useState<boolean>(true);

  const [openConfirm, setOpenConfirm] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [toast, setToast] = useState<Toast>(null);

  const [openChoferes, setOpenChoferes] = useState<boolean>(false);
  const [choferes, setChoferes] = useState<Chofer[]>([]);
  const [choferesLoading, setChoferesLoading] = useState<boolean>(false);
  const [choferesErr, setChoferesErr] = useState<string>('');
  const [qChofer, setQChofer] = useState<string>('');

  const [q, setQ] = useState<string>('');

  const bvCodigosConStock = useMemo(() => {
    const set = new Set<string>();
    for (const row of stockLlenoPorProducto) {
      const codigo = safeStr(row?.bolsaVaciaCodigo);
      if (!codigo) continue;
      const tipos = Array.isArray(row?.tipos) ? row.tipos : [];
      const anyPositivo = tipos.some((t) => num(t?.stockActual) > 0 && isIceType(t?.tipoHielo));
      if (anyPositivo) set.add(codigo);
    }
    return set;
  }, [stockLlenoPorProducto]);

  const bvList = useMemo(() => {
    const base = bolsasVacias.filter((p) => bvCodigosConStock.has(safeStr(p.codigo)));
    const queryText = safeStr(q).toLowerCase();

    return !queryText
      ? base
      : base.filter(
          (p) =>
            safeStr(p.nombre).toLowerCase().includes(queryText) ||
            safeStr(p.codigo).toLowerCase().includes(queryText)
        );
  }, [bolsasVacias, bvCodigosConStock, q]);

  useEffect(() => {
    if (!bvCodigo && bvList.length) setBvCodigo(safeStr(bvList[0].codigo));
  }, [bvList, bvCodigo]);

  useEffect(() => {
    if (!isIceType(tipoHielo)) setTipoHielo(TIPOS_HIELO[0]);
  }, [tipoHielo]);

  const selectedBVRow = useMemo(() => {
    if (!bvCodigo) return null;
    return stockLlenoPorProducto.find((x) => safeStr(x.bolsaVaciaCodigo) === safeStr(bvCodigo)) ?? null;
  }, [bvCodigo, stockLlenoPorProducto]);

  const tiposDisponiblesParaBV = useMemo((): StockTipoRow[] => {
    if (!selectedBVRow) return [];
    const raw = selectedBVRow.tipos ?? [];

    const list: StockTipoRow[] = raw
      .map((t) => ({
        tipoHielo: toIceTypeOrDefault(t?.tipoHielo, TIPOS_HIELO[0]),
        stockActual: num(t?.stockActual),
        ultimaActualizacion: t?.ultimaActualizacion,
      }))
      .filter((t) => isIceType(t.tipoHielo))
      .filter((t) => t.stockActual > 0);

    const order = new Map<IceType, number>(TIPOS_HIELO.map((x, i) => [x, i]));
    list.sort((a, b) => (order.get(a.tipoHielo) ?? 999) - (order.get(b.tipoHielo) ?? 999));
    return list;
  }, [selectedBVRow]);

  useEffect(() => {
    if (!bvCodigo) return;
    if (tiposDisponiblesParaBV.some((x) => x.tipoHielo === tipoHielo)) return;
    if (tiposDisponiblesParaBV.length) setTipoHielo(tiposDisponiblesParaBV[0].tipoHielo);
    else setTipoHielo(TIPOS_HIELO[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bvCodigo, tiposDisponiblesParaBV]);

  const selectedBVStock = useMemo(() => {
    if (!selectedBVRow) return null;
    const t = (selectedBVRow.tipos ?? []).find(
      (x) => toIceTypeOrDefault(x?.tipoHielo, TIPOS_HIELO[0]) === tipoHielo
    );

    return {
      bvCodigo: safeStr(selectedBVRow.bolsaVaciaCodigo),
      nombre: safeStr(selectedBVRow.productoNombre),
      pesoKg: selectedBVRow.pesoKg,
      disponibles: num(t?.stockActual),
      ultima: t?.ultimaActualizacion,
      totalLlenas: num(selectedBVRow.totalLlenas),
      bolsasVaciasDisponibles: num(selectedBVRow.bolsasVaciasDisponibles),
    };
  }, [selectedBVRow, tipoHielo]);

  const ultimaSeleccionada = selectedBVStock?.ultima;

  const disponiblesPorBVTipo = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stockLlenoPorProducto) {
      const bv = safeStr(row?.bolsaVaciaCodigo);
      if (!bv) continue;
      for (const t of row?.tipos ?? []) {
        const tipo = toIceTypeOrDefault(t?.tipoHielo, TIPOS_HIELO[0]);
        if (!isIceType(tipo)) continue;
        map.set(keyBVTipo(bv, tipo), num(t?.stockActual));
      }
    }
    return map;
  }, [stockLlenoPorProducto]);

  const getDisponible = useCallback(
    (bv: string, tipo: IceType) => disponiblesPorBVTipo.get(keyBVTipo(bv, tipo)) ?? 0,
    [disponiblesPorBVTipo]
  );

  const getSalidaProductMeta = useCallback(
    (bolsaVaciaCodigo: string, tipoHieloValue: IceType) => {
      const row =
        stockLlenoPorProducto.find(
          (x) => safeStr(x.bolsaVaciaCodigo) === safeStr(bolsaVaciaCodigo)
        ) ?? null;

      const pesoKg = num(row?.pesoKg);
      const productoNombreBase = safeStr(row?.productoNombre);
      const tipo = safeStr(tipoHieloValue);
      const codigo = safeStr(bolsaVaciaCodigo);

      const productoNombre =
        productoNombreBase ||
        (pesoKg > 0 ? `${tipo} ${pesoKg}KG` : `${codigo} ${tipo}`);

      return {
        productoCodigo: codigo,
        productoNombre,
        pesoKg,
        inventoryKey: buildInventoryKey(codigo, tipo, pesoKg),
      };
    },
    [stockLlenoPorProducto]
  );

  const addOrMergeItem = useCallback(() => {
    if (!bvCodigo) return;
    if (!isIceType(tipoHielo)) return;

    const qty = cantidad === '' ? 0 : clampInt(Number(cantidad));
    if (qty <= 0) {
      setToast({ type: 'err', msg: 'Ingresa una cantidad válida.' });
      return;
    }

    const disp = selectedBVStock?.disponibles ?? getDisponible(bvCodigo, tipoHielo);
    const bv = safeStr(bvCodigo);
    const tipo = tipoHielo;
    const k = keyBVTipo(bv, tipo);

    setItems((prev) => {
      const idx = prev.findIndex((x) => keyBVTipo(x.bolsaVaciaCodigo, x.tipoHielo) === k);

      if (idx >= 0) {
        const next = [...prev];
        const current = next[idx];
        const nueva = clampInt(current.cantidad + qty);

        if (nueva > disp) {
          setToast({ type: 'err', msg: `Stock insuficiente. Máximo disponible: ${disp}` });
          return prev;
        }

        next[idx] = { ...current, cantidad: nueva };
        setToast({ type: 'ok', msg: '✓ Se sumó al renglón existente.' });
        return next;
      }

      if (qty > disp) {
        setToast({ type: 'err', msg: `Stock insuficiente. Máximo disponible: ${disp}` });
        return prev;
      }

      setToast({ type: 'ok', msg: '✓ Agregado a la salida.' });
      return [...prev, { id: uid(), bolsaVaciaCodigo: bv, tipoHielo: tipo, cantidad: qty }];
    });

    setCantidad('');
  }, [bvCodigo, tipoHielo, cantidad, selectedBVStock, getDisponible]);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clearItems = useCallback(() => setItems([]), []);

  const setItemCantidad = useCallback(
    (id: string, raw: unknown) => {
      const qv = clampInt(safeInt(raw, 0));

      setItems((prev) => {
        const next = [...prev];
        const idx = next.findIndex((x) => x.id === id);
        if (idx < 0) return prev;

        const it = next[idx];
        const disp = getDisponible(it.bolsaVaciaCodigo, it.tipoHielo);
        const nextQty = qv <= 0 ? 1 : qv;

        if (nextQty > disp) {
          setToast({ type: 'err', msg: `Stock insuficiente. Máximo disponible: ${disp}` });
          next[idx] = { ...it, cantidad: disp };
          return next;
        }

        next[idx] = { ...it, cantidad: nextQty };
        return next;
      });
    },
    [getDisponible]
  );

  const totalUnidades = useMemo(
    () => items.reduce((acc, it) => acc + safeInt(it.cantidad, 0), 0),
    [items]
  );

  const cargarChoferes = useCallback(async () => {
    setChoferesErr('');
    setChoferesLoading(true);

    try {
      const ref = collection(db, 'empleados');
      const qy = query(
        ref,
        where('role', '==', 'TRANSPORTE'),
        where('isActive', '==', true),
        orderBy('nombre', 'asc'),
        qLimit(200)
      );

      const snap = await getDocs(qy);

      setChoferes(
        snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            codigo: safeStr(data.codigo || d.id),
            nombre: safeStr(data.nombre || 'Transporte'),
            isActive: !!data.isActive,
          };
        })
      );
    } catch (e: any) {
      setChoferesErr(e?.message ?? 'No se pudieron cargar choferes.');
    } finally {
      setChoferesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!openChoferes) return;
    if (choferes.length) return;
    cargarChoferes();
  }, [openChoferes, choferes.length, cargarChoferes]);

  const choferesFiltrados = useMemo(() => {
    const t = safeStr(qChofer).toLowerCase();
    if (!t) return choferes;
    return choferes.filter((c) => c.nombre.toLowerCase().includes(t) || c.codigo.toLowerCase().includes(t));
  }, [choferes, qChofer]);

  const destinatarioFinal = useMemo(() => {
    if (subtipo === 'ENTREGA_TRANSPORTE') return chofer ? `${chofer.nombre} (${chofer.codigo})` : '';
    return safeStr(clienteNombre);
  }, [subtipo, chofer, clienteNombre]);

  const commonMetaOk = useMemo(() => {
    if (!productionSession) return false;
    if (!safeStr(empleadoCodigo) || !safeStr(empleadoNombre)) return false;
    if (!maquina) return false;

    if (subtipo === 'ENTREGA_TRANSPORTE') {
      if (!chofer) return false;
    } else {
      if (!safeStr(clienteNombre)) return false;
    }

    if (!safeStr(destinatarioFinal)) return false;
    return true;
  }, [productionSession, empleadoCodigo, empleadoNombre, subtipo, chofer, clienteNombre, destinatarioFinal, maquina]);

  const singleOk = useMemo(() => {
    if (!commonMetaOk) return false;
    if (!bvCodigo) return false;
    if (!isIceType(tipoHielo)) return false;
    if (!tiposDisponiblesParaBV.some((x) => x.tipoHielo === tipoHielo)) return false;

    if (cantidad === '') return false;
    const qty = clampInt(Number(cantidad));
    if (qty <= 0) return false;

    if (!selectedBVStock) return false;
    if (qty > selectedBVStock.disponibles) return false;

    return true;
  }, [commonMetaOk, bvCodigo, tipoHielo, tiposDisponiblesParaBV, cantidad, selectedBVStock]);

  const batchOk = useMemo(() => {
    if (!commonMetaOk) return false;
    if (!items.length) return false;

    for (const it of items) {
      const qv = safeInt(it.cantidad, 0);
      if (qv <= 0) return false;
      const disp = getDisponible(it.bolsaVaciaCodigo, it.tipoHielo);
      if (qv > disp) return false;
    }

    return true;
  }, [commonMetaOk, items, getDisponible]);

  const canSubmit = useMemo(() => (modoBatch ? batchOk : singleOk), [modoBatch, batchOk, singleOk]);

  const resetForm = useCallback(() => {
    setObservaciones('');
    setCantidad('');
  }, []);

  const buildCommonMeta = useCallback(() => {
    return {
      usuarioCodigo: safeStr(empleadoCodigo),
      usuarioNombre: safeStr(empleadoNombre),

      empleadoAsignadoCodigo: safeStr(empleadoCodigo),
      empleadoAsignadoNombre: safeStr(empleadoNombre),

      salidaSubtipo: subtipo,
      salidaDestino: subtipo === 'VENTA_PUBLICO' ? 'PUBLICO' : 'TRANSPORTE',

      destinatario: destinatarioFinal,
      clienteNombre: subtipo === 'VENTA_PUBLICO' ? safeStr(clienteNombre) : undefined,

      observaciones: safeStr(observaciones) || undefined,
      motivo: 'Salida de producción',

      maquina,
    };
  }, [empleadoCodigo, empleadoNombre, subtipo, destinatarioFinal, clienteNombre, observaciones, maquina]);

  const onRegistrar = useCallback(async () => {
    console.log('[SALIDAS] confirmar', { modoBatch, canSubmit });

    if (!canSubmit) {
      setToast({ type: 'err', msg: 'Revisa los datos antes de confirmar.' });
      return;
    }

    setSubmitting(true);
    setToast({ type: 'info', msg: 'Saliendo… registrando movimiento' });

    try {
      const meta = buildCommonMeta();

      const registrarSingle = async (payload: any) => {
        if (typeof hookRegistrarSalidaStock === 'function') {
          console.log('[SALIDAS] usando hookRegistrarSalidaStock');
          return await hookRegistrarSalidaStock(payload);
        }

        console.log('[SALIDAS] usando ProductionService.registrarSalidaStock (fallback)');
        return await ProductionService.registrarSalidaStock(payload);
      };

      const registrarBatch = async (payload: any) => {
        if (typeof hookRegistrarSalidaStockBatch === 'function') {
          console.log('[SALIDAS] usando hookRegistrarSalidaStockBatch');
          return await hookRegistrarSalidaStockBatch(payload);
        }

        console.log('[SALIDAS] usando ProductionService.registrarSalidaStockBatch (fallback)');
        return await ProductionService.registrarSalidaStockBatch(payload);
      };

      if (modoBatch) {
        const payloadItems: Array<SalidaBatchItem & Record<string, unknown>> = items.map((it) => {
          const metaProducto = getSalidaProductMeta(it.bolsaVaciaCodigo, it.tipoHielo);

          return {
            bolsaVaciaCodigo: it.bolsaVaciaCodigo,
            productoCodigo: metaProducto.productoCodigo,
            productoNombre: metaProducto.productoNombre,
            pesoKg: metaProducto.pesoKg,
            inventoryKey: metaProducto.inventoryKey,
            tipoHielo: it.tipoHielo,
            cantidad: safeInt(it.cantidad, 0),
          };
        });

        console.log('[SALIDAS] payload batch', { meta, items: payloadItems });

        await registrarBatch({ ...meta, items: payloadItems });

        setToast({ type: 'ok', msg: '✓ Salida registrada correctamente (1 movimiento con items).' });
        setOpenConfirm(false);
        resetForm();
        clearItems();
        safeReload();
        return;
      }

      const qty = clampInt(Number(cantidad));
      const metaProducto = getSalidaProductMeta(bvCodigo, tipoHielo);

      console.log('[SALIDAS] payload single', {
        meta,
        bolsaVaciaCodigo: bvCodigo,
        tipoHielo,
        cantidad: qty,
        ...metaProducto,
      });

      await registrarSingle({
        ...meta,
        bolsaVaciaCodigo: bvCodigo,
        productoCodigo: metaProducto.productoCodigo,
        productoNombre: metaProducto.productoNombre,
        pesoKg: metaProducto.pesoKg,
        inventoryKey: metaProducto.inventoryKey,
        tipoHielo,
        cantidad: qty,
      });

      setToast({ type: 'ok', msg: '✓ Salida registrada correctamente.' });
      setOpenConfirm(false);
      resetForm();
      safeReload();
    } catch (e: any) {
      console.error('[SALIDAS] ❌ error', e);
      const details = { code: e?.code, name: e?.name, message: e?.message };
      console.error('[SALIDAS] error details', details);

      setToast({
        type: 'err',
        msg: e?.message || e?.code || 'Error registrando salida (revisa consola: [SALIDAS] error details).',
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    modoBatch,
    canSubmit,
    buildCommonMeta,
    items,
    hookRegistrarSalidaStock,
    hookRegistrarSalidaStockBatch,
    cantidad,
    bvCodigo,
    tipoHielo,
    getSalidaProductMeta,
    resetForm,
    clearItems,
    safeReload,
  ]);

  const headerSubtitle = useMemo(() => {
    const who = productionSession ? `${empleadoNombre} (${empleadoCodigo || '—'})` : '—';
    return `· Sesión: ${who}`;
  }, [productionSession, empleadoNombre, empleadoCodigo]);

  useEffect(() => {
    if (!openConfirm) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenConfirm(false);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openConfirm]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!openConfirm && !openChoferes) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prev;
    };
  }, [openConfirm, openChoferes]);

  const cantidadUI = cantidad === '' ? '—' : String(clampInt(Number(cantidad)));

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-cyan-50 to-blue-50">
      <div className="bg-gradient-to-r from-white to-cyan-50 rounded-b-3xl border-b border-cyan-200/50 shadow-xl p-6 mb-8">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5"
                type="button"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-2xl shadow-lg">
                  <Truck className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <Droplets className="h-5 w-5 text-cyan-600" />
                    <h1 className="text-2xl font-bold text-gray-900">Salidas de Producción</h1>
                  </div>
                  <p className="text-gray-600 mt-1">
                    Transporte <ChevronRight className="w-4 h-4 inline mx-1" /> Venta al público
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{headerSubtitle}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-gray-600">Operario</p>
                <p className="text-lg font-bold text-cyan-700">{empleadoNombre}</p>
                <p className="text-xs text-gray-500 font-mono">{empleadoCodigo || '—'}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <Factory className="w-4 h-4 text-white" />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-cyan-200 shadow-sm">
                <Layers className="h-4 w-4 text-cyan-600" />
                <span className="text-sm font-semibold text-gray-900">Modo:</span>

                <button
                  type="button"
                  onClick={() => setModoBatch(true)}
                  className={[
                    'px-3 py-1.5 rounded-lg text-sm font-semibold transition-all',
                    modoBatch
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                  ].join(' ')}
                >
                  Una sola salida
                </button>

                <button
                  type="button"
                  onClick={() => setModoBatch(false)}
                  className={[
                    'px-3 py-1.5 rounded-lg text-sm font-semibold transition-all',
                    !modoBatch
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                  ].join(' ')}
                >
                  Individual
                </button>
              </div>

              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-cyan-200 shadow-sm">
                <span className="text-sm font-semibold text-gray-900">Máquina:</span>
                <select
                  value={maquina}
                  onChange={(e) => setMaquina(e.target.value as MaquinaId)}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-800 border border-gray-200"
                >
                  {MAQUINAS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {modoBatch && (
              <div className="text-sm text-gray-700">
                <span className="font-semibold">Renglones:</span> {items.length} ·{' '}
                <span className="font-semibold">Total:</span> {totalUnidades}
              </div>
            )}
          </div>

          {!supportsHookBatch && (
            <div className="mt-3 text-xs text-gray-500">
              Nota: aunque tu hook no tenga batch, aquí usamos <b>ProductionService.registrarSalidaStockBatch()</b> como fallback (1 movimiento con items).
            </div>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 pb-10">
        <div className="grid grid-cols-1 gap-6 mb-8">
          {(loading || authLoading) && (
            <div className="bg-gradient-to-r from-white to-cyan-50 rounded-2xl border border-cyan-200 p-6 shadow-lg">
              <div className="flex items-center justify-center gap-4">
                <div className="relative">
                  <div className="w-12 h-12 border-4 border-cyan-100 rounded-full"></div>
                  <div className="absolute top-0 left-0 w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Cargando datos del sistema...</p>
                  <p className="text-sm text-gray-500">Sincronizando información en tiempo real</p>
                </div>
              </div>
            </div>
          )}

          {!!error && (
            <div className="bg-gradient-to-r from-white to-rose-50 rounded-2xl border border-rose-200 p-6 shadow-lg">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-r from-rose-500 to-rose-600 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-rose-800">Error del Sistema</p>
                  <p className="text-rose-600 mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {toast && (
            <div
              className={[
                'rounded-2xl border p-6 shadow-lg',
                toast.type === 'ok'
                  ? 'bg-gradient-to-r from-emerald-50 to-cyan-50 border-emerald-200'
                  : toast.type === 'info'
                    ? 'bg-gradient-to-r from-white to-cyan-50 border-cyan-200'
                    : 'bg-gradient-to-r from-rose-50 to-purple-50 border-rose-200',
              ].join(' ')}
            >
              <div className="flex items-center gap-4">
                <div
                  className={`p-3 rounded-xl ${
                    toast.type === 'ok'
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600'
                      : toast.type === 'info'
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600'
                        : 'bg-gradient-to-r from-rose-500 to-purple-600'
                  }`}
                >
                  {toast.type === 'ok' ? (
                    <CheckCircle2 className="w-6 h-6 text-white" />
                  ) : toast.type === 'info' ? (
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  ) : (
                    <AlertTriangle className="w-6 h-6 text-white" />
                  )}
                </div>
                <div>
                  <p className="font-bold text-gray-900">
                    {toast.type === 'ok' ? 'Operación Exitosa' : toast.type === 'info' ? 'Procesando' : 'Error'}
                  </p>
                  <p className="text-gray-700 mt-1">{toast.msg}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8">
            <div className="bg-gradient-to-b from-white to-cyan-50 rounded-3xl border border-cyan-200/50 shadow-xl p-6 h-full">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-xl">
                    <ClipboardList className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">Nueva salida</h2>
                    <p className="text-sm text-gray-500">Solo aparece BV que tiene stock lleno por tipo</p>
                  </div>
                </div>

                <button
                  onClick={safeReload}
                  className="p-2.5 rounded-xl border border-cyan-200 bg-white text-cyan-700 hover:bg-cyan-50 hover:shadow-md transition-all duration-200 flex items-center gap-2"
                  disabled={loading}
                  type="button"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  <span className="text-sm font-medium">Recargar</span>
                </button>
              </div>

              <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between mb-6">
                <div className="relative w-full md:w-auto">
                  <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar BV por código/nombre…"
                    className="w-full md:w-[280px] pl-9 pr-3 py-2.5 rounded-xl border border-cyan-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400"
                  />
                </div>

                <div className="text-xs text-gray-500">
                  BV con stock: <b>{bvList.length}</b>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <button
                  onClick={() => setSubtipo('ENTREGA_TRANSPORTE')}
                  className={[
                    'rounded-2xl border p-5 text-left transition-all',
                    subtipo === 'ENTREGA_TRANSPORTE'
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-500 border-cyan-500 shadow-lg text-white'
                      : 'bg-white border-gray-200 hover:border-cyan-300 hover:shadow-md text-gray-900',
                  ].join(' ')}
                  type="button"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${subtipo === 'ENTREGA_TRANSPORTE' ? 'bg-white/20' : 'bg-cyan-100'}`}>
                      <Truck className={`h-5 w-5 ${subtipo === 'ENTREGA_TRANSPORTE' ? 'text-white' : 'text-cyan-600'}`} />
                    </div>
                    <p className="font-semibold text-lg">Transporte</p>
                  </div>
                </button>

                <button
                  onClick={() => setSubtipo('VENTA_PUBLICO')}
                  className={[
                    'rounded-2xl border p-5 text-left transition-all',
                    subtipo === 'VENTA_PUBLICO'
                      ? 'bg-gradient-to-r from-purple-500 to-indigo-500 border-purple-500 shadow-lg text-white'
                      : 'bg-white border-gray-200 hover:border-purple-300 hover:shadow-md text-gray-900',
                  ].join(' ')}
                  type="button"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${subtipo === 'VENTA_PUBLICO' ? 'bg-white/20' : 'bg-purple-100'}`}>
                      <User className={`h-5 w-5 ${subtipo === 'VENTA_PUBLICO' ? 'text-white' : 'text-purple-600'}`} />
                    </div>
                    <p className="font-semibold text-lg">Venta al público</p>
                  </div>
                </button>
              </div>

              {subtipo === 'ENTREGA_TRANSPORTE' ? (
                <div className="mb-6">
                  <label className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-2">
                    <Truck className="w-4 h-4 text-cyan-600" />
                    Empleado de transporte
                  </label>

                  <button
                    type="button"
                    onClick={() => setOpenChoferes(true)}
                    className="w-full px-4 py-3 rounded-xl border border-cyan-300 bg-white text-left hover:bg-cyan-50 transition-all flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      {chofer ? (
                        <>
                          <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center">
                            <Truck className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{chofer.nombre}</p>
                            <p className="text-sm text-gray-500">Código: {chofer.codigo}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                            <Users className="w-5 h-5 text-gray-400" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">Seleccionar transporte</p>
                            <p className="text-sm text-gray-500">Haz clic para elegir</p>
                          </div>
                        </>
                      )}
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </button>

                  {!chofer && <p className="mt-2 text-xs text-rose-600">Requerido: selecciona un empleado de transporte.</p>}
                </div>
              ) : (
                <div className="mb-6">
                  <label className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-2">
                    <User className="w-4 h-4 text-purple-600" />
                    Cliente
                  </label>
                  <input
                    value={clienteNombre}
                    onChange={(e) => setClienteNombre(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    className="w-full px-4 py-3 rounded-xl border border-purple-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                  />
                  {!safeStr(clienteNombre) && <p className="mt-2 text-xs text-rose-600">Requerido: nombre del cliente.</p>}
                </div>
              )}

              <div className="mb-6">
                <label className="text-sm font-medium text-gray-900 mb-2 block">Observaciones (opcional)</label>
                <input
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Ej: comentario, urgencia, etc."
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-sm"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="text-sm font-medium text-gray-900 mb-2 block">Bolsa base (BV)</label>
                  <select
                    value={bvCodigo}
                    onChange={(e) => setBvCodigo(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-cyan-300 bg-white text-sm"
                    disabled={!bvList.length}
                  >
                    {bvList.map((bv) => (
                      <option key={safeStr(bv.codigo)} value={safeStr(bv.codigo)}>
                        {safeStr(bv.codigo)} · {bv.nombre} {bv.pesoKg ? `· ${bv.pesoKg}kg` : ''}
                      </option>
                    ))}
                    {!bvList.length && <option value="">Sin BV con stock</option>}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-900 mb-2 block">Tipo de hielo</label>
                  <select
                    value={tipoHielo}
                    onChange={(e) => setTipoHielo(toIceTypeOrDefault(e.target.value, TIPOS_HIELO[0]))}
                    className="w-full px-4 py-3 rounded-xl border border-cyan-300 bg-white text-sm"
                    disabled={!tiposDisponiblesParaBV.length}
                  >
                    {tiposDisponiblesParaBV.map((t) => (
                      <option key={t.tipoHielo} value={t.tipoHielo}>
                        {(ETIQUETAS_TIPO_HIELO as any)[t.tipoHielo] ?? String(t.tipoHielo)} · {t.stockActual} disp.
                      </option>
                    ))}
                    {!tiposDisponiblesParaBV.length && <option value={TIPOS_HIELO[0]}>Sin stock por tipo</option>}
                  </select>

                  {!!selectedBVStock && (
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-purple-600">Disponibles:</span>
                      <span className="font-bold text-gray-900">{selectedBVStock.disponibles}</span>
                      {!!ultimaSeleccionada && (
                        <>
                          <span className="text-gray-400">|</span>
                          <span className="text-gray-500 flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" />
                            {fmtDateTime(ultimaSeleccionada)}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-900 mb-2 block">Cantidad</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={cantidad}
                    placeholder="Ingresar cantidad"
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') return setCantidad('');
                      const next = safeInt(raw, 0);
                      setCantidad(next <= 0 ? '' : next);
                    }}
                    className="w-full px-4 py-3 rounded-xl border border-cyan-300 bg-white text-sm text-center font-bold"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-end pt-6 border-t border-gray-100">
                {modoBatch && (
                  <button
                    onClick={addOrMergeItem}
                    disabled={!bvCodigo || !tiposDisponiblesParaBV.length || submitting}
                    className={[
                      'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-medium shadow-sm transition-all',
                      !bvCodigo || !tiposDisponiblesParaBV.length || submitting
                        ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                        : 'bg-white border border-cyan-200 text-cyan-700 hover:bg-cyan-50',
                    ].join(' ')}
                    type="button"
                  >
                    <PlusCircle className="h-4 w-4" />
                    Agregar bolsa
                  </button>
                )}

                <button
                  onClick={() => {
                    resetForm();
                    setToast(null);
                  }}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white border border-cyan-200 text-cyan-700 hover:bg-cyan-50"
                  type="button"
                >
                  <X className="h-4 w-4" />
                  Cancelar
                </button>

                <button
                  onClick={() => setOpenConfirm(true)}
                  disabled={!canSubmit || submitting}
                  className={[
                    'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-white font-medium shadow-lg transition-all',
                    canSubmit && !submitting
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed',
                  ].join(' ')}
                  type="button"
                >
                  <PackageMinus className="h-5 w-5" />
                  Registrar salida
                </button>
              </div>

              {modoBatch && (
                <div className="mt-6 rounded-2xl border border-cyan-200 bg-white/70 p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-cyan-700" />
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-sm text-gray-700">
                        <span className="font-semibold">Total:</span> {totalUnidades}
                      </div>
                      <button
                        type="button"
                        onClick={clearItems}
                        disabled={!items.length}
                        className={[
                          'px-3 py-2 rounded-xl text-sm font-semibold border transition-all',
                          items.length
                            ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                            : 'border-gray-200 text-gray-400 cursor-not-allowed',
                        ].join(' ')}
                      >
                        Vaciar
                      </button>
                    </div>
                  </div>

                  {!items.length ? (
                    <div className="text-sm text-gray-500">
                      Agrega renglones con <b>“Agregar bolsa”</b>. Si repites BV+Tipo, se sumará.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-500">
                            <th className="py-2 pr-3">BV</th>
                            <th className="py-2 pr-3">Tipo hielo</th>
                            <th className="py-2 pr-3">Cant.</th>
                            <th className="py-2 pr-3">Disp.</th>
                            <th className="py-2 pr-3"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {items.map((it) => {
                            const disp = getDisponible(it.bolsaVaciaCodigo, it.tipoHielo);
                            const bad = safeInt(it.cantidad, 0) > disp;

                            return (
                              <tr key={it.id} className="text-gray-800">
                                <td className="py-2 pr-3 font-mono font-semibold">{it.bolsaVaciaCodigo}</td>
                                <td className="py-2 pr-3 font-semibold">
                                  {(ETIQUETAS_TIPO_HIELO as any)[it.tipoHielo] ?? String(it.tipoHielo)}
                                </td>
                                <td className="py-2 pr-3">
                                  <div className="inline-flex items-center gap-2">
                                    <input
                                      type="number"
                                      min={1}
                                      step={1}
                                      value={it.cantidad}
                                      onChange={(e) => setItemCantidad(it.id, e.target.value)}
                                      className={[
                                        'w-24 px-3 py-2 rounded-xl border text-center font-bold',
                                        bad ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-gray-200 bg-white',
                                      ].join(' ')}
                                    />
                                    <Pencil className="h-4 w-4 text-gray-400" />
                                  </div>
                                </td>
                                <td className="py-2 pr-3">
                                  <span className={bad ? 'text-rose-700 font-semibold' : 'text-gray-700'}>{disp}</span>
                                </td>
                                <td className="py-2 pr-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => removeItem(it.id)}
                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    Quitar
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>

                      {!batchOk && (
                        <div className="mt-3 text-xs text-rose-700 flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 mt-0.5" />
                          <div>Hay renglones inválidos o mayor al disponible. Ajusta cantidades o quita renglones.</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-4">
            <div className="bg-gradient-to-b from-white to-cyan-50 rounded-3xl border border-cyan-200/50 shadow-xl p-6 h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl">
                  <BarChart3 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Resumen</h2>
                  <p className="text-sm text-gray-500">Detalles de la salida</p>
                </div>
              </div>

              <div className="mb-6 p-4 bg-gradient-to-r from-cyan-50 to-white rounded-xl border border-cyan-200">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center">
                    <Factory className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Operario</p>
                    <p className="font-bold text-gray-900">{empleadoNombre}</p>
                    <p className="text-xs text-gray-500 font-mono">{empleadoCodigo || '—'}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-gradient-to-b from-white to-blue-50 rounded-2xl border border-blue-200">
                  <p className="text-sm font-medium text-gray-700 mb-3">Detalle</p>

                  {!modoBatch ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">BV:</span>
                        <span className="font-mono font-bold text-gray-900">{bvCodigo || '—'}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Tipo:</span>
                        <span className="font-bold text-gray-900 flex items-center gap-2">
                          <Thermometer className="w-4 h-4 text-cyan-500" />
                          {(ETIQUETAS_TIPO_HIELO as any)[tipoHielo] ?? String(tipoHielo)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Cantidad:</span>
                        <span className="px-3 py-1 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-full font-bold">
                          {cantidadUI === '—' ? '—' : `${cantidadUI} unidades`}
                        </span>
                      </div>

                      {!!ultimaSeleccionada && (
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Última:
                          </span>
                          <span>{fmtDateTime(ultimaSeleccionada)}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Renglones:</span>
                        <span className="font-bold text-gray-900">{items.length}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Total unidades:</span>
                        <span className="px-3 py-1 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-full font-bold">
                          {totalUnidades}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-xs text-gray-500">
                  {supportsHookBatch ? (
                    <>Batch hook habilitado.</>
                  ) : (
                    <>
                      Hook batch no detectado. Se usará <b>ProductionService.registrarSalidaStockBatch()</b> (funcional).
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {openConfirm && (
        <ModalShell
          title={modoBatch ? 'Confirmar salida (una sola salida)' : 'Confirmar salida'}
          onClose={() => setOpenConfirm(false)}
          tone="purple"
        >
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-amber-50 to-white rounded-xl border border-amber-200 p-4">
              <h4 className="font-bold text-gray-900 mb-2">¿Quién está registrando?</h4>
              <p className="text-sm text-gray-700">
                Empleado:{' '}
                <span className="font-semibold">
                  {empleadoNombre} ({empleadoCodigo || '—'})
                </span>
              </p>
              <p className="text-sm text-gray-700 mt-1">
                Máquina: <span className="font-semibold">{maquina}</span>
              </p>
            </div>

            <div className="bg-gradient-to-r from-cyan-50 to-white rounded-xl border border-cyan-200 p-4">
              <h4 className="font-bold text-gray-900 mb-2">Destinatario</h4>
              <p className="text-lg text-gray-800">{destinatarioFinal || '(sin destinatario)'}</p>
              <p className="text-xs text-gray-500 mt-1">
                Tipo: <b>{subtipo}</b>
              </p>
            </div>

            {modoBatch ? (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-sm font-semibold text-gray-900 mb-2">Renglones</div>
                <div className="text-sm text-gray-700">
                  <b>{items.length}</b> renglones · <b>{totalUnidades}</b> unidades
                </div>

                <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-left text-gray-500">
                        <th className="py-2 px-3">BV</th>
                        <th className="py-2 px-3">Tipo</th>
                        <th className="py-2 px-3 text-right">Cant.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map((it) => (
                        <tr key={it.id}>
                          <td className="py-2 px-3 font-mono font-semibold">{it.bolsaVaciaCodigo}</td>
                          <td className="py-2 px-3">
                            {(ETIQUETAS_TIPO_HIELO as any)[it.tipoHielo] ?? String(it.tipoHielo)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold">{it.cantidad}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-sm font-semibold text-gray-900 mb-2">Salida</div>
                <div className="text-sm text-gray-700">
                  BV <b className="font-mono">{bvCodigo || '—'}</b> ·{' '}
                  {(ETIQUETAS_TIPO_HIELO as any)[tipoHielo] ?? String(tipoHielo)} · <b>{cantidadUI}</b>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4 border-t border-gray-100">
              <button
                onClick={() => setOpenConfirm(false)}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                disabled={submitting}
                type="button"
              >
                <X className="h-4 w-4" />
                Cancelar
              </button>

              <button
                onClick={onRegistrar}
                disabled={!canSubmit || submitting}
                className={[
                  'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-white font-medium shadow-lg transition-all',
                  !canSubmit || submitting
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700',
                ].join(' ')}
                type="button"
              >
                {submitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    Registrando…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Confirmar y registrar
                  </>
                )}
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      <SlideOver open={openChoferes} onClose={() => setOpenChoferes(false)} title="Seleccionar transporte">
        <div className="space-y-4">
          <div className="relative">
            <Search className="h-4 w-4 text-cyan-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={qChofer}
              onChange={(e) => setQChofer(e.target.value)}
              placeholder="Buscar por nombre/código…"
              className="w-full pl-9 pr-3 py-3 rounded-xl border border-cyan-300 bg-white text-sm"
            />
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={cargarChoferes}
              disabled={choferesLoading}
              className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl border border-cyan-200 bg-white text-cyan-700 hover:bg-cyan-50"
              type="button"
            >
              {choferesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Recargar
            </button>
          </div>

          {!!choferesErr && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600 mt-0.5" />
                <p className="text-sm text-rose-800">{choferesErr}</p>
              </div>
            </div>
          )}

          {choferesLoading && !choferesErr && (
            <div className="flex items-center justify-center py-8">
              <div className="relative">
                <div className="w-12 h-12 border-4 border-cyan-100 rounded-full"></div>
                <div className="absolute top-0 left-0 w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            </div>
          )}

          {!choferesLoading && !choferesErr && !choferesFiltrados.length && (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cyan-100 flex items-center justify-center">
                <Users className="w-8 h-8 text-cyan-400" />
              </div>
              <p className="font-medium text-gray-900">No hay empleados de transporte</p>
              <p className="text-sm text-gray-500 mt-1">No se encontraron empleados activos.</p>
            </div>
          )}

          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {choferesFiltrados.map((c) => {
              const active = chofer?.id === c.id;

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setChofer(c);
                    setOpenChoferes(false);
                  }}
                  className={[
                    'w-full text-left rounded-2xl p-4 transition-all',
                    active
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg'
                      : 'bg-white border border-gray-200 hover:border-cyan-300 hover:shadow-md',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                          active ? 'bg-white/20' : 'bg-gradient-to-br from-cyan-500 to-blue-500'
                        }`}
                      >
                        <Truck className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <div className={`font-semibold ${active ? 'text-white' : 'text-gray-900'}`}>{c.nombre}</div>
                        <div className={`text-sm ${active ? 'text-cyan-100' : 'text-gray-500'}`}>
                          Código: {c.codigo}
                        </div>
                      </div>
                    </div>
                    {active ? (
                      <CheckCircle2 className="h-5 w-5 text-white" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </SlideOver>
    </div>
  );
}