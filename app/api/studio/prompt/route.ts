// Studio prompt gate: must be Claudia-related and appropriate.
// Uses a local heuristic always; upgrades to AI Gateway when credentials exist.

import { NextResponse } from "next/server";
import { heuristicPromptFilter, type PromptVerdict } from "@/lib/studio";

export async function POST(req: Request) {
  let body: { prompt?: string };
  try {
    body = (await req.json()) as { prompt?: string };
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const base = heuristicPromptFilter(prompt);

  // Optional LLM second opinion via AI Gateway (OIDC on Vercel, or AI_GATEWAY_API_KEY).
  const upgraded = await maybeAiFilter(prompt, base);
  return NextResponse.json(upgraded);
}

async function maybeAiFilter(prompt: string, fallback: PromptVerdict): Promise<PromptVerdict> {
  const key = process.env.AI_GATEWAY_API_KEY;
  const oidc = process.env.VERCEL_OIDC_TOKEN;
  if (!key && !oidc) return fallback;

  // Hard block list from the heuristic always wins (NSFW / hate / violence).
  if (!fallback.ok && /appropriate/i.test(fallback.reason)) return fallback;

  try {
    const { generateObject } = await import("ai");
    const { z } = await import("zod");
    const schema = z.object({
      ok: z.boolean(),
      reason: z.string(),
      cleanedPrompt: z.string().optional(),
      themeTags: z.array(z.string()).optional(),
    });
    const { object } = await generateObject({
      model: "openai/gpt-4o-mini",
      schema,
      system: `You moderate short creative prompts for a Claudia photomosaic studio.
Claudia is a character from anabology's short films (claudia.gallery / $CLAUDIA).
ALLOW only prompts that clearly ask for a Claudia-related portrait, film homage, or look from that archive.
REJECT sexual, NSFW, violent, hateful, or off-topic prompts (other celebrities, brands, politics, etc.).
Keep reasons short and kind.`,
      prompt: `User prompt: ${JSON.stringify(prompt.slice(0, 280))}`,
    });
    if (!object.ok) {
      return {
        ok: false,
        reason: object.reason || "That prompt isn’t a fit for the Claudia studio.",
      };
    }
    return {
      ok: true,
      reason: object.reason || "Looks good.",
      cleanedPrompt: (object.cleanedPrompt || prompt).trim().slice(0, 280),
      themeTags: object.themeTags?.slice(0, 8) || fallback.themeTags,
    };
  } catch (err) {
    console.warn("[studio/prompt] AI filter unavailable, using heuristic", err);
    return fallback;
  }
}
