import { redirect } from "next/navigation";

type Props = { params: { slug: string } };

export default function ShortBetAliasPage(props: Props) {
  redirect(`/bet/${props.params.slug}`);
}
