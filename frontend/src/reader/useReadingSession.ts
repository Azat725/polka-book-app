import { useEffect, useRef } from 'react';
import { api } from '../shared/api';
import { readingInterval } from './geometry';

export function useReadingSession(bookId: string, enabled: boolean) {
  const interaction = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    interaction.current = Date.now();
    let active = true;
    let sessionId: string | undefined;
    let previous = Date.now();
    let sending = false;
    const interact = () => {
      interaction.current = Date.now();
    };
    void api<{ id: string }>('/reading-sessions/', {
      method: 'POST',
      body: JSON.stringify({ book_id: bookId }),
    })
      .then((result) => {
        if (active) sessionId = result.id;
      })
      .catch(() => undefined);
    async function heartbeat(closed = false) {
      const now = Date.now();
      const seconds = readingInterval(
        previous,
        now,
        document.visibilityState === 'visible',
        interaction.current,
      );
      previous = now;
      if (!sessionId || sending) return;
      sending = true;
      try {
        await api(`/reading-sessions/${sessionId}/heartbeats/`, {
          method: 'POST',
          body: JSON.stringify({
            seconds,
            active: seconds > 0,
            closed,
            client_mutation_id: crypto.randomUUID(),
          }),
        });
      } catch {
        /* Reading remains available when statistics cannot sync. */
      } finally {
        sending = false;
      }
    }
    const timer = setInterval(() => {
      void heartbeat();
    }, 15_000);
    const visibility = () => {
      void heartbeat();
    };
    document.addEventListener('visibilitychange', visibility);
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    for (const name of events)
      window.addEventListener(name, interact, { capture: true, passive: true });
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      void heartbeat(true);
      for (const name of events) window.removeEventListener(name, interact, true);
    };
  }, [bookId, enabled]);
}
