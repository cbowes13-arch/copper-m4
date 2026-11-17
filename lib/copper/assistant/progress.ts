// What Ask Copper is doing, step by step, as it streams in: Gemini's thinking
// summaries, each tool call (with what went in and what came out), and the
// reply. The panel draws this as it changes.

export type ThinkingStep = { type: "thinking"; text: string };

export type ToolStep = {
  type: "tool";
  id: string;
  name: string;
  /** "calling" until the tool's result comes back. */
  state: "calling" | "done" | "error";
  input?: unknown;
  output?: unknown;
};

/** Who is answering: Copper, or the Refund agent Copper hands refunds to (Module 4). */
export type Agent = "copper" | "refund";

export const AGENT_NAMES: Record<Agent, string> = {
  copper: "Copper",
  refund: "Refund agent",
};

/** One agent handed the conversation to the other. */
export type HandoffStep = { type: "handoff"; from: Agent; to: Agent };

export type Step = ThinkingStep | ToolStep | HandoffStep;

export type Progress = {
  steps: Step[];
  reply: string;
  status: "working" | "done" | "error";
  /** Who started this answer (Copper when missing). */
  startAgent?: Agent;
  /** Who finished it, and so who answers the next question. */
  agent?: Agent;
};

/** Every tool call in an answer, in order. */
export function toolCallsOf(progress: Progress) {
  return progress.steps
    .filter((step): step is ToolStep => step.type === "tool")
    .map(({ name, input, output }) => ({ name, input, output }));
}

/**
 * The tools Copper can use, and what each one does in plain English. The chat
 * panel lists these, so it lives here (and not in tools.ts, which reads the
 * database and can't be imported by a client component).
 */
export const TOOL_LABELS: Record<string, string> = {
  get_products: "Listing the products",
  get_prices: "Looking up prices",
  calculate_cost: "Working out the cost",
  check_availability: "Checking stock",
  search_docs: "Searching the documents",
  transfer_to_refund_agent: "Handing you to the Refund agent",
  get_purchase_history: "Looking up your orders",
  get_refund_rules: "Checking the refund rules",
  request_refund: "Asking the app for the refund",
  transfer_to_copper: "Handing you back to Copper",
};

/** The tools that pass the conversation from one agent to the other. */
export const HANDOFF_TOOLS: Record<string, Agent> = {
  transfer_to_refund_agent: "refund",
  transfer_to_copper: "copper",
};

/** Copper's own tools (Modules 2 and 3). */
export const COPPER_TOOL_NAMES = [
  "get_products",
  "get_prices",
  "calculate_cost",
  "check_availability",
  "search_docs",
];

/** Each agent's tools, as the chat panel lists them on the Support page. */
export const AGENT_TOOL_NAMES: Record<Agent, string[]> = {
  copper: [...COPPER_TOOL_NAMES, "transfer_to_refund_agent"],
  refund: [
    "get_purchase_history",
    "get_refund_rules",
    "request_refund",
    "transfer_to_copper",
  ],
};
