// Phone numbers as typed ("+91 93264 50209", "09326450209", "9326450209") all mean the same Indian
// mobile. Accounts are matched on any of the forms an older record may hold (22 Nov: a caregiver
// registered with a different format could not log in, because the match was character-exact).
function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d;
}

// The forms a stored phone may have, for lookups: ["9326450209", "+919326450209", "919326450209"].
function phoneVariants(raw) {
  const n = normalizePhone(raw);
  const out = new Set([String(raw || '').trim()]);
  if (/^\d{10}$/.test(n)) for (const v of [n, `+91${n}`, `91${n}`]) out.add(v);
  return [...out].filter(Boolean);
}

module.exports = { normalizePhone, phoneVariants };
