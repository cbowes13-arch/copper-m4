"use server";

// The server action the Ask Copper chat calls. It streams the conversation to
// the model through callStream (lib/ai/call.ts), with or without the tools,
// and sends back each step as it happens, so the panel can show Copper
// thinking and using its tools.
// Module 4: on the Support page the chat also sends the Refund Console's
// orders and limit. Copper then has a handoff tool; when it calls it, the same
// question goes on to the Refund agent, with its own instructions and tools.
import { hasToolCall, stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import {
  COPPER_HANDOFF_INSTRUCTIONS,
  COPPER_INSTRUCTIONS,
  REFUND_AGENT_INSTRUCTIONS,
} from "@/lib/copper/assistant/instructions";
import {
  type Agent,
  HANDOFF_TOOLS,
  type Progress,
  type ToolStep,
} from "@/lib/copper/assistant/progress";
import {
  handoffToRefundAgent,
  limitRule,
  refundTools,
} from "@/lib/copper/assistant/refund-tools";
import { copperTools } from "@/lib/copper/assistant/tools";
import type { RefundContext } from "@/lib/copper/refunds";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
  /** Who answers first: whoever finished the last answer. Copper by default. */
  agent?: Agent;
  /** The Refund Console's orders and limit (Support page only). */
  refunds?: RefundContext;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per agent. */
const MAX_STEPS = 5;

const SORRY = "Sorry, something went wrong on my end. Please try again.";

/** The model settings for one agent's part of the answer. */
function agentSetup(
  agent: Agent,
  refunds: RefundContext | undefined,
  canHandOff: boolean,
) {
  if (agent === "refund" && refunds) {
    return {
      info: { module: 4, feature: "refund-agent" },
      instructions: `${REFUND_AGENT_INSTRUCTIONS}\n\nThe current limit: ${limitRule(refunds.limitUsd)}`,
      tools: refundTools(refunds, canHandOff),
    };
  }
  return {
    info: { module: 2, feature: "ask-copper" },
    instructions:
      refunds && canHandOff
        ? COPPER_INSTRUCTIONS + "\n" + COPPER_HANDOFF_INSTRUCTIONS
        : COPPER_INSTRUCTIONS,
    tools:
      refunds && canHandOff
        ? { ...copperTools, ...handoffToRefundAgent }
        : copperTools,
  };
}

export async function askCopper({
  messages,
  useTools,
  agent: firstAgent,
  refunds,
}: AskCopperRequest): Promise<AskCopperResult> {
  const { live, update, done } = createLive<Progress>();
  let agent: Agent = refunds && firstAgent === "refund" ? "refund" : "copper";
  const progress: Progress = {
    steps: [],
    reply: "",
    status: "working",
    startAgent: agent,
    agent,
  };
  // A fresh copy each time, so earlier updates never change underneath the
  // panel.
  const snapshot = (): Progress => ({
    ...progress,
    steps: progress.steps.map((step) => ({ ...step })),
  });
  const toolStep = (id: string) =>
    progress.steps.find(
      (step): step is ToolStep => step.type === "tool" && step.id === id,
    );

  /** Streams one agent's part of the answer. Returns who it handed off to, if anyone. */
  async function run(canHandOff: boolean): Promise<Agent | null> {
    const setup = agentSetup(agent, refunds, canHandOff);
    // Without tools, send no instructions either: "always use your tools" with
    // no tools makes the model answer with nothing.
    const result = callStream(setup.info, {
      messages,
      providerOptions: THOUGHT_SUMMARIES,
      ...(useTools && {
        instructions: setup.instructions,
        tools: setup.tools,
        stopWhen: [
          stepCountIs(MAX_STEPS),
          hasToolCall(...Object.keys(HANDOFF_TOOLS)),
        ],
      }),
    });
    let handoff: Agent | null = null;
    // Each agent's words start on a new paragraph.
    let firstWords = true;
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta": {
          const last = progress.steps.at(-1);
          if (last?.type === "thinking") last.text += part.text;
          else progress.steps.push({ type: "thinking", text: part.text });
          break;
        }
        case "tool-input-start":
          progress.steps.push({
            type: "tool",
            id: part.id,
            name: part.toolName,
            state: "calling",
          });
          break;
        case "tool-call": {
          const step = toolStep(part.toolCallId);
          if (step) step.input = part.input;
          else
            progress.steps.push({
              type: "tool",
              id: part.toolCallId,
              name: part.toolName,
              state: "calling",
              input: part.input,
            });
          if (part.toolName in HANDOFF_TOOLS)
            handoff = HANDOFF_TOOLS[part.toolName];
          break;
        }
        case "tool-result": {
          const step = toolStep(part.toolCallId);
          if (step) Object.assign(step, { output: part.output, state: "done" });
          break;
        }
        case "tool-error": {
          const step = toolStep(part.toolCallId);
          const message =
            part.error instanceof Error
              ? part.error.message
              : String(part.error);
          if (step) Object.assign(step, { output: message, state: "error" });
          break;
        }
        case "text-delta":
          if (firstWords && progress.reply.trim()) progress.reply += "\n\n";
          firstWords = false;
          progress.reply += part.text;
          break;
        case "error":
          throw part.error;
        default:
          continue;
      }
      update(snapshot());
    }
    return handoff === agent ? null : handoff;
  }

  // Read the stream in the background, so the panel gets the first update now.
  void (async () => {
    try {
      // At most one handoff per question, so the agents can't pass it back
      // and forth: the agent that takes over can't hand off again.
      const next = await run(Boolean(refunds));
      if (next && refunds && useTools) {
        progress.steps.push({ type: "handoff", from: agent, to: next });
        agent = next;
        progress.agent = agent;
        update(snapshot());
        await run(false);
      }
      progress.status = "done";
      if (!progress.reply.trim()) progress.reply = SORRY;
    } catch {
      progress.status = "error";
      if (!progress.reply.trim()) progress.reply = SORRY;
    }
    done(snapshot());
  })();

  return { progress: live };
}
