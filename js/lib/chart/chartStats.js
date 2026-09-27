// chartStats.js — sección "Significación estadística" (asteriscos/p exacto,
// umbral, método de ajuste).
//
// Parte del editor de figuras troceado desde js/lib/chartEditor.js (Fase 0b,
// sin cambios de comportamiento). Reparto y patrón `ctx`: js/lib/chart/chartEditor.js.

export function createStats(ctx) {
  const { T, cfg, statsControls, writeStore } = ctx;

  // ---- significación estadística (Paso 3 de qiimelab-prompt-editor-fase-1-
  // anotaciones-estadisticas.md) — a diferencia de estilo/paleta/geometría,
  // un cambio aquí obliga a RECALCULAR qué pares son significativos (no solo
  // repintar), así que se resuelve entero en cfg.onStatsChange (mismo
  // patrón que onReset: el módulo vuelve a llamar a su función de pintado).
  function statsOverrides() { return ctx.store.__stats || {}; }

  function setStatsValue(id, val) {
    const s = (ctx.store.__stats = ctx.store.__stats || {});
    if (val === '' || val === undefined || val === null) delete s[id]; else s[id] = val;
    if (!Object.keys(s).length) delete ctx.store.__stats;
    writeStore();
    if (cfg.onStatsChange) try { cfg.onStatsChange(ctx.store.__stats || {}); } catch (e) { /* noop */ }
  }

  function statsRow(labelText, controlEl) {
    const row = document.createElement('div');
    row.className = 'ce-stats-row';
    const id = 'ce-stats-' + (++ctx.cePanelUid);
    const lab = document.createElement('label');
    lab.setAttribute('for', id);
    lab.textContent = labelText;
    row.appendChild(lab);
    controlEl.id = id;
    row.appendChild(controlEl);
    return row;
  }

  function statsSelect(current, options, onChange) {
    const sel = document.createElement('select');
    options.forEach(([val, label]) => {
      const o = document.createElement('option'); o.value = val; o.textContent = label;
      if (val === current) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function renderStatsSection() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-stats';
    wrap.innerHTML = '<h5>' + T.statsTitle + '</h5>';

    const rows = document.createElement('div');
    rows.className = 'ce-stats-rows';
    const s = statsOverrides();
    const mode = s.mode || 'stars+exact';

    rows.appendChild(statsRow(T.statsMode, statsSelect(mode, [
      ['stars', T.statsModeStars], ['exact', T.statsModeExact], ['stars+exact', T.statsModeBoth],
    ], (v) => setStatsValue('mode', v))));

    if (mode !== 'stars') {
      rows.appendChild(statsRow(T.statsStyle, statsSelect(s.style || 'gp', [
        ['gp', 'GraphPad'], ['apa', 'APA'], ['nejm', 'NEJM'],
      ], (v) => setStatsValue('style', v))));
    }

    const thresholdInp = document.createElement('input');
    thresholdInp.type = 'number'; thresholdInp.min = '0'; thresholdInp.max = '1'; thresholdInp.step = '0.01';
    thresholdInp.value = s.threshold != null ? s.threshold : 0.05;
    thresholdInp.addEventListener('change', () => {
      const v = parseFloat(thresholdInp.value);
      if (!Number.isFinite(v)) return;
      setStatsValue('threshold', Math.max(0, Math.min(1, v)));
    });
    rows.appendChild(statsRow(T.statsThreshold, thresholdInp));

    if (statsControls.hasMultiGroup) {
      rows.appendChild(statsRow(T.statsMethod, statsSelect(s.method || 'holm', [
        ['holm', 'Holm'], ['BH', 'Benjamini-Hochberg'], ['bonferroni', 'Bonferroni'],
        ['hochberg', 'Hochberg'], ['BY', 'Benjamini-Yekutieli'],
      ], (v) => setStatsValue('method', v))));
    }

    // Auto-selección de test (prompt "quick wins" 22 sep 2026, punto 2):
    // diagnóstico de normalidad (Shapiro-Wilk)/homogeneidad de varianzas
    // (Levene) que trae ya calculado el propio módulo (groupBoxplot.js,
    // vía js/lib/statAutoSelect.js) -- aquí solo se explica en lenguaje
    // llano y se deja el selector manual para forzar otro test.
    if (statsControls.diagnostic) {
      const d = statsControls.diagnostic;
      // qué test se aplica DE VERDAD y por qué (no solo "recomendado"): el
      // automático nombra el que eligió; si se fuerza otro a mano, se dice y
      // se mantiene visible lo que habría elegido el automático
      const TEST_NAME = {
        student: T.statsTestStudent, welch: T.statsTestWelch, mannwhitney: T.statsTestMW,
        'paired-t': T.statsTestPairedT, 'wilcoxon-signed': T.statsTestWilcoxonSigned,
        'anova-tukey': T.statsTestAnovaTukey, 'welch-anova-gh': T.statsTestWelchGH, 'kruskal-dunn': T.statsTestKruskalDunn,
      };
      const autoName = TEST_NAME[d.recommended] || null;
      const forced = s.testOverride && TEST_NAME[s.testOverride];
      const box = document.createElement('div');
      box.className = 'ce-stats-diagnostic';
      const applied = document.createElement('p');
      applied.className = 'ce-stats-applied';
      const strong = document.createElement('strong');
      strong.textContent = forced || autoName || '—';
      applied.append(T.statsApplied + ' ', strong, ' ' + (forced ? T.statsAppliedManual : T.statsAppliedAuto));
      box.appendChild(applied);
      const why = document.createElement('p');
      why.textContent = (forced && autoName ? T.statsAutoWouldBe(autoName) : T.statsWhy) + ' ' + d.reason;
      box.appendChild(why);
      rows.appendChild(box);

      const autoLabel = autoName ? T.statsTestAutoApplied(autoName) : T.statsTestAuto;
      const testOptions2 = [['auto', autoLabel], ['student', T.statsTestStudent], ['welch', T.statsTestWelch], ['mannwhitney', T.statsTestMW]];
      const testOptionsK = [['auto', autoLabel], ['anova-tukey', T.statsTestAnovaTukey], ['welch-anova-gh', T.statsTestWelchGH], ['kruskal-dunn', T.statsTestKruskalDunn]];
      rows.appendChild(statsRow(T.statsTestLabel, statsSelect(s.testOverride || 'auto', statsControls.hasMultiGroup ? testOptionsK : testOptions2,
        (v) => setStatsValue('testOverride', v === 'auto' ? '' : v))));
    }

    wrap.appendChild(rows);
    return wrap;
  }

  return { renderStatsSection };
}
