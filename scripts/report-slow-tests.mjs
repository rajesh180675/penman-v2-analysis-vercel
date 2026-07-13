import { readFileSync } from "node:fs";

const [input, limitText = "20"] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node scripts/report-slow-tests.mjs <junit.xml> [limit]");
  process.exitCode = 2;
} else {
  const xml = readFileSync(input, "utf8");
  const decode = (value) => value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  const tests = [...xml.matchAll(/<testcase\b([^>]*)>/g)].map((match) => {
    const attributes = match[1] ?? "";
    const name = /\bname="([^"]*)"/.exec(attributes)?.[1] ?? "unnamed test";
    const classname = /\bclassname="([^"]*)"/.exec(attributes)?.[1] ?? "unknown suite";
    const seconds = Number(/\btime="([^"]*)"/.exec(attributes)?.[1] ?? 0);
    return { name: decode(name), classname: decode(classname), seconds };
  }).filter((test) => Number.isFinite(test.seconds));
  tests.sort((left, right) => right.seconds - left.seconds || left.name.localeCompare(right.name));
  const limit = Math.max(1, Number(limitText) || 20);
  const lines = [
    `## Slowest tests in ${input}`,
    "",
    "| Seconds | Suite | Test |",
    "|---:|---|---|",
    ...tests.slice(0, limit).map((test) => `| ${test.seconds.toFixed(3)} | ${test.classname.replaceAll("|", "\\|")} | ${test.name.replaceAll("|", "\\|")} |`),
    "",
    `Total test cases: ${tests.length}; total reported case time: ${tests.reduce((sum, test) => sum + test.seconds, 0).toFixed(3)}s.`,
  ];
  const report = `${lines.join("\n")}\n`;
  process.stdout.write(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }
}
