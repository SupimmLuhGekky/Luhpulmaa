import { describe, expect, it } from "vitest";
import { conversationFor, MAX_HISTORY_TURNS, type ChatTurn } from "@/lib/ai/history";
import { parseAnswer } from "@/components/assistant/answer-text";

describe("assistant conversation history", () => {
  it("ends with the new question after the previous exchange", () => {
    const history: ChatTurn[] = [
      { role: "user", content: "How much did I spend on groceries?" },
      { role: "assistant", content: "$412 this month." },
    ];
    expect(conversationFor(history, "And last month?")).toEqual([...history, { role: "user", content: "And last month?" }]);
  });

  it("starts with the person's message and skips empty turns", () => {
    expect(
      conversationFor(
        [
          { role: "assistant", content: "Hi! Ask me anything." },
          { role: "user", content: "   " },
          { role: "user", content: "Budget status?" },
          { role: "assistant", content: "On track." },
        ],
        "Thanks, and bills?",
      ),
    ).toEqual([
      { role: "user", content: "Budget status?" },
      { role: "assistant", content: "On track." },
      { role: "user", content: "Thanks, and bills?" },
    ]);
  });

  it("merges consecutive turns from the same side, such as an unanswered question", () => {
    expect(conversationFor([{ role: "user", content: "First question" }], "Second question")).toEqual([{ role: "user", content: "First question\n\nSecond question" }]);
  });

  it("keeps only the most recent turns", () => {
    const history: ChatTurn[] = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn ${i}` }));
    const out = conversationFor(history, "latest");
    expect(out.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS + 1);
    expect(out[0].role).toBe("user");
    expect(out.at(-1)).toEqual({ role: "user", content: "latest" });
    expect(out.slice(0, -1).map((t) => t.content)).toEqual(history.slice(-MAX_HISTORY_TURNS).map((t) => t.content));
  });
});

describe("assistant answer formatting", () => {
  it("splits paragraphs, bullet and numbered lists and headings", () => {
    const text = "You spent **$412** on groceries.\nThat's 8% less.\n\n## Biggest stores\n- Metro: $210\n* IGA: $120\n\n1. Cook at home\n2) Plan meals";
    expect(parseAnswer(text)).toEqual([
      { kind: "p", lines: ["You spent **$412** on groceries.", "That's 8% less."] },
      { kind: "h", text: "Biggest stores" },
      { kind: "ul", items: ["Metro: $210", "IGA: $120"] },
      { kind: "ol", items: ["Cook at home", "Plan meals"] },
    ]);
  });

  it("keeps markup as text and ignores blank input", () => {
    expect(parseAnswer("<b>hi</b>")).toEqual([{ kind: "p", lines: ["<b>hi</b>"] }]);
    expect(parseAnswer("  \n\n ")).toEqual([]);
  });
});
