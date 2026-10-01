// Gives the seeded demo personas (15 clients, 6 drivers) real Supabase Auth
// logins, all with one demo passcode that you choose.
//
// Run once, after supabase/schema.sql and supabase/auth.sql:
//
//   node --env-file=.env.local scripts/seed-demo-users.mjs
//
// It asks for the passcode (or reads DEMO_PASSWORD). Safe to run again: it
// skips personas that are already linked and resets the passcode of existing
// demo accounts to the one you give.
import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline/promises';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env.local scripts/seed-demo-users.mjs');
  process.exit(1);
}

let password = process.env.DEMO_PASSWORD;
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = (await rl.question('Choose one passcode for all demo accounts (at least 8 characters): ')).trim();
  rl.close();
}
if (!password || password.length < 8) {
  console.error('The passcode must be at least 8 characters.');
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// Only the seeded personas: their emails end in ".demo".
const isDemo = (email) => typeof email === 'string' && email.toLowerCase().endsWith('.demo');

async function must(query, what) {
  const { data, error } = await query;
  if (error) {
    console.error(`${what}: ${error.message}`);
    if (/client_type|email|profiles/.test(error.message)) console.error('Have you run supabase/auth.sql?');
    process.exit(1);
  }
  return data ?? [];
}

/** Create the auth user, or find it if a previous run already did. Returns the user id. */
async function ensureUser(email, meta) {
  // No `role` in the metadata, so the sign-up trigger leaves this user alone and
  // this script links it to the existing seeded row instead of creating a new one.
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
  if (!created.error) return created.data.user.id;

  const existing = await must(db.from('profiles').select('id').eq('email', email).limit(1), 'Looking up profile');
  let id = existing[0]?.id;
  for (let page = 1; !id && page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data.users.length) break;
    id = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
  }
  if (!id) throw new Error(created.error.message);
  const reset = await db.auth.admin.updateUserById(id, { password, email_confirm: true });
  if (reset.error) throw new Error(reset.error.message);
  return id;
}

const clients = (await must(db.from('clients').select('*').is('auth_user_id', null), 'Reading clients')).filter((c) => isDemo(c.email));
const drivers = (await must(db.from('drivers').select('*').is('auth_user_id', null), 'Reading drivers')).filter((d) => isDemo(d.email));

const done = [];
for (const persona of [
  ...clients.map((c) => ({ table: 'clients', role: 'client', row: c, name: c.company_name })),
  ...drivers.map((d) => ({ table: 'drivers', role: 'driver', row: d, name: d.name })),
]) {
  const { table, role, row, name } = persona;
  const email = row.email.toLowerCase();
  try {
    const id = await ensureUser(email, { full_name: name, phone: row.phone });
    await must(
      db.from('profiles').upsert({
        id,
        role,
        client_type: role === 'client' ? (row.client_type ?? 'company') : null,
        driver_type: role === 'driver' ? row.driver_type : null,
        full_name: name,
        phone: row.phone ?? '',
        email,
      }),
      'Writing profile',
    );
    await must(db.from(table).update({ auth_user_id: id }).eq('id', row.id).select('id'), `Linking ${table}`);
    done.push({ portal: role, name, email });
  } catch (err) {
    console.error(`Skipped ${email}: ${err.message}`);
  }
}

if (done.length === 0) {
  console.log('Nothing to do: every demo persona already has a login.');
} else {
  console.table(done);
  console.log(`${done.length} demo account(s) ready. Log in with the email above and the passcode you chose.`);
}
