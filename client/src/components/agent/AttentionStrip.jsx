// "Needs attention" (UI pass, 22 Nov): what needs the caregiver now, at the top of the dashboard.
// Each item opens the tab that deals with it. Refreshes every 20 seconds.
import React, { useEffect, useState } from 'react';
import api from '../../utils/api';

const CATEGORY = { fall: 'a fall', chest_pain: 'chest pain', breathing: 'trouble breathing', breathlessness: 'trouble breathing', extra_pills: 'extra tablets', financial_scam: 'a possible scam call', scam: 'a possible scam call', self_harm: 'words about self-harm', sudden_confusion: 'sudden confusion', help_key: 'the help key' };
const time = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export default function AttentionStrip({ patientId, onOpen, onCounts }) {
  const [a, setA] = useState(null);

  useEffect(() => {
    if (!patientId) return undefined;
    let live = true;
    const load = () => api.get(`/caregiver/patients/${patientId}/attention`)
      .then((r) => { if (live) { setA(r.data); if (onCounts) onCounts(r.data); } })
      .catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { live = false; clearInterval(t); };
  }, [patientId, onCounts]);

  if (!a) return null;
  const items = [];
  // one line per kind of red flag: "3 red flags today: a fall (latest 2:53 pm). The family was phoned."
  const byKind = {};
  for (const f of a.redFlags) (byKind[f.category] = byKind[f.category] || []).push(f);
  for (const [cat, list] of Object.entries(byKind)) {
    const latest = list.reduce((x, y) => (new Date(y.at) > new Date(x.at) ? y : x));
    items.push({ tone: 'danger', icon: '', text: `${list.length > 1 ? `${list.length} red flags today` : 'Red flag today'}: ${CATEGORY[cat] || cat} (${list.length > 1 ? 'latest ' : ''}${time(latest.at)}). The family was phoned.`, tab: 'activity' });
  }
  if (a.missed.length) items.push({ tone: 'danger', icon: '', text: `${a.missed.length} missed dose${a.missed.length > 1 ? 's' : ''} today (${a.missed.map((m) => m.medicine).join(', ')})`, tab: 'today' });
  if (a.unconfirmed.length) items.push({ tone: 'warn', icon: '', text: `${a.unconfirmed.length} dose${a.unconfirmed.length > 1 ? 's' : ''} not confirmed yet`, tab: 'today' });
  if (a.pendingApprovals) items.push({ tone: 'warn', icon: '', text: `${a.pendingApprovals} change${a.pendingApprovals > 1 ? 's' : ''} waiting for your approval`, tab: 'approvals' });
  if (a.pendingQuestions) items.push({ tone: 'warn', icon: '', text: `${a.pendingQuestions} question${a.pendingQuestions > 1 ? 's' : ''} from MedTime`, tab: 'approvals' });
  if (a.weeklyFlags) items.push({ tone: 'info', icon: '', text: 'The weekly review noticed something', tab: 'insights' });
  if (a.openFollowUps) items.push({ tone: 'info', icon: '', text: `${a.openFollowUps} thing${a.openFollowUps > 1 ? 's' : ''} to follow up on her next call`, tab: 'insights' });

  const TONE = { danger: 'bg-[#fdecea] border-[#f5c6c0] text-[#a23b32]', warn: 'bg-amber-50 border-amber-200 text-amber-900', info: 'bg-sky-50 border-sky-200 text-sky-900' };
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-[#2f6f5e] uppercase tracking-wide">Needs attention</h2>
        <span className="text-xs text-[#66756f]">Today: {a.takenToday} of {a.dueSoFarToday} doses taken so far</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-[#d6ebe0] bg-[#e3f2ea] text-[#1e5a45] text-sm font-bold px-4 py-3">✓ All calm. Nothing needs you right now.</div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {items.map((it, i) => (
            <button key={i} onClick={() => onOpen(it.tab)} className={`text-left rounded-xl border px-4 py-3 text-sm font-semibold hover:brightness-95 transition ${TONE[it.tone]}`}>
              <span className="mr-2">{it.icon}</span>{it.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
