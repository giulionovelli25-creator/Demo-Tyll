import type { Metadata } from "next";
import { Inter, Noto_Sans_Arabic } from "next/font/google";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { BrandLoader } from "@/components/brand";
import "./globals.css";

// tyll.ai sets its pages in Inter, with Noto Sans Arabic for Arabic text.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const arabic = Noto_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic"], weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: "Tyll platform demo",
  description: "Hospitality financial and operational intelligence. Demonstration with simulated data.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${arabic.variable} h-full`}>
      <body className="min-h-full">
        <Suspense fallback={<BrandLoader />}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
