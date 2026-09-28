// Página de validación estadística: ejecuta EN VIVO las fórmulas de
// js/lib/stats.js y las compara con los valores de referencia de R (los mismos
// GOLDEN que usa la batería tests/stats/). Sin estado ni datos que cargar.

import { t } from '../lib/i18n.js';
import { pageHero } from '../lib/brand.js';
import { runValidation } from '../lib/statsValidation.js';

function fmtErr(x) {
  if (!isFinite(x)) return '—';
  if (x === 0) return '0';
  return x.toExponential(1);
}

export function render(container) {
  container.innerHTML = '';

  const results = runValidation();
  const nPass = results.filter((r) => r.pass).length;
  const allPass = nPass === results.length;

  container.appendChild(pageHero({
    eyebrowHtml: t('validacion.eyebrow'),
    titleHtml: t('validacion.title'),
    subHtml: t('validacion.subtitle'),
  }));

  const stack = document.createElement('div');
  stack.className = 'ql-stack';

  // resumen
  const sum = document.createElement('section');
  sum.className = 'ql-card ql-panel ql-health-banner is-' + (allPass ? 'good' : 'error');
  sum.setAttribute('role', 'status');
  sum.innerHTML = '<div class="ql-health-banner-row">' +
    '<span class="ql-health-light" aria-hidden="true" style="background:' + (allPass ? '#1a9e57' : '#d33a3a') +
    ';box-shadow:0 0 0 4px color-mix(in srgb, ' + (allPass ? 'var(--good)' : 'var(--critical)') + ' 18%, transparent);"></span>' +
    '<div class="ql-health-banner-txt"><strong>' +
    t(allPass ? 'validacion.allPass' : 'validacion.someFail', { n: nPass, total: results.length }) +
    '</strong><span class="ql-health-banner-sub">' + t('validacion.recomputed') + '</span></div></div>';
  stack.appendChild(sum);

  // tabla
  const card = document.createElement('section');
  card.className = 'ql-card ql-panel';
  card.innerHTML = '<h2>' + t('validacion.tableTitle') + '</h2><p class="ql-panel-note">' + t('validacion.tableNote') + '</p>';
  const scroll = document.createElement('div');
  scroll.className = 'ql-table-scroll scroll-x';
  const tbl = document.createElement('table');
  tbl.className = 'ql-table';
  tbl.innerHTML = '<thead><tr>' +
    ['', t('validacion.colFormula'), t('validacion.colRef'), t('validacion.colN'), t('validacion.colRelErr'), t('validacion.colTol')]
      .map((h) => '<th>' + h + '</th>').join('') +
    '</tr></thead>';
  const tb = document.createElement('tbody');
  results.forEach((r) => {
    const tr = document.createElement('tr');
    const badge = r.pass
      ? '<span style="color:var(--good-ink);font-weight:600;">✓</span>'
      : '<span style="color:var(--critical);font-weight:600;">✗</span>';
    tr.innerHTML =
      '<td>' + badge + '</td>' +
      '<td>' + t('validacion.f.' + r.key) + '</td>' +
      '<td class="ql-cell-muted"><span class="mono" style="font-size:11.5px;">' + r.ref + '</span></td>' +
      '<td class="ql-num tabular">' + (r.n != null ? r.n : '—') + '</td>' +
      '<td class="ql-num tabular">' + (r.error ? '<span style="color:var(--critical);">' + r.error + '</span>' : fmtErr(r.maxRelErr)) + '</td>' +
      '<td class="ql-num tabular">' + r.tol.toExponential(0) + '</td>';
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  scroll.appendChild(tbl);
  card.appendChild(scroll);

  const foot = document.createElement('p');
  foot.className = 'ql-field-help';
  foot.style.marginTop = '12px';
  foot.innerHTML = t('validacion.foot');
  card.appendChild(foot);
  stack.appendChild(card);

  // qué NO está aquí
  const gaps = document.createElement('section');
  gaps.className = 'ql-card ql-panel';
  gaps.innerHTML = '<h2>' + t('validacion.gapsTitle') + '</h2>' +
    '<ul class="ql-fmt-guide"><li>' + t('validacion.gapRare') + '</li>' +
    '<li>' + t('validacion.gapRichness') + '</li>' +
    '<li>' + t('validacion.gapUpgma') + '</li></ul>';
  stack.appendChild(gaps);

  container.appendChild(stack);
}
