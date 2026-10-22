import type { Metadata } from "next";
import { StudioApp } from "@/components/studio-app";

export const metadata: Metadata = {
  title: "Studio — Claudia Every Frame",
  description:
    "Prompt your own Claudia photomosaic. Must be Claudia-related and appropriate. Every photograph once — share the link.",
};

export default function StudioPage() {
  return <StudioApp />;
}
