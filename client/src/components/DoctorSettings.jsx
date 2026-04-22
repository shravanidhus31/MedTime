import React, { useState, useEffect } from 'react';
import api from '../utils/api';

/**
 * DoctorSettings — Elderly-friendly form to link a physician and toggle
 * automated monthly clinical PDF report emails.
 *
 * Designed for the Patient Dashboard — large inputs, high contrast, clear labels.
 */
export default function DoctorSettings() {
  const [doctorName, setDoctorName] = useState('');
  const [doctorEmail, setDoctorEmail] = useState('');
  const [autoSendMonthly, setAutoSendMonthly] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' }); // 'success' | 'error' | ''
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // ── Load saved settings on mount ─────────────────────────────────────────────
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await api.get('/users/doctor-settings');
        const { linkedDoctor } = res.data;
        if (linkedDoctor) {
          setDoctorName(linkedDoctor.name || '');
          setDoctorEmail(linkedDoctor.email || '');
          setAutoSendMonthly(linkedDoctor.autoSendMonthly || false);
        }
      } catch (err) {
        console.error('Could not load doctor settings:', err);
      } finally {
        setFetching(false);
      }
    };
    loadSettings();
  }, []);

  // ── Save handler ──────────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    setStatus({ type: '', message: '' });

    if (autoSendMonthly && !doctorEmail.trim()) {
      setStatus({
        type: 'error',
        message: "Please enter the doctor's email address before enabling automated reports."
      });
      return;
    }

    setLoading(true);
    try {
      const res = await api.put('/users/doctor-settings', {
        name: doctorName.trim(),
        email: doctorEmail.trim(),
        autoSendMonthly
      });
      setStatus({ type: 'success', message: res.data.message || 'Settings saved!' });
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to save settings. Please try again.';
      setStatus({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  };

  // ── Download PDF handler ──────────────────────────────────────────────────────
  const handleDownloadReport = async () => {
    setDownloading(true);
    try {
      const res = await api.get('/reports/pdf', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'MedTime_Clinical_Report.pdf';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Could not generate the report. Please try again.');
      console.error('PDF download error:', err);
    } finally {
      setDownloading(false);
    }
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────────
  if (fetching) {
    return (
      <div style={styles.card}>
        <div style={styles.skeleton} />
        <div style={{ ...styles.skeleton, width: '60%', marginTop: 12 }} />
      </div>
    );
  }

  return (
    <div style={styles.card}>
      {/* Card Header */}
      <div style={styles.headerRow}>
        <div style={styles.iconBadge}>
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#ffffff" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zm-4 7a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <div>
          <h2 style={styles.cardTitle}>My Doctor</h2>
          <p style={styles.cardSubtitle}>Link your physician to receive automated monthly health reports.</p>
        </div>
      </div>

      <hr style={styles.divider} />

      {/* Status Banner */}
      {status.message && (
        <div style={{
          ...styles.banner,
          background: status.type === 'success' ? '#e8f5e9' : '#fff0f0',
          border: `1px solid ${status.type === 'success' ? '#a5d6a7' : '#ffb3b3'}`,
          color:  status.type === 'success' ? '#2e7d32' : '#c62828'
        }}>
          <span style={{ fontSize: 18, marginRight: 10 }}>
            {status.type === 'success' ? '✅' : '⚠️'}
          </span>
          {status.message}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSave} noValidate>
        {/* Doctor's Name */}
        <div style={styles.fieldGroup}>
          <label htmlFor="doctor-name" style={styles.label}>
            Doctor's Full Name
          </label>
          <input
            id="doctor-name"
            type="text"
            value={doctorName}
            onChange={(e) => setDoctorName(e.target.value)}
            placeholder="e.g. Dr. Suresh Patel"
            style={styles.input}
            autoComplete="off"
          />
        </div>

        {/* Doctor's Email */}
        <div style={styles.fieldGroup}>
          <label htmlFor="doctor-email" style={styles.label}>
            Doctor's Email Address <span style={{ color: '#e53935' }}>*</span>
          </label>
          <input
            id="doctor-email"
            type="email"
            value={doctorEmail}
            onChange={(e) => setDoctorEmail(e.target.value)}
            placeholder="e.g. dr.patel@hospital.com"
            style={styles.input}
            autoComplete="off"
            required
          />
          <span style={styles.helpText}>
            Your doctor does not need to create an account. The report is emailed directly.
          </span>
        </div>

        {/* Auto-Send Toggle */}
        <div style={styles.toggleCard}>
          <div style={styles.toggleTextBlock}>
            <span style={styles.toggleTitle}>Automate Monthly Report Email</span>
            <span style={styles.toggleDesc}>
              On the 1st of every month, MedTime will automatically email a 30-day clinical
              adherence PDF report to your doctor — no manual action needed.
            </span>
          </div>
          <button
            id="auto-send-toggle"
            type="button"
            role="switch"
            aria-checked={autoSendMonthly}
            onClick={() => setAutoSendMonthly(prev => !prev)}
            style={{
              ...styles.toggleBtn,
              background: autoSendMonthly ? '#4A90D9' : '#cbd5e0',
            }}
            title={autoSendMonthly ? 'Disable monthly reports' : 'Enable monthly reports'}
          >
            <span style={{
              ...styles.toggleThumb,
              transform: autoSendMonthly ? 'translateX(26px)' : 'translateX(2px)'
            }} />
          </button>
        </div>

        {/* Automation status pill */}
        {autoSendMonthly && (
          <div style={styles.automationPill}>
            <span style={{ marginRight: 6 }}>📅</span>
            Automation is <strong>ON</strong> — next report sends on the 1st of next month.
          </div>
        )}

        {/* Save Button */}
        <button
          id="save-doctor-settings"
          type="submit"
          disabled={loading}
          style={{
            ...styles.saveBtn,
            opacity: loading ? 0.75 : 1,
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? (
            <>
              <svg style={styles.spinner} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
              </svg>
              Saving…
            </>
          ) : (
            <>Save Doctor Settings</>
          )}
        </button>
      </form>

      {/* Assurance note */}
      <p style={styles.footerNote}>
          Your doctor's information is stored securely and is only used for report delivery.
      </p>

      {/* Download Report Tester */}
      <div style={styles.downloadSection}>
        <div style={styles.downloadInfo}>
          <span style={{ fontSize: 20 }}>📄</span>
          <div>
            <p style={styles.downloadTitle}>Preview Your Report</p>
            <p style={styles.downloadDesc}>Download a copy of the 30-day clinical PDF that gets sent to your doctor.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownloadReport}
          disabled={downloading}
          style={{
            ...styles.downloadBtn,
            opacity: downloading ? 0.7 : 1,
            cursor: downloading ? 'not-allowed' : 'pointer'
          }}
        >
          {downloading ? 'Generating…' : '⬇ Download Report'}
        </button>
      </div>
    </div>
  );
}

// ── Inline styles (elderly-friendly: large text, high contrast, spacious) ─────
const styles = {
  card: {
    background: '#ffffff',
    border: '2px solid #e8e0f5',
    borderRadius: 20,
    padding: '32px 36px',
    maxWidth: 620,
    boxShadow: '0 4px 24px rgba(74,144,217,0.10)',
    fontFamily: "'Segoe UI', Arial, sans-serif",
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 8
  },
  iconBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    background: 'linear-gradient(135deg, #4A90D9 0%, #6C5CE7 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  cardTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: '#2C3E50'
  },
  cardSubtitle: {
    margin: '4px 0 0',
    fontSize: 14,
    color: '#718096'
  },
  divider: {
    border: 'none',
    borderTop: '1.5px solid #edf2f7',
    margin: '20px 0 24px'
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    padding: '14px 18px',
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 500,
    marginBottom: 20
  },
  fieldGroup: {
    marginBottom: 24
  },
  label: {
    display: 'block',
    fontSize: 16,
    fontWeight: 700,
    color: '#2d3748',
    marginBottom: 8
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '14px 18px',
    fontSize: 17,
    border: '2px solid #e2e8f0',
    borderRadius: 12,
    outline: 'none',
    color: '#2d3748',
    background: '#f8fafc',
    transition: 'border-color 0.2s',
  },
  helpText: {
    display: 'block',
    marginTop: 6,
    fontSize: 13,
    color: '#718096',
    lineHeight: 1.5
  },
  toggleCard: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    background: '#f7faff',
    border: '2px solid #e0ecff',
    borderRadius: 14,
    padding: '16px 18px',
    marginBottom: 16
  },
  toggleTextBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
    minWidth: 0
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: '#2d3748'
  },
  toggleDesc: {
    fontSize: 13,
    color: '#718096',
    lineHeight: 1.55
  },
  toggleBtn: {
    position: 'relative',
    display: 'inline-block',
    width: 56,
    height: 30,
    borderRadius: 15,
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.25s ease',
    padding: 0
  },
  toggleThumb: {
    position: 'absolute',
    top: 3,
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: '#ffffff',
    boxShadow: '0 1px 5px rgba(0,0,0,0.25)',
    transition: 'transform 0.25s ease'
  },
  automationPill: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    background: '#eef4ff',
    color: '#2563eb',
    border: '1px solid #bfdbfe',
    borderRadius: 12,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 24,
    lineHeight: 1.5
  },
  saveBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    padding: '16px 24px',
    fontSize: 18,
    fontWeight: 700,
    color: '#ffffff',
    background: 'linear-gradient(135deg, #4A90D9 0%, #6C5CE7 100%)',
    border: 'none',
    borderRadius: 14,
    boxShadow: '0 4px 14px rgba(74,144,217,0.35)',
    transition: 'transform 0.15s, box-shadow 0.15s',
    marginTop: 8
  },
  spinner: {
    width: 20,
    height: 20,
    animation: 'spin 1s linear infinite'
  },
  footerNote: {
    marginTop: 18,
    fontSize: 13,
    color: '#a0aec0',
    textAlign: 'center',
    lineHeight: 1.5
  },
  skeleton: {
    height: 20,
    borderRadius: 8,
    background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.4s infinite'
  },
  downloadSection: {
    marginTop: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    background: '#f0fdf4',
    border: '1.5px solid #bbf7d0',
    borderRadius: 14,
    padding: '14px 18px'
  },
  downloadInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0
  },
  downloadTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 700,
    color: '#14532d'
  },
  downloadDesc: {
    margin: '2px 0 0',
    fontSize: 12,
    color: '#4d7c5a',
    lineHeight: 1.4
  },
  downloadBtn: {
    flexShrink: 0,
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: 700,
    color: '#ffffff',
    background: 'linear-gradient(135deg, #16a34a, #15803d)',
    border: 'none',
    borderRadius: 10,
    boxShadow: '0 2px 8px rgba(22,163,74,0.30)',
    transition: 'transform 0.15s, opacity 0.15s',
    whiteSpace: 'nowrap'
  }
};
