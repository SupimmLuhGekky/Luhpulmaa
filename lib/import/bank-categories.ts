/**
 * Maps category labels found in bank exports (English and French) to our built-in
 * category keys. Used as a hint: the user's own rules and learned merchants still win.
 */
const ALIASES: [string, RegExp][] = [
  ["groceries", /grocer|epicerie|supermarket|alimentation/],
  ["restaurants", /restaurant|dining|food ?(&|and) ?drink|fast food|coffee|cafe|restauration|bar(s)?$/],
  ["gas", /^gas|fuel|essence|carburant|gas station/],
  ["transportation", /transport|transit|rideshare|taxi|parking|stationnement|auto(mobile)?$|car /],
  ["travel", /travel|voyage|hotel|airline|flight|vacation|vacances/],
  ["shopping", /shopping|retail|magasinage|clothing|vetement|electronics|merchandise|general merchandise/],
  ["entertainment", /entertainment|divertissement|recreation|loisir|movies|cinema|games|jeux|sports?$/],
  ["subscriptions", /subscription|abonnement|streaming/],
  ["utilities", /utilit|services publics|phone|telephone|internet|hydro|electric|cable|bills?( (&|and) utilities)?$|factures?/],
  ["housing", /housing|rent|loyer|mortgage|hypotheque|home( improvement)?$|logement|maison/],
  ["insurance", /insurance|assurance/],
  ["healthcare", /health|sante|medical|pharmac|dental|dentaire/],
  ["education", /education|tuition|school|ecole|scolarite/],
  ["personal", /personal|soins|beauty|beaute|gift|cadeau|donation|charity|don(s)?$/],
  ["fees", /fee|frais|interest charge|interet(s)? (charge|debiteur)/],
  ["income", /income|revenu|payroll|salary|salaire|paycheque|paycheck|deposit|depot direct/],
  ["transfers", /transfer|virement|payment|paiement|e-?transfer/],
];

function plain(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Our category key for a bank's category label, or null when nothing fits. */
export function bankCategoryToSystemKey(label: string | null | undefined): string | null {
  if (!label) return null;
  const v = plain(label);
  if (!v) return null;
  for (const [key, pattern] of ALIASES) if (pattern.test(v)) return key;
  return null;
}
