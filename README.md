# NSM: plac zabaw

Strona do samodzielnych eksperymentów z Naturalnym Metajęzykiem Semantycznym (NSM) i modelami
językowymi: jeden model opisuje słowo za pomocą 65 prymitywów semantycznych, inne modele próbują
odgadnąć to słowo, sędzia ocenia odpowiedzi, a wybrany model ocenia eksplikację w 22 wymiarach
(Naskręcki i Szczyszek 2025).

**Otwórz stronę:** https://kdudzic.github.io/nsm-playground/

Potrzebny jest własny klucz [OpenRouter](https://openrouter.ai/keys). Klucz wkleja się na stronie;
trafia on wyłącznie do openrouter.ai i nie jest nigdzie zapisywany poza kartą przeglądarki.
Koszty pobiera OpenRouter z konta właściciela klucza (zwykle ułamek centa do kilku centów na słowo).

Strona działa w całości w przeglądarce, bez serwera. Polecenia, lista prymitywów i wymiary oceny
(`data.json`) są eksportowane z repozytorium badawczego, więc plac zabaw stosuje tę samą metodę co
badanie. Tego repozytorium nie należy edytować ręcznie: jest aktualizowane skryptem z repozytorium
badawczego.
