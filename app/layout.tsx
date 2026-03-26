import type { Metadata } from "next";
import { DM_Sans, Syne } from "next/font/google";
import Script from "next/script";

import { Providers } from "@/components/providers";
import { getSession } from "@/lib/auth/session";

import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-slice-display",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-slice-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Slice — Wanna bet?",
  description: "Social prediction market for food delivery",
};

export default async function RootLayout(props: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable}`}>
      <body>
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? ""}`}
          strategy="afterInteractive"
        />
        <Providers session={session}>{props.children}</Providers>
      </body>
    </html>
  );
}
