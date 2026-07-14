# BOOKING-FLOW-CHANGES — booking-first flow (feature/booking-first-flow)

**Branch:** `feature/booking-first-flow` (local only, not pushed)
**Status:** 82/82 tests passing (36 pre-existing + 46 new). No Meta API calls, no webhook config touched, no credentials read or written.

---

## 1. What this is

A new primary entry point — **WELCOME → [📅 Book cheyyam] [❓ Doubt undu]** — replacing
the old MENU greeting as the first thing every conversation sees. Booking is now
two taps + one typed name (no date/time, no DM Pro API call — a telecaller books
the exact time manually). A secondary Q&A path answers general diabetes-education
questions (diet, exercise, monitoring, HbA1c) with fixed canned text, never
personal medical advice.

The **existing MENU flow is not deleted** — see §3 for exactly what stayed,
what's now dead code, and why.

---

## 2. New states (`src/stateMachine.js`)

```
                    any first message
   ┌──────────┐  ──────────────────────────────►
   │ WELCOME  │◄──────────────────────────┐
   └────┬─────┘   Yes (closing loop)      │ fallback (<2 misses)
        │                                  │ re-prompt WELCOME
   ┌────┼──────────────────┬───────────────┴──┐
   │ btn_book         btn_doubt          btn_talk_to_team
   ▼                        ▼                  ▼
┌───────────────┐    ┌────────────┐    PATIENT_MENU (pre-existing,
│ CLINIC_SELECT │    │ QA_ANSWER  │     kept fully intact — report/Rx,
└──────┬────────┘    └─────┬──────┘     talk-to-team priority handoff)
  clinic pick          free-text Q
       │              (topic or personal)
       ▼                    │
┌───────────────┐           │ [Book cheyyam] tapped from QA footer
│ NAME_CAPTURE  │◄──────────┘  → jumps straight into CLINIC_SELECT
└──────┬────────┘                (never restarts WELCOME)
   typed name
       ▼
┌──────────────────┐
│ BOOKING_COMPLETE  │  confirm + lead saved
└────────┬──────────┘
         ▼
   CLOSING_LOOP  "anything else? [Yes][No]"
     Yes → WELCOME buttons        No → DORMANT 12h, "thank you, bye"
```

Mid-booking interruption (a question typed while in `CLINIC_SELECT` or
`NAME_CAPTURE`): answered briefly, then **resumes at the exact step that was
pending** — never restarts booking, never loses the clinic/name already
captured. Tracked via one new conversational-memory field, `data.resumeState`.

**New states:** `WELCOME, CLINIC_SELECT, NAME_CAPTURE, BOOKING_COMPLETE, QA_ANSWER, CLOSING_LOOP`.

---

## 3. What happened to the old MENU flow

Per an explicit decision during this build (documented here, not just in chat
history):

| Old path | Fate |
|---|---|
| `MENU` → **btn_existing** → **PATIENT_MENU** (appt/report/team) | **Kept live**, bridged via WELCOME's new `btn_talk_to_team` button. Report/Rx requests and priority team-handoffs work exactly as before. |
| `MENU` → **btn_new** → `LEAD_INTEREST` → `LEAD_CLINIC` → `LEAD_NAME` | **Superseded** by the new booking flow. `CLINIC_SELECT`→`NAME_CAPTURE` captures clinic + name in 2 taps + 1 typed name — the interest-selection step was intentionally dropped, matching this build's "two taps + one typed name" brief. These three states, and the `LEAD_INTEREST`/interest-list code, are still present and still pass their own unit tests (nothing was deleted), but are **unreachable from a fresh WELCOME entry**. They'd only ever run again for a conversation already mid-flow there (e.g. a saved DB row from before this change). |
| `MENU`'s btn_new/btn_existing/btn_english screen itself | Unreachable from a fresh conversation (WELCOME is now the universal entry — see below), but the `handleMenu` code path is untouched and still unit-tested directly (`stateMachine.test.js`'s existing MENU tests pass unchanged, since they construct an explicit `state: STATES.MENU` conversation rather than relying on default entry). |

**Every conversation entry point that used to default to `MENU` now defaults to
`WELCOME`** — this includes brand-new phone numbers, and the post-dormancy /
post-handoff reset (a patient messaging again after 12h). This was a deliberate
extension beyond the literal "any first message" wording, applied consistently:
booking-first is now the primary experience everywhere a conversation restarts,
not just on a phone number's very first-ever message. Reversible by changing
2 lines in `server.js` + 2 in `stateMachine.js` if you want post-dormancy
resets to land back on the old MENU screen instead.

---

## 4. Two safety-guard gaps this build had to close (and how)

Testing surfaced real conflicts between the new Q&A education topics and the
**pre-existing** `isClinicalQuestion` guard (`stateMachine.js`) — both are
documented here because they change safety-guard behavior, however narrowly.

### 4a. "What is HbA1c" used to escalate to a human

The clinical guard already treats bare `hba1c` as a hard trigger (correct —
it's used elsewhere for personal-reading questions like "my hba1c is 9, what
dose..."). But your spec explicitly lists "what is HbA1c" as an **allowed**
education topic. Fix: a narrow, whole-phrase allow-list
(`HBA1C_DEFINITION_PHRASES` in `stateMachine.js`) checked *before* the broad
keyword, matching only pure definition-asks ("what is hba1c", "hba1c means",
"hba1c enthanu"...). **Any number anywhere else in the sentence still
escalates** ("my hba1c is 9.2" → still `HUMAN_HANDOFF`, unchanged, covered by
a regression test). Same pattern applied to "what should i eat" (diet
education), which previously tripped the guard's broad `'what should i'`
phrase.

### 4b. "Is my sugar okay" / "should I change my medicine" did NOT escalate

The opposite problem: these spec-named personal-question examples don't
contain a number or a strong clinical keyword, so the existing broad guard
never caught them — they'd have fallen through as unrecognised input
(ordinary fallback), not the "ask doctor" deferral your spec requires. Fix: a
new, narrower detector scoped **only to the Q&A/booking-interruption code
path** (`isPersonalMedicalQuestion`), checked before topic classification.
The main `isClinicalQuestion` guard (used everywhere else in the bot) is
untouched.

**Both fixes are keyword-based, not LLM-based** — consistent with this
project's founding "no RAG, ever" rule and the existing `isClinicalQuestion`
pattern. See §7 for the one thing here that needs clinical sign-off.

---

## 5. New Malayalam/English strings (`src/messages.js`)

All new user-facing text lives in the same `ML`/`EN` tables as everything
else (no inline strings in `stateMachine.js` — same boundary the codebase
already enforces). New keys: `welcome_greeting`, `btn_book`, `btn_doubt`,
`btn_talk_to_team`, `booking_clinic_body`, `booking_name_body`,
`booking_confirm_prefix/suffix`, `qa_prompt_body`, `qa_footer_body`,
`qa_answer_diet/exercise/monitoring/hba1c`, `qa_redirect_personal`,
`qa_redirect_unknown`, `midbooking_answered_prefix`, `closing_prompt`,
`btn_yes/no`, `closing_bye`, `fallback_handoff_number`. All scanned clean by
the existing banned-word test (`bannedWords.test.js`, extended to also render
every new screen builder, not just the pre-existing ones).

Confirmation message (as specified): *"നന്ദി {name}! 🙏 {clinic} ടീം ഉടൻ
വിളിക്കും, സമയം fix ചെയ്യാം."* — verified rendering exactly this in manual
testing (§8).

---

## 6. Lead persistence — one deviation from the literal brief, by design

The original brief said: *"In MOCK_MODE: log the lead to console instead of
storing. In LIVE: store to SQLite."*

**What's actually implemented:** the booking lead is **always** written to
SQLite (mock or live) — matching how every other lead type (new/callback/
priority/clinical/fallback) already behaves unconditionally in this codebase
— **plus** an extra `console.log` line whenever `MOCK_MODE` is on, for manual
testing visibility.

**Why:** `MOCK_MODE` has only ever gated outbound WhatsApp sends in this
codebase, never DB writes. Skipping the DB write in mock mode would have made
booking leads the only type untestable via the normal DB-assertion pattern
every other test in this repo uses (tests always run with `MOCK_MODE=true`).
Confirmed as the right call before implementing — see the DB rows in every
manual-test scenario in §8.

---

## 7. ⚠️ NEEDS Dr. Rakesh sign-off — Q&A topic boundary

This is the one piece of new logic making a **clinical-safety** call, not
just a conversational-flow call, and it should be reviewed before this goes
live:

**Allowed (canned educational answer, in `src/messages.js`):**
- Diet — generic carb-reduction / vegetables-and-fibre guidance, explicitly
  says "check with your doctor for an exact plan."
- Exercise — generic "30-min walk" guidance, explicitly says "check with your
  doctor before starting anything new."
- Monitoring — generic "check regularly, keep a diary" guidance.
- HbA1c — a one-paragraph definition of what the test measures.

**Not allowed (always deferred to "ask the doctor directly" + booking
buttons):** any question containing the patient's own reading/result/dose,
detected two ways:
1. The pre-existing `isClinicalQuestion` guard (strong keywords: insulin,
   dose, med names, a number + sugar/BP/reading, "should I take/stop/is it
   safe") — **unchanged** in this build.
2. A new, narrower `isPersonalMedicalQuestion` detector for softer "about me"
   phrasings the above guard doesn't catch: "is my sugar okay", "should I
   change my medicine/dose", "my hba1c [no number]", etc. — see the exact
   keyword list in `stateMachine.js` (`PERSONAL_MEDICAL_PHRASES`).

**What Dr. Rakesh (or whoever owns clinical content here) should review:**
1. **The 4 canned answer texts themselves** (`qa_answer_diet/exercise/
   monitoring/hba1c` in `messages.js`) — are they medically accurate and
   appropriately generic for an unlicensed WhatsApp front door to say
   verbatim to every patient, in every case, regardless of their individual
   condition?
2. **The personal-question keyword list** (`PERSONAL_MEDICAL_PHRASES`) — is
   it complete enough? It's a fixed list, so a phrasing not on it and not
   caught by the main clinical guard falls through to `qa_redirect_unknown`
   ("we can't answer this exactly, ask your doctor") rather than the
   specific personal-deferral message — which is still safe (never gives
   advice), but worth knowing the fallback behavior is "safe generic
   deferral," not "guaranteed detection of every personal phrasing."
3. **The HbA1c/diet carve-out narrowness** (§4a) — confirm the allow-list
   phrasings are narrow enough that no personal-reading question could ever
   match them by accident. Regression tests exist for the cases checked; a
   clinical reviewer may think of phrasings we didn't test.

This is a keyword list — auditable, and any of it can be tightened or loosened
in `stateMachine.js`/`messages.js` without touching conversation logic.

---

## 8. Manual test evidence (MOCK_MODE, real HTTP + HMAC-signed webhook payloads)

Driven against the actual running server (not just the pure function) via
real signed POST requests to `/webhook`, isolated DB/outbox, port 3998 (torn
down after testing — nothing left running).

**Scenario 1 — happy path:**
```
YOU  "hi"
BOT  buttons: നമസ്കാരം! 👋 ... [📅 Book cheyyam] [❓ Doubt undu]
YOU  btn_book
BOT  list: ഏത് ക്ലിനിക്കിൽ ...  [ആരിക്കോട്]...[എടപ്പാൾ]
YOU  clinic_edappal
BOT  text: നിങ്ങളുടെ പേര്?
YOU  "Ramesh"
BOT  text: നന്ദി Ramesh! 🙏 എടപ്പാൾ ടീം ഉടൻ വിളിക്കും, സമയം fix ചെയ്യാം.
BOT  buttons: വേറെ എന്തെങ്കിലും സഹായം വേണോ? [Yes] [No]
DB:  state=BOOKING_COMPLETE, lead={name:"Ramesh", clinic:"edappal", lead_type:"booking"}
```

**Scenario 2 — "Book cheyyam" from Q&A, no welcome restart:**
```
... hello → welcome buttons → btn_doubt → "what should I eat"
BOT  (diet education answer) + [📅 Book cheyyam] [❓ Doubt undu]
YOU  btn_book
BOT  list: ... clinic list ...
DB state after tap: CLINIC_SELECT  ✓ (not WELCOME)
```

**Scenario 3 — mid-booking question resumes, doesn't restart:**
```
... btn_book → clinic_kondotty → (at NAME_CAPTURE) "how often should I check my sugar"
BOT  (monitoring education answer)
BOT  "ശരി! Back to booking —"
BOT  text: നിങ്ങളുടെ പേര്?          ← re-shown, not a fresh welcome
DB state: NAME_CAPTURE ✓
YOU  "Ramesh"  → booking completes normally, clinic="kondotty" preserved.
```

**Scenario 4 — garbage twice → handoff with phone number:**
```
... garbage_btn_1 → apology + welcome buttons (1st miss)
... garbage_btn_2 →
BOT  text: ഞങ്ങളുടെ ടീം നേരിട്ട് മറുപടി തരും 🙏
BOT  text: ഞങ്ങളുടെ team-നെ ബന്ധപ്പെടാൻ: +91 79948 84799
DB:  state=HUMAN_HANDOFF, lead_type=fallback
```

**Scenario 5 — Malayalam / Manglish / English all understood at WELCOME:**
```
"നമസ്കാരം" → welcome; "ബുക്ക് ചെയ്യണം" → CLINIC_SELECT
"hi" → welcome; "doubt undu" → QA_ANSWER
"hello" → welcome; "I need to book an appointment" → CLINIC_SELECT
```

### How to re-run this yourself

```bash
cp .env.example .env         # if you don't already have one — MOCK_MODE=true by default
npm install
npm test                     # 82/82 should pass
npm start                    # terminal 1, MOCK mode
node scripts/simulate.js     # terminal 2, interactive REPL — type "hi" to see WELCOME
```

The shipped `scripts/simulate.js` REPL works unchanged with the new flow —
type `hi`, then either tap-by-id (it accepts the button id or title text it
just offered) or free-type `book`/`doubt`/Malayalam to test the Manglish/
English/Malayalam understanding at WELCOME.

---

## 9. Questions resolved during this build (answered live, recorded here for continuity)

1. **Should WELCOME replace MENU entirely, or coexist?** → Coexist; WELCOME
   is the new entry, MENU's report/team path bridged in, MENU's new-lead path
   superseded (§3).
2. **Q&A engine: keyword-based or LLM-based?** → Keyword-based, matching
   `isClinicalQuestion`'s existing pattern — consistent with "no RAG, ever."
3. **Should the mid-booking resume message adapt to the pending step, or
   always show the literal example text?** → Adapts (re-shows the actual
   pending prompt — clinic list or name-ask — not a fixed line).
4. **The HbA1c guard conflict (§4a)** → Narrow carve-out, not "leave the gap."
5. **The "what should i eat" guard conflict (§4a)** → Same narrow-carve-out
   pattern, not "leave the gap."
6. **The "is my sugar okay" detection gap (§4b)** → Add a QA-scoped
   personal-question detector, not "leave the gap and remove the unused
   function."
7. **Lead persistence in MOCK_MODE (§6)** → Always save to SQLite (match
   existing convention) + also console-log, not the literal
   skip-SQLite-in-mock reading of the brief.

## 10. Known limitations / not addressed

- **`isPersonalMedicalQuestion` and the Q&A topic classifiers are fixed
  keyword lists** — like the pre-existing clinical guard, they will
  occasionally miss an unusually-phrased personal question (falls through to
  the safe generic `qa_redirect_unknown`, never fabricates medical advice) or
  over-trigger on a borderline educational question (safe direction — routes
  to a human/doctor-deferral, never wrong information). Tune the lists in
  `stateMachine.js` as real messages come in, same practice already
  documented in `HANDOFF.md` for the original clinical guard.
- **No DM Pro / calendar API integration** — intentional per the brief; a
  telecaller books the exact time manually after the lead lands in
  `data/bot.db`.
- **The old `LEAD_INTEREST`/interest-selection UI is dead code** (§3) — still
  present, still tested in isolation, not deletable without also deciding
  whether "interest" (diabetes/BP/CGM/price) should be captured somewhere in
  the new flow. Not requested by this brief; flagging in case that data point
  turns out to matter for lead follow-up later.
