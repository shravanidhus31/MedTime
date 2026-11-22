// Sign-in and sign-up layout (UI pass, 22 Nov): a calm green panel with a bold headline on the left,
// the form on the right. On small screens only the form shows, under a compact brand line.
import React from 'react';
import { HeartPulse, PhoneCall, ShieldCheck, Users } from 'lucide-react';

const POINTS = [
  { icon: PhoneCall, text: 'A gentle call at dose time, in English or Hindi.' },
  { icon: ShieldCheck, text: 'It checks before recording, so no dose is taken twice.' },
  { icon: Users, text: 'The family is told when something needs them.' },
];

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-[#f4f7f5]">
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 text-white bg-gradient-to-br from-[#1f4f43] via-[#2f6f5e] to-[#6fa596]">
        <div className="absolute -right-24 -top-24 w-[26rem] h-[26rem] rounded-full bg-white/10" />
        <div className="absolute -left-20 bottom-[-8rem] w-[22rem] h-[22rem] rounded-full bg-white/5" />
        <div className="relative flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center"><HeartPulse size={20} /></div>
          <span className="text-lg font-bold tracking-wide" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>MedTime</span>
        </div>
        <div className="relative">
          <h1 className="text-[64px] leading-[0.95] uppercase" style={{ fontFamily: "'Anton', 'Plus Jakarta Sans', sans-serif" }}>
            Calmer days,<br />on time.
          </h1>
          <p className="mt-5 text-white/85 text-lg max-w-md">A caring voice that helps a loved one with memory loss take the right medicine, and keeps the family close.</p>
          <ul className="mt-8 space-y-3">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-white/90">
                <span className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center shrink-0"><Icon size={17} /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">MedTime never gives medical advice. Her doctor decides about medicines.</p>
      </aside>

      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8 text-[#2f6f5e]">
            <HeartPulse size={22} /><span className="text-xl font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>MedTime</span>
          </div>
          <h2 className="text-3xl font-bold text-[#1c2b26]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{title}</h2>
          <p className="mt-1.5 text-sm text-[#66756f]">{subtitle}</p>
          <div className="mt-8 bg-white rounded-3xl border border-[#e2e9e5] p-7 shadow-[0_8px_30px_rgba(20,45,38,0.06)]">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
