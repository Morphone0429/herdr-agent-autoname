import { readFile, readdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = path.resolve(process.env.HERDR_APP_HOME ?? path.join(os.homedir(), ".config/herdr-app"));
const recordPath = path.join(home, "data/agent-autoname/install.json");
const record = JSON.parse(await readFile(recordPath, "utf8"));
const names = ["agent-autoname-tabs", "agent-autoname-agents", "agent-autoname-pane", "agent-autoname"];
/** @param {Buffer} data */
const hash = data => createHash("sha256").update(data).digest("hex");
for (const [relative, digest] of Object.entries(record.files)) {
  if (hash(await readFile(path.join(home, relative))) !== digest) throw new Error(`已安装文件有本地修改，不覆盖：${relative}`);
}
for (const name of names) execFileSync("herdr-app", ["check", path.join(root, "mods", name)], { stdio: "inherit", timeout: 20000 });
for (const name of names) {
  const source = path.join(root, "mods", name);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === "jsconfig.json" || entry.name.endsWith(".d.ts") || entry.name.startsWith(".")) continue;
    const relative = `mods/${name}/${entry.name}`;
    const target = path.join(home, relative);
    await copyFile(path.join(source, entry.name), target);
    record.files[relative] = hash(await readFile(target));
  }
}
record.updatedAt = new Date().toISOString();
await writeFile(recordPath, JSON.stringify(record, null, 2) + "\n");
console.log("更新完成。布局、配置、标签所有权和已有日志保留。");
