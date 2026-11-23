# Biblia — versión web

Sitio estático (HTML, CSS y JS sin compilar). Para publicarlo, sube esta carpeta completa a cualquier hosting estático:

- **Cloudflare Pages** (gratis): Workers & Pages → Create → Pages → Upload assets → arrastra esta carpeta.
- **GitHub Pages** (gratis): sube la carpeta a un repositorio y activa Pages.

Estructura:
- `index.html`, `app.css`, `app.js` — la app
- `sw.js`, `manifest.webmanifest` — funciona sin internet y se puede instalar en la pantalla de inicio
- `data/` — contenido (es/en) y el texto bíblico por libro (Reina-Valera 1909 y Berean Standard Bible, dominio público)
- `img/` — íconos y miniaturas de escenas
- `clips/` — escenas de películas mudas de dominio público (Internet Archive)
- `vendor/` — Leaflet (mapas)
