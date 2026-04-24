import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateFromUberLinkForm } from "@/components/bets/create-from-uber-link-form";
import { getSession } from "@/lib/auth/session";
import { verifyWaMagicLink, getWhatsAppMagicSecret } from "@/lib/whatsapp/magic-link";

type SP = { [key: string]: string | string[] | undefined };

function first(s: string | string[] | undefined): string | undefined {
  if (Array.isArray(s)) return s[0];
  return typeof s === "string" ? s : undefined;
}

export default async function CreateBetPage(props: { searchParams: SP }) {
  const phone = first(props.searchParams.phone);
  const uuid = first(props.searchParams.uuid);
  const sig = first(props.searchParams.sig);
  const secret = getWhatsAppMagicSecret();
  const magicOk =
    Boolean(phone && uuid && sig && secret && verifyWaMagicLink(phone, uuid, sig, secret));

  const session = await getSession();
  if (!session?.user?.id && !magicOk) {
    redirect("/");
  }

  return (
    <main className="slice-page">
      <header className="mb-6 flex items-center justify-between">
        <Link href={magicOk ? "/" : "/home"} className="slice-logo text-[26px] leading-none">
          slice
        </Link>
      </header>
      <CreateFromUberLinkForm
        magicAuth={magicOk}
        waNotify={
          magicOk && phone && sig && uuid
            ? { waId: phone, sig, uuid }
            : undefined
        }
      />
    </main>
  );
}
