# Australia Pocket Guide 2026

Chinese-language travel guide for Sydney, Melbourne, the Great Ocean Road and Phillip Island, September 25 to October 6, 2026.

Website: https://nicalm.github.io/australia-pocket-guide-2026/

The shared version is a Cloudflare Worker with static assets and a D1 database. index.html is also kept on GitHub Pages as a read-only fallback.

Packing items and notes sync through a capability URL whose share parameter is checked by the Worker. Keep that URL among the travel group. Browser local storage provides an offline fallback. Weather updates request fixed city forecasts from Open-Meteo.
