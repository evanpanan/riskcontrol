"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

type CheckedState = boolean | "indeterminate";

interface CheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "checked" | "defaultChecked"> {
  checked?: CheckedState;
  defaultChecked?: CheckedState;
  onCheckedChange?: (checked: CheckedState) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
}

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  (
    {
      className,
      checked: checkedProp,
      defaultChecked,
      onCheckedChange,
      disabled,
      required,
      name,
      value,
      id,
      ...props
    },
    ref
  ) => {
    const isControlled = checkedProp !== undefined;
    const [internalChecked, setInternalChecked] = React.useState<CheckedState>(
      defaultChecked ?? false
    );
    const checked = isControlled ? (checkedProp as CheckedState) : internalChecked;

    React.useEffect(() => {
      if (!id) return;
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el && el.type === "checkbox") {
        el.checked = checked === true;
      }
    }, [id, checked]);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;
      e.preventDefault();
      const next: CheckedState = checked === true ? false : true;
      if (!isControlled) setInternalChecked(next);
      onCheckedChange?.(next);
    };

    return (
      <>
        <button
          type="button"
          ref={ref}
          role="checkbox"
          aria-checked={checked === "indeterminate" ? "mixed" : checked}
          aria-required={required}
          disabled={disabled}
          onClick={handleClick}
          className={cn(
            "peer h-4 w-4 shrink-0 rounded border border-input bg-background shadow-sm transition-colors",
            "hover:border-primary/60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-50",
            checked === true &&
              "border-primary bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.25)_inset]",
            checked === "indeterminate" &&
              "border-primary bg-primary/60 text-primary-foreground",
            className
          )}
          {...props}
        >
          <span className="flex items-center justify-center text-current">
            {checked === true && <Check className="h-3 w-3" strokeWidth={3} />}
            {checked === "indeterminate" && (
              <span className="block h-0.5 w-2.5 rounded-full bg-current" />
            )}
          </span>
        </button>
        {name && (
          <input
            type="checkbox"
            id={id}
            name={name}
            value={value}
            checked={checked === true}
            required={required}
            disabled={disabled}
            readOnly
            tabIndex={-1}
            className="sr-only"
            onChange={() => {}}
          />
        )}
      </>
    );
  }
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
