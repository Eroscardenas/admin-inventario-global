// /src/utils/time.ts
export function tsToNumber(t: any): number {
  if (!t) return 0;
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t.seconds === "number") return t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6);
  return Number(t) || 0;
}

export function fmtDate(t: any): string {
  const n = tsToNumber(t);
  if (!n) return "-";
  return new Date(n).toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
