"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUp, Calculator, RotateCcw, Search, Sparkles, TriangleAlert, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssistantAnswer } from "@/lib/ai/assistant";
import type { ChatTurn } from "@/lib/ai/history";
import { AnswerText } from "./answer-text";

const MAX_QUESTION = 1000;

type Message = { id: number; role: "user"; content: string } | { id: number; role: "assistant"; answer: AssistantAnswer } | { id: number; role: "error"; message: string; question: string };

const SUGGESTIONS = [
  "How much did I spend on restaurants last month?",
  "Am I on track with this month's budget?",
  "Which bills are due in the next two weeks?",
  "How much is safe to spend until payday?",
  "How are my savings goals doing?",
  "What subscriptions am I paying for?",
];

/** History sent with a new question: the person's questions and the assistant's own answers. */
function historyOf(messages: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of messages) {
    if (m.role === "user") turns.push({ role: "user", content: m.content });
    else if (m.role === "assistant" && m.answer.source === "ai") turns.push({ role: "assistant", content: m.answer.answer.slice(0, 4000) });
  }
  return turns.slice(-12);
}

export function AssistantChat({ toolLabels }: { toolLabels: Record<string, string> }) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [question, setQuestion] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const nextId = React.useRef(1);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const footerRef = React.useRef<HTMLParagraphElement>(null);
  const lastQuestionRef = React.useRef<HTMLLIElement>(null);
  const lastQuestionId = messages.findLast((m) => m.role === "user")?.id;
  const lastRole = messages.at(-1)?.role;

  // While waiting, keep the question and the indicator in view just above the composer.
  React.useEffect(() => {
    if (pending) footerRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [pending]);

  // When the reply arrives, bring its question to the top so a long answer reads from the start.
  React.useEffect(() => {
    if (lastRole === "assistant" || lastRole === "error") lastQuestionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [messages.length, lastRole]);

  // Grow the box with its content, up to a limit.
  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [question]);

  // Not on touch screens, where focusing opens the keyboard over the answer.
  const focusInput = () => {
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus({ preventScroll: true });
  };

  const ask = async (text: string, opts: { retryOf?: number } = {}) => {
    const q = text.trim();
    if (!q || pending) return;
    const history = historyOf(messages.filter((m) => m.id !== opts.retryOf));
    setMessages((ms) => [...ms.filter((m) => m.id !== opts.retryOf), ...(opts.retryOf ? [] : [{ id: nextId.current++, role: "user" as const, content: q }])]);
    setQuestion("");
    setPending(true);
    let next: Message;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: opts.retryOf ? history.slice(0, -1) : history }),
      });
      const body = (await res.json().catch(() => null)) as { data?: AssistantAnswer; error?: { message?: string } } | null;
      if (res.ok && body?.data) next = { id: nextId.current++, role: "assistant", answer: body.data };
      else next = { id: nextId.current++, role: "error", message: body?.error?.message ?? "The assistant couldn't answer. Please try again.", question: q };
    } catch {
      next = { id: nextId.current++, role: "error", message: "Couldn't reach Harbour. Check your connection and try again.", question: q };
    }
    setMessages((ms) => [...ms, next]);
    setPending(false);
    requestAnimationFrame(focusInput);
  };

  const reset = () => {
    setMessages([]);
    setQuestion("");
    focusInput();
  };

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 && !pending ? (
        <section aria-labelledby="assistant-try" className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
          <h2 id="assistant-try" className="text-sm font-semibold text-foreground">
            Try asking
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => ask(s)}
                  className="flex h-full w-full items-start gap-2 rounded-lg border border-border bg-subtle/50 px-3 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Search className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {messages.length || pending ? (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Harbour doesn&apos;t save this conversation.</p>
          <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
            <RotateCcw /> New conversation
          </Button>
        </div>
      ) : null}

      {messages.length || pending ? (
        <ol className="space-y-5" aria-live="polite" aria-busy={pending}>
          {messages.map((m) => (
            <li key={m.id} ref={m.id === lastQuestionId ? lastQuestionRef : undefined} className="scroll-mt-20">
              {m.role === "user" ? (
                <UserBubble text={m.content} />
              ) : m.role === "assistant" ? (
                <AnswerCard answer={m.answer} toolLabels={toolLabels} />
              ) : (
                <ErrorCard message={m.message} onRetry={() => ask(m.question, { retryOf: m.id })} disabled={pending} />
              )}
            </li>
          ))}
          {pending ? (
            <li>
              <div className="flex gap-3">
                <AssistantAvatar />
                <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground shadow-soft">
                  <span className="flex gap-1" aria-hidden>
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                  </span>
                  Looking at your data…
                </div>
              </div>
            </li>
          ) : null}
        </ol>
      ) : null}

      <form
        className="rounded-xl border border-border bg-card p-2 shadow-soft focus-within:border-ring md:sticky md:bottom-4"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="assistant-question" className="sr-only">
          Your question
        </label>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            id="assistant-question"
            rows={1}
            value={question}
            maxLength={MAX_QUESTION}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(question);
              }
            }}
            placeholder="Ask about your spending, budget, bills or goals…"
            className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <Button type="submit" size="icon" disabled={!question.trim() || pending} aria-label="Send question">
            <ArrowUp />
          </Button>
        </div>
        {question.length > MAX_QUESTION - 200 ? <p className="px-2 pb-1 text-right text-[11px] text-muted-foreground tabular">{MAX_QUESTION - question.length} characters left</p> : null}
      </form>
      <p ref={footerRef} className="scroll-mb-20 text-xs leading-relaxed text-muted-foreground md:scroll-mb-6">
        Read-only: the assistant can look at your Harbour data but can&apos;t move money, change anything or contact anyone. Answers are information, not financial advice. Your questions and the
        details it looks up are sent to Anthropic to write the answer.{" "}
        <Link href="/settings/privacy#ai" className="font-medium text-foreground underline-offset-4 hover:underline">
          AI settings
        </Link>
      </p>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden>
      <Sparkles className="size-4" />
    </span>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end gap-3">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        <span className="sr-only">You asked: </span>
        {text}
      </p>
      <span className="hidden size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground sm:flex" aria-hidden>
        <UserRound className="size-4" />
      </span>
    </div>
  );
}

function AnswerCard({ answer, toolLabels }: { answer: AssistantAnswer; toolLabels: Record<string, string> }) {
  const tools = [...new Set(answer.toolsUsed)].map((t) => toolLabels[t] ?? t);
  const unavailable = answer.source === "unavailable";
  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 space-y-3">
        <div className={cn("rounded-xl border bg-card p-4 shadow-soft", unavailable ? "border-warning/30" : "border-border")}>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {unavailable ? <TriangleAlert className="size-3.5 text-warning" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
            {unavailable ? "Assistant unavailable" : "Explanation · written by AI"}
          </p>
          <AnswerText text={answer.answer} />
        </div>
        {answer.facts.length ? (
          <section className="overflow-hidden rounded-xl border border-border bg-subtle/60" aria-label="Facts from your data">
            <p className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Calculator className="size-3.5" aria-hidden /> From your data · calculated by Harbour
            </p>
            <dl className="divide-y divide-border">
              {answer.facts.map((f, i) => (
                <div key={`${f.label}-${i}`} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                  <dt className="min-w-0 text-[13px] text-foreground">
                    {f.label}
                    {f.basis ? <span className="block text-xs text-muted-foreground">{f.basis}</span> : null}
                  </dt>
                  <dd className="shrink-0 text-sm font-semibold tabular text-foreground sm:text-right">{f.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        {tools.length ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Looked at:</span> {tools.join(" · ")}
          </p>
        ) : !unavailable ? (
          <p className="text-xs text-muted-foreground">No data was looked up for this answer.</p>
        ) : null}
      </div>
    </div>
  );
}

function ErrorCard({ message, onRetry, disabled }: { message: string; onRetry: () => void; disabled: boolean }) {
  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <div
        role="alert"
        className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-foreground sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          {message}
        </span>
        <Button variant="outline" size="sm" onClick={onRetry} disabled={disabled} className="shrink-0 self-start sm:self-auto">
          Try again
        </Button>
      </div>
    </div>
  );
}
