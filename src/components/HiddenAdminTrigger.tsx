'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Logo } from './Logo';

/**
 * Footer logo with the hidden way into the Admin Panel:
 * triple-click (or triple-tap) the logo, or press Ctrl + Shift + A.
 */
export function HiddenAdminTrigger() {
  const router = useRouter();
  const clicks = useRef<number[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        router.push('/admin');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <span
      className="inline-flex cursor-default select-none"
      onClick={() => {
        const now = Date.now();
        clicks.current = [...clicks.current.filter((t) => now - t < 900), now];
        if (clicks.current.length >= 3) {
          clicks.current = [];
          router.push('/admin');
        }
      }}
    >
      <Logo size={26} />
    </span>
  );
}
