'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, useTransition } from 'react';
import { markNotificationsRead } from '@/app/actions/client';
import { respondToOffer } from '@/app/actions/driver';
import type { AppNotification, NotificationKind } from '@/lib/types';
import { ActionButton } from './ActionButton';
import { Icon, type IconName } from './Icon';
import { pushToast } from './Toaster';

export type FeedItem = AppNotification & {
  ago: string;
  /** Where the notification leads (an anchor on the same page). Makes the whole card clickable. */
  href?: string;
  hrefLabel?: string;
  /** Set for a job offer that is still open: the notification carries its own Accept / Reject buttons. */
  offerJobId?: string;
};

const ICONS: Record<NotificationKind, IconName> = {
  info: 'bell',
  offer: 'truck',
  assignment: 'truck',
  milestone: 'pin',
  delay: 'clock',
  reroute: 'route',
  incident: 'alert',
  backhaul: 'refresh',
  delivered: 'check',
};

const ALERT_KINDS: NotificationKind[] = ['delay', 'reroute', 'incident'];

/** Notification list. New arrivals also pop up as a toast and, if allowed, as a system notification. */
export function NotificationFeed({ items, role }: { items: FeedItem[]; role?: 'client' | 'driver' }) {
  const seen = useRef<Set<string> | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    for (const n of [...items].reverse()) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      const alert = ALERT_KINDS.includes(n.kind);
      pushToast({ title: n.title, body: n.body, alert });
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        try {
          new Notification(n.title, { body: n.body, tag: n.id });
        } catch {
          // Some mobile browsers only allow notifications from a service worker.
        }
      }
    }
  }, [items]);

  const unread = items.filter((n) => !n.read).length;

  return (
    <section aria-labelledby="notifications-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="notifications-title" className="flex items-center gap-2 text-2xl font-black">
          <Icon name="bell" size={26} className="text-midnight" />
          Notifications
          {unread > 0 ? <span className="chip-alert">{unread} new</span> : null}
        </h2>
        <div className="flex flex-wrap gap-2">
          {permission === 'default' ? (
            <button
              type="button"
              className="btn-secondary px-4 py-2 text-sm"
              onClick={async () => setPermission(await Notification.requestPermission())}
            >
              Turn on alerts
            </button>
          ) : null}
          {role && unread > 0 ? (
            <button
              type="button"
              className="btn-secondary px-4 py-2 text-sm"
              disabled={pending}
              onClick={() => startTransition(() => markNotificationsRead(role))}
            >
              Mark all read
            </button>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="muted mt-4 font-semibold">Nothing yet. Updates about your loads will appear here.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          <AnimatePresence initial={false}>
            {items.map((n) => {
              const alert = ALERT_KINDS.includes(n.kind);
              return (
                <motion.li
                  key={n.id}
                  layout
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`relative flex gap-4 rounded-2xl border border-noir/10 p-5 ${alert && !n.read ? 'bg-noir text-pearl' : 'bg-white/30'} ${
                    n.href ? 'transition-shadow hover:shadow-card-accent' : ''
                  }`}
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 ${
                      alert && !n.read ? 'border-pearl text-pearl' : 'border-noir bg-midnight text-pearl'
                    }`}
                  >
                    <Icon name={ICONS[n.kind]} size={22} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold leading-snug">
                      {n.href ? (
                        // The link's ::after covers the whole card, so the entire notification is the click target.
                        <a href={n.href} className="rounded underline-offset-4 after:absolute after:inset-0 after:rounded-2xl hover:underline">
                          {n.title}
                        </a>
                      ) : (
                        n.title
                      )}
                      {!n.read && !alert ? <span className="chip-solid ml-2 px-2 py-0.5 text-xs">New</span> : null}
                    </p>
                    <p className={`mt-1 text-[0.95rem] font-medium ${alert && !n.read ? 'text-pearl/85' : 'text-noir/75'}`}>{n.body}</p>
                    {n.offerJobId ? (
                      // Above the card-wide link, so the buttons take their own clicks.
                      <div className="relative z-10 mt-3 grid max-w-sm grid-cols-2 gap-3">
                        <ActionButton action={respondToOffer.bind(null, n.offerJobId, true)} className="btn-primary">
                          <Icon name="check" size={20} /> Accept
                        </ActionButton>
                        <ActionButton action={respondToOffer.bind(null, n.offerJobId, false)} className="btn-secondary">
                          <Icon name="x" size={20} /> Reject
                        </ActionButton>
                      </div>
                    ) : null}
                    <p className={`mt-1.5 flex items-center gap-2 text-sm font-bold ${alert && !n.read ? 'text-pearl/70' : 'text-noir/55'}`}>
                      {n.ago}
                      {n.href ? (
                        <span className={`inline-flex items-center gap-1 font-extrabold ${alert && !n.read ? 'text-pearl' : 'text-midnight'}`}>
                          · {n.hrefLabel ?? 'View'} <Icon name="arrow" size={14} />
                        </span>
                      ) : null}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
