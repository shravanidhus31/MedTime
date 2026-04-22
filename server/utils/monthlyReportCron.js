const cron = require('node-cron');
const PdfPrinter = require('pdfmake/js/Printer.js').default;
const User = require('../models/User');
const Medicine = require('../models/Medicine');
const Vital = require('../models/Vital');
const { sendDoctorReportEmail } = require('./emailClient');
const { decrypt } = require('./encryptionUtil');

// Load Roboto fonts from pdfmake's bundled vfs (base64 → Buffer)
// ✅ Replace with
const _vfsRaw = require('pdfmake/build/vfs_fonts');
const vfsFonts = _vfsRaw.pdfMake?.vfs ?? _vfsRaw; // handle both nested and flat exports
const fonts = {
  Roboto: {
    normal:      'Roboto-Regular.ttf',
    bold:        'Roboto-Medium.ttf',
    italics:     'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  }
};
// No-op urlResolver — required by this version of pdfmake (no remote URLs used)
const noopUrlResolver = { resolve: () => {}, resolved: () => Promise.resolve() };

/**
 * Returns a Buffer of a generated clinical PDF for a given patient.
 *
 * @param {object} patient       — User document (must have .name and ._id)
 * @param {object[]} medicines   — Medicine documents from the last 30 days
 * @param {object[]} vitals      — Vital documents from the last 30 days
 * @returns {Promise<Buffer>}
 */
async function generateClinicalPDF(patient, medicines, vitals) {
    try {
      const virtualfs = {
        existsSync:   (filename) => !!vfsFonts[filename],
        readFileSync: (filename) => Buffer.from(vfsFonts[filename], 'base64'),
      };
      const printer = new PdfPrinter(fonts, virtualfs, noopUrlResolver);

      // ── Date range strings ──────────────────────────────────────────────────
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const fmt = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const dateRange = `${fmt(thirtyDaysAgo)} — ${fmt(now)}`;

      // ── Executive Summary computations ──────────────────────────────────────
      // Adherence %: (taken doses / total scheduled doses) × 100
      const totalScheduled = medicines.reduce((sum, m) => {
        const freqMap = { once: 1, twice: 2, thrice: 3, custom: 1 };
        return sum + (freqMap[m.frequency] || 1) * 30;
      }, 0);

      // We don't track per-dose history here, so use caregiverAlerted as a proxy
      const missedMeds = medicines.filter(m => m.caregiverAlerted).length;
      const overallAdherence = totalScheduled > 0
        ? Math.max(0, Math.round(((totalScheduled - missedMeds * 30) / totalScheduled) * 100))
        : 100;

      // Vitals summary
      const bpReadings = vitals.filter(v => v.sys && v.dia);
      const avgSys  = bpReadings.length ? Math.round(bpReadings.reduce((s, v) => s + v.sys, 0) / bpReadings.length) : 0;
      const avgDia  = bpReadings.length ? Math.round(bpReadings.reduce((s, v) => s + v.dia, 0) / bpReadings.length) : 0;
      const maxSys  = bpReadings.length ? Math.max(...bpReadings.map(v => v.sys)) : 0;
      const minSys  = bpReadings.length ? Math.min(...bpReadings.map(v => v.sys)) : 0;
      const maxDia  = bpReadings.length ? Math.max(...bpReadings.map(v => v.dia)) : 0;
      const minDia  = bpReadings.length ? Math.min(...bpReadings.map(v => v.dia)) : 0;
      const avgSugar = vitals.filter(v => v.sugar).length
        ? Math.round(vitals.filter(v => v.sugar).reduce((s, v) => s + v.sugar, 0) / vitals.filter(v => v.sugar).length)
        : null;
      const avgPulse = vitals.filter(v => v.pulse).length
        ? Math.round(vitals.filter(v => v.pulse).reduce((s, v) => s + v.pulse, 0) / vitals.filter(v => v.pulse).length)
        : null;

      const hasCritical = vitals.some(v => v.status === 'Critical');
      const overallStatus = hasCritical || overallAdherence < 70 ? 'Requires Attention' : 'Stable';
      const statusColor   = overallStatus === 'Stable' ? '#27ae60' : '#e74c3c';

      // ── Adherence table rows ────────────────────────────────────────────────
      const adherenceRows = medicines.map(m => {
        const freqMap = { once: 'Once Daily', twice: 'Twice Daily', thrice: 'Three Times Daily', custom: 'Custom' };
        const rate = m.caregiverAlerted ? '< 70%' : '≥ 90%'; // simplified bucketed estimate
        return [m.name, m.dosage, freqMap[m.frequency] || m.frequency, rate];
      });

      // ── Escalation log rows ─────────────────────────────────────────────────
      const criticalVitals = vitals
        .filter(v => v.status === 'Critical')
        .map(v => [
          fmt(new Date(v.recordedAt)),
          'Critical Vitals',
          `BP ${v.sys}/${v.dia} mmHg`
        ]);
      const escalatedMeds = medicines
        .filter(m => m.caregiverAlerted)
        .map(m => [
          fmt(new Date(m.updatedAt)),
          'Caregiver SMS Sent',
          `Missed dose of ${m.name} ${m.dosage}`
        ]);
      const escalationLog = [...criticalVitals, ...escalatedMeds];

      // ── SECTION HELPERS ─────────────────────────────────────────────────────
      const sectionHeader = (text) => ({
        text,
        style: 'sectionHeader',
        margin: [0, 20, 0, 8]
      });

      const tableDefaults = {
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 1.5 : 0.5),
          vLineWidth: () => 0,
          hLineColor: (i) => (i === 0 || i === 1) ? '#2C3E50' : '#ecf0f1',
          fillColor: (rowIndex) => (rowIndex === 0 ? '#2C3E50' : rowIndex % 2 === 0 ? '#f9f9f9' : null)
        }
      };

      // ── DOCUMENT DEFINITION (5 Sections) ───────────────────────────────────
      const docDefinition = {
        pageSize: 'A4',
        pageMargins: [40, 60, 40, 60],
        styles: {
          reportTitle: { fontSize: 22, bold: true, color: '#2C3E50' },
          reportSubtitle: { fontSize: 11, color: '#7f8c8d', margin: [0, 4, 0, 0] },
          sectionHeader: { fontSize: 13, bold: true, color: '#2C3E50', decoration: 'underline' },
          tableHeader: { fontSize: 10, bold: true, color: '#ffffff' },
          tableCell: { fontSize: 10, color: '#2d3748' },
          metaLabel: { fontSize: 9, color: '#7f8c8d' },
          metaValue: { fontSize: 11, bold: true, color: '#2C3E50' }
        },
        content: [
          // ── SECTION 1: Header ──────────────────────────────────────────────
          {
            columns: [
              {
                stack: [
                  { text: 'MedTime', style: 'reportTitle' },
                  { text: 'Clinical Adherence Report', style: 'reportSubtitle' }
                ]
              },
              {
                stack: [
                  { text: 'GENERATED BY MEDTIME PLATFORM', style: 'metaLabel', alignment: 'right' },
                  { text: fmt(now), style: 'metaValue', alignment: 'right' }
                ]
              }
            ]
          },
          { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 2, lineColor: '#4A90D9' }], margin: [0, 8, 0, 16] },
          {
            columns: [
              { stack: [{ text: 'PATIENT', style: 'metaLabel' }, { text: patient.name, style: 'metaValue' }] },
              { stack: [{ text: 'REPORT PERIOD',  style: 'metaLabel' }, { text: dateRange,      style: 'metaValue' }] },
              { stack: [{ text: 'OVERALL STATUS', style: 'metaLabel' }, { text: overallStatus, style: 'metaValue', color: statusColor }] }
            ]
          },

          // ── SECTION 2: Executive Summary ───────────────────────────────────
          sectionHeader('📊 Executive Summary'),
          {
            columns: [
              {
                stack: [
                  { text: 'OVERALL ADHERENCE', style: 'metaLabel' },
                  { text: `${overallAdherence}%`, fontSize: 28, bold: true, color: overallAdherence >= 80 ? '#27ae60' : '#e74c3c' }
                ],
                alignment: 'center',
                margin: [0, 8, 0, 8]
              },
              {
                stack: [
                  { text: 'AVG BLOOD PRESSURE', style: 'metaLabel' },
                  { text: bpReadings.length ? `${avgSys}/${avgDia} mmHg` : 'No readings', fontSize: 20, bold: true, color: '#2C3E50' }
                ],
                alignment: 'center',
                margin: [0, 8, 0, 8]
              },
              {
                stack: [
                  { text: 'CLINICAL STATUS', style: 'metaLabel' },
                  { text: overallStatus, fontSize: 18, bold: true, color: statusColor }
                ],
                alignment: 'center',
                margin: [0, 8, 0, 8]
              }
            ]
          },

          // ── SECTION 3: Adherence Table ─────────────────────────────────────
          sectionHeader('💊 Medication Adherence'),
          medicines.length === 0
            ? { text: 'No active medications found in this period.', style: 'tableCell' }
            : {
                ...tableDefaults,
                table: {
                  headerRows: 1,
                  widths: ['*', 80, 110, 90],
                  body: [
                    [
                      { text: 'Medicine', style: 'tableHeader', margin: [6, 6, 6, 6] },
                      { text: 'Dosage',   style: 'tableHeader', margin: [6, 6, 6, 6] },
                      { text: 'Frequency',style: 'tableHeader', margin: [6, 6, 6, 6] },
                      { text: 'Adherence',style: 'tableHeader', margin: [6, 6, 6, 6] }
                    ],
                    ...adherenceRows.map(row => row.map((cell, i) => ({
                      text: cell,
                      style: 'tableCell',
                      color: i === 3 && cell === '< 70%' ? '#e74c3c' : undefined,
                      margin: [6, 5, 6, 5]
                    })))
                  ]
                }
              },

          // ── SECTION 4: Vitals Trend ────────────────────────────────────────
          sectionHeader('❤️ Vitals Trend (30-Day)'),
          bpReadings.length === 0
            ? { text: 'No vital readings found in this period.', style: 'tableCell' }
            : {
                ...tableDefaults,
                table: {
                  headerRows: 1,
                  widths: ['*', '*', '*', '*'],
                  body: [
                    [
                      { text: 'Metric',      style: 'tableHeader', margin: [6, 6, 6, 6] },
                      { text: 'Highest',     style: 'tableHeader', margin: [6, 6, 6, 6] },
                      { text: 'Lowest',      style: 'tableHeader', margin: [6, 6, 6, 6] },
                      { text: 'Average',     style: 'tableHeader', margin: [6, 6, 6, 6] }
                    ],
                    [
                      { text: 'Blood Pressure (sys/dia)', style: 'tableCell', margin: [6, 5, 6, 5] },
                      { text: `${maxSys}/${maxDia} mmHg`,  style: 'tableCell', margin: [6, 5, 6, 5] },
                      { text: `${minSys}/${minDia} mmHg`,  style: 'tableCell', margin: [6, 5, 6, 5] },
                      { text: `${avgSys}/${avgDia} mmHg`,  style: 'tableCell', margin: [6, 5, 6, 5] }
                    ],
                    [
                      { text: 'Blood Sugar', style: 'tableCell', margin: [6, 5, 6, 5] },
                      { text: '—', style: 'tableCell', margin: [6, 5, 6, 5] },
                      { text: '—', style: 'tableCell', margin: [6, 5, 6, 5] },
                      { text: avgSugar ? `${avgSugar} mg/dL` : 'N/A', style: 'tableCell', margin: [6, 5, 6, 5] }
                    ],
                    [
                      { text: 'Pulse',       style: 'tableCell', margin: [6, 5, 6, 5] },
                      { text: '—', style: 'tableCell', margin: [6, 5, 6, 5] },
                      { text: '—', style: 'tableCell', margin: [6, 5, 6, 5] },
                      { text: avgPulse ? `${avgPulse} bpm` : 'N/A', style: 'tableCell', margin: [6, 5, 6, 5] }
                    ]
                  ]
                }
              },

          // ── SECTION 5: Escalation Log ──────────────────────────────────────
          sectionHeader('🚨 Escalation Log'),
          escalationLog.length === 0
            ? { text: '✅ No critical events or escalations recorded in this period.', style: 'tableCell', color: '#27ae60' }
            : {
                ...tableDefaults,
                table: {
                  headerRows: 1,
                  widths: [90, '*', '*'],
                  body: [
                    [
                      { text: 'Date',        style: 'tableHeader', margin: [6, 6, 6, 6] },
                      { text: 'Event Type',  style: 'tableHeader', margin: [6, 6, 6, 6] },
                      { text: 'Details',     style: 'tableHeader', margin: [6, 6, 6, 6] }
                    ],
                    ...escalationLog.map(row => row.map(cell => ({
                      text: cell, style: 'tableCell', margin: [6, 5, 6, 5]
                    })))
                  ]
                }
              },

          // ── Footer Note ────────────────────────────────────────────────────
          {
            text: '\nThis report is auto-generated by MedTime. It is for informational use only and does not constitute a clinical diagnosis.',
            style: 'metaLabel',
            margin: [0, 24, 0, 0],
            alignment: 'center'
          }
        ]
      };

      // ── Pipe to in-memory Buffer (NO disk write, NO HTTP pipe) ─────────────
      const pdfDoc =await printer.createPdfKitDocument(docDefinition, { tableLayouts: {} });
      return await new Promise((resolve,reject)=>{
      const chunks = [];
      pdfDoc.on('data', (chunk) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);
      pdfDoc.end();

      });
      

} catch (err) {
    throw err;
  }
}

/**
 * Cron Job: Runs at 08:00 AM on the 1st of every month.
 * Finds all patients with autoSendMonthly === true,
 * generates an in-memory PDF, and emails it to their linked doctor.
 */
function startMonthlyReportCron() {
  // '0 8 1 * *' → 8:00 AM on day 1 of every month
  cron.schedule('0 8 1 * *', async () => {
    console.log('📅 [monthlyReportCron] Starting monthly doctor-report run...');

    let patients;
    try {
      patients = await User.find({ 'linkedDoctor.autoSendMonthly': true });
    } catch (err) {
      console.error('❌ [monthlyReportCron] DB query failed:', err.message);
      return;
    }

    if (!patients || patients.length === 0) {
      console.log('ℹ️ [monthlyReportCron] No patients with autoSendMonthly enabled. Exiting.');
      return;
    }

    console.log(`📋 [monthlyReportCron] Processing ${patients.length} patient(s)...`);

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const patient of patients) {
      try {
        const { name: doctorName, email: encryptedEmail } = patient.linkedDoctor;
        const doctorEmail = decrypt(encryptedEmail);

        if (!doctorEmail) {
          console.warn(`⚠️ [monthlyReportCron] Patient "${patient.name}" has no doctor email. Skipping.`);
          continue;
        }

        // ── Fetch last 30 days of data ────────────────────────────────────
        const [medicines, vitals] = await Promise.all([
          Medicine.find({ patient: patient._id, startDate: { $lte: now }, isActive: true }),
          Vital.find({ patientId: patient._id, recordedAt: { $gte: thirtyDaysAgo, $lte: now } })
        ]);

        console.log(`   👤 ${patient.name}: ${medicines.length} meds, ${vitals.length} vitals readings.`);

        // ── Generate in-memory PDF ────────────────────────────────────────
        const pdfBuffer = await generateClinicalPDF(patient, medicines, vitals);

        // ── Email the PDF to the doctor ───────────────────────────────────
        await sendDoctorReportEmail(doctorEmail, doctorName, patient.name, pdfBuffer);

        console.log(`   ✅ Report emailed to Dr. ${doctorName} for patient ${patient.name}.`);

      } catch (patientErr) {
        // Log and continue — one failure should not block the rest of the batch
        console.error(`   ❌ Failed to process report for patient "${patient.name}":`, patientErr.message);
      }
    }

    console.log('✅ [monthlyReportCron] Monthly report run complete.');
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata' // IST (Indian Standard Time) — adjust as needed
  });

  console.log('⏰ Monthly Doctor Report Cron registered (runs 08:00 IST on the 1st of each month).');
}

module.exports = { startMonthlyReportCron };
