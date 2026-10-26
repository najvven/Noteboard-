# Lokalne poprawki po audycie — 2026-10-25

Zmiany są w otwartym PR [#10](https://github.com/najvven/Noteboard-/pull/10), na gałęzi `audit-fixes-coverage-2026-10-25`; nie zostały scalone do `main`. Publiczna wersja nadal wynosi **1.0** (semver `1.0.0`). Nie zmieniono instalatora ani folderu NoteboardWork. Testy używały osobnych profili i katalogów danych.

| Obszar | Potwierdzony problem i poprawka | Sprawdzenie |
|---|---|---|
| NB-063, cookies Web | Nawigacja między domenami z odpowiedzią HTTP 204 nie tworzy nowego dokumentu. Dotychczas jej oczekujący URL przejmował politykę aktywnej strony i pozwalał wysłać obce cookies. Polityka żądań korzysta teraz z faktycznie otwartego dokumentu. Oczekujący URL służy wyłącznie przyjęciu cookies początkowej odpowiedzi strony i jest czyszczony po zakończeniu ładowania. | W Electronie najpierw potwierdzono wysłanie prawdziwego cookie przy blokadzie Off, następnie odtworzono wyciek przy Third-party. Po poprawce obce cookie jest blokowane przed i po HTTP 204, a cookie własnej strony pozostaje dostępne. |
| NB-067, puste popupy | Zagnieżdżone `about:blank` nie może używać domeny głównego Web ani aktualnej domeny otwierającego okna, jeśli to okno później zmieni stronę. Używany jest natywny origin istniejącego dokumentu. Okno bez właściciela nie dostaje zastępczego, uprzywilejowanego kontekstu. | Kontrola `document.cookie` oraz rzeczywistego nagłówka Cookie, zmiana strony otwierającego okna, zachowanie własnych cookies i blokowanie okna bez właściciela. |
| Praca Chromium przy zmianie rozmiaru | Seria 51 żądań rozmiaru wysyłała 51 poleceń emulacji. Jeden wykonawca stosuje teraz najnowszy rozmiar i pomija niezmienione ustawienia. Po błędzie lub odłączeniu debuggera konfiguracja jest ponawiana w całości. | Kontrolowana seria 51 żądań kończy się jednym poleceniem z właściwym rozmiarem; wszystkie wywołania czekają na zastosowanie ustawień. Natywne testy zachowania treści, reflow, zoomu i trybów urządzeń przeszły. To pomiar liczby poleceń, nie deklaracja spadku zużycia GPU o określony procent. |
| NB-056, tryb urządzenia | Zmiana trybu nadal wymaga nowego dokumentu, aby UA, client hints i dotyk działały przed pierwszym skryptem strony. Dodano potwierdzenie tego przeładowania. Anulowanie pozostawia stronę i wpisaną treść. Wybranie już aktywnego trybu nie resetuje wymiarów pola. | Oba menu urządzeń; anulowanie zachowuje identyfikator gościa, znacznik dokumentu, tekst, rozmiar i liczbę żądań. Potwierdzenie stosuje profil przed pierwszym skryptem i zachowuje cookies sesji. |
| NB-010, zapis i Home | Nie potwierdzono wycieku niezatwierdzonego draftu przez normalny powrót do Home. Dodano regresję dla tej ścieżki. | Nieudany zapis zatrzymuje użytkownika w edytorze i nie zmienia zapisanej wersji. Dopiero potwierdzona ponowna próba pozwala wrócić do Home. |
| NB-036, arkusz po przeładowaniu | Rozszerzono dowód zachowania węzłów menu arkusza. | Trzy przeładowania rzeczywistego iframe zachowują draft tekstu/formuły i jedną kopię montowania menu, układu oraz stylów. |
| NB-014, import XLSX | Rozmiar arkusza uwzględnia też jawnie zadeklarowane puste kolumny i końce scalonych zakresów. Wstępna walidacja odrzuca niepoprawne/duplikowane adresy komórek i nadmiar rekordów wierszy przed przekazaniem pliku do ExcelJS. | Testy sprawdzają dokument wynikowy i round-trip XLSX, puste kolumny, granice XFD/A1048576, błędne XFE, sprzeczne/duplikowane adresy oraz limit rekordów wierszy. |
| NB-035, cykl życia arkusza | `beforeunload` zachowuje bieżący szkic, ale nie zwalnia API. Worker i API są zwalniane przy terminalnym `pagehide`; zdarzenia BFCache pozostawiają API aktywne. Sygnatura szkicu pozwala przechwycić kolejne zmiany po anulowanym unloadzie. | Playwright anuluje zdarzenie `beforeunload` w ramce, sprawdza dalszą edycję i aktywne API, następnie wykonuje rzeczywisty reload iframe i sprawdza odzyskanie obu komórek. Veto rzeczywistej nawigacji strony oraz przywrócenie BFCache nie są osobno odtworzone w tym scenariuszu. |

Pozostałe potencjalne punkty przejrzano bez wymuszania zmian: magazyn tablic stosuje konserwatywne porównanie nazw bez rozróżniania wielkości liter na każdej platformie (NB-004); testy zabezpieczają też zerowe/niepoprawne wymiary skalowanego tekstu (NB-022). Natywne testy zakotwiczenia Ctrl+wheel przy zoomie okna oraz obrocie/odbiciu elementu przechodzą w Windows (NB-021). Nie jest to dowód uruchomienia na macOS.

Weryfikacja końcowa — pełny agregat z 2026-10-25, `.tmp/coverage-aggregate/20261025T155316227Z-331c9f26/`:

- Typecheck i produkcyjny build: poprawne.
- Testy kodu: **401/401**; testy przeglądarkowe: **10/10**; pełny Playwright: **153/153** bez retry.
- Electron: **33 zaliczone, 1 pominięty, 0 nieudanych**. Pominięty jest opcjonalny test live-YouTube.
- Połączone pokrycie V8: **85,39% linii, 85,74% gałęzi, 81,21% funkcji**; wszystkie niezmienione progi 80% są spełnione. Inwentarz obejmuje sześć etapów, nieznane statusy: 0, nieudane suite’y: 0, błędy zbierania profili Playwright: 0. Profile Playwright wykryły kod aplikacji w 151 z 153 testów.
- Scenariusz NB-035 używa anulowanego, syntetycznego zdarzenia `beforeunload`, a potem rzeczywistego reloadu iframe; to sprawdza zachowanie API i draftu, ale nie symuluje dialogu anulowania nawigacji strony ani prawdziwego BFCache.
- Build nadal ostrzega o chunkie arkusza ok. **7,5 MB** i powtarzających się sourcemapach dla chunki językowe.
- Brak kontrolowanego pomiaru produkcyjnego GPU/CPU/RAM dla Web na pierwszym planie. Test stresowy sześciu pól odczytał **1255 MiB** w fixture QA, która wyłącza background throttling; to nie jest produkcyjny baseline.
- Nie uruchomiono zdalnego CI ani weryfikacji macOS/Linux. PR #10 jest otwarty i nie scalony; package version to nadal `1.0.0` / publiczna etykieta `1.0`, a instalator, NoteboardWork i dane użytkownika nie były zmieniane.

Instalator pozostał niezmieniony: SHA-256 `8B98076C2847505168B7CADEC55F4255203722AAC6F739583A7B18E91617BA5C`. Lokalny opublikowany mirror nadal wskazuje `904eb62157a3910c9a674204fc1a5909a151cee2` i nie ma zmian w drzewie roboczym.

## PR #10 — follow-up do audytu agenta

Poniższe poprawki uzupełniają audyt PR #10; publiczna wersja pozostaje `1.0.0` / `1.0`, bez zmian instalatora i danych użytkownika.

| Źródło | Rozwiązanie |
|---|---|
| Fill Q1, CR2 | Przechwycenie na czas klatki ukrywa siatkę i nakładki wyboru przez tymczasowe style, nie zmieniając ustawień ani historii. Wynik odrzucany jest, gdy w czasie asynchronicznego capture zmienią się viewport, zoom, aktywne narzędzie, warstwa albo elementy. |
| Fill Q4, G1 | Obszar Fill ogranicza się do rzeczywistej powierzchni klikniętej dodatkowej Board i widocznego viewportu, także poza prostokątem Main Board. Nowy raster dostaje rodzica z `creationParentId`, więc zachowuje najbliższy Section/layer; istniejące wypełnienie pozostaje osobnym, edytowalnym rasterem. |
| Fill Q5 | Bez Electron IPC przeglądarka renderuje DOM planszy do PNG dla elementów aplikacji. W przeglądarce nie da się odczytać pikseli z obcej ramki, dlatego kliknięcie wewnątrz embedded Web pokazuje jawny komunikat. Desktop używa natywnego capture, które obejmuje również widoczne Web. |
| Fill Q7, CR3 | Main process ogranicza rozmiar capture przed alokacją, uwzględniając skalę monitora; komunikat nie sugeruje już bezpodstawnie, że samo przybliżenie zmniejszy przechwycenie. |
| CR7 | Raster Fill przechowuje spakowaną maskę alfa w ograniczonym cache. Context menu i obie ścieżki gumki trafiają tylko w nieprzezroczyste piksele oraz respektują widoczne granice Section. Testy obejmują obrót, odbicie i crop. |
| XLSX A–D | Wstępna walidacja jest jednokrotnym, ograniczonym tokenizatorem XML; komórki, wiersze, scalenia i liczba arkuszy mają limity przed ExcelJS. Szerokie domyślne/ukryte zakresy kolumn nie rozciągają Simple view, zachowane są rzeczywiste komórki XFD, jawne custom columns i końce scaleń. Pierwsza komórka bez `r` dziedziczy kolumnę A z jawnego numeru wiersza; plik wejściowy nie jest mutowany. Limit archiwum 128 MiB pozostaje zgodny wstecz. |
| COV-A–E, Q2/Q3, G2/G3/G4, CR1/CR-N | Profil Electron ma per-test JSONL i wymagany udany renderer; agregat kończy się błędem przy braku profilu lub błędzie collect. Inwentarz zachowuje marker ✔/✖/﹣, snapshot obejmuje strony HTML/CSS, wszystkie skrypty buildu, testy i konfigurację Sonar, a raport-only przerywa się po nieudanym rebuildzie. Fixture E2E słucha `context` i nowych stron bez wymuszania dodatkowej strony. |
| CI i Sonar | CI coverage uruchamia teraz pełny agregat Node/Chromium/Electron na Node 24/Xvfb, zachowując cztery progi 80%, i publikuje artefakty po sukcesie lub błędzie. Sonar dostaje LCOV z tej samej mapy pod `coverage/lcov.info`; skan wymaga konfiguracji `SONAR_TOKEN`, `SONAR_ORGANIZATION`, `SONAR_CI_BASED=true` oraz udanego agregatu. |
| Windows check | Test zapisu Web czyta plik z już zweryfikowanego profilu tymczasowego zamiast wykonywać IPC do kontekstu podczas `expect.poll`. Wprowadzanie testowych danych do Web używa jednego `insertText`, by uniknąć niestabilnych, osobnych zdarzeń klawiszy. |

### Weryfikacja tego follow-upu

Pełny agregat `20261025T195051958Z-d85b96ea` oraz jego report-only rerun przeszedł na migawce źródła `5eb3aa45c4e52203b5d838b26d38128e19fceda698ed5d4e204a786ef8eb5161`:

- Typecheck i production build: PASS. Build nadal zgłasza znane duplikaty sourcemapów i chunk arkusza około 7,5 MB.
- Source tests 417/417; browser tests 11/11; Playwright 154/154; Electron 36 zaliczonych, 1 opcjonalny live-YouTube pominięty, 0 błędów.
- Połączone pokrycie: **85,68% lines/statements, 85,42% branches, 80,29% functions**; wszystkie dotychczasowe progi 80% spełnione.
- Profile: Node 142, Chromium 152, Electron renderer 42 (35 uruchomień z profilem i 1 oczekiwane zamknięcie). Błędy collect: 0, nieudane suite’y: 0, nieznane statusy: 0.
- `coverage/lcov.info`: 112 oryginalnych plików źródłowych, 565 905 bajtów; brak `dist` i plików testów. Report-only odtworzył te same sumy.
- Nowy browser E2E potwierdził wypełnienie lokalnej planszy bez Electron API. Zewnętrzny embedded Web w browser preview pozostaje niedostępny z powodu izolacji ramek; natywny desktopowy capture działa dla niego.
- SonarCloud CI został skonfigurowany i potwierdzony skanem PR #10 na headzie `f069237a4c8411415fecfd9139cd5b9d51eba52b`. Skan zaimportował LCOV; pokrycie nowego kodu wyniosło 92,55%, duplikacje 0%. Quality Gate pozostał niezaliczony z powodu Reliability C (wymagane A); na tym headzie widoczne były 3 problemy średniej wagi dotyczące nieobsłużonych Promise’ów w `main.js` oraz 90 nowych zgłoszeń łącznie. Brak informacji o blame wystąpił tylko dla części plików.
- Uruchomiono lokalnie na Windows; zdalne GitHub Actions i macOS/Linux nie są jeszcze potwierdzone. PR #10 pozostaje niezmergowany do `main`.

## 2026-10-26 — korekty po pierwszym wyniku SonarCloud

- Fill działa na widocznych, połączonych pikselach dla figur, linii i tła. Wypełnienie poza zamkniętym konturem tworzy osobny raster zamiast zmieniać kolor całej tablicy; element zachowuje kolor obramowania, a raster zapisuje identyfikator właściwej planszy także przy nakładaniu tablic.
- Podgląd przeglądarkowy ogranicza rasteryzację do żądanego, widocznego obszaru, odrzuca elementy poza kadrem i ukrywa komunikat Fill na czas przechwycenia.
- Obsłużono błędy Promise’ów z `win.loadURL`, `win.loadFile` i inicjalizacji `app.whenReady`, które tworzyły trzy średnie problemy Reliability w poprzednim skanie.
- Weryfikacja lokalna po tych zmianach: typecheck i produkcyjny build zaliczone; testy źródłowe 421/421, przeglądarkowe 12/12, wybrane Playwright 7/7 oraz wybrane natywne scenariusze Electron 5/5. Pełny agregat coverage zostanie ponownie oceniony przez CI po aktualizacji PR.
- Te wyniki Sonar odnoszą się do historycznego headu `f069237`; nie są wynikiem skanu bieżącego kodu.

## 2026-10-26 — dodatkowe poprawki po review PR #10

- Wypełnienia pikselowe zachowują właściciela przy klonowaniu tablicy, a transfer strony przypisuje wypełnienia Main Board do nowej powierzchni. Po wklejeniu, duplikacji lub przeniesieniu właściciel jest ponownie rozwiązywany, jeśli raster opuścił poprzednią tablicę. Hit test rozpoznaje brak maski alfa jako stan nieznany, aby gumka i zaznaczanie nie przechodziły przez aktywne wypełnienie.
- W trybie Select rasterowe wypełnienie bezpośrednio pod kursorem może być zaznaczone i przeciągane, mimo że przezroczyste piksele przekazują kliknięcia do płótna.
- Odtwarzanie szkicu w arkuszu ma limit 5 sekund i awaryjne oczekiwanie między klatkami; ukryta karta nie może trzymać ramki przed komunikatem `loaded` do limitu hosta.
- Coverage fixture obsługuje odrzucone `startJSCoverage`, inwentarz błędnej fazy nie przerywa zapisu diagnostyki, checkout CI nie zachowuje tokenu GitHub, a Sonar skanuje wyłącznie po udanym agregacie.
- Testy arkusza zachowują gest zmiany szerokości kolumny, sprawdzają przewijanie klawiaturą oraz w obu osiach kółkiem myszy i wybierają kartę `Data` po roli dostępnościowej.

### Weryfikacja

- Typecheck, build, testy źródłowe **427/427** i testy browserowe **12/12** zaliczone. Build nadal zgłasza znany duży chunk arkusza około 7,5 MB.
- Zestaw Playwright obejmujący wypełnienie, przeniesienie wypełnienia, arkusze, reload szkicu i zmianę kolumny: **11/11**. Po ostatnich zmianach testy arkusza w trybie coverage: **2/2**.
- Na poprzednim headzie `3348b37079d9fe387af753b0e2659492382b8c91` GitHub potwierdził Windows i source/browser, a Linux coverage zebrał LCOV i uruchomił Sonar. Sonar Quality Gate: **passed**, nowe pokrycie **91,8%**, duplikacje **0,0%**, **87 nowych issue**. Ten skan poprzedza bieżące poprawki.
- Ten sam starszy workflow coverage wykrył dwa nieudane testy arkusza, mimo że osobny source/browser job przeszedł. Test przewijania i wybór karty `Data` zostały poprawione; pełny agregat na nowym headzie pozostaje do potwierdzenia przez CI. Nowy workflow pomija Sonar, jeśli agregat nie przejdzie.
- Wersja `1.0`, instalator, NoteboardWork i dane tablic nie były zmieniane.
