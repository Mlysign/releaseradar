// Fandex logo mark — the "F" monogram on the brand gradient, as inline SVG so it
// stays crisp at any size (matches the generated app icons + favicon). Rounded
// corners here since it isn't OS-masked like the app icon.
export default function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="fandex-logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#fandex-logo-gradient)" />
      <g fill="#ffffff">
        <rect x="182" y="150" width="56" height="212" rx="14" />
        <rect x="182" y="150" width="160" height="56" rx="14" />
        <rect x="182" y="240" width="126" height="52" rx="14" />
      </g>
    </svg>
  );
}
