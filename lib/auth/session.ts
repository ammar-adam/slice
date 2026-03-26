import "server-only";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

export function getSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user?.id) {
    return null;
  }
  return session;
}
