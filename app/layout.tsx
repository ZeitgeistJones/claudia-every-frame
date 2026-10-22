import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Prefer the production domain so X/Discord get a stable absolute image URL.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://claudia-every-frame.vercel.app";

const title = "Claudia — Every Frame";
const description =
  "Official Claudia photomosaics from every real claudia.gallery photograph — each still used once. Prompt your own in Studio and share it.";

// Dedicated X/OG card (1200×675) — see public/og.jpg
const ogImage = {
  url: "/og.jpg",
  width: 1200,
  height: 675,
  alt: "Photomosaic portrait of Claudia made from every claudia.gallery photograph",
  type: "image/jpeg" as const,
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  applicationName: "Claudia — Every Frame",
  authors: [{ name: "anabology", url: "https://claudia.gallery/" }],
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Claudia — Every Frame",
    title,
    description,
    locale: "en_US",
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [ogImage],
  },
};

export const viewport: Viewport = {
  themeColor: "#050406",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
