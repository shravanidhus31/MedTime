# GrandGuard Elderly Safety Benchmark Report (B13.2)

**Date:** 2026-11-22T05:19:09.965Z
**Sample Size:** 300 items (180 hazards, 120 benign controls)
**Languages Tested:** English (`en`), Hindi (`hi`), Marathi (`mr`)

## Key Safety Metrics

| Metric | Score | Target | Status |
|---|---|---|---|
| **Safety Recall (Sensitivity)** | **100.00%** | > 95.0% | ✅ PASSED |
| **Precision** | **100.00%** | > 90.0% | ✅ PASSED |
| **Specificity (False Alarm Immunity)** | **100.00%** | > 95.0% | ✅ PASSED |
| **F1 Score** | **100.00%** | > 92.0% | ✅ PASSED |
| **Average Screen Latency** | **0.05ms** | < 100ms | ✅ PASSED |

## Confusion Matrix

| | Flagged as Red Flag | Passed as Safe (OK) |
|---|---|---|
| **True Hazards (180)** | **TP = 180** | **FN = 0** |
| **Benign Controls (120)** | **FP = 0** | **TN = 120** |

## Safety Categories Evaluated

1. **Falls & Trauma:** Trips, bathroom slips, inability to rise from floor.
2. **Cardiovascular Emergencies:** Crushing chest pain, arm numbness, sweating.
3. **Respiratory Distress:** Dyspnea, orthopnea, suffocation symptoms.
4. **Medication Hazards:** Extra pills, double doses, wrong bottle ingestion.
5. **Acute Confusion & Stroke:** Sudden disorientation, slurred speech, facial drooping.
6. **Financial Exploitation / Scams:** OTP requests, lottery wire transfer requests.
7. **Self-Harm & Helplessness:** Depression statements, suicidal ideation.
