// One mosaic, opened from the gallery wall.
// Params are read inside Suspense because this app uses cache components
// with partial prefetching.

import { Suspense } from "react";
import editionsFile from "@/public/editions.json";
import { MosaicExplorer } from "@/components/mosaic-explorer";

type EditionsJson = {
  editions: { id: string }[];
};

export function generateStaticParams() {
  const data = editionsFile as EditionsJson;
  return data.editions.map((edition) => ({ edition: edition.id }));
}

export default function ViewEditionPage({
  params,
}: {
  params: Promise<{ edition: string }>;
}) {
  return (
    <main className="h-dvh w-full bg-[#050406]">
      <Suspense fallback={<div className="h-dvh w-full bg-[#050406]" />}>
        <EditionView params={params} />
      </Suspense>
    </main>
  );
}

async function EditionView({
  params,
}: {
  params: Promise<{ edition: string }>;
}) {
  const { edition } = await params;
  return <MosaicExplorer initialEdition={edition} />;
}
