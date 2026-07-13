# PLAN — SugarCARE WhatsApp Bot (deterministic rebuild)

**Author:** overnight rebuild (autonomous)
**Date:** 2026-07-14
**Replaces:** `../SugarCARE Whatsapp Bot/` (Python/FastAPI RAG bot) — left untouched.

---

## 1. Why the rebuild

The old Python bot (`api/routes/whatsapp.py`, 1112 lines) routes free-text
questions into a full RAG pipeline on the hot path
(`_run_rag()` at `whatsapp.py:838` → embed + pgvector ANN + reranker + Gemini).
Three problems it has that this rebuild fixes:

| Old bot | This rebuild |
|---|---|
| Every question → embedding + vector search + LLM (slow, costly, non-deterministic) | **Zero RAG.** Deterministic finite state machine only. |
| POST webhook never checks `X-Hub-Signature-256` | HMAC-SHA256 signature validation on **every** POST → 401 on mismatch |
| No message-id dedup — Meta retries get reprocessed | `processed_messages` table, dedup by WhatsApp `message_id` |

The bot no longer *answers* clinical questions at all. It is a **router to
humans**: it captures leads, books call-backs, and escalates anything clinical
to the SugarCARE team. This is also the correct safety posture for an unlicensed
(non-RMP) WhatsApp front door.

---

## 2. Conversation flow (state machine)

```
                         first message (any text)
   ┌─────────┐  greeted=false → greet + 3 buttons
   │  MENU   │◄──────────────────────────────────────────────┐
   └────┬────┘                                                │ fallback (<2)
        │ btn_new          btn_existing        btn_english    │ re-prompt menu
        ▼                     ▼                 (lang=en,      │
  ┌──────────────┐      ┌──────────────┐         re-render)───┘
  │ LEAD_INTEREST│      │ PATIENT_MENU │
  └──────┬───────┘      └──┬────────┬──┘
   interest_*          btn_appt   btn_report / btn_team
        ▼                  ▼            │  (PRIORITY)
  ┌──────────────┐   ┌───────────┐      ▼
  │ LEAD_CLINIC  │   │APPT_CLINIC│   HUMAN_HANDOFF (team msg)
  └──────┬───────┘   └─────┬─────┘
   clinic_*            clinic_*
        ▼                  ▼
  ┌──────────────┐   ┌───────────┐
  │  LEAD_NAME   │   │ APPT_DAY  │  (free text)
  └──────┬───────┘   └─────┬─────┘
   free-text name     free-text day
        ▼                  ▼
  HUMAN_HANDOFF        DORMANT
  (save lead)          (save callback lead)
  DORMANT 12h          DORMANT 12h
```

**States:** `MENU, LEAD_INTEREST, LEAD_CLINIC, LEAD_NAME, PATIENT_MENU,
APPT_CLINIC, APPT_DAY, HUMAN_HANDOFF, DORMANT`.

`HUMAN_HANDOFF` and `DORMANT` are both terminal — a human owns the conversation.
The difference is only semantic labelling (handoff = escalation, dormant =
routine call-back queued). Both set `dormant_until = now + 12h`.

---

## 3. Cross-cutting guards (applied before per-state logic)

1. **Clinical guard (HARD RULE #1).** Any *free-text* message that trips the
   clinical keyword list (`sugar 300`, `insulin`, `HbA1c`, `dose`, `മരുന്ന്`, …)
   → **PRIORITY** escalate + handoff message, no answer. Fail-safe: false
   positives just route a human, which is acceptable.
2. **Banned words (HARD RULE #2).** `reversal, cure, മുക്തി, മാറ്റിയെടുക്കാം`
   never appear in any reply string. Enforced by `bannedWords.js` + a test that
   scans `messages.js` and `src/`.
3. **Fallback.** Unrecognized input in a *choice* state (MENU / LEAD_INTEREST /
   LEAD_CLINIC / PATIENT_MENU / APPT_CLINIC) → `fallback_count++`, re-prompt the
   **main menu**. On the 2nd failure → handoff + DORMANT 12h. Free-text states
   (LEAD_NAME, APPT_DAY) accept any non-empty text and never fall back.

---

## 4. Purity boundary

`src/stateMachine.js` is a **pure function** — no DB, no clock, no network:

```js
processMessage(conversation, incomingMessage)
  → { nextState, nextData, replies, leadData, priority, dormantFor }
```

All I/O lives at the edges:
- **server.js** owns the clock (`dormant_until = Date.now() + dormantFor`),
  dedup, dormancy gating, the 24h send-window gate, and persistence.
- **db.js** owns SQLite.
- **whatsapp.js** owns the Meta Cloud API (or the mock outbox).
- **messages.js** owns every user-facing string + payload builder. No inline
  user-facing strings anywhere else (keeps stateMachine.js string-free and makes
  the banned-word scan tractable).

This is what makes the whole flow unit-testable without a running server.

---

## 5. Hard-rule → implementation map

| Rule | Where |
|---|---|
| 1 no medical advice | `stateMachine.js` clinical guard → PRIORITY + handoff |
| 2 banned words | `bannedWords.js` + `bannedWords.test.js` |
| 3 everyday Malayalam register | `messages.js` (Malappuram receptionist voice) |
| 4 24h session window | `whatsapp.js isWithinSessionWindow()` + `server.js` gate |
| 5 idempotency | `db.js` `processed_messages` + `server.js` dedup |
| 6 webhook security | `server.js` GET verify_token + POST HMAC-SHA256 → 401 |
| 7 200 within 5s | `server.js` responds 200, then processes async |

---

## 6. Decisions log (autonomous — no questions asked)

- **DORMANT vs HUMAN_HANDOFF:** modelled as terminal states + a `dormant_until`
  timestamp. Both stop the bot for 12h; a fresh message after expiry restarts at
  MENU (re-greeted).
- **Clinic list shared** between LEAD_CLINIC and APPT_CLINIC (same `clinic_*`
  ids); the current state decides whether the pick lands on a lead or a callback.
- **English button** re-renders the MENU in English (lang='en') with just
  New/Existing — the cleanest reading of "same flow in English".
- **report/team handoff** also goes DORMANT 12h (not specified) so the bot stays
  quiet while a human handles it. Documented, reversible.
- **APP_SECRET default** in MOCK mode is `dev_secret_change_me` (with a loud
  warning) so the simulator works with zero .env setup. Production must set it.
- **Clinical guard keyword list** is intentionally broad (safety > precision).
- **patientLookup.js** is a stub returning null — the "existing patient" branch
  is entered by button, not by EMR lookup, so nothing depends on it yet. It marks
  the future EMR integration point (old repo blocker B1).

---

## 7. Build order

`db.js → messages.js → bannedWords.js → stateMachine.js → whatsapp.js →
patientLookup.js → server.js → scripts/simulate.js → tests` → `npm test` →
simulate → HANDOFF.md → git.
