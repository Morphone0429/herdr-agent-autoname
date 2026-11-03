import { readFile, access, rm, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const home = path.resolve(process.env.HERDR_APP_HOME ?? path.join(os.homedir(), ".config/herdr-app"));
const recordPath = path.join(home, "data/agent-autoname/install.json");
const record = JSON.parse(await readFile(recordPath, "utf8"));
const layoutPath = path.join(home, "layouts", `${record.layout}.json`);
const mods = ["agent-autoname", "agent-autoname-tabs", "agent-autoname-agents", "agent-autoname-pane"];
/** @param {Buffer} data */
const digest = data => createHash("sha256").update(data).digest("hex");

if (digest(await readFile(layoutPath)) !== record.layoutHash) throw new Error("个人布局有本地修改，保留全部文件；请先处理布局改动。");
for (const [relative, hash] of Object.entries(record.files)) {
  if (digest(await readFile(path.join(home, relative))) !== hash) throw new Error(`文件有本地修改，保留全部文件：${relative}`);
}

// 只删除安装记录覆盖的文件；目录里出现未记录文件时停止，避免删除用户自己的内容。
/** @param {string} directory @param {string} [prefix] @returns {Promise<string[]>} */
async function listFiles(directory, prefix = "") {
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), `${prefix}${entry.name}/`));
    else if (entry.isFile()) files.push(`${prefix}${entry.name}`);
  }
  return files;
}
for (const name of mods) {
  for (const file of await listFiles(path.join(home, "mods", name))) {
    if (!record.files[`mods/${name}/${file}`]) throw new Error(`发现未记录的本地文件，保留全部文件：mods/${name}/${file}`);
  }
}

await access(path.join(home, "layouts", `${record.source}.json`));
const env = { ...process.env, HERDR_APP_HOME: home };
const status = JSON.parse(execFileSync("herdr-app", ["status"], { encoding: "utf8", env, timeout: 15000 }));
if (status.layout === record.layout) {
  execFileSync("herdr-app", ["do", "layout.switch", JSON.stringify({ name: record.source })], { encoding: "utf8", env, timeout: 15000 });
  const after = JSON.parse(execFileSync("herdr-app", ["status"], { encoding: "utf8", env, timeout: 15000 }));
  if (after.layout !== record.source) throw new Error("未能切回原布局，保留安装文件。");
}
for (const name of mods) await rm(path.join(home, "mods", name), { recursive: true });
await unlink(layoutPath);
await unlink(recordPath);
console.log("卸载完成。配置、生成日志、备份和原布局保留；已有标签名称保留。");
