# Noteboard+ 1.0.7

Wydanie zawiera poprawki zweryfikowane na podstawie raportu technicznego 1.0.6.
Dotyczą przede wszystkim bezpieczeństwa zapisu, odzyskiwania lokalnych zmian,
arkuszy oraz dużych dokumentów. Nie zmienia układu narzędzi ani zasad pracy
z tablicami użytkownika.

- Zapis jest koordynowany między procesami. Otwarta starsza wersja tablicy
  nie nadpisuje cudzego zapisu tylko dlatego, że ma nowszą datę.
- Rozpoznawane konflikty zachowują szkic do zapisania jako nowa tablica lub
  plik. Odrzucenie konfliktu czeka na świeży odczyt przed pokazaniem Home.
- Import zbiorczy sprawdza wszystkie znane rewizje przed pierwszym zapisem.
  Klienci HTTP PUT/DELETE muszą przesyłać warunek rewizji.
- Przeładowanie widoku arkusza zachowuje wpisywaną komórkę, także formułę,
  formatowanie i możliwość kontynuowania wpisywania. Import XLSX jest dostępny
  również w edytowalnym trybie prostym.
- Rysunki o dużej liczbie punktów nie korzystają z rozwijania całej tablicy
  punktów jako argumentów funkcji. Main Board przesuwa się zgodnie z ruchem
  kursora przy różnych poziomach zoomu i obsługuje Undo/Redo.
- Odczyt poprawnych plików tablic ma liniowy koszt odczytów. Ukryta część
  długiego tekstu wymaga mniej pomiarów układu, zachowując całą treść.
- Foldery danych są jawnie chronione przed udostępnianiem przez serwer
  deweloperski, także przez dowiązania. Electron zaktualizowano do 42.11.16,
  Vite do 6.4.5; audyt zainstalowanych zależności zgłasza 0 podatności.
- Limit archiwum pozostaje 128 MiB. Zachowano dotychczasowe identyfikatory
  aplikacji i położenie danych. Instalator nie zawiera osobistych tablic.

Weryfikacja: 324 testy źródłowe i 9 testów pomocników przeglądarkowych przechodzą.
W poprzednim etapie sprawdzono 37 scenariuszy interakcji i osobny scenariusz
pełnych wierszy tekstu; obecne przygotowanie wydania ponownie sprawdza
szczególnie zapis konfliktów, przeładowanie komórki, import i ruch Main Board.
Testy desktopowe korzystają z osobnych profili, bez zmieniania danych użytkownika.

Końcowe sprawdzenie wydania: 6 scenariuszy w rzeczywistej przeglądarce oraz
3 scenariusze uruchomione ze spakowanego kodu aplikacji przeszły. Zweryfikowano
zgodność 152 plików instalatora ze źródłami i kompilacją oraz brak osobistych
danych w archiwum aplikacji. Aktualizacji instalatorem na profilu użytkownika
nie uruchamiano; zachowano prywatną kopię danych do odzyskania.

**Otwarty punkt jakościowy:** deklarowany próg 80% pokrycia źródeł nadal nie jest
osiągnięty. Aktualny pomiar: 61,46% linii, 77,16% gałęzi, 54,10% funkcji.
Progu nie obniżono; `npm run test:coverage` i zadanie coverage w CI zgłaszają
błąd. Przechodzące testy przeglądarkowe i desktopowe nie są doliczane do tych
wartości. Nie oznaczamy całego raportu audytowego jako zamkniętego.

Szczegóły wcześniejszego etapu: [raport poprawek](REPORT-FIXES-2026-10-24.md).
