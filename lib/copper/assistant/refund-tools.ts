// Module 4: the Refund agent's tools, plus the handoff tools that pass the
// conversation between Copper and the Refund agent.
// The orders and the auto-refund limit live in the Refund Console (the page),
// and the chat sends them with each question, so the tools are built per
// question around that RefundContext.
import { tool } from "ai";
import { z } from "zod";
import { searchDocs, type DocMatch } from "@/lib/copper/assistant/tools";
import {
  CUSTOMER,
  decideRefund,
  usd,
  type RefundContext,
} from "@/lib/copper/refunds";

export type PurchaseHistory = {
  customer: string;
  orders: {
    orderId: string;
    item: string;
    amountUsd: number;
    orderedOn: string;
    status: string;
  }[];
};

export type RefundRules = {
  autoRefundLimitUsd: number;
  rule: string;
  /** Passages about refunds from the customer documents (Module 3's search). */
  matches: DocMatch[];
};

const STATUS_WORDS: Record<string, string> = {
  paid: "paid",
  waiting: "refund waiting for approval",
  refunded: "refunded",
  rejected: "refund declined",
};

/** get_purchase_history: the customer's orders and where each one stands. */
export function purchaseHistory({ orders }: RefundContext): PurchaseHistory {
  return {
    customer: CUSTOMER,
    orders: orders.map((o) => ({
      orderId: o.id,
      item: o.item,
      amountUsd: o.amountUsd,
      orderedOn: o.orderedOn,
      status: STATUS_WORDS[o.status] ?? o.status,
    })),
  };
}

/** The limit rule, in words the agent can repeat. */
export const limitRule = (limitUsd: number) =>
  `Refunds of ${usd(limitUsd)} or less go through automatically. Larger refunds wait in the Refund Console until a person approves or rejects them.`;

/** get_refund_rules: the auto-refund limit, plus the refund passages in the docs. */
export async function refundRules(
  { limitUsd }: RefundContext,
  item?: string,
): Promise<RefundRules> {
  let matches: DocMatch[] = [];
  try {
    const found = await searchDocs(
      `refund and return policy${item ? ` for ${item}` : ""}`,
    );
    matches = found.matches.slice(0, 3);
  } catch {
    // The limit rule still answers the question without the documents.
  }
  return { autoRefundLimitUsd: limitUsd, rule: limitRule(limitUsd), matches };
}

/** Copper's way to pass a refund request to the Refund agent. */
export const handoffToRefundAgent = {
  transfer_to_refund_agent: tool({
    description:
      "Hands the customer to the Refund agent. Use it whenever the customer wants money back, a refund, or to return something they bought.",
    inputSchema: z.object({}),
    execute: async () => ({
      handedOffTo: "Refund agent",
    }),
  }),
};

/** The Refund agent's tools, around the orders and limit sent with this question. */
export function refundTools(context: RefundContext, canHandBack: boolean) {
  return {
    get_purchase_history: tool({
      description:
        "Lists the customer's orders: order number, item, amount, date and status.",
      inputSchema: z.object({}),
      execute: async () => purchaseHistory(context),
    }),
    get_refund_rules: tool({
      description:
        "Gets Copper State Labs' refund rules: the auto-refund limit, and the refund passages from the customer documents.",
      inputSchema: z.object({
        item: z
          .string()
          .optional()
          .describe("The item the refund is for, e.g. 'Copper Home'."),
      }),
      execute: async ({ item }) => refundRules(context, item),
    }),
    request_refund: tool({
      description:
        "Asks the app to refund one order. The app decides: at or under the auto-refund limit it refunds now; over the limit it waits for a person to approve it. It also updates the order's status.",
      inputSchema: z.object({
        orderId: z.string().describe("The order number, e.g. '1004'."),
        reason: z
          .string()
          .optional()
          .describe("Why the customer wants the refund, in a few words."),
      }),
      execute: async ({ orderId }) => decideRefund(context, orderId),
    }),
    ...(canHandBack && {
      transfer_to_copper: tool({
        description:
          "Hands the customer back to Copper for anything that isn't a refund: products, prices, stock, setup or policy questions.",
        inputSchema: z.object({}),
        execute: async () => ({ handedOffTo: "Copper" }),
      }),
    }),
  };
}
