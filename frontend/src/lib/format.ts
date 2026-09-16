export const TRADES = [
  { key: "mieszane", label: "Mieszane" },
  { key: "elektryka", label: "Elektryka" },
  { key: "hydraulika", label: "Hydraulika" },
  { key: "wykonczenia", label: "Wykończenia" },
  { key: "ogolnobudowlana", label: "Ogólnobud." },
];

export function tradeLabel(key: string): string {
  return TRADES.find((t) => t.key === key)?.label ?? "Mieszane";
}

export const KIND_LABELS: Record<string, string> = {
  material: "Materiał",
  labor: "Robocizna",
  extra: "Dodatkowe",
};

export const KINDS = [
  { key: "material", label: "Materiał" },
  { key: "labor", label: "Robocizna" },
  { key: "extra", label: "Dodatkowe" },
];

export const UNITS = ["szt", "m", "mb", "m2", "m3", "kg", "l", "opak", "kpl", "godz", "pkt"];

export function pln(n: number | undefined | null): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const neg = v < 0;
  const abs = Math.abs(v);
  const [int, dec] = abs.toFixed(2).split(".");
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
  return (neg ? "-" : "") + withSep + "," + dec + "\u00A0zł";
}

export function num(n: number | undefined | null): string {
  const v = Number(n) || 0;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(".", ",");
}

export function statusLabel(s: string): string {
  return { draft: "Szkic", sent: "Wysłana", accepted: "Zaakceptowana" }[s] ?? s;
}
