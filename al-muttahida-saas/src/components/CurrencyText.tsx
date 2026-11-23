import React, { useLayoutEffect, useRef } from 'react';

interface CurrencyTextProps {
  value: string;
  className?: string;
}

const CURRENCY_UNIT_RE = /^(?:جنيه|جنيه\s+مصري|ج\.م|ج|EGP|ريال|SAR|دولار|USD)$/i;

/**
 * Renders a formatted currency value without the trailing currency word inside cards,
 * keeping numbers on a single line and auto-scaling down smoothly if a very long number
 * exceeds its container width.
 */
export default function CurrencyText({ value, className = '' }: CurrencyTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  const trimmed = String(value ?? '').trim();
  const match = trimmed.match(/^([+-]?[\d,]+(?:\.\d+)?)\s+(.+)$/);
  const displayValue =
    match && CURRENCY_UNIT_RE.test(match[2].trim()) ? match[1] : trimmed;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const el = textRef.current;
    if (!container || !el) return;

    const fitText = () => {
      el.style.fontSize = '100%';
      const available = container.clientWidth;
      const needed = el.scrollWidth;
      if (available > 0 && needed > available) {
        const nextScale = Math.max(58, Math.floor((available / needed) * 100));
        el.style.fontSize = `${nextScale}%`;
      }
    };

    fitText();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fitText);
    observer.observe(container);
    return () => observer.disconnect();
  }, [displayValue]);

  return (
    <span
      ref={containerRef}
      title={trimmed}
      className={`block w-full overflow-hidden ${className}`}
    >
      <span
        ref={textRef}
        className="inline-block whitespace-nowrap tabular-nums leading-tight"
      >
        {displayValue}
      </span>
    </span>
  );
}
