import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db.ts";
import { onEvent } from "./events.ts";
import {
  implementationConnections,
  ampImplementationProvider,
  ampCommand,
  type ImplementationProvider,
} from "./implementation-connections.ts";

// Test the real persistence and MCP invocation boundary without contacting or messaging an account.
test("connections are opt-in, persist, and gate already-discovered tools after disconnect", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "coxswain-connections-"));
  const path = join(dir, "test.db");
  let db = openDatabase(path);
  t.after(async () => {
    await db.destroy();
    await rm(dir, { recursive: true, force: true });
  });
  const calls: string[] = [];
  const provider: ImplementationProvider = {
    name: "Example",
    check: async () => {
      calls.push("check");
    },
    list: async () => {
      calls.push("list");
      return "[]";
    },
    read: async () => {
      calls.push("read");
      return "Conversation";
    },
    send: async () => {
      calls.push("send");
      return "Reply";
    },
  };
  let events = 0;
  const off = onEvent((e) => {
    if (e.what === "settings") events++;
  });
  t.after(off);
  let service = implementationConnections(db, { example: provider });
  const tool = (name: string) => service.tools.find((tool) => tool.name === name)!;
  const invoke = (name: string, args: object = {}) => tool(name).call(args as never);
  assert.equal(await invoke("list_implementation_connections"), "[]");
  for (const name of [
    "list_implementation_threads",
    "read_implementation_thread",
    "send_implementation_message",
  ])
    await assert.rejects(
      invoke(name, { connection: "example", thread: "T-existing", message: "Proceed" }),
      /not connected/,
    );
  assert.deepEqual(calls, []);
  await service.set("example", true);
  assert.equal(events, 1);
  assert.equal(JSON.parse(await invoke("list_implementation_connections"))[0].name, "Example");
  await db.destroy();
  db = openDatabase(path);
  service = implementationConnections(db, { example: provider });
  assert.equal((await service.list())[0].connected, true);
  assert.equal(
    await invoke("read_implementation_thread", { connection: "example", thread: "T-existing" }),
    "Conversation",
  );
  assert.equal(
    await invoke("send_implementation_message", {
      connection: "example",
      thread: "T-existing",
      message: "Proceed",
    }),
    "Reply",
  );
  const cachedSend = tool("send_implementation_message");
  await service.set("example", false);
  await assert.rejects(
    cachedSend.call({ connection: "example", thread: "T-existing", message: "Proceed" } as never),
    /not connected/,
  );
  assert.equal(events, 2);
  assert.deepEqual(calls, ["check", "read", "send"]);
  provider.check = async () => {
    throw new Error("Not signed in");
  };
  await assert.rejects(service.set("example", true), /Not signed in/);
  assert.equal((await service.list())[0].connected, false);
  await assert.rejects(service.set("unknown", true), /Unknown/);
});

test("Amp adapter validates targets and passes messages as a literal execute option", async () => {
  const calls: { args: string[]; timeoutMs?: number }[] = [];
  const provider = ampImplementationProvider(async (args, timeoutMs) => {
    calls.push({ args, timeoutMs });
    return args.includes("--orb-execute") ? "https://ampcode.com/threads/T-abc-123" : "[]";
  });
  await provider.check();
  await provider.list(10, 20);
  await provider.read("https://ampcode.com/threads/T-abc-123.md");
  const message = "--dangerously-allow-all $(touch SHOULD_NOT_EXIST) `echo data`\nNext line";
  await provider.send("T-abc-123", message);
  assert.deepEqual(calls, [
    { args: ["threads", "list", "--json", "--limit", "1"], timeoutMs: undefined },
    {
      args: ["threads", "list", "--json", "--limit", "10", "--offset", "20"],
      timeoutMs: undefined,
    },
    { args: ["threads", "markdown", "T-abc-123"], timeoutMs: undefined },
    {
      args: ["threads", "continue", "T-abc-123", "--orb-execute", `--execute=${message}`],
      timeoutMs: 30_000,
    },
  ]);
  assert.throws(() => provider.read("--help"), /valid thread/);
  await assert.rejects(
    provider.send("https://example.com/threads/T-abc", "message"),
    /valid thread/,
  );
  assert.equal(calls.length, 4);
});

test("a provider startup prompt cannot consume the message intended for the thread", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "coxswain-amp-stdin-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = join(dir, "cli.cjs");
  await writeFile(
    cli,
    `const fs=require("node:fs");
const stdin=fs.readFileSync(0,"utf8"); // An inherited MCP OAuth flow reads from the shared stdin first.
const prompt=process.argv.find(value=>value.startsWith("--execute="))?.slice("--execute=".length);
if(prompt===undefined){process.stderr.write("Timeout while reading from stdin");process.exit(1)}
console.log(JSON.stringify({prompt,stdin,url:"https://ampcode.com/threads/T-existing"}));`,
  );
  const provider = ampImplementationProvider(ampCommand(process.execPath, [cli]));
  const message = '--flag=literal $(do-not-run) \nquoted "text"';
  const submitted = JSON.parse(await provider.send("T-existing", message));
  assert.equal(submitted.status, "submitted");
  assert.deepEqual(JSON.parse(submitted.output), {
    prompt: message,
    stdin: "",
    url: "https://ampcode.com/threads/T-existing",
  });
});

test("provider errors distinguish startup authorization, CLI incompatibility and unknown failures without leaking diagnostics", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "coxswain-amp-errors-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = join(dir, "cli.cjs");
  await writeFile(cli, "process.stderr.write(process.argv[2]); process.exit(7);");
  for (const [diagnostics, expected] of [
    ["OAuth Authorization Required https://example.com?token=SECRET", /connected service/],
    ["Unknown option --execute SECRET", /CLI version/],
    ["Invalid or missing API key SECRET", /authentication failure/],
    ["unexplained SECRET https://private.example", /cause could not be determined/],
  ] as const) {
    const provider = ampImplementationProvider(ampCommand(process.execPath, [cli, diagnostics]));
    await assert.rejects(provider.read("T-existing"), (error: Error) => {
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /SECRET|https:\/\//);
      return true;
    });
  }
});

test("sending to an already-running remote thread does not claim a local executor", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "coxswain-amp-remote-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = join(dir, "cli.cjs");
  await writeFile(
    cli,
    `const fs=require("node:fs");
const stdin=fs.readFileSync(0,"utf8");
const args=process.argv.slice(2);
// Amp logs an executor collision but can exit without a reason on stdout/stderr.
if(!args.includes("--orb-execute")) process.exit(1);
if(args.includes("--stream-json")) throw new Error("Remote submission is not a local execution stream");
console.log("https://ampcode.com/threads/T-existing");`,
  );
  const provider = ampImplementationProvider(ampCommand(process.execPath, [cli]));
  const result = JSON.parse(await provider.send("T-existing", "Implement the requested change"));
  assert.equal(result.status, "submitted");
  assert.equal(result.thread, "T-existing");
  assert.equal(result.completed, false, "submission must not be reported as completed work");
});

test("remote delivery requires acknowledgment of the selected thread and never falls back to local execution", async () => {
  for (const output of ["", "https://ampcode.com/threads/T-different"]) {
    let calls = 0;
    const provider = ampImplementationProvider(async () => {
      calls++;
      return output;
    });
    await assert.rejects(provider.send("T-existing", "Proceed"), /without confirming submission/);
    assert.equal(calls, 1, "no automatic resend or local fallback after uncertain submission");
  }
});
