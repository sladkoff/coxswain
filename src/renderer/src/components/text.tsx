import { type ReactNode, useEffect, useId, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { GitProblem } from "../../../core/git";
import type { GitHubProblem } from "../../../core/github";
import { cn } from "./styles";

const code =
  "rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs select-text dark:bg-neutral-800";

// Markdown from GitHub or an agent, selectable. Links get target=_blank so the main process opens them in the browser.
// A mermaid code block is drawn as its diagram (ADR 0026). inline: no paragraphs and no wrapper, for a title.
export function Prose({
  children,
  inline,
  className,
}: {
  children: string;
  inline?: boolean;
  className?: string;
}) {
  const md = (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: (p) => <a {...p} target="_blank" />,
        pre: ({ node, ...p }) => {
          const code = node?.children[0];
          const mermaid =
            code?.type === "element" &&
            Array.isArray(code.properties.className) &&
            code.properties.className.includes("language-mermaid");
          const text = mermaid && code.children[0]?.type === "text" ? code.children[0].value : "";
          return mermaid ? <Mermaid code={text} /> : <pre {...p} />;
        },
        ...(inline && { p: (p) => <>{p.children}</> }),
      }}
    >
      {children}
    </Markdown>
  );
  return inline ? (
    md
  ) : (
    <div className={cn("markdown select-text [overflow-wrap:anywhere]", className)}>{md}</div>
  );
}

const dark = matchMedia("(prefers-color-scheme: dark)");

// A mermaid diagram, drawn as SVG once mermaid has loaded (it's big, so only when one shows). A diagram that doesn't
// parse shows its code and the error. ponytail: the theme is read when it's drawn, not followed live; redraw on
// dark.onchange if that's noticed.
function Mermaid({ code }: { code: string }) {
  const id = `mermaid-${useId().replace(/\W/g, "")}`;
  const [drawn, setDrawn] = useState<{ svg?: string; error?: string }>({});
  useEffect(() => {
    let live = true;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark.matches ? "dark" : "neutral",
          fontFamily: "system-ui, sans-serif",
        });
        // Parsed first: a failed render leaves mermaid's error graphic in the page.
        await mermaid.parse(code);
        const { svg } = await mermaid.render(id, code);
        if (live) setDrawn({ svg });
      })
      .catch((e: Error) => live && setDrawn({ error: e.message }));
    return () => void (live = false);
  }, [code]);
  if (drawn.error)
    return (
      <div className="mermaid">
        <pre>
          <code>{code}</code>
        </pre>
        <ErrorText>Diagram: {drawn.error}</ErrorText>
      </div>
    );
  return drawn.svg ? (
    <div
      className="mermaid my-2 flex justify-center [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: drawn.svg }}
    />
  ) : (
    <div className="mermaid text-xs text-neutral-500">Drawing the diagram…</div>
  );
}

export function ErrorText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-xs text-red-600 select-text dark:text-red-400", className)}>
      {children}
    </div>
  );
}

export function ProblemMessage({ problem }: { problem: GitHubProblem | GitProblem }) {
  switch (problem.status) {
    case "git-error":
      return <span className="select-text">Git: {problem.message}</span>;
    case "signed-out":
      return (
        <span>
          Not signed in. Run <code className={code}>gh auth login</code> in a terminal.
        </span>
      );
    case "gh-missing":
      return (
        <span>
          The GitHub CLI isn't installed. Run <code className={code}>brew install gh</code>, then{" "}
          <code className={code}>gh auth login</code>.
        </span>
      );
    case "error":
      return <span>Couldn't reach GitHub: {problem.message}</span>;
  }
}
