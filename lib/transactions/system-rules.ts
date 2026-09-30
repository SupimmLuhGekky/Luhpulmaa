/**
 * Built-in deterministic merchant → category rules (by category systemKey).
 * Patterns are matched against the normalised merchant/description
 * (see normalizeMerchant) as whole-word prefixes.
 */
export interface SystemRule {
  pattern: string;
  categoryKey: string;
  subcategory?: string;
  /** Marks well-known subscription merchants for recurring detection. */
  subscription?: boolean;
  /** Human label shown in "categorised by". */
  label?: string;
}

export const SYSTEM_RULES: SystemRule[] = [
  // Transportation
  { pattern: "uber eats", categoryKey: "restaurants", subcategory: "Delivery" },
  { pattern: "uber", categoryKey: "transportation", subcategory: "Rideshare" },
  { pattern: "lyft", categoryKey: "transportation", subcategory: "Rideshare" },
  { pattern: "stm", categoryKey: "transportation", subcategory: "Public transit" },
  { pattern: "opus", categoryKey: "transportation", subcategory: "Public transit" },
  { pattern: "presto", categoryKey: "transportation", subcategory: "Public transit" },
  { pattern: "ttc", categoryKey: "transportation", subcategory: "Public transit" },
  { pattern: "exo", categoryKey: "transportation", subcategory: "Public transit" },
  { pattern: "via rail", categoryKey: "travel" },
  { pattern: "communauto", categoryKey: "transportation" },
  { pattern: "bixi", categoryKey: "transportation" },
  { pattern: "impark", categoryKey: "transportation", subcategory: "Parking" },
  { pattern: "indigo", categoryKey: "transportation", subcategory: "Parking" },
  { pattern: "saaq", categoryKey: "transportation" },
  // Gas
  { pattern: "petro canada", categoryKey: "gas" },
  { pattern: "esso", categoryKey: "gas" },
  { pattern: "shell", categoryKey: "gas" },
  { pattern: "ultramar", categoryKey: "gas" },
  { pattern: "couche tard", categoryKey: "gas" },
  { pattern: "irving", categoryKey: "gas" },
  // Groceries
  { pattern: "metro", categoryKey: "groceries" },
  { pattern: "iga", categoryKey: "groceries" },
  { pattern: "maxi", categoryKey: "groceries" },
  { pattern: "provigo", categoryKey: "groceries" },
  { pattern: "super c", categoryKey: "groceries" },
  { pattern: "loblaws", categoryKey: "groceries" },
  { pattern: "no frills", categoryKey: "groceries" },
  { pattern: "sobeys", categoryKey: "groceries" },
  { pattern: "adonis", categoryKey: "groceries" },
  { pattern: "costco", categoryKey: "groceries" },
  { pattern: "walmart", categoryKey: "shopping" },
  { pattern: "real canadian superstore", categoryKey: "groceries" },
  { pattern: "save on foods", categoryKey: "groceries" },
  { pattern: "whole foods", categoryKey: "groceries" },
  // Restaurants
  { pattern: "mcdonald", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "mcdonalds", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "tim hortons", categoryKey: "restaurants", subcategory: "Coffee" },
  { pattern: "starbucks", categoryKey: "restaurants", subcategory: "Coffee" },
  { pattern: "second cup", categoryKey: "restaurants", subcategory: "Coffee" },
  { pattern: "a&w", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "subway", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "st hubert", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "benny", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "doordash", categoryKey: "restaurants", subcategory: "Delivery" },
  { pattern: "skipthedishes", categoryKey: "restaurants", subcategory: "Delivery" },
  { pattern: "skip the dishes", categoryKey: "restaurants", subcategory: "Delivery" },
  { pattern: "restaurant", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "cafe", categoryKey: "restaurants", subcategory: "Coffee" },
  { pattern: "pizza", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "pizzeria", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "trattoria", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "bistro", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "brasserie", categoryKey: "restaurants", subcategory: "Dining out" },
  { pattern: "boulangerie", categoryKey: "restaurants", subcategory: "Coffee" },
  { pattern: "patisserie", categoryKey: "restaurants", subcategory: "Coffee" },
  { pattern: "sushi", categoryKey: "restaurants", subcategory: "Dining out" },
  // Subscriptions
  { pattern: "netflix", categoryKey: "subscriptions", subcategory: "Streaming", subscription: true },
  { pattern: "spotify", categoryKey: "subscriptions", subcategory: "Streaming", subscription: true },
  { pattern: "disney plus", categoryKey: "subscriptions", subcategory: "Streaming", subscription: true },
  { pattern: "crave", categoryKey: "subscriptions", subcategory: "Streaming", subscription: true },
  { pattern: "apple com bill", categoryKey: "subscriptions", subcategory: "Software", subscription: true },
  { pattern: "google storage", categoryKey: "subscriptions", subcategory: "Software", subscription: true },
  { pattern: "youtube premium", categoryKey: "subscriptions", subcategory: "Streaming", subscription: true },
  { pattern: "amazon prime", categoryKey: "subscriptions", subcategory: "Memberships", subscription: true },
  { pattern: "prime video", categoryKey: "subscriptions", subcategory: "Streaming", subscription: true },
  { pattern: "microsoft", categoryKey: "subscriptions", subcategory: "Software", subscription: true },
  { pattern: "adobe", categoryKey: "subscriptions", subcategory: "Software", subscription: true },
  { pattern: "icloud", categoryKey: "subscriptions", subcategory: "Software", subscription: true },
  { pattern: "patreon", categoryKey: "subscriptions", subcategory: "Memberships", subscription: true },
  { pattern: "gym", categoryKey: "subscriptions", subcategory: "Memberships", subscription: true },
  { pattern: "energie cardio", categoryKey: "subscriptions", subcategory: "Memberships", subscription: true },
  { pattern: "goodlife", categoryKey: "subscriptions", subcategory: "Memberships", subscription: true },
  // Utilities & telecom
  { pattern: "hydro quebec", categoryKey: "utilities", subcategory: "Electricity" },
  { pattern: "hydro one", categoryKey: "utilities", subcategory: "Electricity" },
  { pattern: "bc hydro", categoryKey: "utilities", subcategory: "Electricity" },
  { pattern: "energir", categoryKey: "utilities" },
  { pattern: "enbridge", categoryKey: "utilities" },
  { pattern: "videotron", categoryKey: "utilities", subcategory: "Internet" },
  { pattern: "bell", categoryKey: "utilities", subcategory: "Phone" },
  { pattern: "rogers", categoryKey: "utilities", subcategory: "Phone" },
  { pattern: "telus", categoryKey: "utilities", subcategory: "Phone" },
  { pattern: "fizz", categoryKey: "utilities", subcategory: "Phone" },
  { pattern: "koodo", categoryKey: "utilities", subcategory: "Phone" },
  { pattern: "fido", categoryKey: "utilities", subcategory: "Phone" },
  { pattern: "virgin plus", categoryKey: "utilities", subcategory: "Phone" },
  { pattern: "freedom mobile", categoryKey: "utilities", subcategory: "Phone" },
  { pattern: "public mobile", categoryKey: "utilities", subcategory: "Phone" },
  { pattern: "cogeco", categoryKey: "utilities", subcategory: "Internet" },
  { pattern: "shaw", categoryKey: "utilities", subcategory: "Internet" },
  // Housing
  { pattern: "rent", categoryKey: "housing", subcategory: "Rent" },
  { pattern: "loyer", categoryKey: "housing", subcategory: "Rent" },
  { pattern: "mortgage", categoryKey: "housing", subcategory: "Mortgage" },
  { pattern: "hypotheque", categoryKey: "housing", subcategory: "Mortgage" },
  { pattern: "ikea", categoryKey: "shopping", subcategory: "Home" },
  { pattern: "home depot", categoryKey: "housing", subcategory: "Maintenance" },
  { pattern: "rona", categoryKey: "housing", subcategory: "Maintenance" },
  { pattern: "reno depot", categoryKey: "housing", subcategory: "Maintenance" },
  // Insurance
  { pattern: "desjardins assurances", categoryKey: "insurance" },
  { pattern: "intact", categoryKey: "insurance" },
  { pattern: "belairdirect", categoryKey: "insurance" },
  { pattern: "td insurance", categoryKey: "insurance" },
  { pattern: "la capitale", categoryKey: "insurance" },
  { pattern: "beneva", categoryKey: "insurance" },
  { pattern: "insurance", categoryKey: "insurance" },
  { pattern: "assurance", categoryKey: "insurance" },
  // Shopping
  { pattern: "amazon", categoryKey: "shopping" },
  { pattern: "amzn", categoryKey: "shopping" },
  { pattern: "canadian tire", categoryKey: "shopping" },
  { pattern: "best buy", categoryKey: "shopping", subcategory: "Electronics" },
  { pattern: "simons", categoryKey: "shopping", subcategory: "Clothing" },
  { pattern: "winners", categoryKey: "shopping", subcategory: "Clothing" },
  { pattern: "uniqlo", categoryKey: "shopping", subcategory: "Clothing" },
  { pattern: "hm", categoryKey: "shopping", subcategory: "Clothing" },
  { pattern: "dollarama", categoryKey: "shopping" },
  { pattern: "sephora", categoryKey: "personal", subcategory: "Personal care" },
  { pattern: "apple store", categoryKey: "shopping", subcategory: "Electronics" },
  { pattern: "staples", categoryKey: "shopping" },
  { pattern: "indigo books", categoryKey: "shopping" },
  { pattern: "renaissance", categoryKey: "shopping" },
  // Healthcare
  { pattern: "jean coutu", categoryKey: "healthcare", subcategory: "Pharmacy" },
  { pattern: "pharmaprix", categoryKey: "healthcare", subcategory: "Pharmacy" },
  { pattern: "shoppers drug mart", categoryKey: "healthcare", subcategory: "Pharmacy" },
  { pattern: "uniprix", categoryKey: "healthcare", subcategory: "Pharmacy" },
  { pattern: "familiprix", categoryKey: "healthcare", subcategory: "Pharmacy" },
  { pattern: "clinique", categoryKey: "healthcare" },
  { pattern: "dentist", categoryKey: "healthcare", subcategory: "Dental" },
  { pattern: "dentaire", categoryKey: "healthcare", subcategory: "Dental" },
  // Entertainment
  { pattern: "cineplex", categoryKey: "entertainment", subcategory: "Events" },
  { pattern: "ticketmaster", categoryKey: "entertainment", subcategory: "Events" },
  { pattern: "steam", categoryKey: "entertainment", subcategory: "Games" },
  { pattern: "playstation", categoryKey: "entertainment", subcategory: "Games" },
  { pattern: "nintendo", categoryKey: "entertainment", subcategory: "Games" },
  { pattern: "xbox", categoryKey: "entertainment", subcategory: "Games" },
  { pattern: "bar", categoryKey: "entertainment" },
  { pattern: "saq", categoryKey: "entertainment" },
  { pattern: "lcbo", categoryKey: "entertainment" },
  // Travel
  { pattern: "air canada", categoryKey: "travel" },
  { pattern: "westjet", categoryKey: "travel" },
  { pattern: "porter", categoryKey: "travel" },
  { pattern: "airbnb", categoryKey: "travel" },
  { pattern: "expedia", categoryKey: "travel" },
  { pattern: "booking com", categoryKey: "travel" },
  { pattern: "hotel", categoryKey: "travel" },
  { pattern: "marriott", categoryKey: "travel" },
  // Education
  { pattern: "udemy", categoryKey: "education" },
  { pattern: "coursera", categoryKey: "education" },
  { pattern: "universite", categoryKey: "education" },
  { pattern: "university", categoryKey: "education" },
  { pattern: "cegep", categoryKey: "education" },
  { pattern: "college", categoryKey: "education" },
  // Fees
  { pattern: "service charge", categoryKey: "fees", subcategory: "Bank fees" },
  { pattern: "monthly fee", categoryKey: "fees", subcategory: "Bank fees" },
  { pattern: "account fee", categoryKey: "fees", subcategory: "Bank fees" },
  { pattern: "plan fee", categoryKey: "fees", subcategory: "Bank fees" },
  { pattern: "atm fee", categoryKey: "fees", subcategory: "Bank fees" },
  { pattern: "frais", categoryKey: "fees", subcategory: "Bank fees" },
  { pattern: "overdraft", categoryKey: "fees", subcategory: "Bank fees" },
  { pattern: "nsf", categoryKey: "fees", subcategory: "Bank fees" },
  { pattern: "interest charge", categoryKey: "fees", subcategory: "Interest" },
  { pattern: "purchase interest", categoryKey: "fees", subcategory: "Interest" },
  { pattern: "annual fee", categoryKey: "fees", subcategory: "Bank fees" },
  // Personal
  { pattern: "salon", categoryKey: "personal", subcategory: "Personal care" },
  { pattern: "barber", categoryKey: "personal", subcategory: "Personal care" },
  { pattern: "coiffure", categoryKey: "personal", subcategory: "Personal care" },
  { pattern: "canadahelps", categoryKey: "personal", subcategory: "Donations" },
  { pattern: "red cross", categoryKey: "personal", subcategory: "Donations" },
];

/** Keywords that indicate income when the amount is positive. */
export const INCOME_KEYWORDS = [
  "payroll", "paie", "salary", "salaire", "direct deposit", "depot direct", "dep dir", "pay", "wages", "employer",
  "canada fed", "gst credit", "credit tps", "ccb", "allocation", "ei benefit", "revenu quebec", "cra", "interest paid", "interet", "dividend",
];

/** Keywords that indicate a transfer between the user's own accounts or a card payment. */
export const TRANSFER_KEYWORDS = [
  "transfer to", "transfer from", "online transfer", "internal transfer", "tfr", "virement", "payment thank you",
  "paiement merci", "credit card payment", "visa payment", "mastercard payment", "card payment", "amex payment",
  "savings transfer", "to savings", "from chequing", "from savings", "to chequing", "investment transfer", "wealthsimple transfer",
];

/** Keywords that indicate a refund on a positive amount. */
export const REFUND_KEYWORDS = ["refund", "return", "remboursement", "reversal", "credit adj", "retour", "chargeback"];

function wordPrefixMatch(haystack: string, needle: string): boolean {
  if (!needle) return false;
  if (haystack === needle) return true;
  const idx = haystack.indexOf(needle);
  if (idx < 0) return false;
  const before = idx === 0 || haystack[idx - 1] === " ";
  const afterIdx = idx + needle.length;
  const after = afterIdx === haystack.length || haystack[afterIdx] === " " || haystack[afterIdx] === "s";
  return before && after;
}

/** Returns the most specific (longest-pattern) system rule matching the normalised text. */
export function matchSystemRule(normalized: string): SystemRule | null {
  let best: SystemRule | null = null;
  for (const rule of SYSTEM_RULES) {
    if (wordPrefixMatch(normalized, rule.pattern) && (!best || rule.pattern.length > best.pattern.length)) best = rule;
  }
  return best;
}

export function containsKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((k) => wordPrefixMatch(text, k));
}
