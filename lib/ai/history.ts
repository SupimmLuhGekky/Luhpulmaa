/**
 * Conversation history sent back to the assistant with a new question. The client keeps
 * it, so it's untrusted: normalise it into a valid, alternating exchange that starts with
 * the person's own message and ends with the new question.
 */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Most recent turns kept (the request schema caps the history too). */
export const MAX_HISTORY_TURNS = 12;

export function conversationFor(history: readonly ChatTurn[], question: string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const turn of [...history.slice(-MAX_HISTORY_TURNS), { role: "user" as const, content: question }]) {
    const content = turn.content.trim();
    if (!content) continue;
    // The exchange has to start with the person, not with an answer.
    if (!turns.length && turn.role === "assistant") continue;
    const last = turns[turns.length - 1];
    // Two messages in a row from the same side (an unanswered question, say) become one.
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${content}`;
    else turns.push({ role: turn.role, content });
  }
  return turns;
}
