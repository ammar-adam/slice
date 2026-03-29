"use client";

import { signIn } from "next-auth/react";

export function StartBettingButton() {
  return (
    <button
      type="button"
      onClick={() => void signIn("google", { callbackUrl: "/home" })}
      className="slice-btn-primary mt-8 block w-full px-4 py-[14px] text-center"
    >
      Start betting
    </button>
  );
}
