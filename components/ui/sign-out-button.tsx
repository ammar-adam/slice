"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="text-xs font-semibold text-slice-primary hover:underline"
    >
      Sign out
    </button>
  );
}
