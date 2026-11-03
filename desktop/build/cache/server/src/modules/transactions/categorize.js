// Merchant clean-up and built-in categorisation (UK-leaning but extendable).
// Order of precedence: user rules/workflows > learned merchant map (your past corrections) > built-in patterns > local AI (optional).
const { q } = require('../../core/db');

const DEFAULT_CATEGORIES = [
  ['Income', '#16a34a', '💷', 'income'], ['Salary', '#15803d', '💼', 'income'], ['Refunds', '#22c55e', '↩️', 'income'],
  ['Supermarkets', '#f97316', '🛒', 'expense'], ['Restaurants & Cafés', '#ef4444', '🍽️', 'expense'],
  ['Takeaway & Delivery', '#dc2626', '🥡', 'expense'], ['Online Shopping', '#eab308', '📦', 'expense'],
  ['Amazon', '#ca8a04', '📦', 'expense'], ['Subscriptions & Streaming', '#a855f7', '📺', 'expense'],
  ['Bills & Utilities', '#0ea5e9', '💡', 'expense'], ['Rent & Mortgage', '#0369a1', '🏠', 'expense'],
  ['Transport', '#14b8a6', '🚆', 'expense'], ['Fuel', '#0d9488', '⛽', 'expense'], ['Health & Pharmacy', '#ec4899', '💊', 'expense'],
  ['Fitness', '#db2777', '🏋️', 'expense'], ['Entertainment', '#8b5cf6', '🎟️', 'expense'], ['Travel', '#06b6d4', '✈️', 'expense'],
  ['Home & DIY', '#84cc16', '🔨', 'expense'], ['Clothing', '#f43f5e', '👕', 'expense'], ['Kids & Family', '#fb923c', '🧸', 'expense'],
  ['Gifts & Events', '#e879f9', '🎁', 'expense'], ['Insurance', '#475569', '🛡️', 'expense'], ['Phone & Internet', '#3b82f6', '📶', 'expense'],
  ['Cash', '#78716c', '💵', 'expense'], ['Fees & Charges', '#991b1b', '⚠️', 'expense'], ['Pets', '#a16207', '🐾', 'expense'],
  ['Savings & Transfers', '#6366f1', '🔁', 'transfer'], ['Other', '#64748b', '•', 'expense'],
];

const PATTERNS = [
  [/tesco|sainsbury|asda|morrisons|aldi|lidl|waitrose|co-?op|iceland|m&s food|marks.*spencer.*food|ocado|farmfoods|spar\b|budgens|costco|whole ?foods|kroger|walmart grocery/i, 'Supermarkets'],
  [/amazon|amzn|amz\*|prime video/i, 'Amazon'],
  [/netflix|spotify|disney\+?|disney plus|apple\.com\/bill|itunes|youtube premium|google \*storage|google one|now ?tv|paramount|audible|icloud|xbox game pass|playstation plus|patreon|chatgpt|openai|adobe|microsoft 365|dropbox|onlyfans|crunchyroll|tidal|deezer/i, 'Subscriptions & Streaming'],
  [/deliveroo|just ?eat|uber ?eats|domino|papa john|pizza hut|kfc|mcdonald|burger king|five guys|nando|greggs/i, 'Takeaway & Delivery'],
  [/restaurant|cafe|café|coffee|costa|starbucks|pret|wagamama|pizza express|zizzi|bistro|grill|tavern|\bpub\b|bar & kitchen|brewdog|wetherspoon|itsu|leon\b|dishoom/i, 'Restaurants & Cafés'],
  [/ebay|etsy|asos|argos|currys|john lewis|very\.co|aliexpress|temu|shein|boots\.com|wayfair/i, 'Online Shopping'],
  [/tfl|trainline|national rail|uber(?! ?eats)|bolt\.eu|addison lee|lner|gwr|avanti|southern rail|thameslink|stagecoach|first bus|arriva|parking|ringgo|paybyphone|dart charge|congestion/i, 'Transport'],
  [/shell|\bbp\b|esso|texaco|gulf|jet petrol|petrol|fuel|tesla supercharger|pod point|ionity/i, 'Fuel'],
  [/british gas|octopus energy|edf|e\.on|eon next|ovo|scottish power|so energy|thames water|severn trent|anglian water|united utilities|council tax|tv licen/i, 'Bills & Utilities'],
  [/rent|mortgage|nationwide bs mortgage|letting|estate agent/i, 'Rent & Mortgage'],
  [/vodafone|\bee\b|ee limited|o2|three\.co|giffgaff|bt group|\bbt\b|sky (digital|broadband|uk)|virgin media|plusnet|talktalk|hyperoptic|community fibre|lebara|tesco mobile/i, 'Phone & Internet'],
  [/boots|superdrug|lloyds pharmacy|pharmacy|chemist|dentist|optician|specsavers|nhs|bupa|vitality/i, 'Health & Pharmacy'],
  [/puregym|the gym|gym ?group|david lloyd|virgin active|nuffield|anytime fitness|peloton|strava|better leisure/i, 'Fitness'],
  [/cinema|odeon|vue|cineworld|ticketmaster|eventbrite|see tickets|steam|playstation|nintendo|xbox|bowling/i, 'Entertainment'],
  [/ryanair|easyjet|british airways|jet2|wizz|tui|booking\.com|airbnb|expedia|hotels\.com|premier inn|travelodge|hilton|marriott|eurostar/i, 'Travel'],
  [/b&q|wickes|screwfix|toolstation|homebase|ikea|dunelm|the range|b and q/i, 'Home & DIY'],
  [/primark|next plc|\bnext\b|h&m|zara|uniqlo|tk ?maxx|sports direct|jd sports|matalan|river island|new look|clarks/i, 'Clothing'],
  [/smyths|toys|mothercare|nursery|childcare|school/i, 'Kids & Family'],
  [/moonpig|funky pigeon|card factory|interflora|gift/i, 'Gifts & Events'],
  [/insurance|aviva|admiral|direct line|churchill|lv=|hastings|aa insurance|axa|legal & general|compare the market/i, 'Insurance'],
  [/atm|cash withdrawal|cashpoint|link atm/i, 'Cash'],
  [/fee|charge|overdraft|interest charged|late payment/i, 'Fees & Charges'],
  [/pets at home|vets|veterinary|zooplus|jollyes/i, 'Pets'],
  [/salary|payroll|wages|bacs credit.*ltd/i, 'Salary'],
  [/refund|reversal|chargeback/i, 'Refunds'],
  [/transfer|standing order to|savings|isa|monzo pot|to pot|vanguard|trading 212|moneybox|chip\b|plum\b/i, 'Savings & Transfers'],
];

// Turn "CARD PAYMENT TO TESCO STORES 2345 LONDON GB 12/10" into "Tesco Stores"
function normaliseMerchant(desc = '') {
  let s = String(desc)
    .replace(/^(card payment to|card purchase|pos|visa|debit card|contactless|cnt|dd|direct debit( to)?|so|standing order( to)?|faster payment( to)?|fp|bgc|bacs|payment to|purchase at|paypal \*|pp\*|sq \*|sumup \*|zettle_\*|iz \*)\s*/i, '')
    .replace(/\b(on|ref|reference)\b.*$/i, '')
    .replace(/\d{2}[\/\-]\d{2}([\/\-]\d{2,4})?/g, '')
    .replace(/\b\d{3,}\b/g, '')
    .replace(/\b(?=\w*\d)(?=\w*[a-z])\w{5,}\b/gi, '')
    .replace(/\.(com|co\.uk|net|io)\b/gi, '')
    .replace(/\*[\w]+/g, '')
    .replace(/\b(gb|gbr|uk|london|manchester|birmingham|leeds|glasgow|bristol|liverpool|usa|us|ie|nl|lu)\b/gi, '')
    .replace(/[^\w&' .+\-]/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
  if (/amzn|amazon/i.test(s)) s = /prime/i.test(s) ? 'Amazon Prime' : 'Amazon';
  s = s.split(' ').slice(0, 4).join(' ');
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) || 'Unknown';
}

function seedCategories(hid) {
  for (const [name, color, icon, kind] of DEFAULT_CATEGORIES) {
    q.run('INSERT OR IGNORE INTO categories(household_id,name,color,icon,kind) VALUES(?,?,?,?,?)', hid, name, color, icon, kind);
  }
}

function categoryIdByName(hid, name) {
  return q.get('SELECT id FROM categories WHERE household_id=? AND name=?', hid, name)?.id || null;
}

function guessCategory(hid, merchant, description, amount) {
  const learned = q.get('SELECT category_id FROM merchant_map WHERE household_id=? AND merchant=?', hid, merchant);
  if (learned?.category_id) return { id: learned.category_id, by: 'learned' };
  const text = `${merchant} ${description}`;
  for (const [re, name] of PATTERNS) {
    if (re.test(text)) {
      if (amount > 0 && !['Salary', 'Refunds', 'Savings & Transfers'].includes(name)) return { id: categoryIdByName(hid, 'Refunds'), by: 'pattern' };
      return { id: categoryIdByName(hid, name), by: 'pattern' };
    }
  }
  if (amount > 0) return { id: categoryIdByName(hid, 'Income'), by: 'pattern' };
  return { id: null, by: null };
}

// Remember a manual correction so every future transaction from that merchant follows it
function learnMerchant(hid, merchant, categoryId) {
  if (!merchant) return;
  q.run('INSERT INTO merchant_map(household_id,merchant,category_id) VALUES(?,?,?) ON CONFLICT(household_id,merchant) DO UPDATE SET category_id=excluded.category_id',
    hid, merchant, categoryId);
}

module.exports = { normaliseMerchant, seedCategories, guessCategory, learnMerchant, categoryIdByName, DEFAULT_CATEGORIES };
