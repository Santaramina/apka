# BudKoszt Pro — PRD

## Original problem statement
Profesjonalna aplikacja mobilna (Expo) do szybkiego wykonywania wycen i kosztorysów dla branży
budowlanej i instalacyjnej. Użytkownik na budowie robi zdjęcia / nagrywa opis głosowy lub tekstowy;
AI (Gemini 3.1 Pro) rozpoznaje zakres prac, tworzy listę materiałów, szacuje ilości i robociznę,
przygotowuje edytowalny kosztorys i ofertę PDF dla klienta. Zarządzanie: klienci, inwestycje,
pomiary, pozycje, materiały, stawki robocizny, narzuty, rabaty, oferty, kosztorysy.

## User choices
- Branże: elektryka, hydraulika, wykończenia, ogólnobudowlana (wielobranżowa)
- Ceny: startowy katalog przykładowych cen (edytowalny); integracja z hurtownią po MVP
- AI: Gemini 3.1 Pro (obraz+tekst+audio), model `gemini-3.1-pro-preview`
- Logowanie: e-mail+hasło (JWT) oraz Google (Emergent-managed)
- Waluta PLN, VAT 23% (edytowalny), oferta PDF po polsku

## Architecture
- Frontend: Expo Router + React Query + react-native-keyboard-controller + phosphor icons
- Backend: FastAPI (server.py + db/security/storage_service/ai_service/pdf_service/seed_data)
- DB: MongoDB (users, user_sessions, clients, projects, estimates[embedded items], materials, labor_rates, captures)
- AI: emergentintegrations LlmChat (Gemini 3.1 Pro) → structured JSON items
- Storage: Emergent Object Storage (photos, audio); PDF generated with fpdf2 (IBM Plex Sans, Polish glyphs)
- Design: Brutalist Mobile Light — Signal Orange, hard black borders, radius 0, Space Grotesk + IBM Plex Sans

## Personas
- Wykonawca/instalator na budowie (jasne otoczenie, duże przyciski, szybka obsługa)

## Implemented (2026-06)
- Auth: rejestracja/login e-mail+hasło (JWT), Google session exchange, profil firmy, gate w root layout
- Katalog auto-seed przy rejestracji (30 materiałów, 14 stawek) — edytowalny
- CRUD: klienci, inwestycje (z klientem, branżą), materiały, stawki robocizny (soft delete)
- Capture: aparat/galeria (expo-image-picker), nagranie głosu (expo-audio), notatka tekstowa
- AI analyze: tworzy szkic kosztorysu z pozycjami (materiały/robocizna), scope, transkrypcja
- Edytor kosztorysu: edycja pozycji (nazwa, rodzaj, ilość +/-, jedn., cena), dodawanie/usuwanie,
  narzut/rabat/VAT/status, live totals, sticky footer, generowanie i udostępnianie PDF
- Ekrany: Pulpit, Inwestycje, Klienci, Baza (tabs) + capture, estimate editor, formularze, ustawienia

## Refactor rdzenia wyceny (2026-06)
Zmienione pliki:
- backend/ai_service.py — AI NIE podaje cen; zwraca kind/name/quantity/unit/confidence/note
- backend/matching.py (NOWY) — dopasowanie nazw pozycji do katalogu (tokeny: Jaccard + zawieranie, próg 0.4)
- backend/server.py — analiza w tle (BackgroundTasks) ze statusem analysis_status (processing/completed/failed); dopasowanie cen z katalogu (price_source catalog/user/null); compute_totals rozszerzony (materials_cost, labor_cost, extra_cost, markup, margin, discount, vat, net, gross, profit); margin_percent; walidacja uploadu (typy + limit 20MB); poprawka przekazywania branży (trade default None → fallback do project.trade); endpoint /estimates/{id}/reanalyze; pola pozycji quantity_source/price_source/confidence/catalog_id/catalog_name
- backend/pdf_service.py — oferta dla klienta ukrywa narzut/marżę/zysk/koszt zakupu (wliczone w ceny jednostkowe), pokazuje tylko Wartość netto / Rabat / VAT / Brutto
- frontend/app/capture.tsx — przekazuje branżę projektu do /ai/analyze
- frontend/app/estimate/[id].tsx — ekrany statusu analizy (processing/failed+retry), odznaki źródeł (Ilość: AI/ręczna, Cena: katalog/ręczna/Brak w katalogu, AI %), modal „Dopasuj z katalogu" + „Wpisz cenę ręcznie", pole Marża, rozbicie kosztorysu wewnętrznego (materiały/robocizna/narzut/marża/rabat/netto/VAT/zysk)

Testy: backend 17/17 (async analyze, matching, trade, reanalyze, totals, upload, PDF bez danych wewnętrznych, izolacja user_id), frontend wszystkie przepływy (edytor, odznaki, picker katalogu, zapis, ustawienia).

Ceny snapshotowane w kosztorysie (zmiana ceny w katalogu nie zmienia historycznego kosztorysu).

## Do zrobienia (kolejne):
- Osobny wydruk PDF kosztorysu wewnętrznego (dla wykonawcy)
- Cena zakupu materiału (koszt) obok ceny sprzedaży → dokładniejszy zysk
- Uczenie na rzeczywistych kosztach; integracja z hurtownią

## Ulepszenie dopasowania do katalogu (2026-06)
Zmienione pliki: backend/matching.py (przepisany), backend/server.py (integracja w run_analysis, pola pozycji requires_confirmation + candidate_matches), backend/tests/test_matching.py (NOWY, 10 testów), frontend/app/estimate/[id].tsx (sekcja potwierdzenia + kandydaci, badge „Wymaga potwierdzenia").
- Matcher świadomy parametrów technicznych: przekrój (3x1,5 vs 3x2,5), liczba żył (3x1,5 vs 5x1,5), średnica (20mm/fi20 vs 25mm), jednostki, napięcie/moc/pojemność. Konflikt parametru = pozycja wykluczona (nigdy nie proponowana).
- Progi: AUTO=0.72 (pewne, po potwierdzeniu parametrów i zgodności jednostki), CANDIDATE=0.30 (pokazanie kandydatów). Bliskie wyniki dwóch najlepszych → wymaga potwierdzenia.
- Wynik: matched / requires_confirmation + candidate_matches[{catalog_id, catalog_name, unit, unit_price, score}].
- Gwarancja: żadna cena z AI nie trafia do kosztorysu; cena tylko z katalogu (auto) lub po ręcznym wyborze/wpisaniu.
- Testy: 27/27 (10 matcher + 17 backend) — potwierdzone przez agenta testującego.

## Bugfix — Upload zdjęć / HEIC (iOS)
- Przyczyna: `capture.tsx` wysyłał każde zdjęcie na sztywno jako `zdjecie_X.jpg` + `image/jpeg`. iOS zwracał czasem HEIC/HEIF (lub PNG/WEBP) → backend zapisywał bajty HEIC pod `.jpg`, a Gemini nie odczytywał HEIC → ogólny błąd „Analiza nie powiodła się”.
- Frontend: każde zdjęcie normalizowane do JPEG przez `expo-image-manipulator` przed uploadem (rozwiązuje HEIC/HEIF/PNG/WEBP). `uploadFile()` nie koduje typu na sztywno. Komunikaty per zdjęcie: „Nie udało się przesłać zdjęcia N…”.
- Backend `/api/upload`: rozpoznanie formatu z realnych bajtów (`image_utils.sniff_image_type`), zabezpieczenie HEIC/HEIF → JPEG (Pillow + pillow-heif) przed zapisem/AI. Dodano `pillow_heif` do requirements.
- Testy: `tests/test_upload.py` 10/10 + weryfikacja live endpointu (JPEG/PNG/WEBP/HEIC/mislabeled/empty/garbage/wrong-type). Zwrócony `path` poprawnie trafia do `/ai/analyze`.

## Bugfix v2 — "Unsupported FormDataPart implementation" (iOS upload)
- Przyczyna: natywny upload przez `FormData.append("file", { uri, name, type })` nie jest wspierany przez sieć Expo/iOS (RN 0.86 / Expo 57) → wyjątek "Unsupported FormDataPart implementation" (mylnie pokazywany jako błąd formatu).
- Rozwiązanie: `uploadFile()` (native iOS/Android) używa NATYWNEGO multipart uploadu z `expo-file-system@57` → `new File(uri).upload(url, { uploadType: UploadType.MULTIPART, fieldName: "file", mimeType, headers })`. Web dalej używa Blob + FormData.
- Kontrakt `/api/upload` bez zmian (multipart/form-data, pole `file`), zachowany safety-net HEIC/HEIF→JPEG.
- Komunikaty: pokazujemy tylko znane błędy backendu (PL); surowe błędy techniczne → "Nie udało się przesłać zdjęcia N. Spróbuj ponownie." Diagnostyka (status/body/mime/name/uri) tylko w console.warn.
- Wersje: expo 57.0.19, expo-file-system ~57.0.7, react-native 0.86.3.
- Testy: pytest 20/20; tsc/lint czyste; web bundle OK. Natywny upload wymaga testu w Expo Go / buildzie na iOS (web preview używa gałęzi web).

## Rozbudowa katalogu wycen + edycja głosem (2026-06)
- Branże (15): elektryka, teletechnika, sieci_lan, cctv, alarmy, kontrola_dostepu, domofony, automatyka, pv, hydraulika, kanalizacja, co, hvac, gaz, ogolnobudowlana (+legacy wykonczenia). Struktura Branża→Kategoria(subcategory)→Pozycja.
- Baza przykładowa: 132 materiały / 58 robocizna (elektryka najobszerniejsza). Wszystkie ceny `price_is_example=True` ("przykładowa"). Materiały: manufacturer/sku/specs.
- Priorytet ceny użytkownika: create/update ustawia price_is_example=False; seed dosypuje TYLKO brakujące pozycje (po seed_key), nigdy nie nadpisuje cen usera. Migracja starych dokumentów (trade=category). Top-up także przy loginie.
- Edycja głosem: POST /api/voice/parse-command (context catalog|estimate, audio_path lub text; Whisper/Gemini via Emergent key) -> transkrypcja + akcje (set_price, bump_prices, add_item, delete_item, set_qty) z labelami/statusem/kandydatami. Zapis dopiero PO potwierdzeniu: /api/catalog/voice-apply (katalog) lub lokalnie w edytorze wyceny -> save (kosztorys). AI nie wymyśla cen (new_price tylko gdy user poda kwotę).
- UI: ekran Katalogu (wyszukiwarka nazwa/producent/SKU/parametr, filtr branża + kategoria, badge "przykładowa", mic "GŁOSEM"), formularz (branża/kategoria/producent/SKU/parametry), edytor wyceny (mic obok "POZYCJE").
- Pliki: backend/seed_data.py, backend/voice_actions.py, backend/ai_service.py, backend/server.py; frontend/src/lib/catalog.ts, frontend/src/components/voice.tsx, frontend/app/(tabs)/catalog.tsx, frontend/app/catalog-form.tsx, frontend/app/estimate/[id].tsx.
- Testy: backend 74/74 (test_catalog_voice.py 21 + test_matching + test_upload + backend_test.py + test_catalog_voice_api.py 19 live). Frontend: przepływ głosowy katalogu zweryfikowany wizualnie (parse+potwierdzenie).
