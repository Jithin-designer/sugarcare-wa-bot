/**
 * scripts/simulate.js — drive the bot without WhatsApp.
 *
 *   node scripts/simulate.js                     # interactive REPL
 *   node scripts/simulate.js --scenario new-lead # scripted new-lead flow
 *   node scripts/simulate.js --scenario existing # scripted existing-patient flow
 *
 * It builds real Meta webhook payloads, signs them with APP_SECRET exactly like
 * Meta would, POSTs them to the running server, then reads data/mock_outbox.jsonl
 * to show what the bot replied. Requires the server running (npm start) in
 * MOCK_MODE=true. Run from the project root so the outbox path matches.
 */

import crypto from 'node:crypto';
import readline from 'node:readline';
import { readOutbox, describe } from '../src/whatsapp.js';

const BASE_URL = process.env.SIM_BASE_URL || 'http://localhost:3000';
const WEBHOOK = `${BASE_URL}/webhook`;
const APP_SECRET = process.env.APP_SECRET || 'dev_secret_change_me'; // matches server MOCK default

// Unique phone per run so every scenario starts from a clean MENU state.
const PHONE = '9199' + String(Date.now()).slice(-8);
let msgCounter = 0;
let seenOutbox = readOutbox().length; // ignore anything already in the file

// ── Build + send one inbound message ─────────────────────────────────────────

function buildPayload({ kind, id, title, text }) {
  msgCounter += 1;
  const message = {
    from: PHONE,
    id: `wamid.SIM_${PHONE}_${msgCounter}_${Date.now()}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  if (kind === 'text') {
    message.type = 'text';
    message.text = { body: text };
  } else if (kind === 'button') {
    message.type = 'interactive';
    message.interactive = { type: 'button_reply', button_reply: { id, title: title || id } };
  } else if (kind === 'list') {
    message.type = 'interactive';
    message.interactive = { type: 'list_reply', list_reply: { id, title: title || id } };
  }
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_SIM',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '0000', phone_number_id: 'SIM' },
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

async function sendInbound(step) {
  const payload = buildPayload(step);
  const bodyStr = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(bodyStr).digest('hex');

  const label =
    step.kind === 'text' ? `"${step.text}"` : `${step.kind}:${step.id} ("${step.title || ''}")`;
  console.log(`\n\x1b[36m▶ YOU (${step.kind})\x1b[0m ${label}`);

  let res;
  try {
    res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
      body: bodyStr,
    });
  } catch (err) {
    console.error(`\n\x1b[31m✖ Could not reach ${WEBHOOK}\x1b[0m — is the server running? (npm start)`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  if (res.status !== 200) {
    console.error(`\x1b[31m✖ server returned ${res.status}\x1b[0m`);
    return [];
  }

  const replies = await waitForReplies();
  for (const rec of replies) {
    console.log(`\x1b[32m🤖 BOT\x1b[0m ${describe(rec.payload)}`);
  }
  if (replies.length === 0) console.log('\x1b[33m(no reply — bot stayed silent)\x1b[0m');
  return replies;
}

/** Poll the mock outbox until it stops growing (or we time out). */
async function waitForReplies({ timeoutMs = 2500, quietMs = 250 } = {}) {
  const start = Date.now();
  let lastLen = readOutbox().length;
  let lastChange = Date.now();
  // wait for at least one new line, then until it goes quiet
  while (Date.now() - start < timeoutMs) {
    await sleep(60);
    const len = readOutbox().length;
    if (len > lastLen) {
      lastLen = len;
      lastChange = Date.now();
    } else if (lastLen > seenOutbox && Date.now() - lastChange > quietMs) {
      break;
    }
  }
  const all = readOutbox();
  const fresh = all.slice(seenOutbox);
  seenOutbox = all.length;
  return fresh;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Extract the choices the bot just offered (for interactive mode) ──────────

function offeredChoices(replies) {
  const choices = [];
  for (const rec of replies) {
    const it = rec.payload.interactive;
    if (it?.type === 'button') {
      for (const b of it.action.buttons) choices.push({ id: b.reply.id, title: b.reply.title });
    } else if (it?.type === 'list') {
      for (const s of it.action.sections) for (const row of s.rows) choices.push({ id: row.id, title: row.title });
    }
  }
  return choices;
}

// ── Scenarios ────────────────────────────────────────────────────────────────

const SCENARIOS = {
  'new-lead': [
    { kind: 'text', text: 'namaskaram' },
    { kind: 'button', id: 'btn_new', title: 'പുതിയ രോഗി' },
    { kind: 'list', id: 'interest_diabetes', title: 'പ്രമേഹ ചികിത്സ' },
    { kind: 'list', id: 'clinic_areekode', title: 'ആരിക്കോട്' },
    { kind: 'text', text: 'Ramesh' },
  ],
  existing: [
    { kind: 'text', text: 'hi' },
    { kind: 'button', id: 'btn_existing', title: 'നിലവിലെ രോഗി' },
    { kind: 'button', id: 'btn_appt', title: 'അപ്പോ. ബുക്ക്' },
    { kind: 'list', id: 'clinic_kondotty', title: 'കൊണ്ടോട്ടി' },
    { kind: 'text', text: 'ചൊവ്വ' },
  ],
};

async function runScenario(name) {
  const steps = SCENARIOS[name];
  if (!steps) {
    console.error(`Unknown scenario "${name}". Options: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }
  console.log(`\n=== Scenario: ${name}  (phone ${PHONE}) ===`);
  for (const step of steps) await sendInbound(step);
  console.log(`\n=== Scenario complete ===\n`);
}

// ── Interactive REPL ─────────────────────────────────────────────────────────

async function runInteractive() {
  console.log(`\n=== Interactive mode (phone ${PHONE}) ===`);
  console.log('Type a message and hit enter. To tap a button/list option, type its id or title.');
  console.log('Commands: /quit to exit.\n');

  // Kick off with a first message so the bot greets us.
  let lastChoices = offeredChoices(await sendInbound({ kind: 'text', text: 'hello' }));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) return rl.prompt();
    if (input === '/quit' || input === '/exit') {
      rl.close();
      return;
    }

    // Does the input match an id or title the bot just offered? → interactive tap.
    const match = lastChoices.find(
      (c) => c.id === input || c.title === input || c.title.toLowerCase() === input.toLowerCase()
    );
    let replies;
    if (match) {
      const kind = match.id.startsWith('clinic_') || match.id.startsWith('interest_') ? 'list' : 'button';
      replies = await sendInbound({ kind, id: match.id, title: match.title });
    } else {
      replies = await sendInbound({ kind: 'text', text: input });
    }

    const choices = offeredChoices(replies);
    if (choices.length) {
      lastChoices = choices;
      console.log('   options: ' + choices.map((c) => `${c.id} ("${c.title}")`).join(', '));
    }
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nbye 👋');
    process.exit(0);
  });
}

// ── Entry ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const scenarioIdx = args.indexOf('--scenario');
if (scenarioIdx !== -1) {
  await runScenario(args[scenarioIdx + 1]);
} else {
  await runInteractive();
}
