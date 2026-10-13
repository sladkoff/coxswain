import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { match } from "ts-pattern";
import type { GitProblem } from "../../../core/git";
import type { ForgeKind, ForgeProblem } from "../../../core/forge";
import { useForgeNames } from "../forge";
import { cn } from "./styles";

const code =
  "rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs select-text dark:bg-neutral-800";

// These are component types, not callbacks: defining them inside Prose would remount every diagram
// whenever its parent renders (opening the command palette, scrolling between sections, …).
const components: Components = {
  a: (p) => <a {...p} target="_blank" />,
  pre: ({ node, ...p }) => {
    const code = node?.children[0];
    const classes = code?.type === "element" ? code.properties.className : undefined;
    const language =
      (["mermaid", "diff"] as const).find(
        (l) => Array.isArray(classes) && classes.includes(`language-${l}`),
      ) ?? null;
    const text =
      code?.type === "element" && code.children[0]?.type === "text" ? code.children[0].value : "";
    return match(language)
      .with("mermaid", () => <Mermaid code={text} />)
      .with("diff", () => <DiffSketch text={text} />)
      .with(null, () => <pre {...p} />)
      .exhaustive();
  },
};

// A diff in prose, e.g. a view's sketch of how a call tree changed (the pr skill's shaped diff): lines added green,
// removed red, hunk headers muted, as a file diff shows them.
function DiffSketch({ text }: { text: string }) {
  return (
    <pre>
      {/* As wide as the longest line, so a line's colour runs on when the block scrolls sideways. */}
      <code className="inline-block min-w-full">
        {text
          .replace(/\n$/, "")
          .split("\n")
          .map((line, i) => (
            <span
              key={i}
              className={cn(
                "-mx-2 block px-2",
                match(line[0])
                  .with("+", () => "bg-green-500/15 text-green-800 dark:text-green-300")
                  .with("-", () => "bg-red-500/15 text-red-800 dark:text-red-300")
                  .with("@", () => "text-neutral-500")
                  .otherwise(() => ""),
              )}
            >
              {line || " "}
            </span>
          ))}
      </code>
    </pre>
  );
}
const inlineComponents: Components = { ...components, p: (p) => <>{p.children}</> };

// ADR 0036: with blockEnd, each top-level block (a paragraph, a list, a table, a diagram) is marked data-block with
// its index, and blockEnd's node for it renders right after it: a view's threads on prose.
type Hast = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children: Hast[];
};
const markBlocks = () => (tree: Hast) => {
  let i = 0;
  tree.children = tree.children.map((el) =>
    el.type !== "element"
      ? el
      : {
          type: "element",
          tagName: "prose-block",
          properties: { block: i },
          children: [{ ...el, properties: { ...el.properties, dataBlock: i++ } }],
        },
  );
};
// HTML in markdown (GitHub's <details>, links, comments from bots) is read as HTML, then cut down to what GitHub itself
// allows in a comment, so it shows as it does there and nothing else gets in.
const html = [rehypeRaw, rehypeSanitize];
const BlockEnd = createContext<((block: number) => ReactNode) | undefined>(undefined);
const blockComponents = {
  ...components,
  "prose-block": ({ block, children }: { block: number; children: ReactNode }) => (
    <>
      {children}
      {useContext(BlockEnd)?.(Number(block))}
    </>
  ),
} as Components;

// Markdown from GitHub or an agent, with the HTML GitHub allows, selectable. Links get target=_blank so the main process opens them in the browser.
// A mermaid code block is drawn as its diagram (ADR 0026). inline: no paragraphs and no wrapper, for a title.
export function Prose({
  children,
  inline,
  className,
  blockEnd,
}: {
  children: string;
  inline?: boolean;
  className?: string;
  blockEnd?: (block: number) => ReactNode;
}) {
  const md = (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={blockEnd ? [...html, markBlocks] : html}
      components={inline ? inlineComponents : blockEnd ? blockComponents : components}
    >
      {children}
    </Markdown>
  );
  return inline ? (
    md
  ) : (
    <div className={cn("markdown select-text [overflow-wrap:anywhere]", className)}>
      <BlockEnd.Provider value={blockEnd}>{md}</BlockEnd.Provider>
    </div>
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

// ADR 0041: each forge's CLI, which coxswain gets its token from, and how to sign in to a host with it.
const clis: Record<ForgeKind, { forge: string; cli: string; login: (host: string) => string }> = {
  github: { forge: "GitHub", cli: "gh", login: () => "gh auth login" },
  gitlab: { forge: "GitLab", cli: "glab", login: (host) => `glab auth login --hostname ${host}` },
};

// What to do about a forge's problem, as a sentence: for a sheet or an error's message.
export const problemText = (p: ForgeProblem) =>
  match(p)
    .with({ status: "error" }, (p) => p.message)
    .otherwise((p) => `Sign in to ${p.host} with ${clis[p.forge].login(p.host)}`);

export function ProblemMessage({ problem }: { problem: ForgeProblem | GitProblem }) {
  const names = useForgeNames();
  return match(problem)
    .with({ status: "git-error" }, (p) => <span className="select-text">Git: {p.message}</span>)
    .with({ status: "signed-out" }, (p) => (
      <span>
        Not signed in to {p.host}. Run <code className={code}>{clis[p.forge].login(p.host)}</code>{" "}
        in a terminal.
      </span>
    ))
    .with({ status: "cli-missing" }, (p) => (
      <span>
        The {clis[p.forge].forge} CLI isn't installed. Run{" "}
        <code className={code}>brew install {clis[p.forge].cli}</code>, then{" "}
        <code className={code}>{clis[p.forge].login(p.host)}</code>.
      </span>
    ))
    .with({ status: "error" }, (p) => (
      <span>
        Couldn't reach {names.forge}: {p.message}
      </span>
    ))
    .exhaustive();
}
