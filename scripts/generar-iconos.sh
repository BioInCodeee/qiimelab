#!/bin/sh
# Regenera icons/*.png desde favicon.svg e icon-maskable.svg.
#
# Los PNG se habían generado a mano una vez (268e7e8) y sin script: cuando Agar
# cambió la paleta, los SVG se quedaron en azul y nadie se acordó de los PNG,
# que son los que de verdad se ven en el icono instalado y en las fichas de las
# tiendas. Esto lo deja reproducible.
#
# Cada archivo tiene su receta y NO son intercambiables:
#   · icon-192/512          ← favicon.svg, con alfa (esquinas redondeadas rx=8)
#   · icon-maskable-192/512 ← icon-maskable.svg, a sangre y opaco (el recorte
#                             adaptable de Android muerde los bordes)
#   · apple-touch-icon-180  ← favicon.svg aplanado sobre el color de marca: iOS
#                             no quiere alfa, compone lo transparente en negro
#
# Requiere rsvg-convert (librsvg) e ImageMagick. En Debian/Ubuntu:
#   sudo apt install librsvg2-bin imagemagick
#
#   sh scripts/generar-iconos.sh
set -eu

cd "$(dirname "$0")/.."

for bin in rsvg-convert convert; do
  command -v "$bin" >/dev/null 2>&1 || { echo "falta $bin — ver cabecera de este script"; exit 1; }
done

# Fondo del icono de Apple: el final del degradado de favicon.svg, o sea el
# --accent-2 del tema claro. Si cambia la paleta, cambia aquí.
APPLE_BG='#0d4f4d'

echo "icons/icon-192.png"
rsvg-convert -w 192 -h 192 favicon.svg -o icons/icon-192.png
echo "icons/icon-512.png"
rsvg-convert -w 512 -h 512 favicon.svg -o icons/icon-512.png

echo "icons/icon-maskable-192.png"
rsvg-convert -w 192 -h 192 icon-maskable.svg -o icons/icon-maskable-192.png
echo "icons/icon-maskable-512.png"
rsvg-convert -w 512 -h 512 icon-maskable.svg -o icons/icon-maskable-512.png

echo "icons/apple-touch-icon-180.png (aplanado sobre $APPLE_BG)"
rsvg-convert -w 180 -h 180 favicon.svg -o /tmp/apple-touch-180.png
convert /tmp/apple-touch-180.png -background "$APPLE_BG" -alpha remove -alpha off \
  icons/apple-touch-icon-180.png
rm -f /tmp/apple-touch-180.png

echo "listo"
