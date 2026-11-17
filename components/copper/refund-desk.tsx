"use client";

// Module 4: the Refund Console's state, shared by the console (left) and the
// Ask Copper chat (right) on the Support page. It holds the customer's orders
// and the auto-refund limit in the page itself, so there is no database: a
// reload starts the demo fresh.
// The chat reports each request_refund result here; Approve and Reject post
// the outcome back into the chat as a message from the Refund agent.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyDecision,
  DEFAULT_REFUND_LIMIT_USD,
  decisionNotice,
  ORDERS,
  type Order,
  type RefundDecision,
  resolveRefund,
} from "@/lib/copper/refunds";

type Desk = {
  orders: Order[];
  limitUsd: number;
  limitText: string;
  setLimitText: (text: string) => void;
  /** Acts on one request_refund result; the same call id is only applied once. */
  applyRefund: (callId: string, decision: unknown, reason?: string) => void;
  /** A person's decision on a refund that is over the limit. */
  decide: (orderId: string, choice: "approve" | "reject") => void;
  /** The chat listens here for messages to post. Returns an unsubscribe. */
  subscribe: (listener: (text: string) => void) => () => void;
};

const DeskContext = createContext<Desk | null>(null);

/** The Refund Console's state, or null outside the Support page. */
export function useRefundDesk() {
  return useContext(DeskContext);
}

const isDecision = (value: unknown): value is RefundDecision =>
  typeof value === "object" &&
  value !== null &&
  "status" in value &&
  "orderId" in value;

export function RefundDesk({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<Order[]>(ORDERS);
  const [limitText, setLimitText] = useState(String(DEFAULT_REFUND_LIMIT_USD));
  const applied = useRef(new Set<string>());
  const listeners = useRef(new Set<(text: string) => void>());

  const parsed = Number.parseFloat(limitText);
  const limitUsd =
    Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_REFUND_LIMIT_USD;

  const applyRefund = useCallback(
    (callId: string, decision: unknown, reason?: string) => {
      if (applied.current.has(callId) || !isDecision(decision)) return;
      applied.current.add(callId);
      setOrders((all) => applyDecision(all, decision, reason));
    },
    [],
  );

  const decide = useCallback(
    (orderId: string, choice: "approve" | "reject") => {
      const order = orders.find((o) => o.id === orderId);
      if (!order || order.status !== "waiting") return;
      setOrders((all) => resolveRefund(all, orderId, choice));
      const text = decisionNotice(order, choice);
      for (const listener of listeners.current) listener(text);
    },
    [orders],
  );

  const subscribe = useCallback((listener: (text: string) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const desk = useMemo(
    () => ({
      orders,
      limitUsd,
      limitText,
      setLimitText,
      applyRefund,
      decide,
      subscribe,
    }),
    [orders, limitUsd, limitText, applyRefund, decide, subscribe],
  );

  return <DeskContext.Provider value={desk}>{children}</DeskContext.Provider>;
}
