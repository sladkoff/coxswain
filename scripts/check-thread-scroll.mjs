// Run against a development app started with REMOTE_DEBUGGING_PORT=9222 pnpm dev.
// Uses synthetic file/thread data in an isolated overlay; never sends an agent message.
import assert from "node:assert/strict";

const pages = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = pages.find(
  (candidate) => candidate.type === "page" && candidate.url.startsWith("http://localhost:"),
);
assert.ok(page, "Start the development app with REMOTE_DEBUGGING_PORT=9222");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
try {
  const response = new Promise((resolve, reject) => {
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id === 1) resolve(message.result);
    });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(async () => { const run = ${checkThreadScroll.toString()}; const results = []; for (const mode of ["unified", "split", "file", "prose"]) results.push(await run(mode)); return results; })()`,
        awaitPromise: true,
        returnByValue: true,
      },
    }),
  );
  const result = await response;
  assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
  for (const row of result.result.value) {
    console.log(row);
    assert.ok(row.stable, `${row.mode}: follow-up moved the reading position`);
  }
} finally {
  socket.close();
}

async function checkThreadScroll(mode) {
  const main = await (await fetch("/src/main.tsx")).text();
  const path = (name) => main.match(new RegExp('from "([^" ]*deps/' + name + '\\.js[^" ]*)"'))[1];
  const { createElement: h } = (await import(path("react"))).default;
  const { createRoot } = (await import(path("react-dom_client"))).default;
  const { QueryClientProvider } = await import(path("@tanstack_react-query"));
  const { Viewer } = await import("/src/Viewer.tsx");
  const { ProseThreads } = await import("/src/ProseThreads.tsx");
  const { ViewProse } = await import("/src/ViewSection.tsx");
  const pierrePath = main.match(/from "([^" ]*deps\/@pierre_diffs_react.js[^" ]*)"/)[1];
  const { Virtualizer } = await import(pierrePath);
  const { queryClient: q } = await import(main.match(/from "([^" ]*\/src\/queries.ts[^" ]*)"/)[1]);
  const source = Array.from({ length: 150 }, (_, i) => `const line${i} = ${i};`).join("\n");
  q.setQueryData(["readFileAt", -999, "base", "scroll.ts"], {
    status: "ok",
    text: source,
    binary: false,
  });
  q.setQueryData(["readFileAt", -999, "head", "scroll.ts"], {
    status: "ok",
    text: source.replace("const line9 = 9;", "const line9 = 99;"),
    binary: false,
  });
  const host = document.createElement("div");
  host.style = "position:fixed;inset:40px;z-index:99999;background:white";
  document.body.append(host);
  const root = createRoot(host);
  const wait = () => new Promise((r) => setTimeout(r, 150));
  let props = {
    root: {
      id: -999,
      workspaceId: -999,
      kind: "question",
      body: "Explain this code",
      startLine: 1,
      endLine: 1,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    },
    replies: [{ id: -998, kind: "answer", body: "Previous answer.\n\n".repeat(50) }],
    canPost: false,
    onReply: () => {},
    onStop: () => {},
    onAnswerPermission: () => {},
    onResolve: async () => {},
    onRemove: async () => {},
    onSend: () => {},
    onSummarize: async () => "",
    onAddComment: async () => {},
  };
  props.root = {
    ...props.root,
    path: "scroll.ts",
    side: "new",
    startLine: 10,
    endLine: 10,
    shown: true,
    state: "current",
  };
  if (mode === "prose")
    props.root = {
      ...props.root,
      path: null,
      viewId: -999,
      section: 0,
      code: "Quoted passage",
      quoteAt: 0,
    };
  const opened =
    mode === "file"
      ? { kind: "file", path: "scroll.ts" }
      : {
          kind: "diff",
          file: { path: "scroll.ts", status: "modified", additions: 1, deletions: 0 },
        };
  const render = () =>
    root.render(
      h(
        QueryClientProvider,
        { client: q },
        h(
          Virtualizer,
          { className: "overflow-auto", style: { height: 500, overflowAnchor: "none" } },
          mode === "prose"
            ? h(
                ProseThreads,
                {
                  workspaceId: -999,
                  viewId: -999,
                  section: 0,
                  canPost: false,
                  entries: [props.root, ...props.replies.map((e) => ({ ...e, parentId: -999 }))],
                  turns: props.turn ? { "-999": props.turn } : {},
                  onAsk: () => {},
                  onAnswerPermission: () => {},
                },
                h(ViewProse, { part: 0 }, "Quoted passage"),
              )
            : h(Viewer, {
                workspace: { id: -999, prNumber: null },
                mergeBase: "base",
                head: "head",
                opened,
                entries: [
                  props.root,
                  ...props.replies.map((e) => ({ ...e, parentId: -999, path: "scroll.ts" })),
                ],
                reviewed: false,
                turns: props.turn ? { "-999": props.turn } : {},
                onAsk: () => {},
                onAnswerPermission: () => {},
                onOpenFile: () => {},
                onReviewedChange: () => {},
                diffStyle: mode === "split" ? "split" : "unified",
                stacked: true,
              }),
          h("div", { style: { height: 1500 } }),
        ),
      ),
    );

  try {
    render();
    await new Promise((r) => setTimeout(r, 1200));
    const s = host.querySelector(".overflow-auto");
    const input = host.querySelector("textarea");
    if (!input) throw new Error("Fixture thread did not render");
    s.scrollTop =
      input.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop - 250;
    input.focus({ preventScroll: true });
    await wait();
    const before = s.scrollTop;
    props = {
      ...props,
      replies: [...props.replies, { id: -997, kind: "question", body: "Follow up" }],
    };
    render();
    await wait();
    const question = s.scrollTop;
    props = { ...props, turn: { running: true, live: [], permission: null, error: null } };
    render();
    await wait();
    const sent = s.scrollTop;
    props = {
      ...props,
      turn: { ...props.turn, live: [{ kind: "text", text: "New streamed answer\n\n".repeat(25) }] },
    };
    render();
    await wait();
    const streamed = s.scrollTop;
    props = {
      ...props,
      turn: { ...props.turn, running: false, live: [] },
      replies: [
        ...props.replies,
        { id: -996, kind: "answer", body: "New streamed answer\n\n".repeat(25) },
      ],
    };
    render();
    await wait();
    const saved = s.scrollTop;
    return {
      mode,
      before,
      question,
      sent,
      streamed,
      saved,
      stable: [question, sent, streamed, saved].every((top) => Math.abs(top - before) < 1),
    };
  } finally {
    root.unmount();
    host.remove();
    q.removeQueries({ predicate: (query) => query.queryKey[1] === -999 });
  }
}
