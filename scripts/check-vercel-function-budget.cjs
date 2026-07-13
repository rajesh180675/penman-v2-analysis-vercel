const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const apiRoot = path.join(root, "api");
const HOBBY_FUNCTION_LIMIT = 12;
const FUNCTION_EXTENSION = /\.(?:[cm]?[jt]s)$/i;

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const deployable = walk(apiRoot)
  .filter((file) => FUNCTION_EXTENSION.test(file))
  .filter((file) => {
    const name = path.basename(file);
    return !name.startsWith("_") && !name.startsWith(".") && !name.endsWith(".d.ts");
  })
  .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
  .sort();

if (deployable.length > HOBBY_FUNCTION_LIMIT) {
  console.error(`vercel-function-budget: ${deployable.length}/${HOBBY_FUNCTION_LIMIT} functions exceed the Hobby limit.`);
  console.error("Consolidate routes or prefix imported helpers/tests in api/ with an underscore.");
  for (const file of deployable) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`vercel-function-budget: OK — ${deployable.length}/${HOBBY_FUNCTION_LIMIT} deployable functions.`);
