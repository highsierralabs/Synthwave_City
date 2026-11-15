// The DOM around the canvas (plan T12, M2 and M3): overlay states, menu rows, HUD, toasts, stats.
// Plain DOM; index.html holds the markup and the styles.
import { MOOD_ORDER, MOODS, type MoodId } from '../contracts/moods';
import { QUALITY_ORDER, type QualityTier } from '../contracts/quality';

export type AppState = 'loading' | 'title' | 'running' | 'error';

/** How full screen is offered: a switch, a home-screen hint (no API, as on iPhone), or not at all. */
export type FullscreenOffer = 'api' | 'hint' | 'none';

export interface UiHandlers {
  onEnter(): void;
  onMood(id: MoodId): void;
  onTier(tier: QualityTier): void;
  onSound(on: boolean): void;
  onCrt(on: boolean): void;
  onFullscreen(on: boolean): void;
  onMenu(): void;
}

export interface Ui {
  readonly canvas: HTMLCanvasElement;
  setState(state: AppState): void;
  readonly state: AppState;
  setProgress(fraction: number, label: string): void;
  showError(html: string): void;
  setMood(id: MoodId): void;
  setTier(tier: QualityTier): void;
  setSound(on: boolean): void;
  setCrt(on: boolean): void;
  setFullscreenOffer(offer: FullscreenOffer): void;
  setFullscreen(on: boolean): void;
  setMode(label: string): void;
  setHint(text: string): void;
  toast(text: string): void;
  setStats(text: string): void;
  toggle(name: 'photo' | 'stats' | 'lost', on?: boolean): boolean;
  /** After the first ENTER the button reads RESUME. */
  setEntered(): void;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html is missing #${id}`);
  return el as T;
}

const TIER_LABEL: Record<QualityTier, string> = { low: 'Low', medium: 'Medium', high: 'High' };

export function createUi(handlers: UiHandlers): Ui {
  const body = document.body;
  const canvas = byId<HTMLCanvasElement>('view');
  const bar = byId('bar').firstElementChild as HTMLElement;
  const status = byId('status');
  const message = byId('message');
  const enter = byId<HTMLButtonElement>('enter');
  const moods = byId('moods');
  const tiers = byId('tiers');
  const sound = byId('sound');
  const look = byId('look');
  const fsChoice = byId('fsChoice');
  const fsButton = byId('fsButton');
  const mode = byId('mode');
  const hint = byId('hint');
  const toastEl = byId('toast');
  const stats = byId('stats');
  let state: AppState = 'loading';

  const press = (group: HTMLElement, match: (b: HTMLButtonElement) => boolean): void => {
    for (const b of Array.from(group.querySelectorAll('button'))) b.setAttribute('aria-pressed', String(match(b)));
  };

  for (const id of MOOD_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = MOODS[id].name;
    b.dataset['mood'] = id;
    b.addEventListener('click', () => handlers.onMood(id));
    moods.appendChild(b);
  }
  for (const tier of QUALITY_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = TIER_LABEL[tier];
    b.dataset['tier'] = tier;
    b.addEventListener('click', () => handlers.onTier(tier));
    tiers.appendChild(b);
  }
  for (const b of Array.from(sound.querySelectorAll('button'))) {
    b.addEventListener('click', () => handlers.onSound(b.dataset['sound'] === 'on'));
  }
  for (const b of Array.from(look.querySelectorAll('button'))) {
    b.addEventListener('click', () => handlers.onCrt(b.dataset['crt'] === 'on'));
  }
  for (const b of Array.from(fsChoice.querySelectorAll('button'))) {
    b.addEventListener('click', () => handlers.onFullscreen(b.dataset['fs'] === 'on'));
  }
  // The HUD button flips whatever the state is; the page learns the result from the change event.
  // It stays on screen while flying, so it gives the focus back: a focused button keeps the keys.
  fsButton.addEventListener('click', () => {
    fsButton.blur();
    handlers.onFullscreen(!body.classList.contains('fs-on'));
  });
  enter.addEventListener('click', () => handlers.onEnter());
  byId('menuButton').addEventListener('click', () => handlers.onMenu());

  let toastTimer = 0;
  let hintTimer = 0;

  return {
    canvas,
    get state(): AppState {
      return state;
    },
    setState(next: AppState): void {
      state = next;
      body.dataset['state'] = next;
      if (next === 'title') enter.focus({ preventScroll: true });
    },
    setProgress(fraction: number, label: string): void {
      bar.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction)).toFixed(3)})`;
      if (label) status.textContent = label;
    },
    showError(html: string): void {
      message.innerHTML = html;
      state = 'error';
      body.dataset['state'] = 'error';
    },
    setMood(id: MoodId): void {
      press(moods, (b) => b.dataset['mood'] === id);
    },
    setTier(tier: QualityTier): void {
      press(tiers, (b) => b.dataset['tier'] === tier);
    },
    setSound(on: boolean): void {
      press(sound, (b) => (b.dataset['sound'] === 'on') === on);
    },
    setCrt(on: boolean): void {
      press(look, (b) => (b.dataset['crt'] === 'on') === on);
    },
    setFullscreenOffer(offer: FullscreenOffer): void {
      body.classList.toggle('fs-api', offer === 'api');
      body.classList.toggle('fs-hint', offer === 'hint');
    },
    setFullscreen(on: boolean): void {
      body.classList.toggle('fs-on', on);
      press(fsChoice, (b) => (b.dataset['fs'] === 'on') === on);
      fsButton.setAttribute('aria-pressed', String(on));
      fsButton.setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
    },
    setMode(label: string): void {
      mode.textContent = label;
    },
    setHint(text: string): void {
      hint.textContent = text;
      hint.classList.remove('faded');
      clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => hint.classList.add('faded'), 7000);
    },
    toast(text: string): void {
      toastEl.textContent = text;
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), 1800);
    },
    setStats(text: string): void {
      stats.textContent = text;
    },
    toggle(name: 'photo' | 'stats' | 'lost', on?: boolean): boolean {
      return body.classList.toggle(name, on);
    },
    setEntered(): void {
      enter.textContent = 'Resume';
    },
  };
}
