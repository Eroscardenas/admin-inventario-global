"use client";

// app/produccion/dashboard/page.tsx
// ✅ PRODUCCIÓN / LLENAR — COMPLETO
// Flujo correcto:
// 1) Admin da de alta bolsas vacías en almacén.
// 2) Admin asigna bolsas vacías a producción y AHÍ se descuenta almacén.
// 3) Producción llena SOLO desde sus asignaciones pendientes.
// 4) Producción NO valida ni descuenta contra productos.cantidad del almacén.

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/context/AuthContext";

import type {
  BolsaProduct,
  IceType,
  MaquinaId,
} from "@/lib/utils/types/product.types";
import {
  TIPOS_HIELO,
  ETIQUETAS_TIPO_HIELO,
  MAQUINAS,
} from "@/lib/utils/types/product.types";

import { useMyAssignments } from "@/lib/hooks/useMyAssignaments";
import { useProductionStock } from "@/lib/hooks/useProductionStock";
import { ProductionService } from "@/lib/services/production.service";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/config.client";

import {
  ArrowLeft,
  Droplets,
  BadgeCheck,
  CheckCircle2,
  AlertTriangle,
  Boxes,
  Factory,
  BarChart3,
  Package,
  Thermometer,
  ChevronRight,
  Zap,
  Layers,
  Eye,
  FolderTree,
  List,
  ChevronDown,
} from "lucide-react";

type BarraUI = {
  codigo: string;
  nombre: string;
  cuartosDisponibles: number;
};

type StockTipoUI = {
  tipoHielo: IceType;
  stockActual: number;
  stockMinimo: number;
  stockMaximo: number;
};

type StockProductoUI = {
  bolsaVaciaCodigo: string;
  productoNombre: string;
  pesoKg?: number | null;
  totalLlenas: number;
  bolsasVaciasDisponibles: number;
  tipos: StockTipoUI[];
};

type AsignacionUI = {
  id: string;
  productoCodigo: string;
  productoNombre: string;
  cantidad: number;
  pesoKg?: number | null;
  turno?: string | null;
  tipoHielo?: IceType | string | null;
  cosechaId?: string | null;
  cosechaCodigo?: string | null;
};

type CosechaGroup = {
  cosechaKey: string;
  cosechaId?: string;
  cosechaCodigo?: string;
  totalItems: number;
  totalBolsas: number;
  items: AsignacionUI[];
};

const safeNum = (n: any, f = 0) => (Number.isFinite(Number(n)) ? Number(n) : f);

const safeInt = (n: any, f = 0) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return f;
  const i = Math.floor(v);
  return i < 0 ? f : i;
};

const pct = (v: number, m: number) =>
  m > 0 ? Math.min(100, Math.max(0, (v / m) * 100)) : 0;
const normCode = (v: any) =>
  String(v ?? "")
    .trim()
    .toUpperCase();

function getTiposConfigurados(bv: BolsaProduct | any): IceType[] {
  const a = bv?.configuracionAdmin?.tiposHieloConfigurados;
  if (Array.isArray(a) && a.length) return a as IceType[];

  const b = bv?.configuracionEspecifica?.tiposHieloHabilitados;
  if (Array.isArray(b) && b.length) return b as IceType[];

  const c = bv?.tiposHieloPermitidos;
  if (Array.isArray(c) && c.length) return c as IceType[];

  return [...TIPOS_HIELO];
}

function Modal({
  open,
  title,
  onClose,
  children,
  maxW = "max-w-xl",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxW?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          className={`w-full ${maxW} bg-white rounded-3xl shadow-2xl border border-gray-200 animate-in slide-in-from-bottom-4 duration-300`}
        >
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-xl">
                <Package className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-lg">{title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">Producción</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-50 transition-all duration-200"
              aria-label="Cerrar"
              type="button"
            >
              <div className="relative w-5 h-5 flex items-center justify-center">
                <div className="w-5 h-0.5 bg-gray-500 rotate-45 absolute" />
                <div className="w-5 h-0.5 bg-gray-500 -rotate-45 absolute" />
              </div>
            </button>
          </div>

          <div className="p-6 max-h-[70vh] overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function ProductionFillPage() {
  const router = useRouter();
  const { productionSession, isProductionLoggedIn, loading } = useAuthContext();

  useEffect(() => {
    if (loading) return;
    if (!isProductionLoggedIn || !productionSession) {
      router.replace("/login?mode=empleado");
    }
  }, [loading, isProductionLoggedIn, productionSession, router]);

  const empleadoCodigo = productionSession?.codigo;
  const empleadoNombre = productionSession?.nombre;

  const {
    asignaciones,
    loading: loadingAsig,
    error: asigError,
  } = useMyAssignments(empleadoCodigo);
  const {
    bolsasVacias,
    stockLlenoPorProducto,
    loading: loadingStock,
    error: stockError,
  } = useProductionStock();

  const [barras, setBarras] = useState<BarraUI[]>([]);

  useEffect(() => {
    const qy = query(collection(db, "productos"), where("tipo", "==", "BARRA"));

    const unsub = onSnapshot(qy, (snap) => {
      const list: BarraUI[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          codigo: String(data.codigo ?? d.id),
          nombre: String(data.nombre ?? "Barra"),
          cuartosDisponibles: safeInt(data.cuartosDisponibles, 0),
        };
      });

      list.sort((a, b) => a.codigo.localeCompare(b.codigo));
      setBarras(list);
    });

    return () => unsub();
  }, []);

  const asignacionesUI = useMemo<AsignacionUI[]>(() => {
    return (asignaciones ?? []).map((a: any) => ({
      id: String(a.id ?? ""),
      productoCodigo: String(a.productoCodigo ?? ""),
      productoNombre: String(a.productoNombre ?? "Producto"),
      cantidad: safeInt(a.cantidad, 0),
      pesoKg: a.pesoKg != null ? safeNum(a.pesoKg, 0) : null,
      turno: a.turno ?? null,
      tipoHielo: a.tipoHielo ?? null,
      cosechaId: a.cosechaId ?? null,
      cosechaCodigo: a.cosechaCodigo ?? null,
    }));
  }, [asignaciones]);

  const cosechas = useMemo<CosechaGroup[]>(() => {
    const map = new Map<string, CosechaGroup>();

    for (const a of asignacionesUI) {
      const cosechaKey =
        String(a.cosechaId || "").trim() ||
        String(a.cosechaCodigo || "").trim() ||
        "SIN_COSECHA";

      if (!map.has(cosechaKey)) {
        map.set(cosechaKey, {
          cosechaKey,
          cosechaId: a.cosechaId ? String(a.cosechaId) : undefined,
          cosechaCodigo: a.cosechaCodigo ? String(a.cosechaCodigo) : undefined,
          totalItems: 0,
          totalBolsas: 0,
          items: [],
        });
      }

      const g = map.get(cosechaKey)!;
      g.items.push(a);
      g.totalItems += 1;
      g.totalBolsas += safeInt(a.cantidad, 0);
    }

    const list = Array.from(map.values());

    list.sort((a, b) => {
      if (a.cosechaKey === "SIN_COSECHA" && b.cosechaKey !== "SIN_COSECHA")
        return 1;
      if (b.cosechaKey === "SIN_COSECHA" && a.cosechaKey !== "SIN_COSECHA")
        return -1;
      return String(b.cosechaCodigo ?? b.cosechaKey).localeCompare(
        String(a.cosechaCodigo ?? a.cosechaKey),
      );
    });

    for (const g of list) {
      g.items.sort((x, y) =>
        `${x.productoNombre}-${x.productoCodigo}`.localeCompare(
          `${y.productoNombre}-${y.productoCodigo}`,
        ),
      );
    }

    return list;
  }, [asignacionesUI]);

  const hayCosechasReales = useMemo(
    () => cosechas.some((c) => c.cosechaKey !== "SIN_COSECHA"),
    [cosechas],
  );

  const [leftView, setLeftView] = useState<"ITEMS" | "COSECHAS">("ITEMS");
  const [filtroCosechaKey, setFiltroCosechaKey] = useState<string>("TODAS");
  const [openCosechas, setOpenCosechas] = useState<Record<string, boolean>>({});
  const [showCosechaDetail, setShowCosechaDetail] =
    useState<CosechaGroup | null>(null);

  const toggleCosecha = (key: string) =>
    setOpenCosechas((s) => ({ ...s, [key]: !s[key] }));

  const asignacionesFiltradas = useMemo(() => {
    if (!hayCosechasReales) return asignacionesUI;
    if (filtroCosechaKey === "TODAS") return asignacionesUI;
    if (filtroCosechaKey === "SIN_COSECHA")
      return asignacionesUI.filter((a) => !a.cosechaId && !a.cosechaCodigo);
    return asignacionesUI.filter(
      (a) =>
        String(a.cosechaId || a.cosechaCodigo || "SIN_COSECHA") ===
        filtroCosechaKey,
    );
  }, [asignacionesUI, filtroCosechaKey, hayCosechasReales]);

  const [selectedAsigId, setSelectedAsigId] = useState<string>("");

  useEffect(() => {
    if (selectedAsigId) return;

    if (leftView === "ITEMS") {
      if (asignacionesFiltradas.length > 0)
        setSelectedAsigId(asignacionesFiltradas[0].id);
      return;
    }

    const firstGroup = cosechas[0];
    if (firstGroup?.items?.length) setSelectedAsigId(firstGroup.items[0].id);
  }, [leftView, asignacionesFiltradas, cosechas, selectedAsigId]);

  useEffect(() => {
    if (!selectedAsigId) return;
    const exists = asignacionesUI.some((a) => a.id === selectedAsigId);
    if (!exists) setSelectedAsigId("");
  }, [asignacionesUI, selectedAsigId]);

  const selectedAsig = useMemo(
    () => asignacionesUI.find((a) => a.id === selectedAsigId) ?? null,
    [asignacionesUI, selectedAsigId],
  );

  const selectedAsigCosecha = useMemo(() => {
    if (!selectedAsig) return null;
    const key = String(
      selectedAsig.cosechaId || selectedAsig.cosechaCodigo || "SIN_COSECHA",
    );
    return cosechas.find((c) => c.cosechaKey === key) ?? null;
  }, [selectedAsig, cosechas]);

  const selectedBV = useMemo(() => {
    if (!selectedAsig) return null;
    const target = normCode(selectedAsig.productoCodigo);

    return (
      (bolsasVacias as any[]).find((b: any) => {
        const c1 = normCode(b?.codigo);
        const c2 = normCode(b?.productoCodigo);
        const c3 = normCode(b?.id);
        const c4 = normCode(b?.docId);
        return [c1, c2, c3, c4].includes(target);
      }) ?? null
    );
  }, [bolsasVacias, selectedAsig]);

  const tiposPermitidos = useMemo<IceType[]>(() => {
    if (!selectedBV) return [...TIPOS_HIELO];
    return getTiposConfigurados(selectedBV as BolsaProduct);
  }, [selectedBV]);

  const selectedStock = useMemo<StockProductoUI | null>(() => {
    if (!selectedAsig) return null;
    const target = normCode(selectedAsig.productoCodigo);

    const found =
      (stockLlenoPorProducto as any[]).find((p: any) => {
        const c1 = normCode(p?.bolsaVaciaCodigo);
        const c2 = normCode(p?.productoCodigo);
        const c3 = normCode(p?.codigo);
        const c4 = normCode(p?.id);
        return [c1, c2, c3, c4].includes(target);
      }) ?? null;

    if (!found) return null;

    const tiposRaw: any[] = Array.isArray(found.tipos) ? found.tipos : [];
    const tipos: StockTipoUI[] = tiposRaw
      .map((t) => ({
        tipoHielo: String(t?.tipoHielo ?? "") as IceType,
        stockActual: safeNum(t?.stockActual, 0),
        stockMinimo: safeNum(t?.stockMinimo, 0),
        stockMaximo: safeNum(t?.stockMaximo, 0),
      }))
      .filter((t) => !!t.tipoHielo);

    return {
      bolsaVaciaCodigo: String(found.bolsaVaciaCodigo ?? ""),
      productoNombre: String(found.productoNombre ?? ""),
      pesoKg: found.pesoKg != null ? safeNum(found.pesoKg, 0) : null,
      totalLlenas: safeNum(found.totalLlenas, 0),
      bolsasVaciasDisponibles: safeNum(found.bolsasVaciasDisponibles, 0),
      tipos,
    };
  }, [stockLlenoPorProducto, selectedAsig]);

  const carouselCards = useMemo(() => {
    if (!selectedAsig || !selectedBV) return [];

    const tiposSet = new Set(tiposPermitidos);
    const baseProductoNombre =
      selectedStock?.productoNombre ||
      selectedAsig.productoNombre ||
      "Producto";
    const basePesoKg = selectedStock?.pesoKg ?? selectedAsig.pesoKg ?? null;
    const totalProducto = safeNum(selectedStock?.totalLlenas, 0);
    const tiposFromStock = Array.isArray(selectedStock?.tipos)
      ? selectedStock!.tipos
      : [];

    const tiposList: StockTipoUI[] =
      tiposFromStock.length > 0
        ? tiposFromStock
        : tiposPermitidos.map((t) => ({
            tipoHielo: t,
            stockActual: 0,
            stockMinimo: 0,
            stockMaximo: 0,
          }));

    return tiposList
      .filter((t) => tiposSet.has(t.tipoHielo))
      .map((t) => {
        const actual = safeNum(t.stockActual, 0);
        const min = safeNum(t.stockMinimo, 0);
        const max = safeNum(t.stockMaximo, 0);

        return {
          key: `${selectedAsig.productoCodigo}-${t.tipoHielo}`,
          codigo: selectedAsig.productoCodigo,
          nombre: baseProductoNombre,
          pesoKg: basePesoKg,
          tipoHielo: t.tipoHielo,
          actual,
          min,
          max,
          ok: max > 0 ? actual >= min : true,
          totalProducto,
          asignadoPendiente: safeInt(selectedAsig.cantidad, 0),
          hasRealStock: !!selectedStock,
        };
      });
  }, [selectedAsig, selectedBV, selectedStock, tiposPermitidos]);

  const [openFill, setOpenFill] = useState(false);
  const [fillTipo, setFillTipo] = useState<IceType>("ROLITO");
  const [fillCantidad, setFillCantidad] = useState<number | "">("");
  const [fillBarraCodigo, setFillBarraCodigo] = useState<string>("");
  const [fillMaquina, setFillMaquina] = useState<MaquinaId | "">("");
  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const barrasDisponibles = useMemo(
    () => barras.filter((b) => b.cuartosDisponibles > 0),
    [barras],
  );

  useEffect(() => {
    if (!selectedBV) return;
    const first = tiposPermitidos[0] ?? "ROLITO";
    setFillTipo(first);
    setFillCantidad("");
    setFillBarraCodigo("");
    setFillMaquina("");
  }, [selectedBV, tiposPermitidos]);

  useEffect(() => {
    if (fillTipo !== "BARRA") return;
    if (fillBarraCodigo) return;
    if (barrasDisponibles.length === 1)
      setFillBarraCodigo(barrasDisponibles[0].codigo);
  }, [fillTipo, fillBarraCodigo, barrasDisponibles]);

  const openFillModal = (tipo: IceType) => {
    if (!selectedAsig) return;
    setOkMsg(null);
    setErrMsg(null);
    setFillTipo(tipo);
    setFillCantidad("");
    setFillBarraCodigo("");
    setFillMaquina("");
    setOpenFill(true);
  };

  const submitFill = async () => {
    setOkMsg(null);
    setErrMsg(null);

    if (!productionSession) return;
    if (!selectedAsig) return setErrMsg("Selecciona una asignación.");
    if (!selectedBV) return setErrMsg("No se encontró la BV del producto.");

    const cantidad = safeInt(fillCantidad as any, 0);
    if (!Number.isFinite(cantidad) || cantidad <= 0)
      return setErrMsg("Ingresa una cantidad válida.");
    if (!fillMaquina) return setErrMsg("Selecciona la máquina.");

    const maxAsig = safeInt(selectedAsig.cantidad, 0);
    if (cantidad > maxAsig)
      return setErrMsg(
        `No puedes llenar más de lo asignado. Asignado: ${maxAsig}`,
      );

    // ✅ IMPORTANTE:
    // Aquí YA NO validamos contra bolsas vacías físicas de almacén.
    // Admin ya descontó almacén al crear la asignación.
    // Producción solo debe validar contra selectedAsig.cantidad.

    if (fillTipo === "BARRA") {
      if (!fillBarraCodigo) return setErrMsg("Selecciona la barra origen.");
      const br = barrasDisponibles.find((b) => b.codigo === fillBarraCodigo);
      if (!br) return setErrMsg("La barra seleccionada no es válida.");
      if (br.cuartosDisponibles < cantidad) {
        return setErrMsg(
          `La barra no tiene cuartos suficientes. Disponibles: ${br.cuartosDisponibles}`,
        );
      }
    }

    try {
      setSaving(true);

      await ProductionService.llenarDesdeAsignacion({
        asignacionId: selectedAsig.id,
        bolsaVaciaCodigo: selectedAsig.productoCodigo,
        productoNombre: selectedAsig.productoNombre,
        tipoHielo: fillTipo,
        cantidad,
        barraOrigenCodigo: fillTipo === "BARRA" ? fillBarraCodigo : undefined,

        empleadoCodigo: empleadoCodigo ?? "EMP",
        empleadoNombre: empleadoNombre ?? "Empleado",

        usuarioCodigo: productionSession.codigo,
        usuarioNombre: productionSession.nombre,

        origen: "PRODUCCION",
        maquina: fillMaquina,

        // ✅ Producción llena desde asignaciones.
        // NO debe validar ni descontar productos.cantidad de almacén.
        descontarBolsaVaciaFisica: false,
      });

      setOkMsg(
        `Listo: +${cantidad} en ${ETIQUETAS_TIPO_HIELO[fillTipo]} (Máquina ${fillMaquina})`,
      );
      setOpenFill(false);
    } catch (e: any) {
      setErrMsg(e?.message ?? "Error registrando llenado");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !productionSession) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-cyan-50 to-blue-50">
      <div className="container mx-auto px-4 py-8">
        <div className="bg-gradient-to-r from-white to-cyan-50 rounded-3xl border border-cyan-200/50 shadow-xl p-6 mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600 shadow-lg transition-all"
                type="button"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-2xl shadow-lg">
                  <Factory className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <Droplets className="h-5 w-5 text-cyan-600" />
                    <h1 className="text-2xl font-bold text-gray-900">
                      Llenado de Producción
                    </h1>
                  </div>
                  <p className="text-gray-600 mt-1">
                    Asignaciones{" "}
                    <ChevronRight className="w-4 h-4 inline mx-1" /> Stock lleno
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-gray-600">Operario</p>
                <p className="text-lg font-bold text-cyan-700">
                  {productionSession.nombre}
                </p>
                <p className="text-xs text-gray-500 font-mono">
                  {productionSession.codigo}
                </p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
                <Package className="w-5 h-5 text-white" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {(loadingAsig || loadingStock) && (
            <div className="col-span-full bg-white rounded-2xl border border-cyan-200 p-6 shadow-lg">
              <div className="flex items-center justify-center gap-4">
                <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                <div>
                  <p className="font-medium text-gray-900">
                    Cargando datos del sistema...
                  </p>
                  <p className="text-sm text-gray-500">
                    Sincronizando información en tiempo real
                  </p>
                </div>
              </div>
            </div>
          )}

          {(asigError || stockError) && (
            <div className="col-span-full bg-gradient-to-r from-white to-rose-50 rounded-2xl border border-rose-200 p-6 shadow-lg">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-r from-rose-500 to-rose-600 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-rose-800">Error del Sistema</p>
                  <p className="text-rose-600 mt-1">
                    {asigError || stockError}
                  </p>
                </div>
              </div>
            </div>
          )}

          {okMsg && (
            <div className="col-span-full bg-gradient-to-r from-emerald-50 to-cyan-50 rounded-2xl border border-emerald-200 p-6 shadow-lg">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-emerald-800">
                    Operación Exitosa
                  </p>
                  <p className="text-emerald-700 mt-1">{okMsg}</p>
                </div>
              </div>
            </div>
          )}

          {errMsg && (
            <div className="col-span-full bg-gradient-to-r from-rose-50 to-purple-50 rounded-2xl border border-rose-200 p-6 shadow-lg">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-r from-rose-500 to-purple-600 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-rose-800">
                    Validación Requerida
                  </p>
                  <p className="text-rose-700 mt-1">{errMsg}</p>
                  <p className="text-sm text-rose-600 mt-2">
                    Revisa los datos y vuelve a intentar
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-1">
            <div className="bg-gradient-to-b from-white to-cyan-50 rounded-3xl border border-cyan-200/50 shadow-xl p-6 h-full">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-xl">
                  <Boxes className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900">
                    Asignaciones
                  </h2>
                  <p className="text-sm text-gray-500">
                    {leftView === "ITEMS"
                      ? "Lista por item"
                      : "Agrupado por cosecha"}
                  </p>
                </div>
                <span className="ml-auto px-3 py-1 bg-cyan-100 text-cyan-800 rounded-full text-sm font-semibold">
                  {leftView === "ITEMS"
                    ? asignacionesFiltradas.length
                    : cosechas.length}
                </span>
              </div>

              <div className="mb-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLeftView("ITEMS")}
                  className={`px-3 py-2.5 rounded-2xl border text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                    leftView === "ITEMS"
                      ? "bg-gradient-to-r from-cyan-500 to-blue-500 text-white border-cyan-500 shadow-lg"
                      : "bg-white border-gray-200 text-gray-800 hover:border-cyan-300"
                  }`}
                >
                  <List className="w-4 h-4" />
                  Items
                </button>
                <button
                  type="button"
                  onClick={() => setLeftView("COSECHAS")}
                  className={`px-3 py-2.5 rounded-2xl border text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                    leftView === "COSECHAS"
                      ? "bg-gradient-to-r from-cyan-500 to-blue-500 text-white border-cyan-500 shadow-lg"
                      : "bg-white border-gray-200 text-gray-800 hover:border-cyan-300"
                  }`}
                >
                  <FolderTree className="w-4 h-4" />
                  Cosechas
                </button>
              </div>

              {leftView === "ITEMS" && (
                <>
                  {hayCosechasReales && (
                    <div className="mb-5 bg-white rounded-2xl border border-cyan-200/60 p-3 shadow-sm">
                      <div className="text-xs text-gray-500 mb-2">
                        Filtro por cosecha
                      </div>
                      <select
                        value={filtroCosechaKey}
                        onChange={(e) => setFiltroCosechaKey(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-cyan-200 bg-white text-gray-900 outline-none focus:ring-2 focus:ring-cyan-200"
                      >
                        <option value="TODAS">Todas</option>
                        {cosechas
                          .filter((c) => c.cosechaKey !== "SIN_COSECHA")
                          .map((c) => (
                            <option key={c.cosechaKey} value={c.cosechaKey}>
                              {c.cosechaCodigo ?? c.cosechaId ?? c.cosechaKey} ·{" "}
                              {c.totalItems} items · {c.totalBolsas} bolsas
                            </option>
                          ))}
                        <option value="SIN_COSECHA">Sin cosecha</option>
                      </select>

                      {selectedAsigCosecha &&
                        selectedAsigCosecha.cosechaKey !== "SIN_COSECHA" && (
                          <button
                            type="button"
                            onClick={() =>
                              setShowCosechaDetail(selectedAsigCosecha)
                            }
                            className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-cyan-200 bg-gradient-to-r from-cyan-50 to-blue-50 text-cyan-800 font-semibold hover:from-cyan-100 hover:to-blue-100 transition-all"
                          >
                            <Eye className="w-4 h-4" />
                            Ver detalle de cosecha
                          </button>
                        )}
                    </div>
                  )}

                  {!asignacionesFiltradas.length && !loadingAsig && (
                    <div className="text-center py-10">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center">
                        <Boxes className="w-8 h-8 text-cyan-400" />
                      </div>
                      <p className="text-gray-700 font-medium">
                        No hay asignaciones pendientes
                      </p>
                      <p className="text-gray-500 text-sm mt-1">
                        Espera nuevas tareas de producción
                      </p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {asignacionesFiltradas.map((a) => {
                      const active = a.id === selectedAsigId;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setSelectedAsigId(a.id)}
                          className={`w-full text-left rounded-2xl border p-4 transition-all ${
                            active
                              ? "bg-gradient-to-r from-cyan-500 to-blue-500 text-white border-cyan-500 shadow-lg"
                              : "bg-white border-gray-200 text-gray-900 hover:border-cyan-300 hover:shadow-md"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-bold truncate">
                                {a.productoNombre}
                              </p>
                              <p
                                className={`text-xs font-mono mt-1 ${active ? "text-cyan-50" : "text-gray-500"}`}
                              >
                                {a.productoCodigo}
                              </p>
                              {(a.cosechaCodigo || a.cosechaId) && (
                                <p
                                  className={`text-xs mt-1 ${active ? "text-cyan-50" : "text-cyan-700"}`}
                                >
                                  Cosecha: {a.cosechaCodigo ?? a.cosechaId}
                                </p>
                              )}
                            </div>
                            <div
                              className={`px-3 py-1 rounded-full font-bold ${active ? "bg-white/20 text-white" : "bg-cyan-100 text-cyan-800"}`}
                            >
                              {safeInt(a.cantidad, 0)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {leftView === "COSECHAS" && (
                <div className="space-y-3">
                  {!cosechas.length && !loadingAsig && (
                    <div className="text-center py-10">
                      <FolderTree className="w-10 h-10 text-cyan-300 mx-auto mb-3" />
                      <p className="text-gray-700 font-medium">
                        No hay cosechas pendientes
                      </p>
                    </div>
                  )}

                  {cosechas.map((c) => {
                    const open = openCosechas[c.cosechaKey] ?? true;
                    return (
                      <div
                        key={c.cosechaKey}
                        className="rounded-2xl border border-cyan-200 bg-white overflow-hidden shadow-sm"
                      >
                        <button
                          type="button"
                          onClick={() => toggleCosecha(c.cosechaKey)}
                          className="w-full p-4 flex items-center justify-between gap-3 hover:bg-cyan-50 transition-all"
                        >
                          <div className="text-left min-w-0">
                            <p className="font-bold text-gray-900 truncate">
                              {c.cosechaKey === "SIN_COSECHA"
                                ? "Sin cosecha"
                                : (c.cosechaCodigo ??
                                  c.cosechaId ??
                                  c.cosechaKey)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {c.totalItems} items · {c.totalBolsas} bolsas
                            </p>
                          </div>
                          <ChevronDown
                            className={`w-5 h-5 text-cyan-600 transition-transform ${open ? "rotate-180" : ""}`}
                          />
                        </button>

                        {open && (
                          <div className="p-3 pt-0 space-y-2">
                            {c.items.map((a) => {
                              const active = a.id === selectedAsigId;
                              return (
                                <button
                                  key={a.id}
                                  type="button"
                                  onClick={() => setSelectedAsigId(a.id)}
                                  className={`w-full text-left rounded-xl border p-3 transition-all ${
                                    active
                                      ? "bg-gradient-to-r from-cyan-500 to-blue-500 text-white border-cyan-500"
                                      : "bg-gray-50 border-gray-200 text-gray-900 hover:border-cyan-300"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="font-bold text-sm truncate">
                                        {a.productoNombre}
                                      </p>
                                      <p
                                        className={`text-xs font-mono ${active ? "text-cyan-50" : "text-gray-500"}`}
                                      >
                                        {a.productoCodigo}
                                      </p>
                                    </div>
                                    <span
                                      className={`px-2 py-1 rounded-full text-xs font-bold ${active ? "bg-white/20 text-white" : "bg-cyan-100 text-cyan-800"}`}
                                    >
                                      {safeInt(a.cantidad, 0)}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}

                            <button
                              type="button"
                              onClick={() => setShowCosechaDetail(c)}
                              className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-cyan-200 bg-cyan-50 text-cyan-800 font-semibold hover:bg-cyan-100 transition-all"
                            >
                              <Eye className="w-4 h-4" />
                              Ver detalle
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="bg-gradient-to-b from-white to-cyan-50 rounded-3xl border border-cyan-200/50 shadow-xl p-6 min-h-[620px]">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl">
                    <BarChart3 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">
                      Stock por Tipo de Hielo
                    </h2>
                    <p className="text-sm text-gray-500">
                      Producción llena desde asignaciones, no desde almacén
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-cyan-50 rounded-xl border border-cyan-200">
                  <Zap className="w-4 h-4 text-cyan-600" />
                  <span className="text-sm font-medium text-cyan-700">
                    {carouselCards.length} tipos activos
                  </span>
                </div>
              </div>

              {!selectedAsig && (
                <div className="text-center py-12">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center">
                    <BadgeCheck className="w-10 h-10 text-cyan-400" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">
                    Selecciona una Asignación
                  </h3>
                  <p className="text-gray-600 max-w-md mx-auto">
                    Elige una bolsa en el panel izquierdo para comenzar el
                    llenado.
                  </p>
                </div>
              )}

              {!!selectedAsig && !selectedBV && (
                <div className="bg-gradient-to-r from-amber-50 to-amber-100 rounded-2xl border border-amber-200 p-6 mb-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-r from-amber-500 to-amber-600 rounded-xl">
                      <AlertTriangle className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-amber-800">
                        Bolsa no encontrada
                      </p>
                      <p className="text-amber-700 mt-1">
                        No se encontró la bolsa vacía para{" "}
                        <b>{selectedAsig.productoCodigo}</b>.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {!!selectedAsig && !!selectedBV && (
                <div className="relative">
                  <div className="flex gap-6 overflow-x-auto pb-6 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
                    {carouselCards.map((c) => (
                      <div
                        key={c.key}
                        className="min-w-[360px] bg-gradient-to-b from-white to-cyan-50 rounded-2xl border border-cyan-200 p-6 shadow-lg hover:shadow-xl transition-all duration-300 flex-shrink-0"
                      >
                        <div className="flex items-start justify-between gap-3 mb-6">
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <Thermometer className="w-5 h-5 text-cyan-500" />
                              <span className="font-bold text-gray-900 text-lg">
                                {c.pesoKg ?? "—"}kg ·{" "}
                                {ETIQUETAS_TIPO_HIELO[c.tipoHielo]}
                              </span>
                            </div>
                            <div className="text-sm text-cyan-600 bg-cyan-50 rounded-xl px-3 py-1.5 inline-block">
                              {c.nombre} · {c.codigo}
                            </div>
                          </div>

                          <div
                            className={`px-3 py-1.5 rounded-full font-bold ${c.ok ? "bg-emerald-500 text-white" : "bg-purple-500 text-white"}`}
                          >
                            {c.ok ? "OK" : "BAJO"}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mb-5">
                          <div className="rounded-xl bg-white border border-cyan-100 p-4">
                            <p className="text-xs text-gray-500">Stock lleno</p>
                            <p className="text-2xl font-black text-gray-900">
                              {safeNum(c.actual, 0)}
                            </p>
                          </div>
                          <div className="rounded-xl bg-white border border-cyan-100 p-4">
                            <p className="text-xs text-gray-500">
                              Asignado pendiente
                            </p>
                            <p className="text-2xl font-black text-cyan-700">
                              {safeInt(c.asignadoPendiente, 0)}
                            </p>
                          </div>
                        </div>

                        <div className="mb-5">
                          <div className="flex justify-between text-xs text-gray-500 mb-2">
                            <span>Min: {safeNum(c.min, 0)}</span>
                            <span>Max: {safeNum(c.max, 0)}</span>
                          </div>
                          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full"
                              style={{ width: `${pct(c.actual, c.max)}%` }}
                            />
                          </div>
                        </div>

                        <div className="space-y-3 mb-6">
                          <div className="bg-gradient-to-r from-cyan-50 to-white rounded-xl p-3 border border-cyan-200">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-cyan-700">
                                Total llenas del producto:
                              </span>
                              <span className="font-bold text-gray-900">
                                {safeNum(c.totalProducto, 0)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {!c.hasRealStock && (
                          <div className="mb-4 bg-gradient-to-r from-amber-50 to-amber-100 rounded-xl p-3 border border-amber-200">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                              <p className="text-sm text-amber-800">
                                No hay stock agregado encontrado. Mostrando
                                valores en 0 para operar.
                              </p>
                            </div>
                          </div>
                        )}

                        <button
                          onClick={() => openFillModal(c.tipoHielo)}
                          disabled={
                            !selectedAsig ||
                            safeInt(selectedAsig?.cantidad, 0) <= 0
                          }
                          className={`w-full rounded-xl py-3.5 font-bold transition-all duration-300 shadow-lg ${
                            !selectedAsig ||
                            safeInt(selectedAsig?.cantidad, 0) <= 0
                              ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                              : "bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-700 hover:to-blue-700 hover:shadow-xl"
                          }`}
                          type="button"
                        >
                          <div className="flex items-center justify-center gap-2">
                            <Package className="w-5 h-5" />
                            Llenar {ETIQUETAS_TIPO_HIELO[c.tipoHielo]}
                          </div>
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 bg-gradient-to-l from-white to-transparent flex items-center justify-center">
                    <ChevronRight className="w-6 h-6 text-cyan-400" />
                  </div>
                </div>
              )}

              {!!selectedAsig && !!selectedBV && !carouselCards.length && (
                <div className="text-center py-12">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center">
                    <Layers className="w-10 h-10 text-cyan-400" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">
                    Sin Tipos Configurados
                  </h3>
                  <p className="text-gray-600 max-w-md mx-auto">
                    Este producto no tiene tipos de hielo configurados.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={!!showCosechaDetail}
        title={`Detalle de cosecha: ${
          showCosechaDetail?.cosechaKey === "SIN_COSECHA"
            ? "Sin cosecha"
            : (showCosechaDetail?.cosechaCodigo ??
              showCosechaDetail?.cosechaId ??
              showCosechaDetail?.cosechaKey ??
              "")
        }`}
        onClose={() => setShowCosechaDetail(null)}
        maxW="max-w-2xl"
      >
        {!showCosechaDetail ? null : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-cyan-50 border border-cyan-200 p-4">
                <p className="text-xs text-cyan-700">Items</p>
                <p className="text-2xl font-black text-gray-900">
                  {showCosechaDetail.totalItems}
                </p>
              </div>
              <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4">
                <p className="text-xs text-blue-700">Bolsas pendientes</p>
                <p className="text-2xl font-black text-gray-900">
                  {showCosechaDetail.totalBolsas}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {showCosechaDetail.items.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setSelectedAsigId(a.id);
                    setShowCosechaDetail(null);
                  }}
                  className="w-full text-left rounded-2xl border border-gray-200 bg-white p-4 hover:border-cyan-300 hover:bg-cyan-50 transition-all"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900 truncate">
                        {a.productoNombre}
                      </p>
                      <p className="text-xs text-gray-500 font-mono">
                        {a.productoCodigo}
                      </p>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-cyan-100 text-cyan-800 font-bold">
                      {safeInt(a.cantidad, 0)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={openFill}
        title="Llenar Bolsas"
        onClose={() => setOpenFill(false)}
      >
        {!selectedAsig ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-cyan-400" />
            </div>
            <p className="text-gray-700 font-medium">
              Selecciona una asignación primero
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 p-4 bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl border border-cyan-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-cyan-500 to-cyan-600 rounded-lg">
                  <Package className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">
                    {selectedAsig.productoNombre}
                  </h4>
                  <p className="text-sm text-gray-600">
                    {selectedAsig.productoCodigo} ·{" "}
                    {selectedAsig.pesoKg != null
                      ? `${selectedAsig.pesoKg}kg`
                      : ""}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">
                    Disponible para llenar:
                  </span>
                  <span className="px-8 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-full font-bold">
                    {safeInt(selectedAsig.cantidad, 0)} unidades
                  </span>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <label className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-2">
                <Factory className="w-4 h-4 text-cyan-600" />
                Máquina de Producción
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {MAQUINAS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setFillMaquina(m)}
                    className={`px-4 py-3 rounded-xl border text-center transition-all duration-200 ${
                      fillMaquina === m
                        ? "bg-gradient-to-r from-cyan-500 to-blue-500 text-white border-cyan-500 shadow-lg"
                        : "bg-white text-gray-800 border-gray-200 hover:border-cyan-300 hover:bg-cyan-50"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <label className="text-sm font-medium text-gray-900 mb-2 block">
                Tipo de hielo
              </label>
              <select
                value={fillTipo}
                onChange={(e) => {
                  setFillTipo(e.target.value as IceType);
                  setFillBarraCodigo("");
                }}
                className="w-full px-4 py-3 rounded-xl border border-cyan-300 bg-white text-gray-900 outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 transition-all duration-200"
              >
                {tiposPermitidos.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETAS_TIPO_HIELO[t] ?? t}
                  </option>
                ))}
              </select>
            </div>

            {fillTipo === "BARRA" && (
              <div className="mb-6">
                <label className="text-sm font-medium text-gray-900 mb-2 block">
                  Barra origen
                </label>
                <select
                  value={fillBarraCodigo}
                  onChange={(e) => setFillBarraCodigo(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-purple-300 bg-white text-gray-900 outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 transition-all duration-200"
                >
                  <option value="">Selecciona una barra...</option>
                  {barrasDisponibles.map((b) => (
                    <option key={b.codigo} value={b.codigo}>
                      {b.nombre} · {b.codigo} · {b.cuartosDisponibles} cuartos
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-purple-600">
                  Regla: 1 cuarto por bolsa llenada
                </p>
              </div>
            )}

            <div className="mb-8">
              <label className="text-sm font-medium text-gray-900 mb-2 block">
                Cantidad a llenar
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  max={safeInt(selectedAsig.cantidad, 0)}
                  inputMode="numeric"
                  value={fillCantidad}
                  placeholder="Ingresar cantidad"
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") {
                      setFillCantidad("");
                      return;
                    }
                    setFillCantidad(safeInt(raw, 1));
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-cyan-300 bg-white text-gray-900 text-center text-lg font-bold outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 transition-all duration-200"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-500 font-medium">
                  unidades
                </div>
              </div>
              <div className="mt-2 flex justify-between items-center">
                <span className="text-xs text-gray-500">
                  Máximo asignado:{" "}
                  <b className="text-gray-900">
                    {safeInt(selectedAsig.cantidad, 0)}
                  </b>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setFillCantidad(safeInt(selectedAsig.cantidad, 0))
                  }
                  className="text-xs px-3 py-1 bg-cyan-100 text-cyan-700 rounded-lg hover:bg-cyan-200 transition-colors"
                >
                  Usar máximo
                </button>
              </div>
            </div>

            <button
              onClick={submitFill}
              disabled={saving || !fillMaquina}
              className={`w-full rounded-xl py-4 font-bold transition-all duration-300 shadow-lg ${
                saving || !fillMaquina
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-700 hover:to-blue-700 hover:shadow-xl"
              }`}
              type="button"
            >
              {saving ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                  Registrando llenado...
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  Confirmar Llenado
                </div>
              )}
            </button>
          </>
        )}
      </Modal>
    </div>
  );
}