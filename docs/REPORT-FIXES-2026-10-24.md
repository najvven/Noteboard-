# Poprawki na podstawie raportu 1.0.6 — 24.10.2026

Ten dokument opisuje wcześniejszy etap lokalnych poprawek. Ich przygotowanie
do kolejnego wydania opisano w [wersji 1.0.7](RELEASE-1.0.7.md).

Zmiany dotyczą lokalnego kodu aplikacji. Bazą jest opublikowany commit
`f3 efcdaae4 e9 a043 fdf7 ecc5902 a87 b615 d8 f58 d`. Nie utworzono nowego wydania,
instalatora ani commitu na GitHubie w ramach tego zadania.

Archiwum raportu rozpakowano i sprawdzono rozmiary oraz sumy SHA256 wszystkich
33 pozycji manifestu. Skryptów dołączonych do raportu nie uruchamiano.
Testy korzystały z osobnych danych i profili; nie zmieniały tablic użytkownika.

## Wdrożone zmiany

| Obszar raportu | Zmiana i potwierdzenie |
| --- | --- |
| STORAGE-01 | Wspólna blokada katalogu dla procesów HTTP i desktopu, również podczas migracji przy odczycie. Dwadzieścia wyścigów dwóch procesów: każdorazowo tylko jeden sprzeczny zapis otrzymał potwierdzenie. Sprawdzono odzyskanie wygasłej blokady po przerwaniu procesu. |
| STORAGE-02 | Import zbiorczy sprawdza znane rewizje wszystkich tablic przed pierwszym zapisem. Stary format tablicy JSON zachowano jako tworzenie nowych dokumentów oraz identyczne ponowienia. Nowsza data nie pozwala nadpisać cudzej zmiany. |
| STORAGE-03 | PUT/DELETE wymagają warunku rewizji: brak daje 428, niepoprawny warunek 400, konflikt 409. Zaktualizowano jawnych klientów testowych i dokumentację. |
| STORAGE-04 | Podczas odrzucania lokalnego konfliktu stary kafelek nie wraca na Home przed zakończeniem odczytu. Test opóźnia odpowiedź serwera o 700 ms. |
| STORAGE-05 | Kolizje nazw różniących się wielkością liter mają jednoznaczny kod błędu, bez pętli niepewnych ponowień. Test desktopowy zachował oba oryginały i zapisał lokalny szkic jako nową tablicę. |
| RENDER-01 | Ekstrema punktów i kolejności warstw wyznaczane są iteracyjnie. Test funkcji obejmuje milion punktów; rzeczywisty widok renderuje rysunek z 200000 punktów obok tekstu. |
| RENDER-02 | Przesunięcie Main Board używa rzeczywistego ruchu kursora w pikselach ekranu. Przy 50/100/200% przesunięcie 100×60 px daje ten sam wynik i jeden krok Undo/Redo. |
| PERF-01 | Zwykły odczyt nie zapisuje ponownie poprawnych plików i nie skanuje całego katalogu dla każdej tablicy. Dla 10/20/40 dokumentów test mierzy odpowiednio 10/20/40 odczytów JSON; pojedynczy zapis mieści się wN+4. |
| PERF-02 | Daleki, ukryty tekst nie wymaga tworzenia listy wszystkich prostokątów wierszy ani znaczników dla każdego fragmentu. Zachowano kanoniczną treść, mieszane czcionki i ograniczenie do pełnych wierszy. |
| SPREADSHEET-01 | Szkic aktualnie wpisywanej komórki jest przechowywany przy przeładowaniu kontekstu arkusza. Weryfikowane są generacje dokumentów, aby spóźniony komunikat starego widoku nie zastąpił nowego. Testy obejmują tekst, formułę, kontynuowanie wpisywania i formatowanie. |
| SPREADSHEET-02 | Import XLSX działa również w edytowalnym trybie prostym i zachowuje istniejące komórki oraz tryb arkusza. |
| SECURITY-01 | Serwer deweloperski jawnie chroni katalogi danych, pliki robocze i kontekst także przez dowiązania. Testy sprawdzają rzeczywistą treść odpowiedzi dla zwykłych, kodowanych, query/raw oraz/@fs/URLi. To potwierdzenie ochrony, nie dowód pierwotnej podatności. |
| SECURITY-02 | Electron 42.11.16, Vite 6.4.5 i zgodne poprawki zależności pośrednich. `npm audit` wskazuje 0 podatności. Wykonano rzeczywiste testy nowego desktopowego runtime. |
| ARCHIVE-01 | Zgodnie z decyzją właściciela zachowano 128 MiB. Poprawiono sprzeczną dokumentację, bez zmniejszania obsługiwanych plików. |
| CONTRACT-01 | Zachowano wcześniej ustalone domyślne edytowanie i przesuwanie tekstu. Testy sprawdzają również jawne wyłączenie oraz niezależność innych narzędzi. |

Dodatkowa diagnoza wykazała ściskanie nazwy otwartego kontenera w nagłówku
Layers po dodaniu przycisku scalania. Nagłówek zawija teraz grupę przycisków,
zamiast ukrywać nazwę. Usuwanie elementu zachowuje bieżący widok kontenera.

Nie potwierdzono osobnego błędu położenia dzieci scalonej grupy ani wspólnych
przycisków odbicia: aktualne testy rzeczywistych interakcji przeszły. Poprawiono
nieaktualne oczekiwanie przycisku zapisu nazwy oraz scenariusz odzyskiwania:
duży tekst stanowi istniejącą treść z zachowanym ukrytym nadmiarem, zamiast
nowego wklejenia przekraczającego pojemność pola.

## Weryfikacja i otwarty punkt TEST-01

- Kontrola typów i kompilacja: przechodzą.
- Pełny przebieg testów źródłowych: 317 przechodzi; po końcowych zmianach
  dodatkowo przechodzą 32 celowane regresje, w tym 25 sprawdzeń zapisu/HTTP.
- Pomocnicze testy przeglądarkowe tekstu i sanitizacji: 8 przechodzi.
- Rzeczywiste interakcje przeglądarkowe: 37 przechodzi oraz osobny scenariusz
  pełnych wierszy tekstu. Obejmują schowek, ponowne upuszczanie plików,
  podglądy, przycinanie, grupowanie, warstwy, konflikty i arkusze.
- Desktop: 26 różnych scenariuszy przeszło w pełnym przebiegu i celowanych
  poprawkach testów. Sprawdzono między innymi zamknięcie z dużym szkicem,
  blokowanie reklam/cookies/popupów, fullscreen, zoom nad Web, zmianę rozmiaru,
  tryby urządzeń, schowek i import arkuszy. Opcjonalnego testu publicznego
  YouTube nie uruchamiano; kontrolowane strony nie dowodzą poprawności każdej
  strony zewnętrznej. Instalatora na profilu użytkownika nie uruchamiano.
- Dodano oddzielny skrypt `npm run test:browser` i konfigurację GitHub Actions
  dla typów, testów źródłowych, przeglądarki, desktopu Windows oraz coverage.
  Konfiguracja nie została jeszcze wykonana na GitHubie.

**TEST-01 pozostaje częściowo otwarty.** Ostatni pomiar źródłowy wynosi
61,30% linii, 76,53% gałęzi i 53,89% funkcji. Deklarowane progi 80% pozostały
bez zmian, więc `npm run test:coverage` oraz odpowiadające mu zadanie CI nadal
zgłoszą błąd. Nie wyłączano kodu produkcyjnego z pomiaru ani nie liczono
testów Playwright/Electron jako pokrycia testów źródłowych. Dalsze pokrycie
rzeczywistych gałęzi aplikacji wymaga osobnej pracy; nie uznajemy tego
kryterium raportu za spełnione.

Graf struktury kodu odświeżono lokalnie. Zawiera 1414 węzłów i 3781 połączeń,
bez brakujących końców połączeń. Graf opisuje zależności w źródłach;
sam nie potwierdza poprawności działania aplikacji.
