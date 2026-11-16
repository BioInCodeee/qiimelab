// Tardi — la mascota de Smart-175 (un tardígrado, el animal que sobrevive a
// todo, como los datos de campo reales).
//
// Decidida en el sistema de diseño Agar (design-system/smart-175/AGAR.md) y
// construida aquí: SVG PLANO dibujado a mano (sin imágenes, sin librerías,
// sin gradientes ni ids internos — no hay defs, así que ninguna instancia
// puede chocar con otra), con SEIS ESTADOS y un ajuste de «modo sobrio» que
// la desactiva por completo.
//
// Reglas de Agar que este archivo no puede romper:
//   - El color de la mascota es el TERRACOTA (--tardi-*), nunca el de marca
//     ni los colores de datos. No compite con ninguna figura: solo aparece en
//     estados vacíos y la portada, nunca dentro de un gráfico.
//   - role="img" con aria-label que describe EL ESTADO, no el animal: quien
//     usa un lector de pantalla oye «Sin datos cargados todavía», no «tardi».
//   - Todo el movimiento va detrás de prefers-reduced-motion (CSS), y el
//     atributo data-sobrio en <html> la esconde entera.
//
// La animación es CSS (css/components.css, bloque «mascota Tardi»), no JS:
// estados vacíos y portada repintan a menudo, y un transform CSS no cuesta
// ni un cálculo por frame del hilo principal.

import { escapeHtml } from './dom.js';
import { t } from './i18n.js';

/** Los seis estados del sistema de diseño, en este orden de uso. */
export const TARDI_STATES = ['idle', 'busy', 'ready', 'warn', 'error', 'celebrate'];

const INK = 'var(--ink)';
const BODY = 'var(--tardi-body)';
const DEEP = 'var(--tardi-deep)';
const SOFT = 'var(--tardi-soft)';

// ---- piezas compartidas ----------------------------------------------------

/** Disco de fondo que asienta la mascota (el «pozo de agar») + sombra. */
function base() {
  return '<circle cx="66" cy="46" r="44" fill="' + SOFT + '"/>' +
    '<ellipse cx="62" cy="80" rx="42" ry="3.2" fill="' + DEEP + '" opacity=".14"/>';
}

/** Cuerpo: cápsula regordeta con la segmentación de cutícula del tardígrado. */
function bodyShape() {
  return '<path d="M16 46 C16 30 30 21 50 20 C76 18 114 25 115 45 C115.5 58 100 65 74 66 C46 67 16 62 16 46 Z" fill="' + BODY + '"/>' +
    '<g fill="none" stroke="' + DEEP + '" stroke-width="2.2" stroke-linecap="round" opacity=".32">' +
    '<path d="M46 20.5 C44 34 44 50 47 65.5"/>' +
    '<path d="M74 18.5 C72 34 72 50 74 66"/>' +
    '</g>';
}

/** Las cuatro patas visibles de perfil (el tardígrado tiene ocho, en cuatro pares). */
function legs() {
  return '<g fill="' + DEEP + '">' +
    '<rect x="27" y="60" width="9" height="16" rx="4.5"/>' +
    '<rect x="49" y="62" width="9" height="16" rx="4.5"/>' +
    '<rect x="71" y="62" width="9" height="16" rx="4.5"/>' +
    '<rect x="93" y="60" width="9" height="16" rx="4.5" transform="rotate(5 97.5 60)"/>' +
    '</g>';
}

/** Ojos abiertos (puntos): idle y ready. La animación de parpadeo los escala. */
function eyesOpen() {
  return '<g class="ql-tardi-eyes" fill="' + INK + '">' +
    '<circle cx="29" cy="39" r="2.8"/>' +
    '<circle cx="40" cy="39" r="2.8"/>' +
    '</g>';
}

/** Ojos entornados (mirando su trabajo): busy. */
function eyesHalf() {
  return '<g fill="none" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round">' +
    '<path d="M26 39.5 H32"/><path d="M37 39.5 H43"/>' +
    '</g>';
}

/** Ojos en X (aturdido): error. */
function eyesX() {
  return '<g fill="none" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round">' +
    '<path d="M26.5 36.5 L31.5 41.5 M31.5 36.5 L26.5 41.5"/>' +
    '<path d="M37.5 36.5 L42.5 41.5 M42.5 36.5 L37.5 41.5"/>' +
    '</g>';
}

/** Ojos cerrados de felicidad (∩∩): celebrate. */
function eyesHappy() {
  return '<g fill="none" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round" fill="none">' +
    '<path d="M25.5 39 Q29 34.5 32.5 39"/>' +
    '<path d="M36.5 39 Q40 34.5 43.5 39"/>' +
    '</g>';
}

function mouthSmile() {
  return '<path d="M27 47.5 Q34 52.5 41 47.5" fill="none" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round"/>';
}

function mouthBig() {
  return '<path d="M26 47 Q34 54.5 42 47" fill="none" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/>';
}

function mouthO() {
  return '<circle cx="34" cy="49" r="2.6" fill="none" stroke="' + INK + '" stroke-width="2.2"/>';
}

function mouthWorried() {
  return '<path d="M28 50 Q34 45.5 40 50" fill="none" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round"/>';
}

function mouthWavy() {
  return '<path d="M27 49.5 L31 48 L35 50 L39 48.5" fill="none" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
}

function mouthOpen() {
  return '<path d="M26.5 46 A7.5 7.5 0 0 0 41.5 46 Z" fill="' + DEEP + '"/>';
}

/** Rubor: dos elipses del mismo tono, más oscuro. */
function cheeks() {
  return '<g fill="' + DEEP + '" opacity=".28">' +
    '<ellipse cx="23" cy="45.5" rx="3.4" ry="2.1"/>' +
    '<ellipse cx="46" cy="44.5" rx="3.4" ry="2.1"/>' +
    '</g>';
}

/** Insignia circular con check (ready). Terracota, nunca color de datos. */
function badgeCheck() {
  return '<g class="ql-tardi-badge">' +
    '<circle cx="117" cy="15" r="10.5" fill="' + SOFT + '" stroke="' + BODY + '" stroke-width="2.4"/>' +
    '<path d="M111.5 15.5 L115.3 19.3 L122.5 11.8" fill="none" stroke="' + DEEP + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</g>';
}

/** Insignia triangular de aviso (warn). */
function badgeAlert() {
  return '<g class="ql-tardi-badge">' +
    '<path d="M117 6 L128.5 24.5 L105.5 24.5 Z" fill="' + SOFT + '" stroke="' + BODY + '" stroke-width="2.4" stroke-linejoin="round"/>' +
    '<path d="M117 12.5 V17.5" stroke="' + DEEP + '" stroke-width="2.6" stroke-linecap="round"/>' +
    '<circle cx="117" cy="21.2" r="1.5" fill="' + DEEP + '"/>' +
    '</g>';
}

/** Insignia circular con X (error). */
function badgeX() {
  return '<g class="ql-tardi-badge">' +
    '<circle cx="117" cy="15" r="10.5" fill="' + SOFT + '" stroke="' + BODY + '" stroke-width="2.4"/>' +
    '<path d="M112.8 10.8 L121.2 19.2 M121.2 10.8 L112.8 19.2" stroke="' + DEEP + '" stroke-width="2.6" stroke-linecap="round"/>' +
    '</g>';
}

/** Lupa de análisis (busy). Va delante del morro, mirando hacia la izquierda. */
function glass() {
  return '<g class="ql-tardi-prop">' +
    '<circle cx="12" cy="55" r="8" fill="' + SOFT + '" stroke="' + INK + '" stroke-width="2.4"/>' +
    '<path d="M18 61 L25.5 68.5" stroke="' + INK + '" stroke-width="3.2" stroke-linecap="round"/>' +
    '</g>';
}

/** Confeti (celebrate): terracota, teal de marca y ámbar de resalte. Es
 *  decoración de interfaz, no una figura: los tres colores están permitidos
 *  fuera de un gráfico. */
function confetti() {
  return '<g class="ql-tardi-confetti">' +
    '<rect x="54" y="10" width="4.5" height="7.5" rx="1.2" fill="' + BODY + '" transform="rotate(20 56 14)"/>' +
    '<circle cx="72" cy="7" r="2.6" fill="var(--tardi-deep)"/>' +
    '<rect x="86" y="12" width="4.5" height="7.5" rx="1.2" fill="var(--highlight)" transform="rotate(-15 88 16)"/>' +
    '<circle cx="101" cy="6.5" r="2.4" fill="' + DEEP + '"/>' +
    '<rect x="42" y="17" width="4" height="6.5" rx="1.1" fill="var(--highlight)" transform="rotate(-25 44 20)"/>' +
    '<circle cx="112" cy="28" r="2.4" fill="var(--tardi-body)"/>' +
    '</g>';
}

/** Cejas preocupadas (warn). */
function browsWorried() {
  return '<g fill="none" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round">' +
    '<path d="M25 34 L32 31.8"/><path d="M38 31.8 L45 34"/>' +
    '</g>';
}

/** El cuerpo completo de cada estado, compuesto pieza a pieza para que cada
 *  pose se lea sola. `pose()` pinta cuerpo + cara; las insignias y el confeti
 *  van FUERA del grupo animado (no deben mecerse con él). */
function pose({ eyes, mouth, prop, brows }) {
  return '<g class="ql-tardi-body">' +
    base() +
    legs() +
    bodyShape() +
    cheeks() +
    (brows || '') +
    eyes +
    mouth +
    (prop || '') +
    '</g>';
}

const PARTS = {
  idle: pose({ eyes: eyesOpen(), mouth: mouthSmile() }),
  busy: pose({ eyes: eyesHalf(), mouth: mouthO(), prop: glass() }),
  ready: pose({ eyes: eyesOpen(), mouth: mouthBig() }) + badgeCheck(),
  warn: pose({ eyes: eyesOpen(), mouth: mouthWorried(), brows: browsWorried() }) + badgeAlert(),
  error: pose({ eyes: eyesX(), mouth: mouthWavy() }) + badgeX(),
  celebrate: pose({ eyes: eyesHappy(), mouth: mouthOpen() }) + confetti(),
};

/**
 * HTML de la mascota: `<div class="ql-tardi-wrap"><svg role="img" …/></div>`.
 * Se inserta con innerHTML como el resto de la app; el único contenido que no
 * es literal propio es el aria-label, que sale del diccionario i18n.
 *
 * @param {string} [state='idle'] uno de TARDI_STATES (desconocido → idle)
 * @param {{ lg?: boolean }} [opts] lg = tamaño grande (portada)
 * @returns {string}
 */
export function tardiHtml(state = 'idle', opts = {}) {
  const s = TARDI_STATES.includes(state) ? state : 'idle';
  const cls = 'ql-tardi-wrap' + (opts.lg ? ' ql-tardi-lg' : '');
  return '<div class="' + cls + '">' +
    '<svg class="ql-tardi" viewBox="0 0 132 92" role="img" data-state="' + s + '" aria-label="' +
    escapeHtml(t('tardi.' + s)) + '">' + PARTS[s] + '</svg>' +
    '</div>';
}

// ---- modo sobrio -----------------------------------------------------------
//
// AGAR.md: «un ajuste de modo sobrio que la desactive». Mismo patrón que
// theme.js / density.js: preferencia en localStorage + atributo en <html> que
// lee el CSS ([data-sobrio="on"] .ql-tardi-wrap { display:none }). El CSS
// basta para ocultarla donde ya esté pintada: no hace falta repintar módulos.

const SOB_KEY = 'smart-175.sobrio';
const listeners = new Set();

/** Por defecto la mascota está ANIMADA: quien no toca los ajustes la ve. */
export const DEFAULT_SOBRO = false;

/** ¿Modo sobrio activo? (la mascota oculta) */
export function getSobrio() {
  try { return localStorage.getItem(SOB_KEY) === '1'; }
  catch (e) { return DEFAULT_SOBRO; }
}

/** Escribe el atributo que lee el CSS. Sin DOM (node), no-op. */
export function applyDataSobrio(on) {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute('data-sobrio', 'on');
  else document.documentElement.removeAttribute('data-sobrio');
}

/** Guarda, aplica y avisa a los suscriptores. */
export function setSobrio(on) {
  const v = Boolean(on);
  try { localStorage.setItem(SOB_KEY, v ? '1' : '0'); } catch (e) { /* cuota/privado */ }
  applyDataSobrio(v);
  listeners.forEach((fn) => { try { fn(v); } catch (e) { /* noop */ } });
  return v;
}

/** Se llama una vez al arrancar la app (igual que initTheme). */
export function initSobrio() {
  applyDataSobrio(getSobrio());
}

/** Se ejecuta `fn(on)` cada vez que cambia. Devuelve función para desuscribir. */
export function onSobrioChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
