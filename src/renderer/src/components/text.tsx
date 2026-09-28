import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { GitProblem } from "../../../core/git";
import type { GitHubProblem } from "../../../core/github";
import { cn } from "./styles";

const code =
  "rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs select-text dark:bg-neutral-800";

// These are component types, not callbacks: defining them inside Prose would remount every diagram
// whenever its parent renders (opening the command palette, scrolling between sections, …).
const components: Components = {
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
};
const inlineComponents: Components = { ...components, p: (p) => <>{p.children}</> };

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
    <Markdown remarkPlugins={[remarkGfm]} components={inline ? inlineComponents : components}>
      {children}
    </Markdown>
  );
  return inline ? (
    md
  ) : (
    <div className={cn("markdown select-text [overflow-wrap:anywhere]", className)}>{md}</div>
  );
}

// The system theme, followed live: diagrams are drawn again when it changes.
const dark = matchMedia("(prefers-color-scheme: dark)");
const subscribeDark = (onChange: () => void) => {
  dark.addEventListener("change", onChange);
  return () => dark.removeEventListener("change", onChange);
};

// Draws a mermaid diagram as SVG, loading mermaid first (it's big, so only when one shows). Throws mermaid's error for a
// diagram that doesn't parse or draw. Parsed first: a failed render leaves mermaid's error graphic in the page.
let drawn = 0;
async function drawDiagram(code: string, isDark: boolean): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: isDark ? "dark" : "neutral",
    fontFamily: "system-ui, sans-serif",
  });
  await mermaid.parse(code);
  return (await mermaid.render(`mermaid-${++drawn}`, code)).svg;
}

// ADR 0026: the view tools check the agent's diagrams by drawing them here before they're saved, so the agent hears
// of one that doesn't draw.
window.coxswain.onCheckDiagrams(async (codes) => {
  const errors: (string | null)[] = [];
  for (const code of codes)
    errors.push(
      await drawDiagram(code, dark.matches).then(
        () => null,
        (e: Error) => e.message,
      ),
    );
  return errors;
});

// A mermaid diagram, drawn as SVG in the system theme. One that doesn't draw shows its code and the error.
function Mermaid({ code }: { code: string }) {
  const isDark = useSyncExternalStore(subscribeDark, () => dark.matches);
  const [result, setResult] = useState<{ svg?: string; error?: string }>({});
  useEffect(() => {
    let live = true;
    drawDiagram(code, isDark).then(
      (svg) => live && setResult({ svg }),
      (e: Error) => live && setResult({ error: e.message }),
    );
    return () => void (live = false);
  }, [code, isDark]);
  if (result.error)
    return (
      <div className="mermaid">
        <pre>
          <code>{code}</code>
        </pre>
        <ErrorText>Diagram: {result.error}</ErrorText>
      </div>
    );
  return result.svg ? (
    <div
      className="mermaid my-2 flex justify-center [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: result.svg }}
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
