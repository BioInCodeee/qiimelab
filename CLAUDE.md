# Smart-175 — contexto del proyecto

**Producto: Smart-175. Repositorio: qiimelab, sin cambios (decisión deliberada).** "QiimeLab" es el nombre heredado y no debe volver a aparecer en nada de cara al usuario (títulos, manifest, textos i18n en los 5 idiomas, README, scripts de `recursos/`). Se quedan con "qiimelab" a propósito: el nombre del repo y su URL de GitHub Pages, la carpeta, `package.json` → `name`, los nombres de los documentos de trabajo `qiimelab-*.md` y las referencias a ellos en comentarios, y las claves heredadas `qiimelab.*` que `js/lib/storageMigration.js` migra a `smart-175.*` (el prefijo vigente de localStorage, con guion). No "corregir" el nombre del repo sin este contexto.

Analiza resultados de QIIME2 (microbioma 16S) y archivos FASTQ enteramente en el navegador. Sin backend, sin instalación, sin subir datos a ningún sitio: todo el cálculo ocurre en el navegador del usuario. Marca: BioInCode (bioincode.info@gmail.com). Hosting: GitHub Pages (repo `LucaDoktor/qiimelab`).

Público objetivo: estudiantes/investigadores de biología con formación en la materia pero **sin experiencia en programación** ni en la línea de comandos de QIIME2. Prioriza siempre: estados vacíos con botón de datos de ejemplo, explicaciones en lenguaje llano junto a cada término/métrica (con enlace al glosario), y tolerancia a que el usuario suba archivos con su propio formato de columnas (mapeo manual como red de seguridad, nunca un formato único obligatorio).

Este proyecto lo desarrollan EN PARALELO varias herramientas de IA (Claude, Gemini/Antigravity, y lo que se use en VS Code) además de la persona que lo mantiene. Este archivo es el punto de partida común — léelo antes de tocar nada para no reinventar convenciones ni duplicar trabajo ya hecho.

## Arquitectura — reglas que no se negocian

- JavaScript vanilla, **módulos ES nativos, sin build step, cero dependencias de código** (sin npm, sin bundler). La única petición externa permitida hoy es la fuente de Google Fonts (IBM Plex) — está en el roadmap auto-hospedarla para quedar 100% offline.
- `index.html` + `css/` (tokens, base, components; clases utilitarias `ql-*`) + `js/app.js` (router por hash, `import()` perezoso por ruta — el id de la ruta home es `''`, hash `#/`) + `js/state.js` (store central con "huecos" con nombre + patrón subscribe/notify) + `js/lib/` (parsers, estadística, i18n, DOM/tooltip centralizados) + `js/modules/` (un archivo por página: exporta `render(container)` y devuelve una función de limpieza) + `js/workers/` (cálculo pesado fuera del hilo principal, p. ej. `alignWorker.js`).
- **Dos tipos de módulo:** la mayoría lee/escribe `js/state.js` y entra en la sesión exportable (`js/lib/session.js`); unos pocos son autónomos (`phylo.js`, `primers.js`, `labcalc.js`...) y persisten solo en su propio `localStorage` — es intencional, no un olvido.
- **DOM/tooltips/SVG centralizados** en `js/lib/dom.js` (`escapeHtml`, `svgEl`) y `js/lib/tooltip.js` (`showTooltip`/`hideTooltip`/`createTooltip`) — todo gráfico nuevo debe consumir esto, no reimplementar a mano.
- La estadística se verifica contra R (vegan, DESeq2, etc.) en la suite de tests propia — cualquier fórmula nueva sigue ese mismo patrón de validación.
- Nunca reimplementar por completo una herramienta externa (QIIME2, LEfSe, PICRUSt2...) — Smart-175 es la capa de análisis/visualización posterior, y donde se apoye en un método inspirado en otra herramienta, decirlo explícitamente en la UI (ya se hace con el biomarcador tipo LEfSe).

## Convenciones de trabajo

- Directorio de trabajo: la raíz de este repositorio (en local, la carpeta `appclaude/`).
- Commits pequeños y frecuentes, no uno gigante al final. **Cada sesión de trabajo termina con `git push`** — regla fija, sin excepción.
- **Nunca dos herramientas de IA escribiendo a la vez sobre esta misma carpeta.** Incidente real (15 sep 2026): un proceso de Antigravity con checkout obsoleto revirtió en caliente trabajo ya empujado por Claude Code local (`i18n.js`, `inference.js`) mientras ambas corrían en paralelo sobre el mismo árbol de trabajo. Antes de lanzar una sesión nueva (Claude Code, Antigravity, la que sea), comprobar que no hay otra corriendo aquí (`ps aux | grep -i agy`, o preguntar directamente). Si hace falta trabajar de verdad en paralelo, usar `git worktree` para que cada herramienta tenga su propia copia y fusionar después — nunca las dos sobre el mismo árbol de trabajo sin un commit/push de por medio.
- Sesiones desatendidas (de noche, sin nadie delante): no esperar confirmación de nada, tomar la decisión más razonable y documentarla en el commit. Si el prompt pide apagar el equipo al terminar: siempre `sudo -n` (comprobar antes de usar sudo, nunca quedarse colgado esperando contraseña) y `shutdown -h +1` (no inmediato), con log en `~/qiimelab-nightly.log`.
- Los datos de ejemplo reales salen de un estudio no publicado del autor (microbioma 16S). Los valores numéricos pueden ser públicos; los nombres de tratamientos/grupos/variables de diseño que revelen la metodología del estudio deben genericizarse antes de usarse como ejemplo público.
- Sin login ni backend real. Como mucho, un nombre de perfil cosmético en `localStorage`, sin cuentas.
- Interfaz en 5 idiomas (es/en/it/de/zh) vía `js/lib/i18n.js`, función `t(key, params)` con interpolación `{n}`. Español es el idioma por defecto y el fallback de cualquier clave que falte en otro idioma — basta con escribir la clave en `es` para que la app no rompa, pero mantener paridad con `en` es lo ideal. Cualquier texto nuevo va como clave i18n, nunca hardcodeado; cuidado con concatenaciones tipo `${n} elementos` (plurales/orden distinto entre idiomas).
- **Tests:** `tests/run.mjs` es un runner propio (sin Jest/Vitest), suites en `tests/*.mjs`. Antes de dar por bueno un cambio, correr `node tests/run.mjs` — algunas suites E2E necesitan Chrome local y se saltan si no está (normal, no un fallo).
- **Gate de tests (hooks versionados en `.githooks/`):** activarlo una vez por clon con `git config core.hooksPath .githooks`. `pre-commit` corre `node tests/run.mjs --rapido` (~20 s) sobre lo que se va a commitear y `pre-push` la suite completa sobre lo que se empuja; si algo falla, bloquea. Saltarlo solo a conciencia (p. ej. commit de solo documentación): `git commit --no-verify` / `git push --no-verify`, o `SMART175_SKIP_TESTS=1` delante. Detalle en `tests/README.md`.

## Cómo trabajar aquí con cuota/tokens limitada

- **Las conversaciones de chat largas salen caras** porque cada turno reenvía TODO el historial anterior. Para una sesión de trabajo nueva (otro día, otra tarea), abrir conversación nueva en vez de alargar una antigua — este archivo es justo lo que sustituye tener que "re-explicar todo" al empezar de cero.
- **Claude Code / VS Code local** es el canal más barato para cambios quirúrgicos concretos (arreglar una función, revisar un diff): no arrastra historial de chat, y lee este CLAUDE.md gratis nada más abrir la carpeta.
- Reservar las sesiones de chat (Cowork / claude.ai) para auditorías cruzadas, decisiones de arquitectura, o trabajo que necesite memoria de varias semanas — no como canal por defecto para cada cambio pequeño.
- **Desconfía de las autocertificaciones de una IA sobre su propio trabajo** ("cero deuda crítica", "certificado para producción"). Pide una segunda pasada con otra herramienta antes de dar algo por cerrado — ver el caso real de abajo.

## Dónde está el roadmap

El roadmap priorizado (P0/P1/P2) y las decisiones de qué NO construir viven en los documentos de trabajo del proyecto, no aquí — este archivo es solo el contexto estable que no cambia sesión a sesión. Si un prompt da una lista de tareas concretas, esa lista manda sobre cualquier prioridad que se pueda inferir de otro sitio.

## Estado conocido (última auditoría cruzada: 15 sep 2026)

Antigravity generó `audit_report.md` → `_v2.md` → `_v3.md` documentando un refactor grande (DRY en dom.js/tooltip.js, blindaje de `ab1Parser.js`, suite de tests de 52 suites). V3 se autodeclara "Zero Critical Debt", pero al verificarlo de forma independiente (Claude, 15 sep):

- **Pendiente real, no mencionado en V3:** el "Grupo B" que SÍ señalaba V2 (listeners individuales por celda en vez de delegación de eventos) sigue sin implementarse. Confirmado con grep — cero usos de `pointerover`/`pointerout` en `js/modules/betaDiversity.js` (heatmap y scatter PCoA), `differentialAbundance.js` (heatmap y volcano plot), `correlogram.js` (matriz de correlación) e `inference.js` (diagrama alluvial). No rompe nada con datasets normales, pero con datasets grandes (cientos de muestras / miles de OTUs) genera decenas de miles de listeners — sigue siendo el próximo candidato de limpieza si se prioriza.
- Los "7 imports sin usar" que sí reporta V3 son reales pero cosméticos.
- `js/modules/taxa.js` (103 bytes) es un alias intencional de `taxaBarplot.js` (`export * from './taxaBarplot.js'`), no un archivo roto.
- Las cifras de paridad i18n (1.668-1.669 claves ES=EN) y de la suite de tests (41/52 pasando, 11 saltadas por falta de Chrome) no se han vuelto a verificar de forma independiente en esta pasada — tomarlas como plausibles, no como confirmadas.
