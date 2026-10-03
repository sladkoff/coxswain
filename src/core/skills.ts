import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ADR 0039: skills the agent pane's agent reads with read_skill while it makes a view. Each is a skill from
// mattpocock/skills copied in full into resources/skills/ (see its README), served with a note on how it applies in
// coxswain: which parts to use, and how they map to the view tools. The note comes first, so it frames the rest.

export const skillNames = ["pr", "writing-beats", "code-review"] as const;
export type SkillName = (typeof skillNames)[number];

// Where the skill folders are: set by the main process, which knows where the app's resources are.
let dir = join(process.cwd(), "resources", "skills");
export const setSkillsDir = (path: string) => void (dir = path);

const inCoxswain: Record<SkillName, string> = {
  pr: `Here the skill shapes a view's overview, its first section, written with write_section, and not a PR body. Use its
Summary and Merge Danger, and its Evidence where the change carries its own proof: name the test that fails without
the change and what it checks. Give the section a heading of your own that says what the change does; the skill's
section names may be bold labels in it. The visuals are markdown in the section: pseudocode, trees and shaped diffs as
\`\`\`text or \`\`\`diff blocks without path=, diagrams as \`\`\`mermaid blocks. The user's domain language is the
repository's glossary when it has one (GLOSSARY.md, CONTEXT.md, a glossary under docs/), and the code's own names
otherwise. The reviewer reads the overview before any diff, so it carries what the diffs can't show: the intent, the
shape and the danger.`,
  "writing-beats": `Here only the skill's Grounding section applies: it orders a view's sections, which are its beats. The audience
knows the codebase but not this change; the overview grounds the change's intent and its new terms. Order the
sections so each leans only on concepts the overview or an earlier section grounded, and grounds what the later ones
need. You plan the whole order yourself, in one go: the journey with the user and the article file are for writing
articles.`,
  "code-review": `Here a review is a guide with findings, so the skill's two axes become findings on lines. The fixed point is the
view's base, and the diff is the one start_view gave you. The spec is the PR's title, description and the issues it
links (\`gh pr view --json title,body,closingIssuesReferences\`), or the commits' messages for a branch without a PR;
it needs no setup or issue-tracker file. The standards are the repository's own documents (AGENTS.md, CLAUDE.md,
CONTRIBUTING.md, ADRs) plus the smell baseline. Add each finding with add_finding on the lines it's about, starting
with its axis: "Spec: …" or "Standards: …", and for a smell its name as a judgement call ("Standards, possible Feature
Envy: …"). Keep the axes apart as the skill says, with sub-agents if you have them; the findings on the lines replace
the skill's report.`,
};

// The skill's text with how it applies in coxswain before it.
export async function readSkill(name: SkillName): Promise<string> {
  const text = await readFile(join(dir, name, "SKILL.md"), "utf8");
  return `# The ${name} skill in coxswain\n\n${inCoxswain[name]}\n\nThe skill, in full:\n\n---\n\n${text}`;
}
