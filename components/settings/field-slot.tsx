"use client";

import type * as React from "react";

export interface FieldSlotProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/**
 * `<Field>` labels its child by giving it an id and aria props. A react-hook-form
 * `<Controller>` would swallow them, so wrap it: `render` receives the props to spread
 * onto the real control.
 *
 *   <Field label="Amount"><FieldSlot render={(a) => <Controller … render={({ field }) => <CurrencyInput {...a} … />} />} /></Field>
 */
export function FieldSlot({ render, ...props }: FieldSlotProps & { render: (props: FieldSlotProps) => React.ReactElement }) {
  return render(props);
}
