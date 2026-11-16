export const CATEGORIES = [
  'Income', 'Transfer', 'Credit Card Payment', 'Housing', 'Utilities', 'Phone & Internet', 'Groceries', 'Dining',
  'Coffee', 'Gas & Transport', 'Shopping', 'Subscriptions', 'Entertainment', 'Health', 'Insurance', 'Loan Payment',
  'Fees & Interest', 'Travel', 'Education', 'Kids & Pets', 'Gifts & Donations', 'Cash', 'Uncategorized',
] as const;

const RULES: [string, RegExp][] = [
  ['Fees & Interest', /\b(interest charge|finance charge|overdraft|nsf|late fee|annual fee|service fee|monthly fee|maintenance fee|foreign transaction fee|atm fee|returned item|cash advance fee|wire fee)\b/],
  ['Credit Card Payment', /\b(credit card|card ?member|autopay|epay|payment thank you|payment - thank|online payment|amex|discover|capital one|citi card|chase card|cardmember)\b/],
  ['Income', /\b(payroll|direct dep|salary|paycheck|dir dep|employer|interest paid|interest earned|dividend|refund|cashback|cash back|reward|tax ref|irs treas)\b/],
  ['Transfer', /\b(transfer|xfer|zelle|venmo|cash app|paypal transfer|apple cash|wire)\b/],
  ['Housing', /\b(rent|mortgage|hoa|apartment|property mgmt|landlord)\b/],
  ['Utilities', /\b(electric|power|energy|water|sewer|gas co|utility|utilities|pg&e|duke energy|con ed|trash|waste)\b/],
  ['Phone & Internet', /\b(verizon|at&t|att|t-mobile|tmobile|comcast|xfinity|spectrum|cox|internet|wireless|mint mobile|google fi)\b/],
  ['Subscriptions', /\b(netflix|spotify|hulu|disney|hbo|max\.com|youtube|apple\.com|icloud|google storage|google one|prime video|amazon prime|audible|patreon|onlyfans|adobe|microsoft|office 365|dropbox|notion|chatgpt|openai|anthropic|claude|paramount|peacock|crunchyroll|duolingo|headspace|calm|nyt|subscription|membership)\b/],
  ['Groceries', /\b(grocery|groceries|whole foods|trader joe|safeway|kroger|aldi|publix|wegmans|costco|sam's club|heb|food lion|giant|stop & shop|sprouts|market)\b/],
  ['Coffee', /\b(starbucks|dunkin|coffee|cafe|peet)\b/],
  ['Dining', /\b(restaurant|grill|pizza|burger|taco|sushi|mcdonald|chipotle|wendy|subway|doordash|uber eats|ubereats|grubhub|postmates|kitchen|diner|bar & grill|chick-fil-a|panera|kfc|domino)\b/],
  ['Gas & Transport', /\b(shell|exxon|chevron|bp|mobil|sunoco|gas station|fuel|uber|lyft|parking|toll|transit|metro|mta|ezpass|e-zpass)\b/],
  ['Health', /\b(pharmacy|cvs|walgreens|rite aid|doctor|dental|dentist|medical|clinic|hospital|vision|optometr|therapy|gym|fitness|planet fitness)\b/],
  ['Insurance', /\b(insurance|geico|progressive|state farm|allstate|lemonade)\b/],
  ['Loan Payment', /\b(loan|navient|nelnet|sallie mae|mohela|student ln|auto pay loan|car payment)\b/],
  ['Travel', /\b(airline|airlines|delta|united|southwest|jetblue|hotel|marriott|hilton|airbnb|expedia|booking\.com)\b/],
  ['Entertainment', /\b(steam|playstation|xbox|nintendo|cinema|theater|theatre|amc|ticketmaster|concert)\b/],
  ['Shopping', /\b(amazon|amzn|target|walmart|best buy|ebay|etsy|ikea|home depot|lowe's|lowes|macy|nordstrom|tj maxx|marshalls)\b/],
  ['Education', /\b(tuition|university|college|school|coursera|udemy)\b/],
  ['Kids & Pets', /\b(petco|petsmart|chewy|vet|daycare|childcare)\b/],
  ['Gifts & Donations', /\b(donation|charity|gofundme|church)\b/],
  ['Cash', /\b(atm|cash withdrawal)\b/],
];

export function categorize(description: string, amount: number): string {
  const d = description.toLowerCase();
  for (const [cat, re] of RULES) {
    if (re.test(d)) {
      // A positive "payment thank you" on a card is the card payment; refunds are income-ish.
      if (cat === 'Income' && amount < 0 && !/refund/.test(d)) continue;
      return cat;
    }
  }
  if (amount > 0) return 'Income';
  return 'Uncategorized';
}

/** Categories that are money moving between your own accounts, excluded from spending totals. */
export const NON_SPENDING = new Set(['Transfer', 'Credit Card Payment', 'Income']);
