# Contract C7 — Call-In Phrase Bank Lines (Feature 7 / B11)
**Author:** Person B (Anuj)  
**Recipient:** Person A (Voice & Audio Pipeline)  
**Status:** Ready for Catalog Integration into `voice/phrasebank/catalogue.json`  
**Tone:** Neutral, warm, calm, non-patronizing, elderly-friendly Indian English (en-IN).

---

## Overview

Per Contract C7 and PRD Feature 7 ("Did I take my pills?"), the call-in agent answers patient queries without ever giving independent clinical advice or encouraging double doses.

When audio is rendered, Person A's `resolveLine(lineId, slots, patientId)` returns the audio URL. Until synthesized, the system falls back to `neutralText` with slots interpolated.

---

## Line Catalogue Table

| Line ID | Slots | Default Neutral Text (en-IN) | Trigger / Context |
|---|---|---|---|
| `callin_greeting` | `{patientName}` | "Hello {patientName}, this is MedTime. How can I help you right now?" | Call answered, patient identified |
| `callin_dose_taken` | `{medicineName}, {timeTaken}, {nextTime}` | "Yes, you took your {medicineName} at {timeTaken}. Your next dose is scheduled for {nextTime}." | Dose already marked taken today |
| `callin_dose_taken_no_next` | `{medicineName}, {timeTaken}` | "Yes, you took your {medicineName} at {timeTaken}. That was your last dose for today." | Dose taken, no further doses today |
| `callin_dose_due_now` | `{medicineName}, {scheduledTime}, {pillboxSlot}` | "Your {medicineName} is due right now. It's in slot {pillboxSlot} of your box. Would you like to take it now?" | Dose pending and window currently open |
| `callin_dose_due_now_noslot` | `{medicineName}, {scheduledTime}` | "Your {medicineName} for {scheduledTime} is due now. Would you like to take it with some water?" | Dose pending, no pillbox slot configured |
| `callin_dose_missed_past` | `{medicineName}, {scheduledTime}` | "Your {scheduledTime} dose of {medicineName} was not recorded, but please do not take an extra pill now. I'll let your caregiver know so they can check with you." | Scheduled time has passed, prevents double dose |
| `callin_no_doses_today` | `{patientName}` | "You don't have any more medicine scheduled for today, {patientName}. You are all set." | No remaining doses today |
| `callin_schedule_summary` | `{scheduleSummary}` | "Here is your schedule: {scheduleSummary}." | Patient asks about their daily routine or timing |
| `callin_memory_found` | `{personName}, {relationship}, {detail}` | "{personName} is your {relationship}. {detail}" | Query answered directly from Life Notes graph |
| `callin_memory_clarify` | `{query}` | "I want to be sure I give you the right information. Are you asking about family or your routine?" | Ambiguous query — exactly one clarification allowed |
| `callin_memory_unknown` | `{caregiverName}` | "I don't have that written down, but I'll ask {caregiverName} to call you shortly." | Life note not found; never invents facts |
| `callin_repeat_calm` | `{medicineName}, {statusSummary}` | "Don't worry, you're doing great. As a reminder, {medicineName} was {statusSummary}. Everything is taken care of." | >3 calls in 1 hour; gentle reassurance without frustration |
| `callin_unregistered_caller` | none | "This phone number is not registered with MedTime. Please contact your primary caregiver for assistance." | Unregistered caller ID deflection |
| `callin_emergency_deflection` | `{caregiverName}` | "Please stay right where you are. I have immediately alerted {caregiverName} and emergency services." | Red flag detected during call |

---

## Slot Specifications

- `{patientName}`: First name of patient (e.g. "Ramesh", "Sita").
- `{medicineName}`: Clean medicine name without strength jargon (e.g. "Aspirin", "Metformin").
- `{timeTaken}`: Formatted in 12-hour IST (e.g. "8:10 AM").
- `{nextTime}`: Formatted in 12-hour IST (e.g. "2:00 PM").
- `{scheduledTime}`: Formatted in 12-hour IST (e.g. "8:00 AM").
- `{pillboxSlot}`: Pillbox slot letter or label (e.g. "slot A", "Morning box").
- `{caregiverName}`: Primary caregiver name from Patient profile (e.g. "Priya").
- `{relationship}`: Relationship from LifeNote (e.g. "daughter", "cardiologist").
- `{detail}`: Factual snippet from LifeNote (e.g. "She lives in Pune and calls every evening.").

---

## Double-Dose Protection Contract

1. If dose status is `taken`, the system **must** state the exact time taken and never prompt the patient to take another dose.
2. If dose is missed (scheduled time + 60 min passed), the system **must** advise against taking an extra pill and alert the caregiver via `notify_caregiver`.
3. If caller asks >3 times within 1 hour about the same dose, the agent uses `callin_repeat_calm` and appends a `sundowning_anxiety` pattern note to tonight's Daily Care Journal.
