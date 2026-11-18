# ❄️ Generator Śnieżynek i Błysków (Snow & Sparkle Generator) ✨

Profesjonalna, w 100% kliencka aplikacja internetowa do nakładania trójwymiarowego, padającego śniegu oraz animowanych rozbłysków światła (błysków) z efektem poświaty (Bloom) na zdjęcia i pliki wideo.

Aplikacja działa w całości w przeglądarce internetowej (HTML5 Canvas 2D, SVG, Web Animations, Web Audio/Video, MediaRecorder) — **nie wymaga żadnego środowiska Python, Node.js ani serwera backendowego**. Repozytorium jest w pełni przygotowane do natychmiastowego hostowania na **GitHub Pages**.

---

## 🚀 Jak opublikować na GitHub Pages (Krok po kroku)

### Krok 1: Wgraj repozytorium na GitHub

Możesz wybrać najwygodniejszy dla siebie sposób:

#### Sposób A: Przez przeglądarkę (GitHub Web)
1. Utwórz nowe repozytorium na [GitHub.com](https://github.com/new) (np. o nazwie `sniezynki-blask`), wybierając opcję **Public**.
2. Na stronie nowo utworzonego repozytorium kliknij **uploading an existing file** (lub **Add file** -> **Upload files**).
3. Przeciągnij i upuść całą zawartość tego katalogu do okna przeglądarki.
4. Kliknij zielony przycisk **Commit changes**.

#### Sposób B: Przez Git w wierszu poleceń (Terminal / Git Bash)
```bash
git init
git add .
git commit -m "Wdrożenie: Generator Śnieżynek i Błysków gotowy na GitHub Pages"
git branch -M main
git remote add origin https://github.com/<twoj-login>/<nazwa-repozytorium>.git
git push -u origin main
```

#### Sposób C: Przez program GitHub Desktop
1. Otwórz **GitHub Desktop**, wybierz **File** -> **Add local repository...** i wskaż ten folder.
2. Kliknij **Publish repository**, upewnij się, że opcja *Keep this code private* jest odznaczona (aby GitHub Pages było bezpłatnie dostępne), i zatwierdź.

---

### Krok 2: Włącz GitHub Pages w ustawieniach repozytorium

1. W swoim repozytorium na GitHubie wejdź w zakładkę **Settings** (Ustawienia).
2. W menu po lewej stronie przejdź do sekcji **Pages** (w kategorii *Code and automation*).
3. W sekcji **Build and deployment**:
   - **Source**: wybierz `Deploy from a branch`.
   - **Branch**: wybierz gałąź `main` (lub `master`).
   - **Folder**: wybierz `/ (root)` LUB `/docs` *(obie opcje działają w 100% zamiennie, repozytorium posiada kompletną strukturę w obu lokalizacjach)*.
   - Kliknij **Save**.
4. Odczekaj około 1–2 minut. Na górze strony pojawi się zielony komunikat z bezpośrednim linkiem:
   ```text
   Your site is live at https://<twoj-login>.github.io/<nazwa-repozytorium>/
   ```

---

## ✨ Najważniejsze Funkcje Aplikacji

### 1. Trzy tryby generowania wideo
- **✨ Generuj Błyski**: renderuje film wyłącznie z naniesionymi punktami rozbłysków i poświatą Bloom.
- **❄️ Generuj Śnieg**: renderuje film z proceduralnym, przestrzennym opadem śniegu.
- **🚀 Generuj Śnieg i Błyski (Tryb łączony)**: łączy oba efekty w jeden zsynchronizowany plik wideo.

### 2. Zaawansowana Oś Czasu (Timeline)
- **Wspólna ścieżka dla wszystkich błysków**: intuicyjne zarządzanie wszystkimi punktami na jednej czytelnej osi.
- **Granice czasowe (Klipy)**: dodanie błysku automatycznie tworzy klip czasowy; błyski dodawane w tym samym przedziale czasu animują się wspólnie.
- **Rozciąganie i skracanie w czasie**: precyzyjne uchwyty po lewej i prawej stronie klipu pozwalają rozszerzać lub zwężać czas trwania efektu w przód i w tył.
- **Przesuwanie granic**: chwycenie środka klipu przesuwa całą grupę błysków w czasie.
- **Przewijanie poziome (Scroll)**: możliwość wygodnego przewijania osi czasu kółkiem myszy (`wheel`) dla dłuższych filmów (np. 15s, 30s, 60s).
- **Automatyczne podążanie (Autoscroll)**: widok osi czasu automatycznie przesuwa się za znacznikiem podczas odtwarzania.
- **Idealne wyrównanie wskaźnika (Playheada)**: wskaźnik przecina linijkę i ścieżki z dokładnością do 0.00 px (dzięki przypiętemu nagłówkowi kolumny).

### 3. Paleta Błysków i Rozbłysków
- **4 gotowe presety**:
  - `1`: Normalny błysk statyczny (`assets/blysk.png`) z kontrolą pulsowania i zanikania.
  - `2`: Animowany Snowdrop 01 (opadający rozbłysk wideo).
  - `3`: Animowany Błysk 01 (promienisty, dynamiczny wybuch światła).
  - `4`: Animowana Śnieżynka 01 (wirujący płatek śniegu z rozbłyskiem).
- **Skróty klawiszowe**: klawisze `1`, `2`, `3`, `4` natychmiast przełączają aktywny typ pędzla.
- **Niezależny pędzel**: każdy nowo dodany punkt może mieć inny typ oraz inny rozmiar pędzla (istniejące punkty zachowują swoje właściwości).
- **Szybkie usuwanie**: kliknięcie **Prawym Przyciskiem Myszy (PPM)** na podglądzie natychmiast usuwa najbliższy błysk.
- **Opcje blendowania (Tryb Normal i Addition)**: dedykowany tryb `Normal` oraz `Addition` gwarantują pełne nasycenie bieli, ostrość i wyrazistość na jasnych tłach wideo.
- **Wpisywana przeźroczystość**: numeryczne pole wartości (0.0 – 1.0) zsynchronizowane dwukierunkowo z suwakiem.
- **Efekt Bloom (Poświata)**: osobny wybór trybu mieszania, promienia rozmycia, intensywności, koloru i przeźroczystości poświaty.

### 4. Przestrzenny Generator Śniegu (3D Snow)
- **Wpisywana liczba płatków**: pole numeryczne (10 – 5000 płatków) zsynchronizowane z suwakiem gęstości.
- **Głębia ostrości (Depth of Field)**: wielowarstwowe płatki z fizycznym efektem rozmycia tła i pierwszego planu.
- **Wiatr i turbulencje**: realistyczne kołysanie, zmienne porywy wiatru i efekt paralaksy.
- **Łagodne zanikanie przy krawędziach**: konfigurowalna strefa wygaszania śniegu u dołu ekranu.

### 5. Niezawodny i Płynny Eksport Wideo
- **Brak zacinania się na wideo**: eksport z importowanym plikiem MP4 odbywa się w czasie rzeczywistym z synchronizacją klatek GPU, eliminując opóźnienia bufora dekodera.
- **Format MP4 (H.264 `avc1`)**: gwarantuje natywną akcelerację sprzętową i płynne odtwarzanie we wszystkich odtwarzaczach (Windows Media Player, VLC, QuickTime, smartfony).
- **Format WebM (VP9/VP8)**: z automatycznym wstrzykiwaniem metadanych czasu trwania (EBML duration fixer) umożliwiającym płynne przewijanie.
- **Wybór rozdzielczości**: Domyślna (1:1 z pliku źródłowego), HD (1280x720), FullHD (1920x1080), 210x240 (A4).
- **Inteligentne kadrowanie**: automatyczny wybór czarnych pasów (letterbox) lub przycięcia krawędzi (crop) przy zachowaniu proporcji obrazu.

### 6. Wygodny Interfejs Użytkownika (UI / UX)
- **Zwijanie okienek**: kliknięcie w nagłówek dowolnej karty zwija ją do cienkiego paska, zwalniając miejsce na podgląd.
- **Zoom podglądu**: przyciski zoomu (+, −, 100%) z zachowaniem matematycznej zgodności współrzędnych SVG 1:1.
- **Przewijanie strony**: elastyczny układ zoptymalizowany pod kątem małych i dużych monitorów.

---

## 📁 Struktura Repozytorium

```text
├── index.html           # Główny plik aplikacji (GitHub Pages root)
├── style.css            # Style interfejsu Dark Mode Pro
├── script.js            # Silnik Canvas 2D, oś czasu, cząsteczki i MediaRecorder
├── .nojekyll            # Wyłącza silnik Jekyll na GitHub Pages (wymagane dla assetów)
├── .gitignore          # Ignoruje pliki tymczasowe i systemowe
├── README.md            # Dokumentacja projektu
├── assets/              # Zasoby graficzne, arkusze sprite'ów i animacje
│   ├── blysk.png
│   ├── snieg_blysk.png
│   ├── animowany_snowdrop_01.mp4
│   ├── animowany_snowdrop_01_sprites.png
│   ├── animowany_snowdrop_01_sprites.webp
│   ├── animowany_blysk_01.mp4
│   ├── animowany_blysk_01_sprites.png
│   ├── animowany_blysk_01_sprites.webp
│   ├── animowana_sniezynka_01.mp4
│   ├── animowana_sniezynka_01_sprites.png
│   └── animowana_sniezynka_01_sprites.webp
├── docs/                # Lustrzana kopia aplikacji dla trybu GitHub Pages /docs
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   ├── .nojekyll
│   ├── README.md
│   └── assets/
└── [przykładowe pliki]  # input.jpg, input2.jpg, generator.png, Blask_ze_sniegiem.mp4
```

---

## 📄 Licencja i Informacje Techniczne
- **Licencja**: MIT
- **Kompatybilność przeglądarek**: Google Chrome, Microsoft Edge, Mozilla Firefox, Apple Safari, Opera.
- **Wymagania**: Włączona obsługa JavaScript i Canvas API w przeglądarce.
