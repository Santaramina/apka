import uuid

from db import now_utc

# ---------------------------------------------------------------------------
# Baza PRZYKŁADOWA (wszystkie ceny oznaczone jako przykładowe: price_is_example=True).
# Struktura: Branża (trade) -> Kategoria (subcategory) -> Pozycja -> Jednostka -> Cena.
# Ceny są ORIENTACYJNE / przykładowe — NIE są aktualnymi cenami rynkowymi.
#
# MATERIALS: (name, trade, subcategory, unit, price, manufacturer, sku, specs)
# LABOR:     (name, trade, subcategory, unit, rate)
# ---------------------------------------------------------------------------

MATERIALS_SEED = [
    # ===================== ELEKTRYKA =====================
    # Przewody i kable
    ("Przewód YDYp 3x1,5", "elektryka", "Przewody i kable", "mb", 3.20, "", "", "3x1,5 mm²; 750V"),
    ("Przewód YDYp 3x2,5", "elektryka", "Przewody i kable", "mb", 4.80, "", "", "3x2,5 mm²; 750V"),
    ("Przewód YDYp 4x1,5", "elektryka", "Przewody i kable", "mb", 4.10, "", "", "4x1,5 mm²; 750V"),
    ("Przewód YDYp 5x2,5", "elektryka", "Przewody i kable", "mb", 8.50, "", "", "5x2,5 mm²; 750V"),
    ("Przewód LgY 1x2,5", "elektryka", "Przewody i kable", "mb", 1.60, "", "", "1x2,5 mm²; linka"),
    ("Przewód LgY 1x6", "elektryka", "Przewody i kable", "mb", 3.90, "", "", "1x6 mm²; linka"),
    ("Kabel YKY 3x2,5", "elektryka", "Przewody i kable", "mb", 6.20, "", "", "3x2,5 mm²; 1kV"),
    ("Kabel YKY 5x6", "elektryka", "Przewody i kable", "mb", 18.00, "", "", "5x6 mm²; 1kV"),
    ("Kabel YKY 4x10", "elektryka", "Przewody i kable", "mb", 24.00, "", "", "4x10 mm²; 1kV"),
    # Osprzęt
    ("Gniazdo pojedyncze podtynkowe", "elektryka", "Osprzęt", "szt", 14.00, "", "", ""),
    ("Gniazdo podwójne podtynkowe", "elektryka", "Osprzęt", "szt", 22.00, "", "", ""),
    ("Gniazdo hermetyczne IP44", "elektryka", "Osprzęt", "szt", 28.00, "", "", "IP44"),
    ("Włącznik pojedynczy", "elektryka", "Osprzęt", "szt", 16.00, "", "", ""),
    ("Włącznik świecznikowy", "elektryka", "Osprzęt", "szt", 24.00, "", "", ""),
    ("Włącznik schodowy", "elektryka", "Osprzęt", "szt", 20.00, "", "", ""),
    ("Ramka pojedyncza", "elektryka", "Osprzęt", "szt", 6.00, "", "", ""),
    ("Puszka podtynkowa fi60", "elektryka", "Osprzęt", "szt", 1.20, "", "", "fi60"),
    ("Puszka natynkowa", "elektryka", "Osprzęt", "szt", 3.50, "", "", ""),
    ("Puszka łączeniowa fi80", "elektryka", "Osprzęt", "szt", 3.00, "", "", "fi80"),
    # Rozdzielnica i zabezpieczenia
    ("Rozdzielnica podtynkowa 12 modułów", "elektryka", "Rozdzielnice", "szt", 85.00, "", "", "12 modułów"),
    ("Rozdzielnica natynkowa 24 moduły", "elektryka", "Rozdzielnice", "szt", 140.00, "", "", "24 moduły"),
    ("Wyłącznik nadprądowy B16 1P", "elektryka", "Zabezpieczenia", "szt", 22.00, "", "", "B16; 1P"),
    ("Wyłącznik nadprądowy C16 1P", "elektryka", "Zabezpieczenia", "szt", 24.00, "", "", "C16; 1P"),
    ("Wyłącznik różnicowoprądowy 63A 30mA", "elektryka", "Zabezpieczenia", "szt", 140.00, "", "", "63A; 30mA"),
    ("Ogranicznik przepięć B+C", "elektryka", "Zabezpieczenia", "szt", 220.00, "", "", "B+C"),
    ("Rozłącznik izolacyjny 63A", "elektryka", "Zabezpieczenia", "szt", 45.00, "", "", "63A"),
    # Oświetlenie
    ("Oprawa LED natynkowa 18W", "elektryka", "Oświetlenie", "szt", 45.00, "", "", "18W"),
    ("Oprawa LED downlight 12W", "elektryka", "Oświetlenie", "szt", 28.00, "", "", "12W"),
    ("Panel LED 60x60 40W", "elektryka", "Oświetlenie", "szt", 75.00, "", "", "60x60; 40W"),
    ("Naświetlacz LED 50W IP65", "elektryka", "Oświetlenie", "szt", 65.00, "", "", "50W; IP65"),
    ("Taśma LED 12V 14,4W/m", "elektryka", "Oświetlenie", "mb", 18.00, "", "", "12V; 14,4W/m"),
    ("Zasilacz LED 12V 100W", "elektryka", "Oświetlenie", "szt", 55.00, "", "", "12V; 100W"),
    # Trasy kablowe
    ("Peszel karbowany fi20", "elektryka", "Trasy kablowe", "mb", 1.10, "", "", "fi20"),
    ("Peszel karbowany fi25", "elektryka", "Trasy kablowe", "mb", 1.60, "", "", "fi25"),
    ("Korytko kablowe 100mm", "elektryka", "Trasy kablowe", "mb", 22.00, "", "", "100mm"),
    ("Listwa naścienna 40x40", "elektryka", "Trasy kablowe", "mb", 14.00, "", "", "40x40mm"),

    # ===================== TELETECHNIKA =====================
    ("Przewód koncentryczny RG6", "teletechnika", "RTV-SAT", "mb", 2.40, "", "", "RG6"),
    ("Gniazdo RTV-SAT podtynkowe", "teletechnika", "RTV-SAT", "szt", 26.00, "", "", ""),
    ("Rozgałęźnik antenowy", "teletechnika", "RTV-SAT", "szt", 18.00, "", "", ""),
    ("Przewód głośnikowy 2x1,5", "teletechnika", "Audio", "mb", 2.10, "", "", "2x1,5 mm²"),

    # ===================== SIECI KOMPUTEROWE (LAN) =====================
    ("Przewód UTP kat.6 drut", "sieci_lan", "Okablowanie", "mb", 2.20, "", "", "UTP; kat.6"),
    ("Przewód FTP kat.6 ekranowany", "sieci_lan", "Okablowanie", "mb", 3.40, "", "", "FTP; kat.6"),
    ("Gniazdo RJ45 kat.6 podtynkowe", "sieci_lan", "Osprzęt", "szt", 22.00, "", "", "RJ45; kat.6"),
    ("Patchpanel 24 porty kat.6", "sieci_lan", "Szafy i krosownice", "szt", 130.00, "", "", "24 porty; kat.6"),
    ("Switch 8 portów gigabit", "sieci_lan", "Aktywne", "szt", 160.00, "", "", "8x 1Gbit"),
    ("Szafa rack 19\" 6U wisząca", "sieci_lan", "Szafy i krosownice", "szt", 260.00, "", "", "19\"; 6U"),

    # ===================== CCTV =====================
    ("Kamera IP kopułkowa 4MP", "cctv", "Kamery", "szt", 220.00, "", "", "4MP; IP"),
    ("Kamera IP tubowa 4MP", "cctv", "Kamery", "szt", 240.00, "", "", "4MP; IP"),
    ("Rejestrator NVR 8 kanałów", "cctv", "Rejestratory", "szt", 480.00, "", "", "8 kanałów"),
    ("Dysk HDD 4TB do monitoringu", "cctv", "Rejestratory", "szt", 320.00, "", "", "4TB"),
    ("Przewód UTP kat.5e zewnętrzny", "cctv", "Okablowanie", "mb", 2.60, "", "", "UTP; kat.5e; żel"),

    # ===================== ALARMY =====================
    ("Centrala alarmowa 8 wejść", "alarmy", "Centrale", "szt", 380.00, "", "", "8 wejść"),
    ("Czujka ruchu PIR", "alarmy", "Czujki", "szt", 55.00, "", "", "PIR"),
    ("Czujka magnetyczna (kontaktron)", "alarmy", "Czujki", "szt", 18.00, "", "", ""),
    ("Sygnalizator zewnętrzny", "alarmy", "Sygnalizacja", "szt", 95.00, "", "", ""),
    ("Manipulator LCD", "alarmy", "Manipulatory", "szt", 180.00, "", "", "LCD"),

    # ===================== KONTROLA DOSTĘPU =====================
    ("Kontroler dostępu 1 przejście", "kontrola_dostepu", "Kontrolery", "szt", 320.00, "", "", "1 przejście"),
    ("Czytnik zbliżeniowy RFID", "kontrola_dostepu", "Czytniki", "szt", 140.00, "", "", "RFID"),
    ("Zwora elektromagnetyczna 280kg", "kontrola_dostepu", "Rygle", "szt", 160.00, "", "", "280kg"),
    ("Przycisk wyjścia", "kontrola_dostepu", "Osprzęt", "szt", 35.00, "", "", ""),

    # ===================== DOMOFONY =====================
    ("Panel zewnętrzny domofonu", "domofony", "Panele", "szt", 240.00, "", "", ""),
    ("Unifon (słuchawka)", "domofony", "Odbiorniki", "szt", 110.00, "", "", ""),
    ("Wideodomofon monitor 7\"", "domofony", "Odbiorniki", "szt", 420.00, "", "", "7\""),

    # ===================== AUTOMATYKA =====================
    ("Sterownik rolet", "automatyka", "Sterowniki", "szt", 120.00, "", "", ""),
    ("Czujnik temperatury", "automatyka", "Czujniki", "szt", 45.00, "", "", ""),
    ("Moduł przekaźnikowy WiFi", "automatyka", "Moduły", "szt", 60.00, "", "", "WiFi"),
    ("Termostat pokojowy programowalny", "automatyka", "Sterowniki", "szt", 180.00, "", "", ""),

    # ===================== FOTOWOLTAIKA (PV) =====================
    ("Panel fotowoltaiczny 450W mono", "pv", "Panele", "szt", 480.00, "", "", "450W; mono"),
    ("Inwerter 5kW hybrydowy", "pv", "Inwertery", "szt", 4500.00, "", "", "5kW; hybrydowy"),
    ("Konstrukcja montażowa (na panel)", "pv", "Konstrukcje", "szt", 90.00, "", "", ""),
    ("Kabel solarny 6mm2", "pv", "Okablowanie", "mb", 4.20, "", "", "6 mm²; solarny"),
    ("Konektor MC4 (para)", "pv", "Okablowanie", "szt", 12.00, "", "", "MC4"),
    ("Optymalizator mocy", "pv", "Optymalizatory", "szt", 320.00, "", "", ""),

    # ===================== HYDRAULIKA =====================
    ("Rura PEX 16mm", "hydraulika", "Rury i kształtki", "mb", 5.50, "", "", "fi16"),
    ("Rura PP fi20 PN20", "hydraulika", "Rury i kształtki", "mb", 4.20, "", "", "fi20; PN20"),
    ("Rura PP fi25 PN20", "hydraulika", "Rury i kształtki", "mb", 5.40, "", "", "fi25; PN20"),
    ("Kolano PP fi20", "hydraulika", "Rury i kształtki", "szt", 2.30, "", "", "fi20"),
    ("Trójnik PP fi20", "hydraulika", "Rury i kształtki", "szt", 3.10, "", "", "fi20"),
    ("Zawór kątowy 1/2\"", "hydraulika", "Armatura", "szt", 18.00, "", "", "1/2\""),
    ("Bateria umywalkowa stojąca", "hydraulika", "Armatura", "szt", 220.00, "", "", ""),
    ("Umywalka ceramiczna 60cm", "hydraulika", "Biały montaż", "szt", 260.00, "", "", "60cm"),
    ("Miska WC podwieszana ze stelażem", "hydraulika", "Biały montaż", "kpl", 890.00, "", "", ""),
    ("Syfon umywalkowy", "hydraulika", "Biały montaż", "szt", 35.00, "", "", ""),

    # ===================== KANALIZACJA =====================
    ("Rura PVC kanalizacyjna fi50", "kanalizacja", "Rury", "mb", 8.50, "", "", "fi50"),
    ("Rura PVC kanalizacyjna fi110", "kanalizacja", "Rury", "mb", 16.00, "", "", "fi110"),
    ("Kolano PVC fi110 67°", "kanalizacja", "Kształtki", "szt", 7.00, "", "", "fi110; 67°"),
    ("Trójnik PVC fi110", "kanalizacja", "Kształtki", "szt", 12.00, "", "", "fi110"),

    # ===================== CENTRALNE OGRZEWANIE (CO) =====================
    ("Grzejnik płytowy 600x1000", "co", "Grzejniki", "szt", 320.00, "", "", "600x1000"),
    ("Zawór termostatyczny + głowica", "co", "Armatura", "kpl", 65.00, "", "", ""),
    ("Rura PEX-AL-PEX 16mm", "co", "Rury", "mb", 7.20, "", "", "fi16"),
    ("Rozdzielacz 6-obwodowy", "co", "Rozdzielacze", "szt", 380.00, "", "", "6 obwodów"),

    # ===================== HVAC / WENTYLACJA / KLIMATYZACJA =====================
    ("Klimatyzator split 3,5kW", "hvac", "Klimatyzacja", "kpl", 2200.00, "", "", "3,5kW"),
    ("Rura miedziana 1/4\" izolowana", "hvac", "Instalacja chłodnicza", "mb", 22.00, "", "", "1/4\""),
    ("Rekuperator 300m3/h", "hvac", "Rekuperacja", "szt", 4800.00, "", "", "300 m³/h"),
    ("Kanał wentylacyjny fi125", "hvac", "Wentylacja", "mb", 18.00, "", "", "fi125"),

    # ===================== GAZ =====================
    ("Rura stalowa gazowa 1/2\"", "gaz", "Rury", "mb", 16.00, "", "", "1/2\""),
    ("Zawór gazowy kulowy 1/2\"", "gaz", "Armatura", "szt", 28.00, "", "", "1/2\""),
    ("Kocioł gazowy kondensacyjny 24kW", "gaz", "Kotły", "szt", 4200.00, "", "", "24kW; kondensacyjny"),

    # ===================== OGÓLNOBUDOWLANA =====================
    ("Płyta GK 12,5mm", "ogolnobudowlana", "Płyty G-K", "szt", 32.00, "", "", "12,5mm"),
    ("Płyta GKB wodoodporna 12,5mm", "ogolnobudowlana", "Płyty G-K", "szt", 42.00, "", "", "12,5mm; wodoodporna"),
    ("Profil CW75", "ogolnobudowlana", "Płyty G-K", "mb", 9.50, "", "", "CW75"),
    ("Profil UW75", "ogolnobudowlana", "Płyty G-K", "mb", 8.50, "", "", "UW75"),
    ("Wełna mineralna 10cm", "ogolnobudowlana", "Izolacje", "m2", 28.00, "", "", "10cm"),
    ("Styropian EPS fasada 15cm", "ogolnobudowlana", "Docieplenia", "m2", 42.00, "", "", "EPS; 15cm"),
    ("Zaprawa murarska 25kg", "ogolnobudowlana", "Murowanie", "szt", 16.00, "", "", "25kg"),
    ("Bloczek betonowy", "ogolnobudowlana", "Murowanie", "szt", 4.50, "", "", ""),
    ("Cegła ceramiczna", "ogolnobudowlana", "Murowanie", "szt", 1.80, "", "", ""),
    ("Pustak ceramiczny 25cm", "ogolnobudowlana", "Murowanie", "szt", 6.80, "", "", "25cm"),
    ("Tynk gipsowy maszynowy 30kg", "ogolnobudowlana", "Tynki", "szt", 27.00, "", "", "30kg"),
    ("Gładź gipsowa 20kg", "ogolnobudowlana", "Gładzie", "szt", 34.00, "", "", "20kg"),
    ("Farba lateksowa biała 10l", "ogolnobudowlana", "Malowanie", "szt", 130.00, "", "", "10l"),
    ("Grunt głęboko penetrujący 5l", "ogolnobudowlana", "Malowanie", "szt", 55.00, "", "", "5l"),
    ("Płytki gres 60x60", "ogolnobudowlana", "Płytki", "m2", 65.00, "", "", "60x60"),
    ("Klej do płytek elastyczny 25kg", "ogolnobudowlana", "Płytki", "szt", 42.00, "", "", "25kg"),
    ("Fuga elastyczna 5kg", "ogolnobudowlana", "Płytki", "szt", 38.00, "", "", "5kg"),
    ("Panele podłogowe AC4", "ogolnobudowlana", "Podłogi", "m2", 49.00, "", "", "AC4"),
    ("Listwa przypodłogowa MDF", "ogolnobudowlana", "Podłogi", "mb", 12.00, "", "", "MDF"),
    ("Dachówka ceramiczna", "ogolnobudowlana", "Dachy", "m2", 55.00, "", "", ""),
    ("Membrana dachowa", "ogolnobudowlana", "Dachy", "m2", 8.00, "", "", ""),
]


LABOR_SEED = [
    # ===================== ELEKTRYKA =====================
    ("Punkt elektryczny podtynkowy", "elektryka", "Instalacje", "pkt", 85.00),
    ("Punkt elektryczny natynkowy", "elektryka", "Instalacje", "pkt", 60.00),
    ("Układanie przewodów w peszlu", "elektryka", "Instalacje", "mb", 6.00),
    ("Bruzdowanie w cegle/betonie", "elektryka", "Instalacje", "mb", 12.00),
    ("Montaż osprzętu (gniazda/włączniki)", "elektryka", "Montaż", "szt", 25.00),
    ("Montaż i podłączenie rozdzielnicy do 12 modułów", "elektryka", "Rozdzielnice", "kpl", 350.00),
    ("Montaż rozdzielnicy 24+ modułów", "elektryka", "Rozdzielnice", "kpl", 550.00),
    ("Montaż oprawy oświetleniowej", "elektryka", "Oświetlenie", "szt", 35.00),
    ("Montaż oprawy LED downlight", "elektryka", "Oświetlenie", "szt", 30.00),
    ("Pomiary elektryczne + protokół", "elektryka", "Pomiary", "kpl", 250.00),
    ("Wykucie i osadzenie puszki", "elektryka", "Instalacje", "szt", 15.00),

    # ===================== TELETECHNIKA =====================
    ("Punkt RTV-SAT", "teletechnika", "RTV-SAT", "pkt", 80.00),

    # ===================== SIECI KOMPUTEROWE (LAN) =====================
    ("Punkt sieciowy LAN (gniazdo RJ45)", "sieci_lan", "Okablowanie", "pkt", 90.00),
    ("Zarobienie i test toru LAN", "sieci_lan", "Okablowanie", "szt", 25.00),
    ("Montaż szafy rack", "sieci_lan", "Montaż", "kpl", 180.00),

    # ===================== CCTV =====================
    ("Montaż i konfiguracja kamery IP", "cctv", "Montaż", "szt", 120.00),
    ("Montaż i konfiguracja rejestratora NVR", "cctv", "Montaż", "kpl", 250.00),

    # ===================== ALARMY =====================
    ("Montaż czujki ruchu", "alarmy", "Montaż", "szt", 70.00),
    ("Uruchomienie i konfiguracja centrali alarmowej", "alarmy", "Uruchomienie", "kpl", 300.00),

    # ===================== KONTROLA DOSTĘPU =====================
    ("Montaż kontroli dostępu (1 przejście)", "kontrola_dostepu", "Montaż", "kpl", 350.00),

    # ===================== DOMOFONY =====================
    ("Montaż i podłączenie domofonu", "domofony", "Montaż", "kpl", 200.00),
    ("Montaż wideodomofonu", "domofony", "Montaż", "kpl", 260.00),

    # ===================== AUTOMATYKA =====================
    ("Montaż i konfiguracja modułu automatyki", "automatyka", "Montaż", "szt", 90.00),

    # ===================== FOTOWOLTAIKA (PV) =====================
    ("Montaż panela PV (z konstrukcją)", "pv", "Montaż", "szt", 120.00),
    ("Montaż i konfiguracja inwertera", "pv", "Montaż", "kpl", 800.00),
    ("Uruchomienie instalacji PV + zgłoszenie", "pv", "Uruchomienie", "kpl", 600.00),

    # ===================== HYDRAULIKA =====================
    ("Punkt wod-kan (podejście)", "hydraulika", "Instalacje", "pkt", 120.00),
    ("Montaż baterii", "hydraulika", "Montaż", "szt", 90.00),
    ("Montaż białego montażu (WC/umywalka)", "hydraulika", "Montaż", "szt", 150.00),

    # ===================== KANALIZACJA =====================
    ("Montaż pionu kanalizacyjnego fi110", "kanalizacja", "Instalacje", "mb", 45.00),
    ("Podejście kanalizacyjne", "kanalizacja", "Instalacje", "pkt", 90.00),

    # ===================== CENTRALNE OGRZEWANIE (CO) =====================
    ("Montaż grzejnika", "co", "Montaż", "szt", 90.00),
    ("Rozłożenie ogrzewania podłogowego", "co", "Instalacje", "m2", 45.00),

    # ===================== HVAC =====================
    ("Montaż klimatyzatora split", "hvac", "Montaż", "kpl", 800.00),
    ("Montaż rekuperacji (punkt nawiewny)", "hvac", "Montaż", "pkt", 180.00),

    # ===================== GAZ =====================
    ("Montaż instalacji gazowej (punkt)", "gaz", "Instalacje", "pkt", 180.00),
    ("Podłączenie kotła gazowego", "gaz", "Montaż", "kpl", 700.00),
    ("Próba szczelności instalacji gazowej", "gaz", "Odbiory", "kpl", 250.00),

    # ===================== OGÓLNOBUDOWLANA =====================
    ("Murowanie ścianek działowych", "ogolnobudowlana", "Murowanie", "m2", 70.00),
    ("Tynkowanie maszynowe", "ogolnobudowlana", "Tynki", "m2", 40.00),
    ("Gładzie gipsowe", "ogolnobudowlana", "Gładzie", "m2", 35.00),
    ("Malowanie (2 warstwy)", "ogolnobudowlana", "Malowanie", "m2", 22.00),
    ("Zabudowa GK ścian", "ogolnobudowlana", "Płyty G-K", "m2", 55.00),
    ("Sufit podwieszany GK", "ogolnobudowlana", "Sufity", "m2", 65.00),
    ("Układanie płytek", "ogolnobudowlana", "Płytki", "m2", 90.00),
    ("Układanie paneli podłogowych", "ogolnobudowlana", "Podłogi", "m2", 30.00),
    ("Docieplenie elewacji styropianem", "ogolnobudowlana", "Docieplenia", "m2", 95.00),
    ("Wylewka betonowa", "ogolnobudowlana", "Posadzki", "m2", 40.00),
    ("Stawka robocizny - prace ogólne", "ogolnobudowlana", "Ogólne", "godz", 70.00),
]


def _mat_key(trade: str, name: str) -> str:
    return f"m:{trade}:{name}".lower()


def _lab_key(trade: str, name: str) -> str:
    return f"l:{trade}:{name}".lower()


def _build_material(user_id, name, trade, subcategory, unit, price, manufacturer, sku, specs, ts):
    return {
        "material_id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": name,
        "trade": trade,
        "category": trade,  # legacy compat
        "subcategory": subcategory,
        "unit": unit,
        "unit_price": price,
        "manufacturer": manufacturer,
        "sku": sku,
        "specs": specs,
        "price_is_example": True,
        "seed_key": _mat_key(trade, name),
        "created_at": ts,
        "deleted_at": None,
    }


def _build_labor(user_id, name, trade, subcategory, unit, rate, ts):
    return {
        "labor_id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": name,
        "trade": trade,
        "category": trade,  # legacy compat
        "subcategory": subcategory,
        "unit": unit,
        "rate": rate,
        "price_is_example": True,
        "seed_key": _lab_key(trade, name),
        "created_at": ts,
        "deleted_at": None,
    }


async def _migrate_legacy(db, user_id: str):
    """Uzupełnij brakujące pola (trade/seed_key) w istniejących dokumentach."""
    async for m in db.materials.find({"user_id": user_id, "trade": {"$exists": False}}):
        trade = m.get("category") or "ogolnobudowlana"
        await db.materials.update_one(
            {"_id": m["_id"]},
            {"$set": {
                "trade": trade,
                "subcategory": m.get("subcategory", ""),
                "manufacturer": m.get("manufacturer", ""),
                "sku": m.get("sku", ""),
                "specs": m.get("specs", ""),
                "price_is_example": m.get("price_is_example", True),
                "seed_key": _mat_key(trade, m.get("name", "")),
            }},
        )
    async for l in db.labor_rates.find({"user_id": user_id, "trade": {"$exists": False}}):
        trade = l.get("category") or "ogolnobudowlana"
        await db.labor_rates.update_one(
            {"_id": l["_id"]},
            {"$set": {
                "trade": trade,
                "subcategory": l.get("subcategory", ""),
                "price_is_example": l.get("price_is_example", True),
                "seed_key": _lab_key(trade, l.get("name", "")),
            }},
        )


async def seed_user_catalog(db, user_id: str):
    """Zapewnij pełną bazę przykładową dla użytkownika.

    - Uzupełnia stare dokumenty o nowe pola (migracja).
    - Dosypuje BRAKUJĄCE pozycje przykładowe (po seed_key), NIE nadpisując
      istniejących pozycji ani cen ustawionych przez użytkownika.
    """
    await _migrate_legacy(db, user_id)
    ts = now_utc()

    existing_mat = set()
    async for m in db.materials.find({"user_id": user_id}, {"seed_key": 1}):
        if m.get("seed_key"):
            existing_mat.add(m["seed_key"])
    existing_lab = set()
    async for l in db.labor_rates.find({"user_id": user_id}, {"seed_key": 1}):
        if l.get("seed_key"):
            existing_lab.add(l["seed_key"])

    new_mats = [
        _build_material(user_id, name, trade, sub, unit, price, man, sku, specs, ts)
        for (name, trade, sub, unit, price, man, sku, specs) in MATERIALS_SEED
        if _mat_key(trade, name) not in existing_mat
    ]
    new_labor = [
        _build_labor(user_id, name, trade, sub, unit, rate, ts)
        for (name, trade, sub, unit, rate) in LABOR_SEED
        if _lab_key(trade, name) not in existing_lab
    ]
    if new_mats:
        await db.materials.insert_many(new_mats)
    if new_labor:
        await db.labor_rates.insert_many(new_labor)
