/**
 * Sanity-checks the recommendation and Agent Mode parser against the demo
 * scenarios. Pure logic — no server, no network, no payment.
 *
 * Usage: npx tsx scripts/dev-scenarios.ts
 */
import { recommend, type Priority } from "../src/recommend.js";
import { parseIntent } from "../src/agent.js";

const show = (label: string, r: ReturnType<typeof recommend>) => {
  console.log(`\n${label}`);
  console.log(`  -> ${r.recommended?.name ?? "none"}  (${r.recommended?.estimatedCostUsdc} USDC, ${r.recommended?.estimatedSeconds}s)`);
  console.log(`  ${r.reason}`);
  for (const c of r.candidates) {
    console.log(
      `     ${c.eligible ? "OK  " : "SKIP"} ${c.name.padEnd(11)} $${c.estimatedCostUsdc}  ${String(c.estimatedSeconds).padStart(5)}s  score ${c.score}` +
        (c.rejectionReason ? `  (${c.rejectionReason})` : ""),
    );
  }
};

show(
  "5 SDXL images, budget $0.20, balanced",
  recommend({ workload: "image-generation", model: "sdxl", units: 5, maxBudget: 0.2, priority: "balanced" }),
);

show(
  "10 SDXL images, budget $0.20, speed",
  recommend({ workload: "image-generation", model: "sdxl", units: 10, maxBudget: 0.2, priority: "speed" }),
);

show(
  "fine-tune sdxl, 5 x 100 steps, no budget",
  recommend({ workload: "fine-tune", model: "sdxl", units: 5, priority: "balanced" }),
);

show(
  "llama-3-70b inference, 50k tokens, cost priority",
  recommend({ workload: "text-inference", model: "llama-3-70b", units: 50, priority: "cost" }),
);

const phrases = [
  "Generate 5 SDXL images under $0.20, prioritize balanced performance.",
  "I need to generate 10 images using SDXL under $0.20 and prioritize speed.",
  "Upscale 30 seconds of video as cheaply as possible",
  "run llama 3 70b on 100k tokens, needs to be reliable, max $2",
];

console.log("\n\nAgent Mode parsing");
for (const p of phrases) {
  const intent = parseIntent(p);
  const r = intent.requirements;
  console.log(`\n  "${p}"`);
  console.log(
    `    workload=${r.workload} model=${r.model} units=${r.units} budget=${r.maxBudget ?? "-"} priority=${r.priority}`,
  );
  const rec = recommend(r);
  console.log(`    -> ${rec.recommended?.name} $${rec.recommended?.estimatedCostUsdc}`);
  if (intent.notes.length) console.log(`    notes: ${intent.notes.join(" | ")}`);
}
