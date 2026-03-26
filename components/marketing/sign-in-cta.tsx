"use client";

import { signIn } from "next-auth/react";

import { cn } from "@/lib/utils";

export function SignInCTA(props: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => signIn("google")}
      className={cn(
        "w-full rounded-xl bg-slice-primary px-4 py-3 text-center text-sm font-semibold text-white shadow-sm",
        "hover:brightness-110 active:scale-[0.99]",
        props.className
      )}
    >
      Continue with Google
    </button>
  );
}
