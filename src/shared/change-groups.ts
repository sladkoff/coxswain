import { match } from "ts-pattern";

export const changeGroups = [
  { id: "implementation", label: "Implementation" },
  { id: "tests", label: "Tests" },
  { id: "generated", label: "Generated" },
] as const;
export type ChangeGroup = (typeof changeGroups)[number]["id"];

// Shared path classification for Changes categories and Guide ordering.
// Generated artifacts take precedence even when they live under a test directory.
export function changeGroup(sourcePath: string): ChangeGroup {
  return match(sourcePath.toLowerCase())
    .when(
      (path) =>
        /(^|\/)(generated|__generated__|gen|dist)\//.test(path) ||
        /\.(generated|gen|g|pb)\./.test(path) ||
        /\.(snap|tsbuildinfo|map)$/.test(path) ||
        /\.min\.(js|css)$/.test(path) ||
        /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|cargo\.lock|poetry\.lock|uv\.lock|go\.sum|composer\.lock|gemfile\.lock)$/.test(
          path,
        ),
      () => "generated" as const,
    )
    .when(
      (path) =>
        /(^|\/)(__tests__|tests?|specs?|fixtures|__fixtures__|testdata|e2e)\//.test(path) ||
        testFilename(sourcePath),
      () => "tests" as const,
    )
    .otherwise(() => "implementation");
}

// Python domain filenames can legitimately start with test_ or end in _test.
// Only its explicit _spec convention identifies a test outside a test directory.
function testFilename(sourcePath: string): boolean {
  const name = sourcePath.split("/").at(-1) ?? "";
  if (/\.pyi?$/i.test(name)) return /_spec\.pyi?$/i.test(name);
  return (
    /^(test_|spec_)/i.test(name) ||
    /[._-](test|tests|spec|specs)(\.[^./]+)?$/i.test(name) ||
    /(Test|Tests)\.(java|kt|cs|swift)$/.test(name)
  );
}
