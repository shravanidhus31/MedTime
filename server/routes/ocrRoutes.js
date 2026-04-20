const express = require('express');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

// Store the uploaded file in memory temporarily (no need to save to disk)
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/v1/ocr/parse - Upload image and extract medicine details
// POST /api/v1/ocr/parse - Upload image and extract multiple medicines
router.post('/parse', verifyToken, upload.single('prescription'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image provided.' });
    }

    // 1. CRASH PROTECTION: Ensure it is actually an image!
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'Invalid file type. Please upload a JPG or PNG image of the prescription.' });
    }

    console.log('📷 Starting OCR analysis on uploaded prescription...');

    // 2. Run Tesseract OCR on the image buffer
    const { data: { text } } = await Tesseract.recognize(
      req.file.buffer,
      'eng',
      { logger: m => console.log(m.status, Math.round(m.progress * 100) + '%') }
    );

    console.log('📝 Raw Extracted Text:\n', text);

    // 3. Parse the unstructured text into an ARRAY of medicines
// 3. Parse the unstructured text into an ARRAY of medicines
// 3. Parse the unstructured text into an ARRAY of medicines
    let extractedMedicines = [];
    
    // Split by new lines, trim extra spaces, and ignore tiny/empty lines
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      // SMART DEMO PARSER: Catch any line with 'mg' OR 'vitamin'
      if (lowerLine.includes('mg') || lowerLine.includes('vitamin')) {
        
        // 1. Bulletproof Name Extraction
        let name = 'Unknown Medicine';
        if (lowerLine.includes('paracetamol')) name = 'Paracetamol';
        else if (lowerLine.includes('amoxicillin')) name = 'Amoxicillin';
        else if (lowerLine.includes('cetirizine')) name = 'Cetirizine';
        else if (lowerLine.includes('vitamin c')) name = 'Vitamin C';

        // 2. Bulletproof Dosage Extraction
        let dosageMatch = lowerLine.match(/(\d+)\s*(mg)/);
        let dosage = dosageMatch ? dosageMatch[0] : '1 Tablet';

        // 3. Bulletproof Time Extraction
        let time = '08:00'; // Default morning
        if (lowerLine.includes('morning')) time = '08:00';
        else if (lowerLine.includes('afternoon')) time = '14:00';
        else if (lowerLine.includes('evening')) time = '18:00';
        else if (lowerLine.includes('night')) time = '21:00';

        // Push the perfectly formatted object into our array
        extractedMedicines.push({
          name: name,
          dosage: dosage,
          frequency: 'once',
          time: time,
          mealTiming: 'after' // Defaulting to after food
        });
      }
    }

    // DEBUG: Print the final array to the terminal so we can see it!
    console.log("✅ Parsed Medicines Array:", extractedMedicines);

    // Send the array back to React
    res.status(200).json({ 
      message: 'Prescription parsed successfully',
      extractedMedicines 
    });
      
    

  } catch (error) {
    console.error('OCR Error:', error);
    res.status(500).json({ message: 'Failed to read prescription', error: error.message });
  }
});

module.exports = router;