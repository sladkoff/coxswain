import type { SetupCheck } from "../../core/setup";
import { Button } from "./components/button";
import { Card } from "./components/layout";
import { cn, muted, titleBar } from "./components/styles";

// Shown full window while the startup check finds a tool missing or not set up: each problem, the command that fixes
// it, and the PATH the app looked on (a Dock-launched app gets a shorter one than a terminal).
export function Setup({ check, onRetry }: { check: SetupCheck; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col select-none text-sm">
      <div className={titleBar} />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-auto p-6 pb-10">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">coxswain needs a few tools</h1>
          <p className={cn("mt-2", muted)}>
            Install or set up what's listed below in a terminal, then check again.
          </p>
        </div>
        <ul className="w-full max-w-lg space-y-3">
          {check.problems.map((p) => (
            <li key={p.tool}>
              <Card>
                <div className="font-medium">{p.problem}</div>
                <code className="mt-2 block rounded bg-neutral-100 px-2 py-1 font-mono text-xs select-text dark:bg-neutral-800">
                  {p.fix}
                </code>
              </Card>
            </li>
          ))}
        </ul>
        <Button variant="primary" onClick={onRetry}>
          Check again
        </Button>
        <p className={cn("max-w-lg text-center text-xs break-all select-text", muted)}>
          Looked on this PATH: {check.path || "(empty)"}
        </p>
      </div>
    </div>
  );
}
