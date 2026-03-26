import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { Providers } from "@/components/providers";
import { getSession } from "@/lib/auth/session";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Slice — Wanna bet?",
  description: "Social prediction market for food delivery",
};

export default async function RootLayout(props: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <Providers session={session}>{props.children}</Providers>
      </body>
    </html>
  );
}
