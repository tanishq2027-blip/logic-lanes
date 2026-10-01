import type { SVGProps } from 'react';

const PATHS = {
  truck: 'M2 6h11v10H2zM13 9h4l4 4v3h-8zM6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6',
  bell: 'M6 9a6 6 0 1 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7zM10 20a2 2 0 0 0 4 0',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  alert: 'M12 3 2 20h20zM12 10v4M12 17.5v.5',
  check: 'M4 12.5 9.5 18 20 6.5',
  x: 'M5 5l14 14M19 5 5 19',
  arrow: 'M4 12h15M13 6l6 6-6 6',
  back: 'M20 12H5M11 6l-6 6 6 6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.5-6 8-6s8 2 8 6',
  pin: 'M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.500 7 12 7 12zM12 12.5a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.500 2',
  refresh: 'M20 11a8 8 0 0 0-14.500-4.500L4 8M4 4v4h4M4 13a8 8 0 0 0 14.500 4.500L20 16M20 20v-4h-4',
  logout: 'M9 4H5v16h4M14 8l4 4-4 4M18 12H9',
  cloud: 'M7 18a4 4 0 0 1-.5-7.970 5.500 5.500 0 0 1 10.600-1.500A4.500 4.500 0 0 1 17.500 18z',
  star: 'M12 3l2.700 5.800 6.300.800-4.600 4.300 1.200 6.300L12 17.200 6.400 20.200l1.200-6.300L3 9.600l6.300-.800z',
  shield: 'M12 3 4 6v6c0 4.500 3.400 8 8 9 4.600-1 8-4.500 8-9V6z',
  spark: 'M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7V6a2 2 0 0 1 2-2h11M16 13.500h2',
  turn: 'M5 20v-7a4 4 0 0 1 4-4h10M15 5l4 4-4 4',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  lock: 'M6 11h12v10H6zM8.500 11V8a3.500 3.500 0 0 1 7 0v3',
  phone: 'M5 4h4l2 5-2.500 1.500a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
