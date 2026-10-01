'use client';

import { useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';
import { describeActionFailure } from '@/lib/actionError';
import { pushToast } from './Toaster';

type Result = { ok: boolean; message: string };

/** Button that runs a Server Action, shows its result as a toast and refreshes the page data. */
export function ActionButton({
  action,
  children,
  className = 'btn-primary',
  confirmText,
  disabled,
  ariaLabel,
}: {
  action: () => Promise<Result>;
  children: ReactNode;
  className?: string;
  confirmText?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      disabled={pending || disabled}
      aria-busy={pending}
      aria-label={ariaLabel}
      onClick={() => {
        if (confirmText && !window.confirm(confirmText)) return;
        startTransition(async () => {
          let result: Result;
          try {
            result = await action();
          } catch {
            // The call never reached the action: usually a page older than the running app.
            const failure = describeActionFailure();
            pushToast({ title: failure.message, alert: true });
            if (failure.stale) window.setTimeout(() => window.location.reload(), 1200);
            return;
          }
          pushToast({ title: result.message, alert: !result.ok });
          router.refresh();
        });
      }}
    >
      {pending ? 'Please wait…' : children}
    </button>
  );
}
