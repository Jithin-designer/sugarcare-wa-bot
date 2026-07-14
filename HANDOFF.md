# HANDOFF — SugarCARE WhatsApp Bot (deterministic rebuild)

**Built:** overnight, autonomously, 2026-07-14
**Location:** `sugarcare-wa-bot/` (sibling of the old `SugarCARE Whatsapp Bot/` — the Python repo was **not** touched)
**Status:** ✅ all 37 tests pass · ✅ both simulator scenarios pass end-to-end · MOCK mode by default (no real messages sent)

---

## 1. What this is

A ground-up rewrite of the WhatsApp bot as a **deterministic finite state
machine — no RAG, no LLM, no vector search.** The old bot ran a full RAG lookup
(embed → pgvector → reranker → Gemini) on every question; this one never does.
It is a Malayalam-first receptionist that captures leads, books call-backs, and
routes anything clinical to a human. Node.js + Express + SQLite only.

Three concrete gaps in the old bot that this closes:
- **RAG on the hot path** → removed entirely (deterministic FSM).
- **No webhook signature check** → HMAC-SHA256 on every POST, 401 on mismatch.
- **No dedup** → `processed_messages` table, idempotent by WhatsApp `message_id`.

---

## 2. File list

| File | What it does |
|---|---|
| `server.js` | Express entry. Webhook GET verify + POST (signature → 401), `/health`, dedup, dormancy gating, persistence, dispatch. The imperative shell. |
| `src/stateMachine.js` | **Pure** conversation engine — `processMessage(conversation, msg)`. No I/O. Clinical guard + fallback live here. |
| `src/db.js` | SQLite (better-sqlite3) setup + every query. `openDb(file)` factory (file for prod, `:memory:` for tests). |
| `src/messages.js` | **Every** user-facing string (ML + EN) + WhatsApp payload builders. No inline reply strings anywhere else. |
| `src/whatsapp.js` | Meta Cloud API client. `MOCK_MODE` logs + appends to `data/mock_outbox.jsonl`; live mode POSTs to Graph API. 24h-window helper. |
| `src/bannedWords.js` | HARD RULE #2 checker. Word-boundary match for ASCII, substring for Malayalam. |
| `src/patientLookup.js` | ⚠️ MOCK STUB. EMR lookup placeholder — returns `{found:false}`. See §5. |
| `scripts/simulate.js` | CLI simulator — interactive REPL + `--scenario new-lead|existing`. Signs payloads like Meta. |
| `tests/webhook.test.js` | GET verify, POST bad-signature → 401, dedup skip, payload extraction. |
| `tests/stateMachine.test.js` | Every state transition, clinical guard, both fallback tiers, English parity. |
| `tests/conversations.test.js` | Full new-lead + existing-patient walkthroughs, asserting DB rows. |
| `tests/bannedWords.test.js` | Scans `messages.js` strings + all `src/` files for banned words. |
| `PLAN.md` | Architecture + decisions log written before the build. |
| `README-DEPLOY.md` | Step-by-step production deploy + Meta config. |
| `.env.example` | All env vars with guidance. |

---

## 3. Architecture decisions

- **Functional core / imperative shell.** `stateMachine.js` is a pure function
  returning *intentions* (`leadData`, `dormantFor`, `priority`). `server.js`
  performs all I/O and owns the clock. Result: every conversation path is unit-
  testable without a server, and replays are deterministic.
- **No RAG, ever.** The bot does not answer questions. Clinical questions are
  escalated to a human (HARD RULE #1); everything else is button/list driven.
- **Clinical guard is keyword-based and biased toward escalation.** A false
  positive just routes a human — the safe failure mode for an unlicensed front
  door. Plain "diabetes"/"sugar" alone are *not* triggers (the whole clinic is
  about diabetes); triggers are med names, lab values (`sugar` + a number),
  doses, and advice-seeking phrasing.
- **DORMANT + HUMAN_HANDOFF** are terminal states backed by a `dormant_until`
  timestamp (12h). A message during dormancy is logged, not answered. After 12h,
  the next message restarts at MENU (re-greeted), keeping the chosen language.
- **All strings in one file** so the banned-word scan is tractable and a
  non-engineer can edit copy without touching logic.
- **SQLite, synchronous.** Per-webhook work is a few sub-millisecond indexed
  queries; async would add complexity for no gain. Meta's 5s budget is safe
  because we ACK 200 *before* doing this work.

---

## 4. Actual test output (pasted verbatim)

```
> sugarcare-wa-bot@1.0.0 test
> vitest run

 RUN  v2.1.9 /Users/jithin/.../sugarcare-wa-bot

 ✓ tests/bannedWords.test.js (6 tests) 4ms
 ✓ tests/stateMachine.test.js (18 tests) 6ms
 ✓ tests/conversations.test.js (6 tests) 10ms
 ✓ tests/webhook.test.js (7 tests) 63ms

 Test Files  4 passed (4)
      Tests  37 passed (37)
   Start at  04:43:20
   Duration  606ms (transform 93ms, setup 0ms, collect 330ms, tests 83ms, ...)
```

(Interleaved `webhook: verified / bad signature → 401 / duplicate ... — skipping`
log lines are expected — they are the handlers narrating; every test passes.)

### Live simulator evidence

New-lead scenario produced this reply chain (Malayalam receptionist register):
```
YOU  "namaskaram"
BOT  buttons: നമസ്കാരം! 🙏 SugarCARE Clinics-ലേക്ക് സ്വാഗതം... [പുതിയ രോഗി][നിലവിലെ രോഗി][English]
YOU  btn_new
BOT  list: എന്ത് കാര്യത്തിനാ?... [പ്രമേഹ ചികിത്സ][BP / കൊളസ്ട്രോൾ][CGM സെൻസർ][ഫീ അറിയണം]
YOU  interest_diabetes
BOT  list: ഏത് ക്ലിനിക് ആണ് അടുത്തുള്ളത്?... [ആരിക്കോട്]...[എടപ്പാൾ]
YOU  clinic_areekode
BOT  text: നിങ്ങളുടെ പേര് ഒന്ന് പറയാമോ? 🙂
YOU  "Ramesh"
BOT  text: ഞങ്ങളുടെ ടീം ഉടൻ വിളിക്കും 🙏 നേരിട്ട് വിളിക്കാൻ: +91 79948 84799
```

Resulting DB rows (`data/bot.db` → `leads`):
```json
[
  { "name": "Ramesh", "interest": "diabetes",    "clinic": "areekode", "priority": 0, "lead_type": "new" },
  { "name": null,     "interest": "appointment", "clinic": "kondotty", "priority": 0, "lead_type": "callback", "notes": "preferred day: ചൊവ്വ" }
]
```

Live security checks (curl against the running server):
```
GET  /webhook  correct token → HTTP 200, body: ECHO_OK
GET  /webhook  wrong token   → HTTP 403
POST /webhook  bad signature → HTTP 401
```

---

## 5. What is stubbed

**`src/patientLookup.js` only.** It always returns `{ found:false, name:null,
homeClinicId:null }`. In production this is where the bot would confirm an
"existing patient" against the clinic EMR/patient DB by phone number (and could
personalise with their name / home clinic). That EMR integration is still an
open decision in the original repo (blocker **B1**). Nothing depends on it today:
the "existing patient" branch is entered by the user tapping a button, not by a
lookup, so the flow works fully without it. Wire the real call in when B1 lands;
keep the return shape.

Everything else is real: the state machine, DB, webhook security, dedup, dormancy,
and the mock WhatsApp client all run for real. "MOCK" only means outbound messages
are written to `data/mock_outbox.jsonl` instead of hitting Meta.

---

## 6. What Jithin needs to do in the morning

1. **Install & sanity-check** (if not already):
   ```bash
   cd sugarcare-wa-bot
   npm install
   npm test          # expect 37 passing
   ```
2. **Try it locally** (two terminals):
   ```bash
   npm start                                   # terminal 1 (MOCK mode)
   node scripts/simulate.js --scenario new-lead # terminal 2
   node scripts/simulate.js                      # or interactive REPL
   ```
3. **Fill in `.env`** (copy from `.env.example`):
   - `WHATSAPP_TOKEN` — permanent System User token from Meta.
   - `PHONE_NUMBER_ID` / `WABA_ID` — from Meta ▸ WhatsApp ▸ API Setup.
   - `APP_SECRET` — Meta ▸ App Settings ▸ Basic (⚠️ **required in production** —
     without it every signature is rejected; the dev default only works in MOCK).
   - `VERIFY_TOKEN` — invent a random string; you paste the same one into Meta.
4. **Deploy & expose HTTPS** — see `README-DEPLOY.md` (needs a public HTTPS URL;
   Meta will not call http).
5. **Configure the Meta webhook**: callback URL `https://YOURHOST/webhook`,
   verify token = your `VERIFY_TOKEN`, subscribe to the **messages** field.
6. **Flip to live**: set `MOCK_MODE=false` in `.env` and restart. Outbound
   messages now go to real WhatsApp. Send yourself a "hi" to confirm the menu.
7. **Review the copy** in `src/messages.js` — the Malayalam is written in an
   everyday Malappuram receptionist register; adjust any wording you'd say
   differently. (Do not introduce the banned words — the test will catch them.)
8. **Confirm the clinic list** in `src/messages.js` (`CLINICS`) matches the 7
   live locations; Malayalam names were carried over from the old repo's
   `config/clinics.json`.

---

## 7. Known issues / limitations

- **Clinical keyword detection is heuristic**, not NLP. It will occasionally
  over-escalate a benign message to a human (safe) and could, in theory, miss an
  unusually phrased clinical question typed as free text. Tune the lists in
  `src/stateMachine.js` (`CLINICAL_STRONG` / `CLINICAL_NUMERIC` /
  `CLINICAL_ADVICE`) as real messages come in. Note the guard only sees *typed*
  text — button/list taps never carry a clinical question.
- **Single-process SQLite.** Fine for one clinic front-desk load. Horizontal
  scaling (multiple server instances) would need a shared DB (Postgres) — the
  `db.js` API is small and swappable if that day comes.
- **`report`/`team` handoff also goes DORMANT for 12h** (not specified in the
  brief) so the bot stays quiet while a human replies. If you'd rather the bot
  stay responsive there, drop `dormantFor` in `handlePatientMenu`.
- **24h session-window gate is effectively always-open** in the current reactive
  flow (every reply answers a fresh inbound). The helper
  (`isWithinSessionWindow`) exists and is unit-safe; any *future proactive*
  sender (e.g. a dormant-nudge cron) MUST pass the real last-inbound timestamp.
- **No outbound retry/queue.** If a live Meta send fails it is logged and
  dropped (the webhook stays alive). Add a retry queue before high volume.
- **`npm audit`** reports vulnerabilities in **dev-only** transitive deps
  (vitest toolchain). No runtime dependency is affected (runtime deps are just
  `express` + `better-sqlite3`).
- **Lead notifications are DB-only.** Leads land in `data/bot.db`; there is no
  push to the team yet (Slack/email/CRM). Reading the table is the current
  hand-off mechanism — wire a notifier when ops is ready.
