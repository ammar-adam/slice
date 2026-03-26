import { redirect } from "next/navigation";

import { CreateBetForm } from "@/components/bets/create-bet-form";
import { getSession } from "@/lib/auth/session";

export default async function CreateBetPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect("/");
  }

  return <CreateBetForm />;
}
