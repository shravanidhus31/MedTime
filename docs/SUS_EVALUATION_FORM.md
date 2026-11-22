# System Usability Scale (SUS) Evaluation Form — B13.3
**Project:** MedTime Care Agent (Intel AI for Future Workforce)  
**Standard Instrument:** System Usability Scale (Brooke, 1996)  
**Target Audience:** Family Caregivers, Professional Nurses, and Clinical Observers  
**Comparative Baselines:**
- **MeBo Baseline (2024):** 87.75 / 100
- **CHI 2025 Supervised Care Agent Baseline:** 85.00 / 100
- **MedTime Care Agent Target:** ≥ 85.00 / 100

---

## 1. Instructions for Evaluator

Please score each statement on a 5-point Likert scale based on your immediate reaction after using the MedTime Caregiver Dashboard, reviewing AI proposals, and testing the call simulator:

- **1** = Strongly Disagree
- **2** = Disagree
- **3** = Neutral
- **4** = Agree
- **5** = Strongly Agree

---

## 2. The 10-Item SUS Questionnaire

| # | Statement | 1 (SD) | 2 (D) | 3 (N) | 4 (A) | 5 (SA) |
|---|---|:---:|:---:|:---:|:---:|:---:|
| 1 | I think that I would like to use MedTime frequently to monitor and assist my loved one. | [ ] | [ ] | [ ] | [ ] | [ ] |
| 2 | I found the system unnecessarily complex (e.g. approving schedule changes or checking doses). | [ ] | [ ] | [ ] | [ ] | [ ] |
| 3 | I thought the MedTime interface and caregiver panels were easy to use. | [ ] | [ ] | [ ] | [ ] | [ ] |
| 4 | I think that I would need the assistance of a technical person to be able to use this system. | [ ] | [ ] | [ ] | [ ] | [ ] |
| 5 | I found the various functions in this system (journal, memory graph, prescription scanner) were well integrated. | [ ] | [ ] | [ ] | [ ] | [ ] |
| 6 | I thought there was too much inconsistency in this system. | [ ] | [ ] | [ ] | [ ] | [ ] |
| 7 | I would imagine that most people would learn to use this system very quickly. | [ ] | [ ] | [ ] | [ ] | [ ] |
| 8 | I found the system very cumbersome to use. | [ ] | [ ] | [ ] | [ ] | [ ] |
| 9 | I felt very confident using the system to supervise medication adherence and safety alerts. | [ ] | [ ] | [ ] | [ ] | [ ] |
| 10 | I needed to learn a lot of things before I could get going with this system. | [ ] | [ ] | [ ] | [ ] | [ ] |

---

## 3. SUS Scoring Formula

The System Usability Scale yields a single composite score on a scale of 0 to 100:

1. For **odd-numbered questions** (1, 3, 5, 7, 9):  
   $$\text{Score Contribution} = \text{User Rating} - 1$$
2. For **even-numbered questions** (2, 4, 6, 8, 10):  
   $$\text{Score Contribution} = 5 - \text{User Rating}$$
3. Multiply the sum of all item score contributions by **2.5**:  
   $$\text{SUS Total} = 2.5 \times \sum_{i=1}^{10} \text{Score Contribution}_i$$

---

## 4. Benchmark & Score Interpretation

| SUS Score Range | Grade | Adjective Rating | Clinical Acceptance |
|---|:---:|---|---|
| **> 85.0** | **A+** | **Best Imaginable / Excellent** | **Meets PRD target (outperforms CHI 2025)** |
| 80.3 – 85.0 | A | Excellent | Highly acceptable for elderly home care |
| 68.0 – 80.2 | B / C | Good / Above Average | Acceptable |
| 51.0 – 67.9 | D | OK / Marginal | Needs simplification |
| < 51.0 | F | Poor / Unusable | Not clinically deployable |

---

## 5. Clinical Dimension Qualitative Questions (Post-Task Interview)

1. **Supervision vs. Autonomy:** Did you feel in control when reviewing prescription proposals and schedule changes before they were applied?
2. **Safety Screen Comfort:** Did the immediate neutral escalation for falls/chest pain give you peace of mind?
3. **Double-Dose Prevention:** Was the call-in agent clear and reassuring when explaining that a dose was already taken?
