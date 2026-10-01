'use client';

import { useEffect, useRef } from 'react';

/**
 * Full-screen looping video behind the landing page.
 *
 * Two layers sit on top of it:
 *  1. a frosted layer that blurs the video, masked so the blur is full at the
 *     top of the screen and fades to nothing by the middle;
 *  2. a Pearl tint that does the same, so the headline up there stays readable.
 * The result: glass at the top, the video clear in the lower half.
 *
 * The video is decoration only: muted, hidden from assistive tech, and paused
 * for people who have asked their device for reduced motion.
 */
export function BackgroundVideo({ src }: { src: string }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      if (reduce.matches) el.pause();
      else el.play().catch(() => undefined); // Autoplay can be refused (data saver, low power): the first frame stays.
    };
    apply();
    reduce.addEventListener('change', apply);
    return () => reduce.removeEventListener('change', apply);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-pearl" aria-hidden="true">
      <video ref={video} className="h-full w-full object-cover" src={src} autoPlay muted loop playsInline preload="auto" disablePictureInPicture tabIndex={-1} />

      {/* 1. Frost: strong blur at the top, gone by ~60% of the screen height. */}
      <div
        className="absolute inset-0 backdrop-blur-2xl"
        style={{
          maskImage: 'linear-gradient(to bottom, #000 0%, #000 22%, transparent 62%)',
          WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 22%, transparent 62%)',
        }}
      />
      {/* 2. Pearl tint, fading the same way, so dark text has a light surface behind it. */}
      <div className="absolute inset-0 bg-gradient-to-b from-pearl/85 via-pearl/35 via-45% to-transparent to-70%" />
    </div>
  );
}
