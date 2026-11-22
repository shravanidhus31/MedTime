// Follow-ups (A4.3, the Planner): concerns she mentioned on calls that MedTime will ask about once
// on a later call, with her exact words and her latest answer. The caregiver can close one.
import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/api';
import { Card, SectionTitle, Badge, Empty } from '../ui';

const REASON = { better: 'she said it was better', visited: 'the visit happened', asked_3_times: 'asked 3 times', caregiver: 'closed by family' };

export default function FollowUpsPanel({ patientId }) {
  const [items, setItems] = useState(null);
  const [status, setStatus] = useState('open');
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!patientId) return;
    api.get(`/followups?patientId=${patientId}&status=${status}`)
      .then((r) => { setItems(r.data.followUps || []); setError(null); })
      .catch((e) => setError(e?.response?.data?.message || 'Could not load follow-ups.'));
  }, [patientId, status]);

  useEffect(() => { load(); }, [load]);

  const close = async (id) => {
    try { await api.patch(`/followups/${id}/close`); load(); } catch (e) { setError(e?.response?.data?.message || 'Could not close it.'); }
  };

  return (
    <Card>
      <SectionTitle
        title="Follow-ups"
        subtitle="Things she mentioned on calls. MedTime asks about each one once, after a dose, on a later call. It only asks; it never advises."
        right={(
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-xs border border-[#e2e9e5] rounded-lg px-2 py-1.5 bg-white">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        )}
      />
      {error && <p className="text-xs text-[#a23b32] mb-2">{error}</p>}
      {items === null ? (
        <p className="text-sm text-[#66756f]">Loading…</p>
      ) : items.length === 0 ? (
        <Empty icon="" title={status === 'open' ? 'Nothing to follow up' : 'No follow-ups yet'}>
          When she mentions something like "my knee hurts" on a call, it appears here and MedTime asks about it next time.
        </Empty>
      ) : (
        <ul className="divide-y divide-[#eaf3ee]">
          {items.map((f) => (
            <li key={f.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#1c2b26] capitalize">{f.about}</div>
                <div className="text-xs text-[#66756f] italic mt-0.5">She said: “{f.quote}”</div>
                {f.lastAnswer && <div className="text-xs text-[#2f6f5e] mt-1">Last asked: “{f.lastAnswer}”</div>}
                <div className="mt-1.5 flex gap-1.5 flex-wrap">
                  <Badge tone={f.status === 'open' ? 'warn' : 'good'}>{f.status === 'open' ? 'Will ask on the next call' : `Closed: ${REASON[f.closedReason] || f.closedReason}`}</Badge>
                  {f.asks > 0 && <Badge>Asked {f.asks}×</Badge>}
                </div>
              </div>
              {f.status === 'open' && (
                <button onClick={() => close(f.id)} className="text-xs font-bold text-[#2f6f5e] border border-[#e2e9e5] rounded-lg px-3 py-1.5 hover:bg-[#f4f7f5] whitespace-nowrap">
                  No need to ask
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
