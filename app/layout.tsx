import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:4317";

const description =
  "One portrait of Claudia, built from every real photograph in claudia.gallery. Zoom in to find each frame.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Claudia — Every Frame",
  description,
  openGraph: {
    title: "Claudia — Every Frame",
    description,
    images: [{ url: "/mosaic/claudia-mosaic-x.jpg", width: 2048, height: 1152, alt: "Photomosaic portrait of Claudia" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Claudia — Every Frame",
    description,
    images: ["/mosaic/claudia-mosaic-x.jpg"],
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
