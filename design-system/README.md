# design-system/

`smart-175/MASTER.md` lo genera el plugin **UI UX Pro Max**
(github.com/nextlevelbuilder/ui-ux-pro-max-skill), 28 sep 2026:

```bash
python3 search.py "analytics dashboard data-dense scientific research data tables charts microbiome" \
  --design-system --persist --force -p "Smart-175" --density 6 --output-dir <raíz del repo>
```

Es la segunda consulta. La primera, «scientific bioinformatics microbiome analysis
dashboard research tool professional», se descartó: la clasificó como
«Calculator & Unit Converter» (neumorfismo, landing de una columna, naranja sobre
fondo oscuro, Poppins/Open Sans).

**Es material de referencia, no se aplica tal cual.** En concreto:

- El `@import` / enlace a Google Fonts NO se usa: la CSP lo bloquea y el proyecto
  no hace peticiones externas. Toda fuente se autoaloja en `fonts/` (Fira Sans y
  Fira Code son SIL OFL 1.1).
- El «Page Pattern» (Enterprise Gateway: vídeo, logos de clientes, *Contact
  Sales*) es de web de marketing y no aplica a una herramienta de análisis.
- Las muestras de CSS de componentes (`.btn-primary`, `.card`…) son orientativas;
  la app sigue con sus clases `ql-*` y `css/tokens.css`.
- El archivo no trae paleta oscura: la del tema oscuro se deriva a mano.
- **El azul del MASTER (#1E40AF) no se usa tal cual.** Quedaba a ΔE OKLab 5,7 del
  violeta de datos `--cat-7` (y su derivado oscuro #60A5FA, a 9,3 de `--cat-1`).
  Mismo criterio que con el teal (ΔE ≥ 15 frente a todos los colores de datos):
  marca **#00107C** en claro y **#93C5FD** en oscuro. Detalle y cifras en la
  cabecera del bloque v2 de `css/tokens.css`; lo comprueba `tests/design-v2.mjs`.

## Fase global (28 sep 2026)

Tras aprobarse el piloto de la portada, v2 se aplica a toda la app:

- `data-ds="v2"` en `<body>` (index.html y el HTML autocontenido del informe).
- Tema **oscuro por defecto** sin preferencia guardada, aunque el SO pida claro
  (`js/lib/theme.js`); «Automático» sigue disponible y ahora se guarda.
- Encabezado de identidad: wordmark «Smart-175» (Fira Sans 700, azul de marca)
  + el motivo de siempre (dendrograma + nube PCoA, `js/lib/motif.js`) —
  `js/lib/brand.js`. El mismo wordmark en barra lateral, cajón móvil y pie.
- Colores de estado como texto: nunca `--good`/`--warning` a secas; sus tonos
  `--good-ink`/`--warning-ink`/`--critical-ink` (≥ 4,5:1, también sobre su
  insignia tintada). Enriquecido/reducido como texto: tinta + punto de color.
- La marca no va dentro de las figuras (nodos, puntos de hoja, áreas de datos,
  anotaciones); solo en controles interactivos de la figura.
- Las **figuras conservan IBM Plex** (son salida exportable con fuente elegible
  en el editor); Fira Code, fuera de ellas, solo para cifras, código y secuencias.
- Verificación: `tests/design-v2.mjs` (tokens, marca vs datos, encabezado en
  375/768/1024/1440) y `tests/design-v2-modules.mjs` (todas las rutas y
  pestañas, claro y oscuro: contraste real, marca en figuras, restos del teal).
