"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { CurrencyInput, type CurrencyInputProps } from "@/components/ui/currency-input";

/**
 * A react-hook-form controlled CurrencyInput (integer cents). Unlike a bare <Controller>,
 * it forwards the `id` and `aria-*` props that <Field> adds, so the label, hint and
 * error stay attached to the input.
 */
export function MoneyField<T extends FieldValues>({
  control,
  name,
  nullable = false,
  ...inputProps
}: { control: Control<T>; name: FieldPath<T>; /** Empty means null (optional amounts) instead of missing. */ nullable?: boolean } & Omit<CurrencyInputProps, "value" | "onChange" | "name">) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <CurrencyInput
          {...inputProps}
          ref={field.ref}
          name={field.name}
          value={field.value}
          onChange={(cents) => field.onChange(cents ?? (nullable ? null : undefined))}
          onBlur={(e) => {
            field.onBlur();
            inputProps.onBlur?.(e);
          }}
        />
      )}
    />
  );
}
