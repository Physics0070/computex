/**
 * Agent Mode — deterministic natural-language intent parser.
 *
 * Turns "generate 10 SDXL images under $0.20 and prioritize speed" into the same
 * structured requirements the form produces, then hands them to the ordinary
 * recommendation engine. No LLM call, no network, fully reproducible.
 *
 * Each extracted field records how it was decided so the UI can show
 * intent -> requirements transparently instead of asking for trust.
 */
import { MODEL_VRAM_GB, SUPPORTED_WORKLOADS, WORKLOADS, type WorkloadKind } from "./pricing.js";
import { PRIORITIES, type Priority, type RecommendRequest } from "./recommend.js";

export interface ParsedField<T> {
  value: T;
  /** The substring that produced this value, or null when a default was used. */
  matched: string | null;
  source: "parsed" | "default" | "inferred";
}

export interface ParsedIntent {
  input: string;
  requirements: RecommendRequest;
  fields: {
    workload: ParsedField<WorkloadKind>;
    model: ParsedField<string>;
    units: ParsedField<number>;
    maxBudget: ParsedField<number | undefined>;
    priority: ParsedField<Priority>;
  };
  /** Anything the parser wants the user to double-check. */
  notes: string[];
}

/** Workload keywords, checked in order — first hit wins. */
const WORKLOAD_KEYWORDS: Array<{ kind: WorkloadKind; patterns: RegExp }> = [
  { kind: "fine-tune", patterns: /\b(fine[\s-]?tun\w*|train\w*|lora|checkpoint)\b/i },
  { kind: "video-upscale", patterns: /\b(video|upscal\w*|footage|clip|frames?)\b/i },
  {
    kind: "text-inference",
    patterns: /\b(text|token|prompt|chat|llm|summari[sz]\w*|complet\w*|inference on|generate text)\b/i,
  },
  {
    kind: "image-generation",
    patterns: /\b(image|images|picture|pictures|render|renders|art|photo|photos|generate .*image)\b/i,
  },
];

/** Model aliases -> canonical id. Longest alias is matched first. */
const MODEL_ALIASES: Record<string, string> = {
  sdxl: "sdxl",
  "sdxl turbo": "sdxl-turbo",
  "sdxl-turbo": "sdxl-turbo",
  "stable diffusion xl": "sdxl",
  "stable diffusion": "sd-1.5",
  "sd 1.5": "sd-1.5",
  "sd-1.5": "sd-1.5",
  "sd1.5": "sd-1.5",
  flux: "flux-dev",
  "flux dev": "flux-dev",
  "flux-dev": "flux-dev",
  "flux schnell": "flux-schnell",
  "flux-schnell": "flux-schnell",
  "llama 3 8b": "llama-3-8b",
  "llama-3-8b": "llama-3-8b",
  "llama 3 70b": "llama-3-70b",
  "llama-3-70b": "llama-3-70b",
  llama: "llama-3-8b",
  "mistral 7b": "mistral-7b",
  "mistral-7b": "mistral-7b",
  mistral: "mistral-7b",
  whisper: "whisper-large",
  "whisper large": "whisper-large",
  "real esrgan": "real-esrgan",
  "real-esrgan": "real-esrgan",
  esrgan: "real-esrgan",
  "video crafter": "video-crafter",
  "video-crafter": "video-crafter",
};

/** Sensible default model per workload when the user does not name one. */
const DEFAULT_MODEL: Record<WorkloadKind, string> = {
  "image-generation": "sdxl",
  "text-inference": "llama-3-8b",
  "video-upscale": "real-esrgan",
  "fine-tune": "sdxl",
};

const PRIORITY_KEYWORDS: Array<{ priority: Priority; patterns: RegExp }> = [
  { priority: "speed", patterns: /\b(speed|fast\w*|quick\w*|asap|latency|urgent|soon)\b/i },
  { priority: "cost", patterns: /\b(cheap\w*|cost|budget|afford\w*|inexpensive|economical|save money)\b/i },
  { priority: "reliability", patterns: /\b(reliab\w*|stable|robust|safe|uptime|dependable)\b/i },
  { priority: "balanced", patterns: /\b(balanc\w*|middle|mix|both)\b/i },
];

/**
 * Parses a natural-language compute request.
 *
 * @param input - Free text typed by the user in Agent Mode.
 * @returns Structured requirements plus a per-field provenance trail.
 */
export function parseIntent(input: string): ParsedIntent {
  const text = input.trim();
  const notes: string[] = [];

  /* -- workload ---------------------------------------------------- */
  let workload: ParsedField<WorkloadKind> = {
    value: "image-generation",
    matched: null,
    source: "default",
  };
  for (const { kind, patterns } of WORKLOAD_KEYWORDS) {
    const hit = text.match(patterns);
    if (hit) {
      workload = { value: kind, matched: hit[0], source: "parsed" };
      break;
    }
  }
  if (workload.source === "default") {
    notes.push('No workload keyword found — defaulted to image generation.');
  }

  /* -- model ------------------------------------------------------- */
  let model: ParsedField<string> = {
    value: DEFAULT_MODEL[workload.value],
    matched: null,
    source: "default",
  };
  const aliases = Object.keys(MODEL_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const pattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const hit = text.match(pattern);
    if (hit) {
      model = { value: MODEL_ALIASES[alias]!, matched: hit[0], source: "parsed" };
      break;
    }
  }
  // A model that changes the workload implication (e.g. an LLM named in an
  // "images" sentence) is worth surfacing rather than silently reconciling.
  if (model.source === "parsed" && workload.source === "default") {
    const impliedByModel = model.value.startsWith("llama") || model.value.startsWith("mistral");
    if (impliedByModel) {
      workload = { value: "text-inference", matched: model.matched, source: "inferred" };
      model = { ...model };
      notes.pop();
      notes.push(`Workload inferred as text inference from the model "${model.value}".`);
    }
  }

  /* -- units ------------------------------------------------------- */
  const spec = WORKLOADS[workload.value];
  let units: ParsedField<number> = { value: 1, matched: null, source: "default" };

  // Allows up to two words between the count and the noun, so "5 SDXL images"
  // and "10 high-res pictures" both read as a quantity.
  const unitNoun =
    /(\d+(?:\.\d+)?)\s*(?:[\w.-]+\s+){0,2}?(images?|pictures?|renders?|photos?|tokens?|seconds?|secs?|steps?|frames?)\b/i;
  const unitHit = text.match(unitNoun);
  if (unitHit) {
    units = { value: Math.ceil(Number(unitHit[1])), matched: unitHit[0], source: "parsed" };
  } else {
    // Fall back to the first bare integer that is not part of a price or a model name.
    const bare = text.match(/(?<![$\d.\w-])(\d{1,4})(?![\d.]*\s*(?:usdc|usd|dollars?|cents?|gb|b\b))(?![.\d])/i);
    if (bare) {
      units = { value: Number(bare[1]), matched: bare[0], source: "inferred" };
      notes.push(`Interpreted "${bare[0]}" as the number of ${spec.unit}s.`);
    } else {
      notes.push(`No quantity found — defaulted to 1 ${spec.unit}.`);
    }
  }
  if (units.value > 1000) {
    units = { ...units, value: 1000 };
    notes.push("Quantity capped at 1000 units.");
  }

  /* -- budget ------------------------------------------------------ */
  let maxBudget: ParsedField<number | undefined> = {
    value: undefined,
    matched: null,
    source: "default",
  };
  const dollarHit = text.match(/\$\s*(\d+(?:\.\d+)?)/);
  const wordHit = text.match(
    /\b(?:under|below|less than|max(?:imum)?|budget of|within|up to|at most|no more than)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:usdc|usd|dollars?)?/i,
  );
  const centsHit = text.match(/\b(\d+)\s*cents?\b/i);
  if (dollarHit) {
    maxBudget = { value: Number(dollarHit[1]), matched: dollarHit[0], source: "parsed" };
  } else if (wordHit) {
    maxBudget = { value: Number(wordHit[1]), matched: wordHit[0], source: "parsed" };
  } else if (centsHit) {
    maxBudget = { value: Number(centsHit[1]) / 100, matched: centsHit[0], source: "parsed" };
  } else {
    notes.push("No budget mentioned — every compatible GPU stays in the running.");
  }

  /* -- priority ---------------------------------------------------- */
  let priority: ParsedField<Priority> = { value: "balanced", matched: null, source: "default" };
  for (const { priority: p, patterns } of PRIORITY_KEYWORDS) {
    const hit = text.match(patterns);
    if (hit) {
      priority = { value: p, matched: hit[0], source: "parsed" };
      break;
    }
  }

  return {
    input: text,
    requirements: {
      workload: workload.value,
      model: model.value,
      units: units.value,
      priority: priority.value,
      maxBudget: maxBudget.value,
    },
    fields: { workload, model, units, maxBudget, priority },
    notes,
  };
}

export { SUPPORTED_WORKLOADS, PRIORITIES, MODEL_VRAM_GB };
