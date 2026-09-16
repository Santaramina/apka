// Wspólna taksonomia branż (klucze zgodne z backendem seed_data.py / ai_service.TRADE_LABELS)
export type Trade = { key: string; label: string };

// Kategorie główne (7) — grupowanie nadrzędne, zgodne z backendem seed_data.MAIN_CATEGORIES
export const MAIN_CATEGORIES: Trade[] = [
  { key: "elektryka", label: "Elektryka i elektrotechnika" },
  { key: "hydraulika", label: "Hydraulika i instalacje sanitarne" },
  { key: "budownictwo", label: "Budownictwo" },
  { key: "remonty", label: "Remonty i wykończenia" },
  { key: "stolarka", label: "Stolarka i montaż" },
  { key: "ogrod", label: "Ogrodnictwo i teren zewnętrzny" },
  { key: "ogolnobudowlana", label: "Prace ogólnobudowlane" },
];

export const MAIN_CATEGORY_LABEL: Record<string, string> = MAIN_CATEGORIES.reduce(
  (acc, t) => ({ ...acc, [t.key]: t.label }),
  {} as Record<string, string>,
);

export function mainCategoryLabel(key?: string): string {
  if (!key) return "Inne";
  return MAIN_CATEGORY_LABEL[key] || key;
}

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

// Etykiety pól kanonicznych do importu CSV/Excel
export const IMPORT_FIELD_LABELS: Record<string, string> = {
  name: "Nazwa *",
  manufacturer: "Producent",
  sku: "Nr katalogowy",
  ean: "EAN",
  main_category: "Kategoria",
  subcategory: "Podkategoria",
  description: "Opis",
  specs: "Parametry",
  unit: "Jednostka",
  unit_price: "Cena netto *",
  rate: "Stawka netto *",
  vat_rate: "VAT",
  rate_min: "Stawka min",
  rate_max: "Stawka max",
  includes_materials: "Zawiera materiały",
  price_source_label: "Źródło ceny",
  source_url: "Link",
  notes: "Uwagi",
  status: "Status",
};
