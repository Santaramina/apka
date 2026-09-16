#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## [2026-06] Rozbudowa katalogu wycen + edycja głosem
backend:
  - task: "Rozszerzony katalog (branża/kategoria/producent/SKU/parametry, ceny przykładowe, migracja+top-up)"
    file: "/app/backend/seed_data.py, /app/backend/server.py"
    status: implemented; needs_retesting: true
    details: "GET/POST/PUT/DELETE /materials i /labor-rates rozszerzone o trade, subcategory, manufacturer, sku, specs, price_is_example. Seed dosypuje brakujące pozycje przykładowe (po seed_key) bez nadpisywania cen użytkownika; migracja starych dokumentów (trade=category). Login też wywołuje top-up. Po edycji przez użytkownika price_is_example=false."
  - task: "Parser komend głosowych + zastosowanie (katalog)"
    file: "/app/backend/ai_service.py, /app/backend/voice_actions.py, /app/backend/server.py"
    status: implemented; needs_retesting: true
    details: "POST /voice/parse-command (context catalog|estimate; audio_path lub text) zwraca transkrypcję + akcje z labelami/statusami/kandydatami. POST /catalog/voice-apply wykonuje potwierdzone akcje (set_price, bump_prices, add_item, delete_item). Nie wymyśla cen. Zweryfikowane live: set_price YDY 3x2,5->8zł, bump elektryka labor +10%."
frontend:
  - task: "Ekran katalogu: wyszukiwarka + filtr branża/kategoria + badge przykładowa + głos"
    file: "/app/frontend/app/(tabs)/catalog.tsx, /app/frontend/src/components/voice.tsx, /app/frontend/src/lib/catalog.ts"
    status: implemented; needs_retesting: true
  - task: "Formularz katalogu: branża/kategoria/producent/SKU/parametry"
    file: "/app/frontend/app/catalog-form.tsx"
    status: implemented; needs_retesting: true
  - task: "Edycja głosem w edytorze wyceny (dodaj/zmień cenę/ilość/usuń/zbiorczo %) z potwierdzeniem"
    file: "/app/frontend/app/estimate/[id].tsx, /app/frontend/src/components/voice.tsx"
    status: implemented; needs_retesting: true
test_credentials: test@budkoszt.pl / test123
agent_communication:
  - "Backend: 38 testów jednostkowych (voice_actions/matching/seed/upload) + backend_test.py = 55 passed. Prosze przetestowac nowe endpointy i przeplyw glosowy oraz priorytet ceny uzytkownika."

## [2026-06] Audyt procesu kosztorysowania (AI + katalog + obliczenia + PDF)
backend:
  - task: "AI: rozróżnienie ilości odczytana/szacowana + needs_confirmation, brak wymyślania cen"
    file: "/app/backend/ai_service.py, /app/backend/server.py"
    status: implemented; needs_retesting: true
    details: "Prompt wzmocniony (nie wymyślaj materiałów/ilości; quantity_basis read|estimated; needs_confirmation). run_analysis mapuje basis->quantity_source (ai_read/ai_estimated); ceny wyłącznie z katalogu (0 + requires_confirmation gdy brak pewnego dopasowania). ai needs_confirmation wymusza requires_confirmation TYLKO gdy cena nie z katalogu. Live-verified: opis elektryczny -> 10 pozycji, quantity_basis=read, ceny z katalogu lub 0+confirm."
  - task: "Obliczenia: narzut/marża od subtotal (bez podwójnego naliczania), rabat po narzucie, VAT, zysk"
    file: "/app/backend/server.py compute_totals"
    status: verified; needs_retesting: false
    details: "12 testów jednostkowych (test_totals.py) w tym 6 scenariuszy elektrycznych. Potwierdzone: markup i margin liczone od subtotal (nie kaskadowo), discount od before_discount, gross=net+vat, profit=net-subtotal."
frontend:
  - task: "Edytor: badge Ilość odczytana/szacowana/ręczna; edycja ilości/ceny/produktu; kandydaci; dodaj/usuń"
    file: "/app/frontend/app/estimate/[id].tsx"
    status: implemented; needs_retesting: true
test_credentials: test@budkoszt.pl / test123
agent_communication:
  - "Backend 50/50 testow jednostkowych. Live E2E analyze OK. Prosze przetestowac: pelny przeplyw analyze->items(quantity_basis)->matching->edycja(ilosc/cena/kandydat/dodaj/usun)->compute totals->PDF. Nie zmieniac matching.py."
