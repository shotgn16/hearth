// Creates a demo household with two users and ~2 years of realistic transactions so you can explore the app.
// Usage: DATA_DIR=./demo-data node scripts/seed-demo.js   (never run against your real data folder)
process.removeAllListeners('warning');
const { q } = require('../src/core/db');
const auth = require('../src/core/auth');
const { seedCategories } = require('../src/modules/transactions/categorize');
const { ingest } = require('../src/modules/transactions/ingest');
const { detectSubscriptions } = require('../src/modules/tracker/subscriptions');
const A = require('../src/modules/insights/analytics');

(async () => {
  if (q.get('SELECT 1 FROM users LIMIT 1')) { console.log('Data folder already has users — refusing to seed.'); process.exit(1); }
  const hid = Number(q.run("INSERT INTO households(name) VALUES('The Demo Household')").lastInsertRowid);
  const alex = Number(q.run('INSERT INTO users(household_id,name,email,pass_hash,role,color) VALUES(?,?,?,?,?,?)', hid, 'Alex', 'alex@demo.local', auth.hashPassword('demo1234'), 'admin', '#3b82f6').lastInsertRowid);
  const sam = Number(q.run('INSERT INTO users(household_id,name,email,pass_hash,role,color) VALUES(?,?,?,?,?,?)', hid, 'Sam', 'sam@demo.local', auth.hashPassword('demo1234'), 'member', '#ec4899').lastInsertRowid);
  q.run('INSERT INTO people(household_id,name,user_id,color) VALUES(?,?,?,?)', hid, 'Alex', alex, '#3b82f6');
  q.run('INSERT INTO people(household_id,name,user_id,color) VALUES(?,?,?,?)', hid, 'Sam', sam, '#ec4899');
  const ella = Number(q.run("INSERT INTO people(household_id,name,color) VALUES(?, 'Ella', '#f59e0b')", hid).lastInsertRowid);
  seedCategories(hid);
  const joint = Number(q.run("INSERT INTO accounts(household_id,name,institution,type,balance,color,shared) VALUES(?, 'Joint Current', 'Monzo', 'current', 2840.55, '#f43f5e', 1)", hid).lastInsertRowid);
  const alexAcc = Number(q.run("INSERT INTO accounts(household_id,owner_user_id,name,institution,type,balance,color,shared) VALUES(?,?, 'Alex Current', 'Starling', 'current', 1210.20, '#14b8a6', 0)", hid, alex).lastInsertRowid);
  const samAcc = Number(q.run("INSERT INTO accounts(household_id,owner_user_id,name,institution,type,balance,color,shared) VALUES(?,?, 'Sam Current', 'Barclays', 'current', 940.75, '#0ea5e9', 0)", hid, sam).lastInsertRowid);
  q.run("INSERT INTO accounts(household_id,name,institution,type,balance,color) VALUES(?, 'Easy Saver', 'Chase', 'savings', 8500, '#6366f1')", hid);

  let seed = 42; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const txs = [];
  const start = A.addDays(new Date(), -730);
  for (let d = new Date(start); d <= new Date(); d = A.addDays(d, 1)) {
    const ds = A.iso(d), dom = d.getDate(), dow = d.getDay(), m = d.getMonth();
    const xmas = m === 11 ? 1.6 : 1;
    if (dom === 25) { txs.push({ date: ds, amount: 2650, description: 'BACS CREDIT ACME LTD SALARY', account_id: alexAcc, user_id: alex }); txs.push({ date: ds, amount: 2180, description: 'PAYROLL NORTHWIND HEALTH', account_id: samAcc, user_id: sam }); }
    if (dom === 1) txs.push({ date: ds, amount: -1350, description: 'DD MORTGAGE NATIONWIDE BS', account_id: joint });
    if (dom === 3) txs.push({ date: ds, amount: -15.99, description: 'NETFLIX.COM', account_id: joint });
    if (dom === 7) txs.push({ date: ds, amount: -11.99, description: 'Spotify UK P1234567', account_id: alexAcc, user_id: alex });
    if (dom === 9) txs.push({ date: ds, amount: -(ds >= `${new Date().getFullYear()}-04-01` ? 132 : 118), description: 'DD OCTOPUS ENERGY', account_id: joint });
    if (dom === 12) txs.push({ date: ds, amount: -185, description: 'DD COUNCIL TAX', account_id: joint });
    if (dom === 14) txs.push({ date: ds, amount: -29.99, description: 'PUREGYM LTD', account_id: samAcc, user_id: sam });
    if (dom === 15) txs.push({ date: ds, amount: -38, description: 'VIRGIN MEDIA PYMTS', account_id: joint });
    if (dom === 18) txs.push({ date: ds, amount: -8.99, description: 'AMAZON PRIME*AB12C', account_id: joint });
    if (dom === 20) txs.push({ date: ds, amount: -400, description: 'STANDING ORDER TO EASY SAVER', account_id: joint });
    if (dom === 22) txs.push({ date: ds, amount: -2.99, description: 'APPLE.COM/BILL', account_id: samAcc, user_id: sam });
    if (dow === 6 || (dow === 3 && rnd() > 0.4)) txs.push({ date: ds, amount: -Number((55 + rnd() * 70 * xmas).toFixed(2)), description: `CARD PAYMENT TO ${pick(['TESCO STORES 3021', 'SAINSBURYS S/MKTS', 'ALDI 4412', 'WAITROSE 771'])} ON ${ds}`, account_id: joint });
    if (rnd() > 0.82) txs.push({ date: ds, amount: -Number((3 + rnd() * 4).toFixed(2)), description: pick(['PRET A MANGER', 'COSTA COFFEE', 'STARBUCKS']), account_id: pick([alexAcc, samAcc]), user_id: null });
    if (rnd() > 0.93) txs.push({ date: ds, amount: -Number((22 + rnd() * 60).toFixed(2)), description: pick(['DELIVEROO', 'JUST EAT', 'WAGAMAMA', 'PIZZA EXPRESS', 'DISHOOM']), account_id: joint });
    if (rnd() > 0.88) txs.push({ date: ds, amount: -Number((8 + rnd() * 90 * xmas).toFixed(2)), description: pick(['AMZN Mktp UK*2K4', 'Amazon.co.uk*RT5', 'ARGOS LTD', 'JOHN LEWIS']), account_id: pick([joint, alexAcc, samAcc]) });
    if (rnd() > 0.9) txs.push({ date: ds, amount: -Number((45 + rnd() * 30).toFixed(2)), description: pick(['SHELL 4471', 'BP CONNECT', 'TESCO PFS']), account_id: alexAcc, user_id: alex });
    if (rnd() > 0.95) txs.push({ date: ds, amount: -Number((6 + rnd() * 25).toFixed(2)), description: pick(['TFL TRAVEL CH', 'TRAINLINE', 'UBER *TRIP']), account_id: samAcc, user_id: sam });
    if (rnd() > 0.97) txs.push({ date: ds, amount: -Number((15 + rnd() * 40).toFixed(2)), description: pick(['SMYTHS TOYS', 'SCHOOL TRIP PAYMENT', 'CLARKS']), account_id: joint, person_id: ella });
  }
  // set user_id from account owner where missing
  for (const t of txs) if (t.user_id === null) t.user_id = t.account_id === alexAcc ? alex : t.account_id === samAcc ? sam : undefined;
  const r = await ingest(hid, txs, { source: 'demo', runWorkflows: false });
  detectSubscriptions(hid);
  const supermarkets = q.get("SELECT id FROM categories WHERE household_id=? AND name='Supermarkets'", hid).id;
  const eating = q.get("SELECT id FROM categories WHERE household_id=? AND name='Restaurants & Cafés'", hid).id;
  const takeaway = q.get("SELECT id FROM categories WHERE household_id=? AND name='Takeaway & Delivery'", hid).id;
  q.run("INSERT INTO budgets(household_id,name,amount,period,category_ids,scope,color) VALUES(?, 'Groceries', 650, 'monthly', ?, 'shared', '#f97316')", hid, JSON.stringify([supermarkets]));
  q.run("INSERT INTO budgets(household_id,name,amount,period,category_ids,scope,color) VALUES(?, 'Eating out', 220, 'monthly', ?, 'shared', '#ef4444')", hid, JSON.stringify([eating, takeaway]));
  q.run("INSERT INTO budgets(household_id,name,amount,period,scope,user_id,color) VALUES(?, 'Alex fun money', 150, 'monthly', 'individual', ?, '#3b82f6')", hid, alex);
  q.run("INSERT INTO budgets(household_id,name,amount,period,scope,user_id,color) VALUES(?, 'Sam fun money', 150, 'monthly', 'individual', ?, '#ec4899')", hid, sam);
  q.run("INSERT INTO goals(household_id,name,target_amount,current_amount,target_date,color) VALUES(?, 'Summer holiday', 3000, 1150, ?, '#06b6d4')", hid, `${new Date().getFullYear() + 1}-06-30`);
  q.run("INSERT INTO goals(household_id,name,target_amount,current_amount,color) VALUES(?, 'Emergency fund', 10000, 8500, '#6366f1')", hid);
  const y = new Date().getFullYear();
  q.run("INSERT INTO events(household_id,title,start,budget,person_id,source) VALUES(?, 'Ella''s birthday party', ?, 250, ?, 'manual')", hid, A.iso(A.addDays(new Date(), 9)), ella);
  q.run("INSERT INTO events(household_id,title,start,budget,source) VALUES(?, 'Christmas', ?, 900, 'manual')", hid, `${y}-12-25`);
  q.run("INSERT INTO events(household_id,title,start,source) VALUES(?, 'Dinner with Jo & Pete', ?, 'manual')", hid, A.iso(A.addDays(new Date(), 5)));
  q.run("INSERT INTO rules(household_id,name,trigger,conditions,actions) VALUES(?, 'Tag kids spending', 'transaction_created', ?, ?)", hid,
    JSON.stringify([{ field: 'description', op: 'regex', value: 'smyths|school|clarks' }]), JSON.stringify([{ type: 'add_tag', value: 'Kids' }]));
  q.run("INSERT INTO rules(household_id,name,trigger,conditions,actions) VALUES(?, 'Ping me on big spends', 'large_transaction', ?, ?)", hid,
    JSON.stringify([{ field: 'direction', op: 'equals', value: 'out' }]), JSON.stringify([{ type: 'notify', title: 'Big spend', message: '{amount} at {merchant}' }]));
  console.log(`Seeded ${r.added} transactions. Sign in as alex@demo.local / demo1234 (or sam@demo.local).`);
})();
