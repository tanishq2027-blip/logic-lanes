/**
 * Map colours and marker artwork.
 * The base map is OpenStreetMap, greyed out and blended into the Pearl Perfect
 * page (see `.fleet-map` in globals.css) so the Midnight route line and the
 * Noir markers are the only loud things on it.
 */
export const PEARL = '#FBF9E4';
export const MIDNIGHT = '#122C4F';
export const NOIR = '#000000';

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · routes by <a href="https://openrouteservice.org" target="_blank" rel="noreferrer">openrouteservice</a>';

const svg = (body: string, size: number) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`,
  )}`;

/** Marker artwork. Critical markers are Noir with a Pearl keyline. `size` is the artwork's pixel size. */
export const MARKER_ICONS = {
  truck: {
    size: 52,
    url: svg(
      `<circle cx="26" cy="26" r="22" fill="${NOIR}" stroke="${PEARL}" stroke-width="4"/>` +
        `<path d="M14 19h14v12H14zM28 22h6l4 4v5H28z" fill="${PEARL}"/>` +
        `<circle cx="19.500" cy="33" r="3" fill="${PEARL}" stroke="${NOIR}" stroke-width="2"/>` +
        `<circle cx="33" cy="33" r="3" fill="${PEARL}" stroke="${NOIR}" stroke-width="2"/>`,
      52,
    ),
  },
  origin: { size: 32, url: svg(`<circle cx="16" cy="16" r="11" fill="${PEARL}" stroke="${NOIR}" stroke-width="5"/>`, 32) },
  destination: {
    size: 40,
    url: svg(
      `<path d="M20 38s13-11.500 13-21A13 13 0 1 0 7 17c0 9.500 13 21 13 21z" fill="${NOIR}" stroke="${PEARL}" stroke-width="2.500"/>` +
        `<circle cx="20" cy="17" r="5" fill="${PEARL}"/>`,
      40,
    ),
  },
  detour: {
    size: 36,
    url: svg(`<rect x="9" y="9" width="18" height="18" transform="rotate(45 18 18)" fill="${NOIR}" stroke="${PEARL}" stroke-width="3"/>`, 36),
  },
  incident: {
    size: 40,
    url: svg(
      `<path d="M20 4 37 34H3z" fill="${NOIR}" stroke="${PEARL}" stroke-width="3" stroke-linejoin="round"/>` +
        `<path d="M20 15v9M20 28.500v.500" stroke="${PEARL}" stroke-width="3.500" stroke-linecap="round"/>`,
      40,
    ),
  },
};

export type MarkerKind = keyof typeof MARKER_ICONS;
