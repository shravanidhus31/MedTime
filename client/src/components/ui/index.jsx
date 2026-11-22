// Shared building blocks for the UI pass (22 Nov). One place for card, heading, tabs and badge
// styles, so the look can be changed here instead of on every screen.
import React from 'react';

export function Card({ className = '', children, ...rest }) {
  return (
    <div className={`bg-white rounded-2xl border border-[#e8dcc8] shadow-[0_2px_12px_rgba(90,60,30,0.06)] p-5 md:p-6 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h2 className="text-lg md:text-xl font-bold text-[#2d2418]" style={{ fontFamily: "'Lora', serif" }}>{title}</h2>
        {subtitle && <p className="text-xs md:text-sm text-[#8a7560] mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

const TONES = {
  neutral: 'bg-[#f5ede0] text-[#5c4535] border-[#e8dcc8]',
  good: 'bg-[#e3eedf] text-[#2a4a28] border-[#c8d9c4]',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  danger: 'bg-[#fbe5df] text-[#7a2a1a] border-[#f2c4b5]',
  info: 'bg-sky-50 text-sky-900 border-sky-200',
};
export function Badge({ tone = 'neutral', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border ${TONES[tone] || TONES.neutral} ${className}`}>{children}</span>;
}

// tabs: [{ id, label, count? }]
export function Tabs({ tabs, active, onChange }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-[#e8dcc8] mb-6 -mx-1 px-1 [scrollbar-width:none]">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`whitespace-nowrap px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${active === t.id ? 'border-[#5c4535] text-[#5c4535]' : 'border-transparent text-[#8a7560] hover:text-[#5c4535]'}`}
        >
          {t.label}
          {t.count ? <span className="ml-1.5 text-[10px] bg-[#7a2a1a] text-white rounded-full px-1.5 py-0.5 align-middle">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon = '·', title, children }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-sm font-bold text-[#5c4535]">{title}</div>
      {children && <div className="text-xs text-[#8a7560] mt-1 max-w-md mx-auto">{children}</div>}
    </div>
  );
}
