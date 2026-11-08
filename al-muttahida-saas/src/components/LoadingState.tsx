import React from 'react';

interface LoadingStateProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'card' | 'minimal' | 'table' | 'fullscreen';
  colSpan?: number;
  className?: string;
  minHeight?: string;
  // Kept in interface for backward compatibility with existing callers, but intentionally unrendered
  message?: string;
  subMessage?: string;
}

export default function LoadingState({
  size = 'md',
  variant = 'minimal',
  colSpan = 6,
  className = '',
  minHeight,
}: LoadingStateProps) {
  const pixelSize = size === 'sm' ? 20 : size === 'lg' ? 38 : 28;
  const strokeWidth = size === 'sm' ? 3.5 : size === 'lg' ? 2.8 : 3;

  // Ultra-clean, modern, minimalist SVG spinner (no text, no clutter)
  const spinner = (
    <div
      className="inline-flex items-center justify-center select-none"
      role="status"
      aria-label="Loading"
    >
      <svg
        className="animate-spin text-blue-600"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        style={{ width: pixelSize, height: pixelSize }}
      >
        <circle
          className="opacity-20 text-slate-300"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth={strokeWidth}
        />
        <path
          className="opacity-90"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  );

  // Table row variant
  if (variant === 'table') {
    return (
      <tr className="animate-fadeIn">
        <td colSpan={colSpan} className={`px-4 py-12 text-center ${className}`}>
          <div
            className="flex items-center justify-center w-full"
            style={{ minHeight: minHeight || '100px' }}
          >
            {spinner}
          </div>
        </td>
      </tr>
    );
  }

  // Fullscreen overlay variant
  if (variant === 'fullscreen') {
    return (
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/10 backdrop-blur-[2px] ${className}`}
      >
        {spinner}
      </div>
    );
  }

  // Minimal / Standard variant: pure centered spinner without boxes, borders, or text
  return (
    <div
      className={`flex items-center justify-center w-full animate-fadeIn ${className}`}
      style={{
        minHeight:
          minHeight ||
          (size === 'lg' ? '40vh' : size === 'sm' ? '60px' : '180px'),
      }}
    >
      {spinner}
    </div>
  );
}
