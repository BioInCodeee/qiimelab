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
