// Module 4: the customer's orders, and the rule that decides which refunds go
// through on their own. This is plain code, not AI: the Refund agent asks for a
// refund, and decideRefund() compares the amount with the auto-refund limit.
// Anything over the limit waits in the Refund Console for a person.
// No server-only imports, so the Refund Console (a client component) uses it too.

export type OrderStatus = "paid" | "waiting" | "refunded" | "rejected";

export type Order = {
  /** Like "1004". Shown as #1004. */
  id: string;
  item: string;
  amountUsd: number;
  /** YYYY-MM-DD */
  orderedOn: string;
  status: OrderStatus;
  /** Who refunded it: the app on its own, or a person in the Refund Console. */
  refundedBy?: "auto" | "person";
  /** Why the customer asked, in their words. */
  reason?: string;
};

/** The customer chatting on the Support page. */
export const CUSTOMER = "Maya Reyes";

/** Refunds at or under this many dollars go through without a person. */
export const DEFAULT_REFUND_LIMIT_USD = 50;

export const ORDERS: Order[] = [
  {
    id: "1001",
    item: "Copper Plus, monthly",
    amountUsd: 7.99,
    orderedOn: "2026-11-02",
    status: "paid",
  },
  {
    id: "1002",
    item: "Copper Plus, annual",
    amountUsd: 79,
    orderedOn: "2026-11-10",
    status: "paid",
  },
  {
    id: "1003",
    item: "Copper Notes",
    amountUsd: 129,
    orderedOn: "2026-11-05",
    status: "paid",
  },
  {
    id: "1004",
    item: "Copper Home",
    amountUsd: 149,
    orderedOn: "2026-11-12",
    status: "paid",
  },
];

/** What the Refund agent's tools can see: the orders and the current limit. */
export type RefundContext = { orders: Order[]; limitUsd: number };

type Found = { orderId: string; item: string; amountUsd: number };

export type RefundDecision =
  | (Found & { status: "refunded"; limitUsd: number; message: string })
  | (Found & {
      status: "waiting_for_approval";
      limitUsd: number;
      message: string;
    })
  | (Found & {
      status: "already_refunded" | "already_waiting" | "already_rejected";
      message: string;
    })
  | { status: "not_found"; orderId: string; message: string };

/** "#1004", " 1004 " and "1004" are the same order. */
export const orderIdOf = (id: string) => id.trim().replace(/^#/, "");

export const usd = (amount: number) =>
  amount.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * The decision made by code: at or under the limit, refund now; over it,
 * wait for a person. Orders already handled aren't refunded twice.
 */
export function decideRefund(
  { orders, limitUsd }: RefundContext,
  orderId: string,
): RefundDecision {
  const id = orderIdOf(orderId);
  const order = orders.find((o) => o.id === id);
  if (!order) {
    return {
      status: "not_found",
      orderId: id,
      message: `There is no order #${id}. Check the purchase history.`,
    };
  }
  const found = { orderId: id, item: order.item, amountUsd: order.amountUsd };
  if (order.status === "refunded")
    return {
      ...found,
      status: "already_refunded",
      message: `Order #${id} has already been refunded.`,
    };
  if (order.status === "waiting")
    return {
      ...found,
      status: "already_waiting",
      message: `The refund for order #${id} is already waiting for a person to approve it.`,
    };
  if (order.status === "rejected")
    return {
      ...found,
      status: "already_rejected",
      message: `A person already reviewed and declined the refund for order #${id}.`,
    };
  if (order.amountUsd <= limitUsd)
    return {
      ...found,
      status: "refunded",
      limitUsd,
      message: `Refunded ${usd(order.amountUsd)} automatically: it is within the ${usd(limitUsd)} auto-refund limit.`,
    };
  return {
    ...found,
    status: "waiting_for_approval",
    limitUsd,
    message: `${usd(order.amountUsd)} is over the ${usd(limitUsd)} auto-refund limit, so a person must approve it in the Refund Console. Nothing has been refunded yet.`,
  };
}

/** The orders after the app acts on a decision from request_refund. */
export function applyDecision(
  orders: Order[],
  decision: RefundDecision,
  reason?: string,
): Order[] {
  if (
    decision.status !== "refunded" &&
    decision.status !== "waiting_for_approval"
  )
    return orders;
  return orders.map((order) =>
    order.id !== decision.orderId || order.status !== "paid"
      ? order
      : decision.status === "refunded"
        ? { ...order, status: "refunded", refundedBy: "auto", reason }
        : { ...order, status: "waiting", reason },
  );
}

/** The decision made by a person: Approve refunds it, Reject keeps the money. */
export function resolveRefund(
  orders: Order[],
  orderId: string,
  choice: "approve" | "reject",
): Order[] {
  return orders.map((order) =>
    order.id !== orderId || order.status !== "waiting"
      ? order
      : choice === "approve"
        ? { ...order, status: "refunded", refundedBy: "person" }
        : { ...order, status: "rejected" },
  );
}

/** What the Refund agent tells the customer in the chat after a person decides. */
export function decisionNotice(order: Order, choice: "approve" | "reject") {
  return choice === "approve"
    ? `Good news! Your refund of ${usd(order.amountUsd)} for ${order.item} (order #${order.id}) was approved, and the money is on its way back to you.`
    : `I'm sorry: your refund request for ${order.item} (order #${order.id}, ${usd(order.amountUsd)}) was reviewed and declined, so no money was refunded. If you have questions, contact the Copper Crew in the Copper app (Settings > Help).`;
}
