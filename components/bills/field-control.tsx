"use client";

import type * as React from "react";

export interface FieldControlProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/**
 * `Field` wires its label, hint and error by cloning its child with an id and aria
 * props. A react-hook-form `Controller` child would swallow them, so wrap it in
 * this and spread the props onto the real control:
 * `<Field label="Amount"><FieldControl>{(p) => <Controller render={({ field }) => <CurrencyInput {...p} />} />}</FieldControl></Field>`
 */
export function FieldControl({ children, ...props }: FieldControlProps & { children: (props: FieldControlProps) => React.ReactElement }) {
  return children(props);
}
