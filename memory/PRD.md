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

## Backlog / next
- P1: moduł pomiarów (pomieszczenia/wymiary), analiza wideo (klatki)
- P1: uczenie systemu — rzeczywiste koszty vs estymacja, prywatne normy użytkownika
- P2: integracja z hurtownią (ceny materiałów online), wersjonowanie ofert, wielu użytkowników w firmie
- P2: dopasowywanie pozycji AI do katalogu użytkownika (ceny z bazy zamiast estymacji AI)
