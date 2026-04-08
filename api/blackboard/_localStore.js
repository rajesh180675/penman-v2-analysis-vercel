import fs from "node:fs/promises";
import path from "node:path";

const LOCAL_DIR = path.join(process.cwd(), ".afes-local");

function filePathForSession(session) {
  return path.join(LOCAL_DIR, `blackboard-${session}.json`);
}

export async function readLocalBlackboard(session) {
  try {
    const contents = await fs.readFile(filePathForSession(session), "utf8");
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

export async function writeLocalBlackboard(session, payload) {
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  const target = filePathForSession(session);
  await fs.writeFile(target, JSON.stringify(payload, null, 2), "utf8");
  return target;
}
