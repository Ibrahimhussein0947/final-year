import { Link } from 'react-router-dom';

export function LogoMark({ className = 'h-8 w-8 shrink-0 sm:h-9 sm:w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0b1f3a" />
      <path d="M9 10h14M9 16h10M9 22h14" stroke="#14b8a6" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ light }: { light?: boolean }) {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2 whitespace-nowrap sm:gap-2.5" aria-label="EthioTalent AI home">
      <LogoMark />
      <span className={`truncate text-base font-extrabold tracking-tight sm:text-lg ${light ? 'text-white' : 'text-text'}`}>
        EthioTalent <span className="text-accent">AI</span>
      </span>
    </Link>
  );
}
