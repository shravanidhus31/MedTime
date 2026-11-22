// Shared building blocks for the UI pass (22 Nov). One place for card, heading, tabs and badge
// styles, so the look can be changed here instead of on every screen.
import React from 'react';

export function Card({ className = '', children, ...rest }) {
  return (
    <div className={`bg-white rounded-2xl border border-[#e2e9e5] shadow-[0_2px_12px_rgba(20,45,38,0.06)] p-5 md:p-6 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h2 className="text-lg md:text-xl font-bold text-[#1c2b26]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{title}</h2>
        {subtitle && <p className="text-xs md:text-sm text-[#66756f] mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

const TONES = {
  neutral: 'bg-[#eaf3ee] text-[#2f6f5e] border-[#e2e9e5]',
  good: 'bg-[#e3f2ea] text-[#1e5a45] border-[#d6ebe0]',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  danger: 'bg-[#fdecea] text-[#a23b32] border-[#f5c6c0]',
  info: 'bg-sky-50 text-sky-900 border-sky-200',
};
export function Badge({ tone = 'neutral', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border ${TONES[tone] || TONES.neutral} ${className}`}>{children}</span>;
}

// tabs: [{ id, label, count? }]
export function Tabs({ tabs, active, onChange }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-[#e2e9e5] mb-6 -mx-1 px-1 [scrollbar-width:none]">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`whitespace-nowrap px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${active === t.id ? 'border-[#2f6f5e] text-[#2f6f5e]' : 'border-transparent text-[#66756f] hover:text-[#2f6f5e]'}`}
        >
          {t.label}
          {t.count ? <span className="ml-1.5 text-[10px] bg-[#a23b32] text-white rounded-full px-1.5 py-0.5 align-middle">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon = '·', title, children }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-sm font-bold text-[#2f6f5e]">{title}</div>
      {children && <div className="text-xs text-[#66756f] mt-1 max-w-md mx-auto">{children}</div>}
    </div>
  );
}
