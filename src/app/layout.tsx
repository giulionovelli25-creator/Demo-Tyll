import type { Metadata, Viewport } from "next";
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

// The browser bar follows the page. These two values mirror --color-mist in tokens.css, as metadata cannot read a token.
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f5f7" }, { media: "(prefers-color-scheme: dark)", color: "#10141b" }],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${inter.variable} ${arabic.variable} h-full`}>
      <head>
        {/* Applies a saved theme and look before first paint, so the page never flashes the wrong colours. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var r=document.documentElement.dataset;if(localStorage.getItem("tyll-theme-v2")==="dark")r.theme="dark";var l=(JSON.parse(localStorage.getItem("tyll-look-v1")||"{}").state)||{};if(l.waves)r.waves=l.waves;if(l.colour&&l.colour!=="sections"){r.look="one";if(l.colour==="outlets"){r.outlets="on";r.tone="indigo"}else{r.tone=l.colour}}}catch(e){}` }} />
      </head>
      <body className="min-h-full">
        <Suspense fallback={<BrandLoader />}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
