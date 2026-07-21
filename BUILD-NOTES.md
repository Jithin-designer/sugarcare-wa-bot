# BUILD-NOTES — Free-text intent router

Branch: `feature/intent-router-node` (built off `main`, **not pushed**).

The bot used to understand only button/list taps; any TYPED sentence
("appointment venam", "Need consultation", "reschedule", "yes") fell through to
the welcome menu. This adds a **deterministic keyword classifier** that maps
typed text onto the flows the bot already has — no LLM, no external API, no new
npm deps.

---

## What changed

| File | Change |
|------|--------|
| `src/intentClassifier.js` | **New.** Pure `classifyIntent(text)` → `{ intent, confidence, matched }`. Keyword/pattern only. Exports `INTENTS`, `KEYWORDS` (for audit tooling). |
| `server.js` | **Wiring only.** Intent routing added in `handleIncoming`, *after* the dormancy + agent-owned gates and *after* a safety pre-check, *before* `processMessage`. |
| `src/messages.js` | Added `rescheduleHandoff()` — the bilingual "our team will call you" message (includes the clinic call line). |
| `tests/intentClassifier.test.js` | **New.** 79 pure unit tests (each intent in Malayalam / Manglish / English, case + punctuation, UNKNOWN passthrough, priority ordering, confidence contract). |
| `tests/intentRouter.test.js` | **New.** 11 server-level tests driving `handleIncoming` end-to-end (routing, safety-wins, reschedule handoff, affirmation, 2-strike fallback, agent-owned silence). |

**No dependency changes** (`package.json` untouched; `package-lock.json` unchanged).

### Contract

```js
import { classifyIntent } from './src/intentClassifier.js';
const { intent, confidence, matched } = classifyIntent('appointment venam');
// intent:     'BOOKING' | 'RESCHEDULE' | 'MEDICINE' | 'FAQ' | 'AFFIRMATION' | 'UNKNOWN'
// confidence: 'high' (a trigger fired) | 'low' (UNKNOWN)
// matched:    the trigger phrase that fired ('' for UNKNOWN) — for the audit log
```

---

## How routing is wired (order matters)

Inside `handleIncoming`, for a **typed text** message only (button/list taps are
untouched):

1. **Dormancy gate** — a 12h-dormant thread stays silent. *(pre-existing)*
2. **Agent-owned gate** — if a telecaller owns the thread, free text is logged
   and the bot stays silent (unless it is a clinical escalation). *(pre-existing)*
3. **Safety pre-check (HARD RULE #1)** — if the text is a clinical
   (`isClinicalQuestion`) or personal-outcome (`isSafetyRedirectQuestion`)
   question, the classifier is **skipped** and the text falls through to
   `processMessage`, where the existing safety guard fires. **Intent routing can
   never override the safety guard.**
4. **`classifyIntent`** — routes the cleared text:
   - `BOOKING`   → inject `BTN_BOOK_SHORT`   → booking clinic picker
   - `MEDICINE`  → inject `BTN_ORDER_MEDS_SHORT` → medicine clinic picker
   - `FAQ`       → inject `BTN_DOUBT`        → 8-row FAQ list
   - `RESCHEDULE`→ set `agent_owned=1` + send `rescheduleHandoff()` (telecaller
     handles it; **no calendar self-serve**), then return.
   - `AFFIRMATION` → at WELCOME re-send the welcome (clean re-greet); mid-flow
     pass through as text so the current flow handles it.
   - `UNKNOWN`   → unchanged; existing 2-strike fallback applies.

> **Why injection?** `processMessage` already routes button IDs into every flow.
> A matched intent is turned into the equivalent button tap, so *zero* flow logic
> is duplicated — the classifier only decides *which* existing door to open.

---

## Trigger phrases → intent (for Dr. Rakesh to audit)

Every phrase below lives in `src/intentClassifier.js` (`KEYWORDS`) and nowhere
else. To add/remove a phrase, edit that one array. **Matching rules:** a bare
ASCII word matches on a word boundary (so `ok` ≠ `book`); a multi-word phrase or
any Malayalam token matches as a substring. **Priority** is top-to-bottom below —
`RESCHEDULE` is checked before `BOOKING` (both mention "appointment"), and
`AFFIRMATION` is checked last (so "ok, book" books rather than merely affirms).

### RESCHEDULE  — change an appointment you already have → telecaller
- **English:** reschedule · change appointment · change my appointment · change the appointment · reschedule appointment · reschedule my appointment · change time · change my time · different time · another time · another day · postpone · prepone · move my appointment · date change
- **Manglish:** reschedule cheyyanam · reschedule cheyyam · time maat · time maaty · time maathanam · samayam maat · appointment maat · appointment maaty · date maatan
- **Malayalam:** റീഷ · സമയം മാറ്റ · സമയ മാറ്റ · സമയമാറ്റ · ടൈം മാറ്റ · അപ്പോയിന്റ്മെന്റ് മാറ്റ · അപ്പോയിന്റ്മന്റ് മാറ്റ · മാറ്റണം · മാറ്റണോ · മാറ്റിവെക്ക

### BOOKING  — book a new appointment / consultation
- **English:** book · booking · appointment · appointments · appt · consultation · consult · book appointment · book a consultation · need appointment · need consultation · schedule appointment · book slot
- **Manglish:** appointment venam · apointment venam · appointment veno · book cheyyam · book cheyyanam · book tharam · consultation venam · doctor kaananam · doctor venam · doctore kaanam
- **Malayalam:** ബുക്ക് · അപ്പോയിന്റ്മെന്റ് · അപ്പോയിന്റ്മന്റ് · ബുക്ക് ചെയ്യണം · കൺസൾട്ടേഷൻ · ഡോക്ടറെ കാണണം

### MEDICINE  — refill / order medicine
- **English:** medicine · medicines · meds · refill · refil · medicine refill · medicine order · order medicine · refill prescription · need medicine
- **Manglish:** marunnu · marunn · marunnu venam · marunnu order · marunnu orden · medicine venam · meds venam · tablet venam · tablet veno
- **Malayalam:** മരുന്ന് · മരുന്നു · മരന്ന് · മരുന്ന് വേണം · മരുന്ന് ഓർഡർ · മരുന്ന് തീർന്നു

### FAQ  — a general question → 8-row FAQ list
- **English:** doubt · question · query · timing · timings · location · address · fee · fees · cost · charge · charges · price · how much · where is · have a doubt · have a question · quick question · opening hours · working hours
- **Manglish:** sandham · sandheham · chodyam · doubt undu · fee ethra · fee evvalavu · charge ethra · timing ethu · timing engane · clinic evide · evide aanu
- **Malayalam:** സംശയം · സംശയ · ചോദ്യം · ഡൗട്ട് · ഫീസ് · വില · സ്ഥലം · എവിടെ · സമയം · ചെലവ് · ടൈമിംഗ്

### AFFIRMATION  — a bare "yes / ok"
- **English:** yes · yeah · yep · yup · yess · yes please · ok · okay · okey · okk · sure
- **Manglish:** yesu · yas · sari · seri · shari · adhe · athe · aah
- **Malayalam:** ശരി · അതെ · ഉവ്വ് · ആകാം · ഓക്കേ · ഓക്കെ

> **Deliberately excluded from MEDICINE:** words like *insulin / dose / tablet
> reading* are `CLINICAL_STRONG` in `stateMachine.js` and escalate to a human
> *before* the classifier runs. "timing"/"timings" is FAQ, but bare "time" is a
> RESCHEDULE hint, so only the "-ing" forms are FAQ triggers.

---

## Design decisions & edge cases

- **Safety always wins.** `"ente sugar 300, appointment venam"` contains a
  booking phrase, but the numeric-sugar clinical guard fires first and it is
  escalated to a doctor — never booked. Covered by
  `tests/intentRouter.test.js › safety guard fires first`.
- **RESCHEDULE for a brand-new phone.** The conversation row is upserted *before*
  `setAgentOwned(1)` — `setAgentOwned` is an `UPDATE` and would silently no-op on
  a phone that has no row yet, leaving the thread un-owned. Regression covered.
- **AFFIRMATION is adapted to this FSM.** The active flow (WELCOME → clinic pick →
  confirm → WELCOME) has no yes/no gate, so a lone "yes" has nothing to literally
  advance. At WELCOME it cleanly re-sends the welcome (no fallback strike);
  mid-flow it is passed through as text so the current flow handles it, and is
  never allowed to hijack the conversation into a fresh booking.
- **agent-owned stays silent** on typed booking/medicine/FAQ intent — the
  agent-owned gate runs before the classifier.

## Python-bot reference

Per the "do not clone from GitHub" constraint, the reference repo was **not
cloned**. A read-only `git ls-remote` of
`github.com/Jithin-designer/preventify-diabetes-ai` shows it has **only `main`** —
the `feature/intent-router` branch named in the brief does not exist. Triggers
were therefore authored from the SugarCARE brief plus the existing
Manglish/Malayalam detector patterns already in `stateMachine.js`
(`isClinicalQuestion` / `isSafetyRedirectQuestion`).

---

## Running the tests locally

```bash
# full suite (better-sqlite3 compiles natively on macOS) — all green
MOCK_MODE=true npm test

# just the intent work
MOCK_MODE=true npx vitest run tests/intentClassifier.test.js tests/intentRouter.test.js

# start the admin panel with dev credentials
MOCK_MODE=true \
ADMIN_SESSION_SECRET=devsecret \
ADMIN_SEED_PASSWORD_NITHIN=demo123 \
ADMIN_SEED_PASSWORD_ALEENA=demo123 \
ADMIN_SEED_PASSWORD_JITHIN=demo123 \
node admin/server.js
# → http://127.0.0.1:3010/admin/login
```
Log in as **nithin / demo123** (or aleena / jithin). If the seed-password env
vars are unset in MOCK_MODE, each user is seeded with the dev password
`changeme` (a warning is printed).

Current status: **197 tests pass** (13 files) in `MOCK_MODE`, including 79 pure
classifier tests + 11 server-level router tests. No real Meta/WhatsApp API call is
ever made (`MOCK_MODE` logs instead of sending); no real patient data is used.
