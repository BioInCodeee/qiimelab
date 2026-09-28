# Gate de tests compartido por .githooks/pre-commit y .githooks/pre-push.
# Se carga con "." desde los hooks; no se ejecuta solo.
#
# gate <etiqueta> <directorio con el árbol a probar> [argumentos de run.mjs]
# Corre tests/run.mjs DENTRO de ese directorio (una copia exacta de lo que se
# va a commitear/empujar, no el árbol de trabajo) y bloquea si algo falla.

gate() {
  label=$1; dir=$2; shift 2
  log="${TMPDIR:-/tmp}/smart175-gate-$(printf '%s' "$label" | tr -c 'A-Za-z0-9' '-').log"
  if ! command -v node >/dev/null 2>&1; then
    echo "✗ BLOQUEADO ($label): no se encuentra 'node' para correr los tests."
    echo "  Saltarlo conscientemente: ver \"Gate de tests\" en tests/README.md"
    rm -rf "$dir"; return 1
  fi
  echo "▶ Gate de tests ($label): node tests/run.mjs $* — log en $log"
  if node "$dir/tests/run.mjs" "$@" >"$log" 2>&1; then
    echo "✓ Gate de tests ($label): $(grep -E '^  [0-9]+ tests · ' "$log" | sed 's/^ *//')"
    rm -rf "$dir"; return 0
  fi
  echo ""
  echo "✗ BLOQUEADO ($label): la suite de tests no pasa entera."
  # solo el bloque RESUMEN del runner (la salida de cada test puede contener "FALLA")
  fails=$(sed -n '/^RESUMEN$/,$p' "$log" | grep -E '^  FALLA ' | sed 's/^  FALLA */    · /')
  if [ -n "$fails" ]; then
    echo "  Tests que fallan:"
    echo "$fails"
    echo "  $(grep -E '^  [0-9]+ tests · ' "$log" | sed 's/^ *//')"
  else
    echo "  El runner no llegó al resumen; últimas líneas del log:"
    tail -n 15 "$log" | sed 's/^/    /'
  fi
  echo ""
  echo "  Log completo:      $log"
  echo "  Repetir uno solo:  node tests/run.mjs <nombre-del-test>"
  echo "  Saltar el gate a conciencia (p. ej. solo documentación):"
  echo "      git commit --no-verify …   /   git push --no-verify"
  echo "      (o SMART175_SKIP_TESTS=1 delante del comando)"
  rm -rf "$dir"; return 1
}
