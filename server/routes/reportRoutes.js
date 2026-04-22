const express = require('express');
const router = express.Router();
const PdfPrinter = require('pdfmake/js/Printer.js').default;
const Vital = require('../models/Vital');
const Medicine = require('../models/Medicine');
const User = require('../models/User');
const Patient = require('../models/Patient');
const { verifyToken } = require('../middleware/authMiddleware');

// Load Roboto fonts from pdfmake's bundled vfs (base64 strings)
const _vfsRaw = require('pdfmake/build/vfs_fonts');
const vfsFonts = _vfsRaw.pdfMake?.vfs ?? _vfsRaw; // handle both nested and flat exports

// Font definition uses filenames — resolved via virtualfs below
const fonts = {
  Roboto: {
    normal:      'Roboto-Regular.ttf',
    bold:        'Roboto-Medium.ttf',
    italics:     'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  }
};

// Virtual filesystem adapter: decodes base64 font data on demand
const virtualfs = {
  existsSync:   (filename) => !!vfsFonts[filename],
  readFileSync: (filename) => Buffer.from(vfsFonts[filename], 'base64'),
};

// No-op urlResolver — required by this version of pdfmake (no remote URLs used)
const noopUrlResolver = { resolve: () => {}, resolved: () => Promise.resolve() };
const printer = new PdfPrinter(fonts, virtualfs, noopUrlResolver);

// GET - Download 30-Day Clinical PDF Report
router.get('/pdf', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Fetch User + Patient profile (medicines are stored against Patient._id, not User._id)
    const patient = await User.findById(userId);
    const patientProfile = await Patient.findOne({ user: userId });
    if (!patientProfile) {
      console.warn('[PDF Report] No Patient profile found for userId:', userId);
      return res.status(404).json({ error: 'Patient profile not found. Please add a medicine first.' });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const vitals = await Vital.find({ patientId: userId, recordedAt: { $gte: thirtyDaysAgo } }).sort({ recordedAt: -1 });
    // Medicine.patient stores patientProfile._id (NOT the User._id)
    const medicines = await Medicine.find({ patient: patientProfile._id });

    // ── Diagnostic log — remove after confirming data is correct ──────────────
    console.log('[PDF Report] userId:', userId, '| patientProfileId:', patientProfile._id);
    console.log('[PDF Report] medicines found:', medicines.length);
    if (medicines.length > 0) console.log('[PDF Report] sample medicine:', JSON.stringify(medicines[0], null, 2));
    else console.warn('[PDF Report] ⚠️ No medicines found for patientProfileId:', patientProfile._id);

    // 2. Calculate Executive Summary Stats
    let avgSys = 0, avgDia = 0, vitalsStatus = 'Stable';
    if (vitals.length > 0) {
      avgSys = Math.round(vitals.reduce((acc, v) => acc + v.sys, 0) / vitals.length);
      avgDia = Math.round(vitals.reduce((acc, v) => acc + v.dia, 0) / vitals.length);
      const latestStatus = vitals[0].status;
      vitalsStatus = latestStatus === 'Normal' ? 'Stable' : `Requires Attention (${latestStatus})`;
    }

    // 3. Format the Medicines Array for the PDF Table
    const freqLabel = { once: 'Once Daily', twice: 'Twice Daily', thrice: 'Three Times Daily', custom: 'Custom' };
    const medTableBody = [
      // Table Header Row
      [
        { text: 'Medication',  bold: true },
        { text: 'Dosage',      bold: true },
        { text: 'Frequency',   bold: true },
        { text: 'Status',      bold: true }
      ]
    ];

    medicines.forEach(med => {
      const statusText = med.caregiverAlerted ? 'Caregiver Alerted' : 'On Track';
      medTableBody.push([
        med.name    || '—',
        med.dosage  || '—',
        freqLabel[med.frequency] || med.frequency || '—',
        statusText
      ]);
    });

    // 4. Build the Document Blueprint
    const docDefinition = {
      defaultStyle: { font: 'Roboto' },
      content: [
        { text: 'MedTime Clinical Summary', fontSize: 24, bold: true, color: '#5c4535', margin: [0, 0, 0, 5] },
        { text: `Generated: ${new Date().toLocaleDateString()}`, fontSize: 10, color: '#8a7560', margin: [0, 0, 0, 20] },
        
        // Context
        { text: 'Patient Information', fontSize: 14, bold: true, margin: [0, 0, 0, 5] },
        { text: `Name: ${patient.name}`, margin: [0, 0, 0, 2] },
        { text: `Reporting Period: Last 30 Days`, margin: [0, 0, 0, 20] },

        // Executive Summary
        { text: 'Executive Summary', fontSize: 14, bold: true, margin: [0, 0, 0, 10] },
        {
          columns: [
            { text: `Average BP:\n${avgSys}/${avgDia} mmHg`, bold: true, alignment: 'center' },
            { text: `Vitals Status:\n${vitalsStatus}`, bold: true, alignment: 'center', color: vitalsStatus === 'Stable' ? '#2e7d32' : '#c62828' }
          ],
          margin: [0, 0, 0, 20]
        },

        // Medication Table
        { text: 'Current Prescriptions & Adherence', fontSize: 14, bold: true, margin: [0, 0, 0, 10] },
        {
          table: {
            headerRows: 1,
            widths: ['*', 'auto', 'auto', 'auto'],
            body: medTableBody
          },
          layout: 'lightHorizontalLines', // Clean, minimalist borders
          margin: [0, 0, 0, 20]
        }
      ]
    };

    // 5. Generate and send the PDF!
    const pdfDoc = await printer.createPdfKitDocument(docDefinition);
    
    // Set headers so the browser knows it's receiving a downloaded file
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="MedTime_Report_${patient.name.replace(/\s+/g, '_')}.pdf"`);
    
    pdfDoc.pipe(res);
    pdfDoc.end();

  } catch (error) {
    console.error("PDF Generation Error:", error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

module.exports = router;