export interface TelegramApp {
  initData: string;
  platform?: string;
  version?: string;
  colorScheme?: 'light' | 'dark';
  initDataUnsafe?: { user?: { language_code?: string } };
  viewportStableHeight?: number;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  ready(): void;
  expand(): void;
  close?(): void;
  requestFullscreen?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent?(name: string, callback: (...args: unknown[]) => void): void;
  offEvent?(name: string, callback: (...args: unknown[]) => void): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(fn: () => void): void;
    offClick(fn: () => void): void;
  };
  SecureStorage?: {
    getItem(key: string, cb: (error: string | null, value: string | null) => void): void;
    setItem(key: string, value: string, cb?: (error: string | null) => void): void;
    removeItem(key: string, cb?: (error: string | null) => void): void;
  };
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramApp };
  }
}
export const telegram = () => window.Telegram?.WebApp;
export function setupTelegram() {
  const app = telegram();
  const update = () => {
    const physicalHeight = window.visualViewport?.height || window.innerHeight;
    const height = Math.min(app?.viewportStableHeight || physicalHeight, physicalHeight);
    document.documentElement.style.setProperty('--viewport-height', `${height}px`);
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      const inset = Math.max(
        app?.safeAreaInset?.[edge] || 0,
        app?.contentSafeAreaInset?.[edge] || 0,
      );
      document.documentElement.style.setProperty(
        `--safe-${edge}`,
        `max(env(safe-area-inset-${edge}, 0px), ${inset}px)`,
      );
    }
  };
  app?.ready();
  app?.expand();
  update();
  const events = ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged'];
  events.forEach((event) => app?.onEvent?.(event, update));
  window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
  return () => {
    events.forEach((event) => app?.offEvent?.(event, update));
    window.removeEventListener('resize', update);
    window.visualViewport?.removeEventListener('resize', update);
  };
}
