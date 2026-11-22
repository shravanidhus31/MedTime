# MedTime — Known Issues

Findings from a full read-through of the repository (server and client). Nothing here has been fixed yet.

Priority: **High** = security or data-correctness problem, **Medium** = functional bug, **Low** = cleanup.

## High

### 1. Missing authorization on medicine routes
- **Where:** [server/routes/medicineRoutes.js](server/routes/medicineRoutes.js)
- `PUT /medicines/:id`, `DELETE /medicines/:id` and `POST /medicines/:id/status` never check that the medicine belongs to the logged-in user. Any authenticated user can edit, delete or change the status of anyone's medicine.
- `PUT /medicines/:id` passes `req.body` straight into `findByIdAndUpdate`, so any field can be overwritten, including `patient`, `caregiverAlerted` and `snoozeUntil`.
- **Fix:** look up the user's `Patient` profile (or confirm they are a linked caregiver) and scope every query to it. Whitelist the updatable fields.

### 2. Anyone can link themselves as a caregiver
- **Where:** [server/routes/caregiverRoutes.js:64](server/routes/caregiverRoutes.js#L64)
- `POST /caregiver/link` has no role check and no consent from the patient. Knowing a patient's phone number is enough to gain access to their medication history and to receive their alerts.
- **Fix:** require the caregiver role, and add patient approval or an invite code.

### 3. Monthly report cron queries medicines with the wrong ID
- **Where:** [server/utils/monthlyReportCron.js:344](server/utils/monthlyReportCron.js#L344)
- `Medicine.find({ patient: patient._id })` uses a `User._id`, but `Medicine.patient` stores a `Patient._id`. The emailed report will usually show no medicines. [reportRoutes.js](server/routes/reportRoutes.js) resolves this correctly through `Patient.findOne({ user })`.
- **Fix:** look up the `Patient` profile first and query with its `_id`.

### 4. Twilio webhooks are not verified
- **Where:** [server/routes/webhookRoutes.js](server/routes/webhookRoutes.js)
- `/webhooks/sms` and `/webhooks/voice` don't validate `X-Twilio-Signature`, so anyone can POST to them and mark doses taken, skipped or snoozed.
- `/webhooks/sms` also reads `req.body.Body.trim()` with no guard, and dereferences `patient._id` when the user has no `Patient` profile.
- **Fix:** use `twilio.webhook()` or `validateRequest`, and add null checks.
- **Status:** ✅ fixed in A1.1 (`server/middleware/twilioSignature.js`, branch `feat/a-phase0-fixes`).

## Medium

### 5. Reminders are only generated for 7 days
- **Where:** [server/routes/medicineRoutes.js](server/routes/medicineRoutes.js)
- Reminders are created once when a medicine is added and nothing regenerates them. SMS reminders stop after a week. Voice calls match on `scheduledTimes`, so they are unaffected.
- **Fix:** add a daily job that tops up reminders for active medicines.
- **Note (A1.3):** voice calls now work per `Reminder`. Until the top-up exists, the escalation cron creates the Reminder for a call-type dose that is due this minute and has none (upsert on medicine + minute, so it never duplicates). The top-up should also upsert, not insert blindly, so the two never create two records for one dose.

### 6. Editing a medicine doesn't regenerate reminders
- **Where:** [server/routes/medicineRoutes.js](server/routes/medicineRoutes.js) (`PUT /:id`)
- Changing the time updates `scheduledTimes`, but existing future reminders keep the old time. A code comment acknowledges this.

### 7. Reminder generation doesn't use IST for "today"
- **Where:** [server/routes/medicineRoutes.js](server/routes/medicineRoutes.js)
- The day loop uses the server-local date (UTC on Render), then applies the IST-to-UTC conversion. Near midnight IST the generated dates can be off by one day.
- The "Frequency" field is also ignored, because only the single time the UI sends is used.

### 8. Caregiver "missed" count checks a status that doesn't exist
- **Where:** [server/routes/caregiverRoutes.js:37](server/routes/caregiverRoutes.js#L37)
- It tests for `'due'`, which is not in the `Reminder` status enum (`pending`, `alerted`, `taken`, `skipped`, `missed`). Reminders with status `missed` are not counted, and `pending` is not counted either.

### 9. Emailed adherence figures are estimates, not measurements
- **Where:** [server/utils/monthlyReportCron.js](server/utils/monthlyReportCron.js)
- Adherence is derived from the `caregiverAlerted` flag (`< 70%` or `≥ 90%`, and a flat `missedMeds * 30`) instead of counting `taken` and `missed` `Reminder` records. A doctor receiving this report gets misleading numbers.
- The simpler on-demand PDF in [reportRoutes.js](server/routes/reportRoutes.js) has a similar gap: the "Status" column is just "On Track" or "Caregiver Alerted".

### 10. Hardcoded ngrok fallback URL
- **Where:** [server/utils/twilioClient.js:14](server/utils/twilioClient.js#L14)
- If `NGROK_URL` is not set on Render, voice-call webhooks point at a dead tunnel. Patients' button presses are lost and the caregiver gets a false "missed" alert.
- **Fix:** use a `PUBLIC_BASE_URL` variable and fail loudly at startup if it is missing.
- **Status:** ✅ fixed in A1.2 (branch `feat/a-phase0-fixes`). `NGROK_URL` is no longer read.

### 11. Access token is never refreshed, and is lost on reload
- **Where:** [client/src/utils/api.js](client/src/utils/api.js), [client/src/redux/authSlice.js](client/src/redux/authSlice.js)
- The server issues a 15-minute access token and a refresh token, but the client stores only the access token (in memory) and never calls `/auth/refresh`. Users are silently logged out after 15 minutes and on every page refresh.
- **Fix:** persist the refresh token, add an axios 401 interceptor that refreshes and retries.

### 12. No registration UI
- **Where:** [client/src/App.jsx](client/src/App.jsx)
- `POST /auth/register` exists, but the client only has a login page. Caregivers also can't be assigned from the patient side.

### 13. Voice-call snooze and escalation edge cases
- **Where:** [server/jobs/missedDoseCron.js](server/jobs/missedDoseCron.js)
- Escalation state lives on `Medicine`, not per `Reminder`. Medicines with more than one scheduled time share one `caregiverAlertTime`, so a second dose can be skipped while the first is still armed.
- `caregiverAlerted` is only reset when the patient presses 1. It is not reset at the next scheduled dose, so the card can stay red.
- A caregiver SMS failure inside the loop is swallowed, so the `missed` state is recorded even if no one was notified.
- **Status:** ✅ fixed in A1.3 (branch `feat/a-phase0-fixes`): escalation fields live on each `Reminder`; confirming clears only that dose; the missed-dose alert is a phone call, and a failed one is marked `alertFailed` and retried up to 3 times. The dashboard badges switch to the per-dose fields in A1.4 (#14).

### 14. Take/Skip from the web app does not clear escalation state
- **Where:** [server/routes/medicineRoutes.js](server/routes/medicineRoutes.js) (`POST /:id/status`)
- It only updates the `Reminder`. It does not reset `caregiverAlertTime`, `snoozeUntil` or `caregiverAlerted` on the `Medicine`. A patient who confirms in the app can still trigger a caregiver alert 10 minutes later.

## Low

### 15. Weak input validation
- `register`, medicine create/update and vitals do almost no validation. For example, `password` is never checked before bcrypt, and `sys` and `dia` are not range-checked.
- `Vital.patientId` is not marked required ([server/models/Vital.js](server/models/Vital.js)).
- The `User.email` index is `sparse` but not `unique`.

### 16. Doctor settings stores `name` unencrypted, and `decrypt` can throw
- **Where:** [server/utils/encryptionUtil.js](server/utils/encryptionUtil.js), [server/routes/userRoutes.js](server/routes/userRoutes.js)
- A stored value that happens to contain exactly three colon-separated parts but isn't valid ciphertext will throw instead of being returned as-is.

### 17. CORS is fully open and auth errors leak internals
- **Where:** [server/index.js](server/index.js)
- `app.use(cors())` allows all origins. Many routes return `error.message` to the client on 500s.
- The invalid/expired-token response is `403`, which clients conventionally expect to be `401`.

### 18. OCR parser is a demo stub
- **Where:** [server/routes/ocrRoutes.js](server/routes/ocrRoutes.js)
- Only four drug names are recognised; everything else becomes "Unknown Medicine". The client auto-saves every result immediately, with stock hardcoded to 30, without a review step. There is also no file size limit on the upload.

### 19. Duplicate and dead code
- `DELETE /medicines/:id` is defined twice in [medicineRoutes.js](server/routes/medicineRoutes.js).
- `makeCall` in [twilioClient.js](server/utils/twilioClient.js) is a legacy helper that nothing uses. ✅ Deleted in A1.2.
- Stray `// 3. Parse...` comment repeated three times in [ocrRoutes.js](server/routes/ocrRoutes.js).
- Diagnostic `console.log`s in [reportRoutes.js](server/routes/reportRoutes.js) that say "remove after confirming".
- Unused dependency `socket.io-client` in [client/package.json](client/package.json).
- `/vitals` has no client-side route guard in [App.jsx](client/src/App.jsx).

### 20. Repository housekeeping
- [README.md](README.md) is empty. There is no setup guide or list of required environment variables.
- Required variables, found by reading the code: `MONGO_URI`, `JWT_SECRET`, `ENCRYPTION_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `PUBLIC_BASE_URL` (was `NGROK_URL` before A1.2), `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM_NAME`, `VITE_API_URL`.
- `server/eng.traineddata` (a binary Tesseract model) is committed to git.
- `dns.setServers(["1.1.1.1", "8.8.8.8"])` in [server/index.js](server/index.js) is a global workaround for DNS resolution and should be documented or removed.
- The reminder job polls the database every 10 seconds and every medicine card polls every 5 seconds, which is heavy for a free-tier deployment.
- There are no automated tests (`npm test` is a placeholder).
