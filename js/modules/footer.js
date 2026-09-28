// Pie de página común a todas las vistas. Pequeño y discreto: autoría
// (BioInCode), contacto y enlace al repositorio. Vive fuera de #app-view,
// así que no lo tocan los módulos al repintar.

import { t } from '../lib/i18n.js';
import { pwa } from '../lib/pwa.js';

const REPO_URL = 'https://github.com/BioInCodeee/qiimelab';
const CONTACT = 'bioincode.info@gmail.com';

export function renderFooter(el) {
  if (!el) return;
  el.innerHTML =
    '<div class="ql-footer-inner">' +
    '<span class="ql-footer-brand">Smart-175</span>' +
    '<span class="ql-footer-sep" aria-hidden="true">·</span>' +
    '<span class="ql-footer-by">' + t('footer.by') + ' <strong>BioInCode</strong></span>' +
    '<a class="ql-footer-link" href="mailto:' + CONTACT + '">' + CONTACT + '</a>' +
    '<a class="ql-footer-link" href="' + REPO_URL + '" target="_blank" rel="noopener noreferrer">' + t('footer.source') + '</a>' +
    '</div>';

  // Botón "Instalar app": solo si el navegador ofreció beforeinstallprompt
  // (Chromium en la web; oculto en el resto y una vez instalada).
  if (pwa.canInstall) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ql-footer-install';
    btn.textContent = t('pwa.install');
    btn.addEventListener('click', () => pwa.promptInstall());
    el.querySelector('.ql-footer-inner').appendChild(btn);
  }
}
