// Crossed meels: the clubs of the zurkhaneh, Persia's traditional strength training. Source: docs/brand/.
const CLUB = 'M-1.9 -27L-1.9 -10C-1.9 -4 -7.2 4 -7.2 13C-7.2 20 -3.8 24 0 24C3.8 24 7.2 20 7.2 13C7.2 4 1.9 -4 1.9 -10L1.9 -27Z';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <g fill="var(--accent)" stroke="var(--bg)" strokeWidth="2.2" strokeLinejoin="round">
        {[-32, 32].map((deg) => (
          <g key={deg} transform={`translate(32 44) rotate(${180 + deg}) translate(0 17)`}><path d={CLUB} /><circle cy="-29.5" r="3.4" /></g>
        ))}
      </g>
    </svg>
  );
}
