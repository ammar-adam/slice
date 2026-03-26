import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

export function Button({ className, variant = "primary", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition active:scale-[0.99]",
        variant === "primary" &&
          "bg-slice-primary text-white shadow-sm hover:brightness-110",
        variant === "ghost" && "bg-transparent text-neutral-700 hover:bg-neutral-100",
        className
      )}
      {...props}
    />
  );
}
