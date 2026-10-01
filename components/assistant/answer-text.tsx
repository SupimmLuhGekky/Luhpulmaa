import * as React from "react";

type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] } | { kind: "h"; text: string };

/** Splits plain text with light Markdown into paragraphs, lists and headings. */
export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  // The block being built; a holder object so TypeScript doesn't narrow it across flush().
  const open: { block: Block | null } = { block: null };
  const flush = () => {
    if (open.block) blocks.push(open.block);
    open.block = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    const item = /^[-*•]\s+(.+)$/.exec(line) ?? /^\d{1,2}[.)]\s+(.+)$/.exec(line);
    const kind = /^[-*•]\s/.test(line) ? "ul" : "ol";
    const current = open.block;
    if (heading) {
      flush();
      blocks.push({ kind: "h", text: heading[1] });
    } else if (item) {
      if (current && current.kind === kind) current.items.push(item[1]);
      else {
        flush();
        open.block = { kind, items: [item[1]] };
      }
    } else if (current && current.kind === "p") {
      current.lines.push(line);
    } else {
      flush();
      open.block = { kind: "p", lines: [line] };
    }
  }
  flush();
  return blocks;
}

/** **bold** and `code` inside a line; everything else stays plain text (never HTML). */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={i} className="rounded bg-muted px-1 py-px text-[0.9em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

/** The assistant's written explanation. */
export function AnswerText({ text }: { text: string }) {
  const blocks = parseAnswer(text);
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-foreground">
      {blocks.map((b, i) =>
        b.kind === "h" ? (
          <p key={i} className="font-semibold">
            <Inline text={b.text} />
          </p>
        ) : b.kind === "p" ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <React.Fragment key={j}>
                {j > 0 ? <br /> : null}
                <Inline text={l} />
              </React.Fragment>
            ))}
          </p>
        ) : b.kind === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
            {b.items.map((item, j) => (
              <li key={j}>
                <Inline text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">
            {b.items.map((item, j) => (
              <li key={j}>
                <Inline text={item} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}
