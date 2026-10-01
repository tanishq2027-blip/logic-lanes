'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '../Icon';
import { pushToast } from '../Toaster';

/** Asks the Edge AI route for a fresh goods and route briefing (Gemini, then Groq, then the built-in writer). */
export function BriefingButton({ jobCardId }: { jobCardId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn-secondary px-4 py-2 text-sm"
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch('/api/ai/summary', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jobCardId }),
          });
          const data = (await res.json()) as { ok: boolean; message?: string };
          if (!data.ok) pushToast({ title: data.message ?? 'Could not refresh the briefing.', alert: true });
          router.refresh();
        } catch {
          pushToast({ title: 'Could not refresh the briefing.', alert: true });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="refresh" size={18} />
      {busy ? 'Updating…' : 'Update briefing'}
    </button>
  );
}
