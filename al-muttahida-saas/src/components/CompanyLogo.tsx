import React from 'react';

interface CompanyLogoProps {
  size?: number;
  className?: string;
  variant?: 'emblem' | 'full';
  companyName?: string;
  subTitle?: string;
}

export default function CompanyLogo({
  size = 40,
  className = '',
  variant = 'emblem',
  companyName = 'شركة المتحدة',
}: CompanyLogoProps) {
  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* Executive Geometric Unity Emblem for Al-Muttahida */}
      <div
        className="relative shrink-0 flex items-center justify-center rounded-xl overflow-hidden shadow-sm shadow-blue-900/20 ring-1 ring-blue-900/10 transition-transform duration-200 hover:scale-105"
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(145deg, #2563eb 0%, #1d4ed8 50%, #1e3a8a 100%)',
        }}
      >
        {/* Subtle top edge highlight */}
        <div
          className="absolute inset-0 pointer-events-none opacity-25"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, transparent 45%)',
          }}
        />

        <svg
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-[68%] h-[68%]"
        >
          {/* Left rising architectural pillar */}
          <path
            d="M12 48V22L24 14V48H12Z"
            fill="#FFFFFF"
          />
          {/* Right rising architectural pillar */}
          <path
            d="M40 48V14L52 22V48H40Z"
            fill="#BFDBFE"
          />
          {/* Central interlocking bridge / unity chevron */}
          <path
            d="M24 22L32 30L40 22V34L32 42L24 34V22Z"
            fill="#FFFFFF"
          />
          {/* Base foundation bar */}
          <rect
            x="12"
            y="50"
            width="40"
            height="3.5"
            rx="1.75"
            fill="#FFFFFF"
            fillOpacity="0.85"
          />
        </svg>
      </div>

      {/* Clean Corporate Wordmark */}
      {variant === 'full' && (
        <span className="truncate text-[17px] font-black leading-normal py-0.5 text-slate-900">
          {companyName}
        </span>
      )}
    </div>
  );
}

