import uuid

from db import now_utc

# category: elektryka | hydraulika | wykonczenia | ogolnobudowlana
MATERIALS_SEED = [
    # Elektryka
    ("Przewód YDYp 3x1,5", "elektryka", "mb", 3.20),
    ("Przewód YDYp 3x2,5", "elektryka", "mb", 4.80),
    ("Gniazdo pojedyncze podtynkowe", "elektryka", "szt", 14.00),
    ("Włącznik pojedynczy", "elektryka", "szt", 16.00),
    ("Puszka podtynkowa fi60", "elektryka", "szt", 1.20),
    ("Rozdzielnica podtynkowa 12 modułów", "elektryka", "szt", 85.00),
    ("Wyłącznik nadprądowy B16", "elektryka", "szt", 22.00),
    ("Oprawa LED natynkowa", "elektryka", "szt", 45.00),
    # Hydraulika
    ("Rura PEX 16mm", "hydraulika", "mb", 5.50),
    ("Rura PP fi20", "hydraulika", "mb", 4.20),
    ("Kolano PP fi20", "hydraulika", "szt", 2.30),
    ("Bateria umywalkowa stojąca", "hydraulika", "szt", 220.00),
    ("Umywalka ceramiczna", "hydraulika", "szt", 260.00),
    ("Miska WC podwieszana ze stelażem", "hydraulika", "kpl", 890.00),
    ("Grzejnik płytowy 600x1000", "hydraulika", "szt", 320.00),
    ("Syfon umywalkowy", "hydraulika", "szt", 35.00),
    # Wykończenia
    ("Płytki gres 60x60", "wykonczenia", "m2", 65.00),
    ("Klej do płytek elastyczny 25kg", "wykonczenia", "szt", 42.00),
    ("Fuga elastyczna 5kg", "wykonczenia", "szt", 38.00),
    ("Gładź gipsowa 20kg", "wykonczenia", "szt", 34.00),
    ("Farba lateksowa biała 10l", "wykonczenia", "szt", 130.00),
    ("Grunt głęboko penetrujący 5l", "wykonczenia", "szt", 55.00),
    ("Panele podłogowe AC4", "wykonczenia", "m2", 49.00),
    ("Listwa przypodłogowa MDF", "wykonczenia", "mb", 12.00),
    # Ogólnobudowlana
    ("Płyta GK 12,5mm", "ogolnobudowlana", "szt", 32.00),
    ("Profil CW75", "ogolnobudowlana", "mb", 9.50),
    ("Wełna mineralna 10cm", "ogolnobudowlana", "m2", 28.00),
    ("Zaprawa murarska 25kg", "ogolnobudowlana", "szt", 16.00),
    ("Bloczek betonowy", "ogolnobudowlana", "szt", 4.50),
    ("Tynk gipsowy maszynowy 30kg", "ogolnobudowlana", "szt", 27.00),
]

# category, unit, rate (PLN)
LABOR_SEED = [
    ("Układanie przewodów elektrycznych", "elektryka", "pkt", 45.00),
    ("Montaż osprzętu (gniazda/włączniki)", "elektryka", "szt", 25.00),
    ("Montaż i podłączenie rozdzielnicy", "elektryka", "kpl", 350.00),
    ("Montaż instalacji wod-kan", "hydraulika", "pkt", 120.00),
    ("Montaż i podłączenie białego montażu", "hydraulika", "szt", 150.00),
    ("Montaż grzejnika", "hydraulika", "szt", 90.00),
    ("Układanie płytek", "wykonczenia", "m2", 90.00),
    ("Gładzie gipsowe", "wykonczenia", "m2", 35.00),
    ("Malowanie (2 warstwy)", "wykonczenia", "m2", 22.00),
    ("Układanie paneli podłogowych", "wykonczenia", "m2", 30.00),
    ("Zabudowa GK ścian", "ogolnobudowlana", "m2", 55.00),
    ("Tynkowanie maszynowe", "ogolnobudowlana", "m2", 40.00),
    ("Murowanie ścianek działowych", "ogolnobudowlana", "m2", 70.00),
    ("Stawka robocizny - prace ogólne", "ogolnobudowlana", "godz", 70.00),
]


async def seed_user_catalog(db, user_id: str):
    existing = await db.materials.find_one({"user_id": user_id})
    if existing:
        return
    ts = now_utc()
    mats = [
        {
            "material_id": str(uuid.uuid4()),
            "user_id": user_id,
            "name": name,
            "category": cat,
            "unit": unit,
            "unit_price": price,
            "created_at": ts,
            "deleted_at": None,
        }
        for (name, cat, unit, price) in MATERIALS_SEED
    ]
    labor = [
        {
            "labor_id": str(uuid.uuid4()),
            "user_id": user_id,
            "name": name,
            "category": cat,
            "unit": unit,
            "rate": rate,
            "created_at": ts,
            "deleted_at": None,
        }
        for (name, cat, unit, rate) in LABOR_SEED
    ]
    if mats:
        await db.materials.insert_many(mats)
    if labor:
        await db.labor_rates.insert_many(labor)
