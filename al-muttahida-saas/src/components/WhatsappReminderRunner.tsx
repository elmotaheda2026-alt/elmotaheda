import { useEffect } from 'react';
import { runDailyWhatsappReminders } from '../lib/whatsappReminders';

export default function WhatsappReminderRunner({ enabled }: { enabled?: boolean }) {
  useEffect(() => {
    if (!enabled) return;

    let disposed = false;

    const run = async () => {
      if (disposed) return;
      await runDailyWhatsappReminders();
    };

    void run();
    const interval = window.setInterval(run, 60 * 60 * 1000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [enabled]);

  return null;
}