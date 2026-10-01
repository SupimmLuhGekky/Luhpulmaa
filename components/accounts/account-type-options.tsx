import { ACCOUNT_GROUPS, ACCOUNT_TYPE_LABELS } from "@/lib/accounts/types";

/** Account types as grouped <option>s (cash, credit, loans, investments, other) for a native <select>. */
export function AccountTypeOptions() {
  return (
    <>
      {ACCOUNT_GROUPS.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.types.map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
