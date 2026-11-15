import React from 'react';
import companyLogo from '../assets/company-logo-sm.jpg';
import companyMark from '../assets/company-mark.png';

interface CompanyLogoProps {
  size?: number;
  className?: string;
  variant?: 'emblem' | 'full';
  companyName?: string;
  subTitle?: string;
  theme?: 'light' | 'dark';
}

export default function CompanyLogo({
  size = 40,
  className = '',
  variant = 'emblem',
  companyName = 'شركة المتحدة',
  theme = 'light',
}: CompanyLogoProps) {
  const isDark = theme === 'dark';

  return (
    <div className={`inline-flex items-center ${isDark ? 'gap-0.5' : 'gap-3'} select-none ${className}`}>
      {/* Al-Muttahida Brand Logo */}
      <div
        className={`relative shrink-0 flex items-center justify-center overflow-hidden transition-transform duration-200 hover:scale-105 ${
          isDark
            ? '-ml-1'
            : 'rounded-xl shadow-sm shadow-slate-900/20 ring-1 ring-slate-900/10 bg-[#0f245c]'
        }`}
        style={{
          width: size,
          height: size,
        }}
      >
        <img
          src={isDark ? companyMark : companyLogo}
          alt={companyName}
          className={
            isDark
              ? 'w-full h-full object-contain scale-125 drop-shadow-[0_2px_6px_rgba(16,185,129,0.22)]'
              : 'w-full h-full object-cover'
          }
        />
      </div>

      {/* Unified Corporate Wordmark (No Subtitle) */}
      {variant === 'full' && (
        <span
          className={`truncate text-[17px] font-black leading-normal py-0.5 ${
            isDark ? 'text-white tracking-tight drop-shadow-xs' : 'text-slate-900'
          }`}
        >
          {companyName}
        </span>
      )}
    </div>
  );
}
