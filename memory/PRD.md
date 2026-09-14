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
