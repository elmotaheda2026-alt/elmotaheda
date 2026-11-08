import React from 'react';

interface CompanyLogoProps {
  size?: number;
  className?: string;
  variant?: 'emblem' | 'full';
  companyName?: string;
  subTitle?: string;
}

export default function CompanyLogo({
  size = 38,
  className = '',
  variant = 'emblem',
  companyName = 'شركة المتحدة',
  subTitle = 'نظام ERP المتكامل',
}: CompanyLogoProps) {
  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* Premium Vector Emblem for Al-Muttahida */}
      <div
        className="relative shrink-0 flex items-center justify-center rounded-xl overflow-hidden shadow-xs border border-white/20 transition-transform duration-200 hover:scale-105"
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #4f46e5 100%)',
        }}
      >
        {/* Subtle glossy glass reflection */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.05) 55%, transparent 100%)',
          }}
        />

        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-[72%] h-[72%] drop-shadow-sm"
        >
          <defs>
            {/* Linear and radial gradients for the emblem */}
            <linearGradient id="muttahidaGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#93c5fd" />
            </linearGradient>
            <linearGradient id="muttahidaGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#60a5fa" />
            </linearGradient>
            <linearGradient id="muttahidaGold" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
          </defs>

          {/* Left Wing / Pillar of Unity */}
          <path
            d="M 22 74 C 22 74, 20 42, 36 28 C 42 22, 49 26, 49 35 C 49 46, 38 52, 34 68 C 32 75, 25 76, 22 74 Z"
            fill="url(#muttahidaGrad1)"
          />

          {/* Right Wing / Pillar of Unity */}
          <path
            d="M 78 74 C 78 74, 80 42, 64 28 C 58 22, 51 26, 51 35 C 51 46, 62 52, 66 68 C 68 75, 75 76, 78 74 Z"
            fill="url(#muttahidaGrad2)"
          />

          {/* Central Keystone / Arch uniting both sides (Letter M / Shield Arch) */}
          <path
            d="M 33 67 L 50 42 L 67 67 C 62 72, 38 72, 33 67 Z"
            fill="#ffffff"
            opacity="0.95"
          />

          {/* Central Golden Diamond Apex (Excellence & Prosperity) */}
          <polygon
            points="50,16 57,25 50,34 43,25"
            fill="url(#muttahidaGold)"
          />

          {/* Bottom Foundation Line */}
          <rect
            x="32"
            y="76"
            width="36"
            height="5"
            rx="2.5"
            fill="#ffffff"
            opacity="0.85"
          />
        </svg>
      </div>

      {/* Typography when variant === 'full' */}
      {variant === 'full' && (
        <div className="flex flex-col truncate text-right">
          <span className="truncate text-sm font-black tracking-tight text-slate-900 leading-tight">
            {companyName}
          </span>
          <span className="text-[11px] font-medium text-slate-500 mt-0.5">
            {subTitle}
          </span>
        </div>
      )}
    </div>
  );
}

