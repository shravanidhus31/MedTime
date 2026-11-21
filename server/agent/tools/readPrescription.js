/**
 * read_prescription Tool — B12 (Prescription-to-Schedule Agent, Feature 8)
 *
 * Smart-tier LLM tool that extracts structured medicine data from raw OCR text.
 * Each field has a confidence score. Low-confidence fields are NEVER guessed —
 * they appear as null with low confidence so the UI can show "couldn't read".
 *
 * Contract C1 compliant.
 */

module.exports = {
  name: 'read_prescription',
  description: 'Extract structured medicine schedule data from OCR prescription text. Returns each medicine with per-field confidence scores. Low-confidence fields are null, never invented.',
  inputSchema: {
    type: 'object',
    properties: {
      ocrText: {
        type: 'string',
        description: 'Raw text extracted from the prescription image by OCR',
      },
      currentMedicines: {
        type: 'array',
        description: 'List of currently active medicines for duplicate/conflict detection',
        items: { type: 'object' },
      },
    },
    required: ['ocrText'],
  },
  approvalLevel: 1, // Level 1: Caregiver must approve before any medicine is created

  async run(input, ctx = {}) {
    const { ocrText, currentMedicines = [] } = input;

    if (!ocrText || !ocrText.trim()) {
      return { ok: false, error: 'No OCR text provided to read_prescription.' };
    }

    const provider = process.env.LLM_PROVIDER || 'groq';
    const apiKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.GROQ_API_KEY;

    if (!apiKey) {
      // Fall back to basic regex parsing without LLM
      return fallbackRegexParse(ocrText, currentMedicines);
    }

    const model = process.env.LLM_MODEL_SMART ||
      (provider === 'anthropic' ? 'claude-sonnet-4-5' : 'llama-3.3-70b-versatile');

    const currentMedNames = currentMedicines.map((m) => m.name || '').filter(Boolean);

    const systemPrompt = `You are a clinical pharmacist AI assistant that extracts structured data from prescription images.

RULES (must follow strictly):
1. Extract ONLY what is explicitly stated in the text. Never guess or infer missing values.
2. For each field, assign a confidence: "high" (clearly stated), "medium" (implied but not explicit), or "low" (not found or unclear).
3. Low-confidence fields MUST be set to null in the value. Never fill them with assumptions.
4. Identify if any medicine is a DUPLICATE of the current list (same name, any strength).
5. Identify STRENGTH CHANGES (same name, different strength than what is currently active).
6. Output valid JSON only. No commentary.

Current active medicines for conflict detection: ${currentMedNames.length > 0 ? currentMedNames.join(', ') : 'none'}

Output format (JSON array):
[
  {
    "name": "string | null",
    "nameConfidence": "high | medium | low",
    "strength": "string | null",
    "strengthConfidence": "high | medium | low",
    "dose": "string | null",
    "doseConfidence": "high | medium | low",
    "frequency": "once | twice | thrice | alternate_days | weekly | custom | null",
    "frequencyConfidence": "high | medium | low",
    "daysOfWeek": [0,1,2,3,4,5,6] | null,
    "intervalDays": number | null,
    "duration": "string | null",
    "durationConfidence": "high | medium | low",
    "foodRule": "before | after | with | any | null",
    "foodRuleConfidence": "high | medium | low",
    "isDuplicate": boolean,
    "isStrengthChange": boolean,
    "conflictNotes": "string | null"
  }
]`;

    try {
      let endpoint, headers, body;

      if (provider === 'anthropic') {
        endpoint = 'https://api.anthropic.com/v1/messages';
        headers = {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        };
        body = JSON.stringify({
          model,
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: 'user', content: `Extract medicines from this prescription text:\n\n${ocrText}` }],
        });
      } else {
        endpoint = 'https://api.groq.com/openai/v1/chat/completions';
        headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        };
        body = JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Extract medicines from this prescription text:\n\n${ocrText}` },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 2000,
          temperature: 0,
        });
      }

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(8000), // 8s budget for prescription reading
      });

      const data = await resp.json();
      let raw;

      if (provider === 'anthropic') {
        raw = data.content?.[0]?.text || '[]';
      } else {
        raw = data.choices?.[0]?.message?.content || '[]';
      }

      // Handle Groq JSON object wrapping
      const parsed = JSON.parse(raw);
      const medicines = Array.isArray(parsed) ? parsed : (parsed.medicines || parsed.data || []);

      // Validate: reject any medicine where name confidence is low (never guess names)
      const validated = medicines.map((med) => ({
        ...med,
        name: med.nameConfidence === 'low' ? null : med.name,
        strength: med.strengthConfidence === 'low' ? null : med.strength,
        frequency: med.frequencyConfidence === 'low' ? null : med.frequency,
        duration: med.durationConfidence === 'low' ? null : med.duration,
        foodRule: med.foodRuleConfidence === 'low' ? null : med.foodRule,
      }));

      return {
        ok: true,
        medicines: validated,
        total: validated.length,
        hasConflicts: validated.some((m) => m.isDuplicate || m.isStrengthChange),
        hasLowConfidence: validated.some(
          (m) =>
            m.nameConfidence === 'low' ||
            m.frequencyConfidence === 'low' ||
            m.strengthConfidence === 'low'
        ),
      };
    } catch (err) {
      console.error('[read_prescription] LLM error, using regex fallback:', err.message);
      return fallbackRegexParse(ocrText, currentMedicines);
    }
  },
};

/**
 * Basic regex fallback when no LLM key is available.
 * Conservative: only extracts what regex clearly matches.
 */
function fallbackRegexParse(ocrText, currentMedicines) {
  const lines = ocrText.split('\n').map((l) => l.trim()).filter((l) => l.length > 3);
  const medicines = [];
  const currentNames = currentMedicines.map((m) => (m.name || '').toLowerCase());

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Name + strength pattern: "Metformin 500mg" or "Tab. Aspirin 75 mg"
    const nameStrengthMatch = line.match(
      /(?:tab\.?\s*|cap\.?\s*|syrup\s*)?([A-Za-z][\w\s\-\/]{2,30}?)\s+(\d+(?:\.\d+)?)\s*(mg|mcg|ml|g|iu)/i
    );

    if (!nameStrengthMatch) continue;

    const name = nameStrengthMatch[1].replace(/\b(tab|cap|syrup|sr|er|xl|od)\b\.?/gi, '').trim();
    const strength = `${nameStrengthMatch[2]}${nameStrengthMatch[3].toLowerCase()}`;

    // Frequency detection
    let frequency = null;
    let frequencyConfidence = 'low';
    if (/\b(od|once|1-0-0|1-0-1|1-1-1|once daily)\b/i.test(lower)) {
      frequency = 'once'; frequencyConfidence = 'high';
    } else if (/\b(bd|twice|bid|2x|1-0-1|twice daily|two times)\b/i.test(lower)) {
      frequency = 'twice'; frequencyConfidence = 'high';
    } else if (/\b(tds|thrice|tid|3x|three times)\b/i.test(lower)) {
      frequency = 'thrice'; frequencyConfidence = 'high';
    } else if (/\b(alternate|eod|every other day)\b/i.test(lower)) {
      frequency = 'alternate_days'; frequencyConfidence = 'medium';
    } else if (/\b(weekly|once a week|per week)\b/i.test(lower)) {
      frequency = 'weekly'; frequencyConfidence = 'medium';
    }

    // Food rule
    let foodRule = null;
    let foodRuleConfidence = 'low';
    if (/before\s*(food|meal|eating|breakfast|lunch|dinner)/i.test(lower)) {
      foodRule = 'before'; foodRuleConfidence = 'high';
    } else if (/after\s*(food|meal|eating|breakfast|lunch|dinner)/i.test(lower)) {
      foodRule = 'after'; foodRuleConfidence = 'high';
    } else if (/with\s*(food|meal|water)/i.test(lower)) {
      foodRule = 'with'; foodRuleConfidence = 'high';
    }

    // Duration
    const durationMatch = line.match(/(\d+)\s*(days?|weeks?|months?)/i);
    const duration = durationMatch ? `${durationMatch[1]} ${durationMatch[2]}` : null;

    const isDuplicate = currentNames.some((n) => n.includes(name.toLowerCase()) || name.toLowerCase().includes(n));

    medicines.push({
      name: name || null,
      nameConfidence: name ? 'medium' : 'low',
      strength: strength || null,
      strengthConfidence: strength ? 'medium' : 'low',
      dose: null,
      doseConfidence: 'low',
      frequency,
      frequencyConfidence,
      daysOfWeek: null,
      intervalDays: null,
      duration,
      durationConfidence: duration ? 'medium' : 'low',
      foodRule,
      foodRuleConfidence,
      isDuplicate,
      isStrengthChange: false,
      conflictNotes: isDuplicate ? `${name} may already be in the active medicine list` : null,
    });
  }

  return {
    ok: true,
    medicines,
    total: medicines.length,
    source: 'regex_fallback',
    hasConflicts: medicines.some((m) => m.isDuplicate),
    hasLowConfidence: medicines.some(
      (m) => m.nameConfidence === 'low' || m.frequencyConfidence === 'low'
    ),
  };
}
