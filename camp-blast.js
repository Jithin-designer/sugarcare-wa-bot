#!/usr/bin/env node
/**
 * camp-blast.js — SugarCARE Camp Screening WhatsApp Blast
 * Template: camp_screening_announcement (5 variables)
 * {{1}} patient name, {{2}} clinic name (Malayalam), {{3}} date, {{4}} time, {{5}} maps link
 *
 * Usage:
 *   node camp-blast.js --clinic edappal
 *   node camp-blast.js --clinic padinjarangadi
 *   node camp-blast.js --clinic kanjirathani
 *   node camp-blast.js --clinic edappal --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1232912896566193';
const WHATSAPP_TOKEN  = process.env.WHATSAPP_TOKEN;
const TEMPLATE_NAME   = 'camp_screening_announcement';
const LANGUAGE_CODE   = 'ml'; // Malayalam

const RATE_LIMIT_MS   = 1000;   // 1 message per second (safe under Meta limits)
const RESUME_FILE     = path.join(__dirname, '.blast-resume.json');

// ── Clinic data ───────────────────────────────────────────────────────────────

const CLINICS = {
  edappal: {
    csvMatch:    'Edappal',
    nameVar:     'എടപ്പാൾ',
    date:        '23 ജൂലൈ, വ്യാഴം',
    time:        'രാവിലെ 10 മുതൽ 1 മണി വരെ',
    mapsLink:    'https://maps.google.com/?q=10.7847369,76.0180944',
  },
  padinjarangadi: {
    csvMatch:    'Padinjarangadi',
    nameVar:     'പടിഞ്ഞാറങ്ങാടി',
    date:        '24 ജൂലൈ, വെള്ളി',
    time:        'രാവിലെ 10 മുതൽ 1 മണി വരെ',
    mapsLink:    'https://maps.google.com/?q=10.787016,76.0673621',
  },
  kanjirathani: {
    csvMatch:    'Kanjirathani',
    nameVar:     'കാഞ്ഞിരത്താണി',
    date:        '25 ജൂലൈ, ശനി',
    time:        'രാവിലെ 10 മുതൽ 1 മണി വരെ',
    mapsLink:    'https://maps.google.com/?q=10.7738914,76.0612044',
  },
};

// ── Args ──────────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const clinicKey = (args[args.indexOf('--clinic') + 1] || '').toLowerCase();
const DRY_RUN   = args.includes('--dry-run');

if (!CLINICS[clinicKey]) {
  console.error(`\n❌  Unknown clinic. Use: --clinic edappal | padinjarangadi | kanjirathani\n`);
  process.exit(1);
}

if (!WHATSAPP_TOKEN && !DRY_RUN) {
  console.error(`\n❌  WHATSAPP_TOKEN not set in environment. Cannot send.\n`);
  process.exit(1);
}

const clinic = CLINICS[clinicKey];

// ── CSV loader ────────────────────────────────────────────────────────────────

function loadCSV(csvPath) {
  const raw  = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''); // strip BOM
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());

  const nameIdx  = header.indexOf('name');
  const phoneIdx = header.indexOf('phone_number');
  const clinicIdx= header.indexOf('clinic_location');

  if (nameIdx < 0 || phoneIdx < 0 || clinicIdx < 0) {
    throw new Error(`CSV must have columns: name, phone_number, clinic_location`);
  }

  return lines.slice(1)
    .map(line => {
      const cols = line.split(',');
      return {
        name:   (cols[nameIdx]  || '').trim(),
        phone:  (cols[phoneIdx] || '').trim(),
        clinic: (cols[clinicIdx]|| '').trim(),
      };
    })
    .filter(r => r.clinic === clinic.csvMatch && r.name && r.phone);
}

// ── Phone normaliser ──────────────────────────────────────────────────────────

function normalisePhone(raw) {
  let p = raw.replace(/[\s\-().+]/g, '');
  // Strip leading country code if present
  if (p.startsWith('91') && p.length === 12) return p; // already 91XXXXXXXXXX
  if (p.length === 10 && /^[6-9]/.test(p)) return '91' + p;
  return null; // invalid
}

// ── Resume state ──────────────────────────────────────────────────────────────

function loadResume() {
  try { return JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8')); }
  catch { return {}; }
}

function saveResume(state) {
  fs.writeFileSync(RESUME_FILE, JSON.stringify(state, null, 2));
}

// ── Send one message ──────────────────────────────────────────────────────────

async function sendTemplate(to, name) {
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: TEMPLATE_NAME,
      language: { code: LANGUAGE_CODE },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: name },
          { type: 'text', text: clinic.nameVar },
          { type: 'text', text: clinic.date },
          { type: 'text', text: clinic.time },
          { type: 'text', text: clinic.mapsLink },
        ],
      }],
    },
  };

  const res = await fetch(
    `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
    {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      },
      body: JSON.stringify(body),
    }
  );

  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = path.join(__dirname, `camp_${clinicKey}.csv`);

  if (!fs.existsSync(csvPath)) {
    console.error(`\n❌  CSV not found: ${csvPath}\n    Upload camp_${clinicKey}.csv to the bot directory first.\n`);
    process.exit(1);
  }

  const rows   = loadCSV(csvPath);
  const resume = loadResume();
  const key    = `${clinicKey}`;

  if (!resume[key]) resume[key] = { sent: [], failed: [] };
  const alreadySent = new Set(resume[key].sent);

  const pending = rows
    .map(r => ({ ...r, e164: normalisePhone(r.phone) }))
    .filter(r => {
      if (!r.e164) { console.warn(`⚠️  Skipping invalid phone: ${r.name} / ${r.phone}`); return false; }
      if (alreadySent.has(r.e164)) { console.log(`⏭️  Already sent: ${r.name} (${r.e164})`); return false; }
      return true;
    });

  console.log(`\n📋  Clinic   : ${clinic.nameVar}`);
  console.log(`📅  Date     : ${clinic.date}`);
  console.log(`⏰  Time     : ${clinic.time}`);
  console.log(`👥  Total    : ${rows.length} | Pending: ${pending.length} | Done: ${alreadySent.size}`);
  console.log(DRY_RUN ? `\n🧪  DRY RUN — no messages will be sent\n` : `\n🚀  LIVE SEND — messages will be sent\n`);

  if (!DRY_RUN && pending.length > 0) {
    // Confirm before sending
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(resolve => rl.question(`Type YES to confirm sending to ${pending.length} patients: `, ans => {
      rl.close();
      if (ans.trim() !== 'YES') { console.log('Aborted.'); process.exit(0); }
      resolve();
    }));
  }

  let sent = 0, failed = 0;

  for (const row of pending) {
    if (DRY_RUN) {
      console.log(`🧪  [DRY] → ${row.name} (${row.e164}) | ${clinic.nameVar} | ${clinic.date}`);
      continue;
    }

    try {
      await sendTemplate(row.e164, row.name);
      console.log(`✅  Sent → ${row.name} (${row.e164})`);
      resume[key].sent.push(row.e164);
      saveResume(resume);
      sent++;
    } catch (err) {
      console.error(`❌  Failed → ${row.name} (${row.e164}): ${err.message}`);
      resume[key].failed.push({ phone: row.e164, name: row.name, error: err.message });
      saveResume(resume);
      failed++;
    }

    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  console.log(`\n✅  Done. Sent: ${sent} | Failed: ${failed} | Skipped (already done): ${alreadySent.size}`);
  if (resume[key].failed.length > 0) {
    console.log(`\n⚠️  Failed numbers saved to .blast-resume.json for retry.`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
