// Module 4: refunds. The limit rule and a person's decision are plain code;
// the handoff from Copper to the Refund agent runs with a mock model, so these
// tests need no AI key and cost nothing.
import type { LanguageModelV4StreamPart as ModelStreamPart } from "@ai-sdk/provider";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finalValue } from "@/lib/ai/live";
import { toolCallsOf } from "@/lib/copper/assistant/progress";
import {
  applyDecision,
  decideRefund,
  decisionNotice,
  ORDERS,
  resolveRefund,
} from "@/lib/copper/refunds";

describe("the auto-refund limit (code decides)", () => {
  const context = { orders: ORDERS, limitUsd: 50 };

  it("refunds an order at or under the limit right away", () => {
    const decision = decideRefund(context, "#1001");
    expect(decision.status).toBe("refunded");
    const orders = applyDecision(ORDERS, decision, "Not using it");
    expect(orders.find((o) => o.id === "1001")).toMatchObject({
      status: "refunded",
      refundedBy: "auto",
    });
  });

  it("holds an order over the limit for a person, refunding nothing", () => {
    const decision = decideRefund(context, "1004");
    expect(decision.status).toBe("waiting_for_approval");
    const orders = applyDecision(ORDERS, decision);
    expect(orders.find((o) => o.id === "1004")?.status).toBe("waiting");
  });

  it("follows the limit when it changes", () => {
    expect(decideRefund({ orders: ORDERS, limitUsd: 150 }, "1004").status).toBe(
      "refunded",
    );
    expect(decideRefund({ orders: ORDERS, limitUsd: 5 }, "1001").status).toBe(
      "waiting_for_approval",
    );
  });

  it("never refunds the same order twice, and reports unknown orders", () => {
    const refunded = applyDecision(ORDERS, decideRefund(context, "1001"));
    expect(decideRefund({ ...context, orders: refunded }, "1001").status).toBe(
      "already_refunded",
    );
    expect(decideRefund(context, "9999").status).toBe("not_found");
  });
});

describe("Approve and Reject (a person decides)", () => {
  const waiting = applyDecision(
    ORDERS,
    decideRefund({ orders: ORDERS, limitUsd: 50 }, "1003"),
  );

  it("Approve refunds it", () => {
    const order = resolveRefund(waiting, "1003", "approve").find(
      (o) => o.id === "1003",
    );
    expect(order).toMatchObject({ status: "refunded", refundedBy: "person" });
    expect(decisionNotice(order!, "approve")).toMatch(/approved/);
  });

  it("Reject keeps the money and tells the customer", () => {
    const order = resolveRefund(waiting, "1003", "reject").find(
      (o) => o.id === "1003",
    );
    expect(order?.status).toBe("rejected");
    expect(decisionNotice(order!, "reject")).toMatch(/no money was refunded/);
  });
});

// ---------------------------------------------------------------------------
// The handoff, with a mock model
// ---------------------------------------------------------------------------

let model: MockLanguageModelV4;
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => model,
}));

type StreamPart = Parameters<
  typeof convertArrayToReadableStream<ModelStreamPart>
>[0][number];

const usage = {
  inputTokens: {
    total: 500,
    noCache: 500,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 50, text: 50, reasoning: undefined },
};
const finish = (reason: "stop" | "tool-calls") => ({
  type: "finish" as const,
  finishReason: { unified: reason, raw: undefined },
  usage,
});
const calls = (toolName: string, input: unknown, id: string): StreamPart[] => [
  { type: "tool-input-start", id, toolName },
  { type: "tool-input-delta", id, delta: JSON.stringify(input) },
  { type: "tool-input-end", id },
  { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) },
  finish("tool-calls"),
];
const says = (text: string): StreamPart[] => [
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: text },
  { type: "text-end", id: "t1" },
  finish("stop"),
];

/** Each model step streams the next of `steps`, across both agents. */
function modelStreaming(...steps: StreamPart[][]) {
  let step = 0;
  const prompts: string[] = [];
  const mock = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(JSON.stringify(options.prompt[0]));
      return {
        stream: convertArrayToReadableStream(steps[step++] ?? says("")),
      };
    },
  });
  return { mock, prompts };
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Copper hands refund requests to the Refund agent", () => {
  it("passes the question to the Refund agent, whose request_refund holds a large refund", async () => {
    const { mock, prompts } = modelStreaming(
      calls("transfer_to_refund_agent", {}, "c1"),
      calls("get_purchase_history", {}, "c2"),
      calls("request_refund", { orderId: "1004", reason: "Broken" }, "c3"),
      says("A team member will review your refund."),
    );
    model = mock;
    const { askCopper } = await import("@/lib/copper/assistant/ask");
    const progress = await finalValue(
      (
        await askCopper({
          messages: [
            {
              role: "user",
              content: "I want my money back for my Copper Home.",
            },
          ],
          useTools: true,
          refunds: { orders: ORDERS, limitUsd: 50 },
        })
      ).progress,
    );

    expect(progress.status).toBe("done");
    expect(progress.agent).toBe("refund");
    expect(progress.steps).toContainEqual({
      type: "handoff",
      from: "copper",
      to: "refund",
    });
    const tools = toolCallsOf(progress);
    expect(tools.map((t) => t.name)).toEqual([
      "transfer_to_refund_agent",
      "get_purchase_history",
      "request_refund",
    ]);
    expect(tools[2].output).toMatchObject({
      status: "waiting_for_approval",
      orderId: "1004",
    });
    // Copper's instructions first, then the Refund agent's own.
    expect(prompts[0]).toContain("You are Copper");
    expect(prompts[1]).toContain("You are the Refund agent");
  });

  it("keeps Copper on its own, with no handoff tool, off the Support page", async () => {
    const { mock } = modelStreaming(says("Hi!"));
    model = mock;
    const { askCopper } = await import("@/lib/copper/assistant/ask");
    const progress = await finalValue(
      (
        await askCopper({
          messages: [{ role: "user", content: "I want a refund" }],
          useTools: true,
        })
      ).progress,
    );
    expect(progress.agent).toBe("copper");
    const tools = Object.keys(
      (mock.doStreamCalls[0].tools ?? []).reduce(
        (all, t) => ({ ...all, [t.name]: true }),
        {} as Record<string, boolean>,
      ),
    );
    expect(tools).not.toContain("transfer_to_refund_agent");
  });
});

describe("when Gemini's free limit is used up", () => {
  it("tells the customer plainly instead of a vague error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    model = new MockLanguageModelV4({
      doStream: async () => {
        throw Object.assign(new Error("Resource has been exhausted"), {
          statusCode: 429,
        });
      },
    });
    const { askCopper } = await import("@/lib/copper/assistant/ask");
    const progress = await finalValue(
      (
        await askCopper({
          messages: [{ role: "user", content: "Refund my Copper Home" }],
          useTools: true,
          refunds: { orders: ORDERS, limitUsd: 50 },
        })
      ).progress,
    );
    expect(progress.status).toBe("error");
    expect(progress.reply).toMatch(/free Gemini usage limit/);
  });
});
