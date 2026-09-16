// Wspólna taksonomia branż (klucze zgodne z backendem seed_data.py / ai_service.TRADE_LABELS)
export type Trade = { key: string; label: string };

export const TRADES: Trade[] = [
  { key: "elektryka", label: "Elektryka" },
  { key: "teletechnika", label: "Teletechnika" },
  { key: "sieci_lan", label: "Sieci LAN" },
  { key: "cctv", label: "CCTV" },
  { key: "alarmy", label: "Alarmy" },
  { key: "kontrola_dostepu", label: "Kontrola dostępu" },
  { key: "domofony", label: "Domofony" },
  { key: "automatyka", label: "Automatyka" },
  { key: "pv", label: "Fotowoltaika" },
  { key: "hydraulika", label: "Hydraulika" },
  { key: "kanalizacja", label: "Kanalizacja" },
  { key: "co", label: "C.O." },
  { key: "hvac", label: "HVAC" },
  { key: "gaz", label: "Gaz" },
  { key: "wykonczenia", label: "Wykończenia" },
  { key: "ogolnobudowlana", label: "Ogólnobud." },
];

export const TRADE_LABEL: Record<string, string> = TRADES.reduce(
  (acc, t) => ({ ...acc, [t.key]: t.label }),
  {} as Record<string, string>,
);

export function tradeLabel(key?: string): string {
  if (!key) return "Inne";
  return TRADE_LABEL[key] || key;
}
