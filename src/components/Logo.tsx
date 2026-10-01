/**
 * Logic Lanes brand mark and wordmark.
 *
 * The mark is `public/logo.png`: the official artwork (a route pin flowing
 * into a road with a truck, on a navy tile) with its corners cut to
 * transparent. The same artwork is the browser-tab icon (`src/app/icon.png`).
 * To change the logo, replace those two files.
 */
const LOGO_SRC = '/logo.png';

export function LogoMark({ size = 36, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    // Decorative here: the wordmark next to it carries the name.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      alt=""
      width={size}
      height={size}
      // The tile is navy, close to the Midnight nav bar: a faint light edge keeps it from disappearing there.
      className={`block shrink-0 rounded-[13.5%] ${onDark ? 'ring-1 ring-white/35' : 'shadow-card-accent'}`}
    />
  );
}

export function Logo({ onDark = false, size = 36 }: { onDark?: boolean; size?: number }) {
  return (
    <span className="inline-flex items-center gap-3">
      <LogoMark size={size} onDark={onDark} />
      <span className={`text-xl font-black tracking-tight ${onDark ? 'text-pearl' : 'text-noir'}`}>
        Logic <span className={onDark ? 'text-pearl/75' : 'text-midnight'}>Lanes</span>
      </span>
    </span>
  );
}
