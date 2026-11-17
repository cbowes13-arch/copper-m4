// Module 4 starter: the Support page is an empty Refund Console with Ask
// Copper already open beside it.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("Support page", () => {
  it("shows the Refund Console title, a Support link in the header, and the chat already open", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
    const { default: Support } = await import("@/app/support/page");
    render(<Support />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Refund Console" }),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("site-header")).getByRole("link", {
        name: "Support",
      }),
    ).toHaveAttribute("href", "/support");
    const chat = within(await screen.findByTestId("ask-copper"));
    expect(chat.getByLabelText("Your question")).toBeInTheDocument();
    expect(screen.queryByTestId("ask-copper-launcher")).toBeNull();
  });

  it("shows the setup card in the chat when there is no AI key", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    const { default: Support } = await import("@/app/support/page");
    render(<Support />);
    const chat = within(await screen.findByTestId("ask-copper"));
    expect(chat.queryByLabelText("Your question")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Refund Console" }),
    ).toBeVisible();
  });
});

// Module 4: the Refund Console. The chat's answer is faked (no AI key, no
// cost): the Refund agent's request_refund comes back over the limit.
describe("Refund Console", () => {
  async function renderWithRefundAnswer(orderId: string) {
    vi.resetModules();
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
    const { createLive } = await import("@/lib/ai/live");
    const { decideRefund, ORDERS } = await import("@/lib/copper/refunds");
    vi.doMock("@/lib/copper/assistant/ask", () => ({
      askCopper: async () => {
        const live = createLive<unknown>();
        live.done({
          status: "done",
          reply: "A team member will review it.",
          startAgent: "copper",
          agent: "refund",
          steps: [
            { type: "handoff", from: "copper", to: "refund" },
            {
              type: "tool",
              id: "c1",
              name: "request_refund",
              state: "done",
              input: { orderId },
              output: decideRefund({ orders: ORDERS, limitUsd: 50 }, orderId),
            },
          ],
        });
        return { progress: live.live };
      },
    }));
    const { default: Support } = await import("@/app/support/page");
    render(<Support />);
    const chat = within(await screen.findByTestId("ask-copper"));
    fireEvent.change(chat.getByLabelText("Your question"), {
      target: { value: "Refund my order" },
    });
    fireEvent.click(chat.getByRole("button", { name: "Send" }));
    return chat;
  }

  afterEach(() => {
    vi.doUnmock("@/lib/copper/assistant/ask");
    vi.resetModules();
  });

  it("shows the orders and a $50 auto-refund limit", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
    const { default: Support } = await import("@/app/support/page");
    render(<Support />);
    expect(screen.getByTestId("refund-limit")).toHaveValue(50);
    const orders = within(screen.getByTestId("orders"));
    expect(orders.getByText("Copper Home")).toBeVisible();
    expect(orders.getByText("$149.00")).toBeVisible();
  });

  it("holds a refund over the limit until Approve, then tells the customer", async () => {
    const chat = await renderWithRefundAnswer("1004");
    const queue = within(screen.getByTestId("refund-queue"));
    fireEvent.click(await queue.findByRole("button", { name: /approve/i }));
    expect(await chat.findByTestId("console-update")).toHaveTextContent(
      /approved/,
    );
    expect(
      within(screen.getByTestId("orders")).getByText(/approved by you/),
    ).toBeVisible();
  });

  it("Reject keeps the money, and the chat says so", async () => {
    const chat = await renderWithRefundAnswer("1003");
    const queue = within(screen.getByTestId("refund-queue"));
    fireEvent.click(await queue.findByRole("button", { name: /reject/i }));
    expect(await chat.findByTestId("console-update")).toHaveTextContent(
      /no money was refunded/,
    );
    expect(
      within(screen.getByTestId("orders")).getByText(/rejected/i),
    ).toBeVisible();
  });
});
