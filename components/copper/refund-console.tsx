"use client";

// Module 4: the Refund Console on the Support page. The auto-refund limit (a
// person sets it), refunds waiting for a person's decision, and the
// customer's orders with where each refund stands.
import { CheckIcon, ClockIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useRefundDesk } from "@/components/copper/refund-desk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CUSTOMER, type Order, usd } from "@/lib/copper/refunds";
import { cn } from "@/lib/utils";

export function RefundConsole() {
  const desk = useRefundDesk();
  if (!desk) return null;
  const { orders, limitUsd, limitText, setLimitText, decide } = desk;
  const waiting = orders.filter((o) => o.status === "waiting");

  return (
    <div className="mt-2 space-y-6">
      <p className="text-muted-foreground text-sm">
        Ask for a refund in the chat as the customer. Copper hands you to the
        Refund agent, which asks the app for the refund. The app checks the
        amount against your limit: at or under it, the refund goes through; over
        it, it waits here for you.
      </p>

      <section className="bg-card rounded-xl border p-4">
        <label htmlFor="refund-limit" className="text-sm font-semibold">
          Auto-refund limit
        </label>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-muted-foreground">$</span>
          <Input
            id="refund-limit"
            data-testid="refund-limit"
            type="number"
            min={0}
            step={1}
            inputMode="decimal"
            value={limitText}
            onChange={(event) => setLimitText(event.target.value)}
            className="w-32"
          />
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          Refunds up to {usd(limitUsd)} go through on their own. Anything larger
          needs your approval.
        </p>
      </section>

      <section data-testid="refund-queue">
        <h2 className="mb-2 text-lg font-semibold">
          Waiting for your approval
        </h2>
        {waiting.length === 0 ? (
          <p className="text-muted-foreground bg-card rounded-xl border p-4 text-sm">
            Nothing is waiting. Refunds over the limit will stop here.
          </p>
        ) : (
          <ul className="space-y-3">
            {waiting.map((order) => (
              <li
                key={order.id}
                className="border-chart-4 bg-chart-4/10 rounded-xl border-2 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">
                    <span className="text-muted-foreground font-mono">
                      #{order.id}
                    </span>{" "}
                    {order.item}
                  </p>
                  <p className="text-xl font-bold">{usd(order.amountUsd)}</p>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  Over the {usd(limitUsd)} limit
                  {order.reason ? ` · Reason: ${order.reason}` : ""}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => decide(order.id, "approve")}>
                    <CheckIcon /> Approve
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => decide(order.id, "reject")}
                  >
                    <XIcon /> Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="orders">
        <h2 className="mb-2 text-lg font-semibold">{CUSTOMER}&apos;s orders</h2>
        <ul className="bg-card divide-y rounded-xl border">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
            >
              <span className="text-muted-foreground font-mono text-sm">
                #{order.id}
              </span>
              <span className="flex-1 font-medium">{order.item}</span>
              <StatusPill order={order} />
              <span className="w-20 text-right font-mono">
                {usd(order.amountUsd)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatusPill({ order }: { order: Order }) {
  switch (order.status) {
    case "refunded":
      return (
        <Pill className="bg-accent text-white">
          <CheckIcon className="size-3" />
          {order.refundedBy === "person"
            ? "Refunded · approved by you"
            : "Refunded · automatic"}
        </Pill>
      );
    case "waiting":
      return (
        <Pill className="bg-chart-4 text-chart-5">
          <ClockIcon className="size-3" />
          Waiting for approval
        </Pill>
      );
    case "rejected":
      return (
        <Pill className="bg-chart-3 text-white">
          <XIcon className="size-3" />
          Refund rejected · kept
        </Pill>
      );
    default:
      return <Pill className="bg-muted text-muted-foreground">Paid</Pill>;
  }
}

function Pill({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}
