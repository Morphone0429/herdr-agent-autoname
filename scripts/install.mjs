import { readFile, writeFile, readdir, mkdir, copyFile, access, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { integrateLayout } from "./layout.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = path.resolve(process.env.HERDR_APP_HOME ?? path.join(os.homedir(), ".config/herdr-app"));
const names = ["agent-autoname", "agent-autoname-tabs", "agent-autoname-agents", "agent-autoname-pane"];

/** @param {string[]} args */
function herdr(args) {
  const output = execFileSync("herdr-app", args, { encoding: "utf8", timeout: 20000, env: { ...process.env, HERDR_APP_HOME: home } });
  const value = JSON.parse(output);
  if (value.error) throw new Error(value.error);
  return value;
}

/** @param {string} file */
async function exists(file) {
  try { await access(file); return true; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
}

/** @param {string} directory */
async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {string[]} */
  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "jsconfig.json" || entry.name.endsWith(".d.ts")) continue;
    if (entry.isSymbolicLink()) throw new Error(`源文件不接受符号链接：${entry.name}`);
    if (entry.isDirectory()) result.push(...(await sourceFiles(path.join(directory, entry.name))).map(p => `${entry.name}/${p}`));
    else result.push(entry.name);
  }
  return result;
}

const status = herdr(["status"]);
if (status.errors.length) throw new Error(`Herdr 当前有错误：${status.errors.join("; ")}`);
const data = path.join(home, "data/agent-autoname");
if (await exists(path.join(data, "install.json"))) throw new Error("已有安装记录。请先检查本地改动并卸载，再安装；不会覆盖已有 Mod。");
for (const name of names) if (await exists(path.join(home, "mods", name))) throw new Error(`Mod 名称冲突：${name}`);
const sourceName = status.layout;
const sourcePath = path.join(home, "layouts", `${sourceName}.json`);
const original = await readFile(sourcePath, "utf8");
integrateLayout(JSON.parse(original));
const model = process.env.AUTONAME_MODEL ?? "magpie/auto/deepseek-v4.1-flash";
const command = process.env.AUTONAME_PI_COMMAND ?? execFileSync("/bin/sh", ["-c", "command -v pi"], { encoding: "utf8", timeout: 5000 }).trim();
await access(command);
let layoutName = "agent-autoname";
for (let suffix = 2; await exists(path.join(home, "layouts", `${layoutName}.json`)); suffix++) layoutName = `agent-autoname-${suffix}`;
for (const name of names) execFileSync("herdr-app", ["check", path.join(root, "mods", name)], { stdio: "inherit", timeout: 20000 });

await mkdir(data, { recursive: true, mode: 0o700 });
const backup = path.join(data, `backup-${Date.now()}`);
await mkdir(backup);
await copyFile(sourcePath, path.join(backup, `${sourceName}.json`));
/** @type {Record<string,string>} */
const hashes = {};
for (const name of names) {
  const source = path.join(root, "mods", name), destination = path.join(home, "mods", name);
  await mkdir(destination);
  for (const relative of await sourceFiles(source)) {
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(source, relative), target);
    hashes[`mods/${name}/${relative}`] = createHash("sha256").update(await readFile(target)).digest("hex");
  }
}

const configFile = path.join(data, "config.json");
if (!await exists(configFile)) await writeFile(configFile, JSON.stringify({ version: 1, command, node: await realpath(process.execPath), model, timeoutMs: 22000, refreshMs: 180000 }, null, 2) + "\n", { mode: 0o600 });

herdr(["do", "layout.clone", JSON.stringify({ name: sourceName, as: layoutName })]);
const layoutPath = path.join(home, "layouts", `${layoutName}.json`);
const cloned = JSON.parse(await readFile(layoutPath, "utf8"));
const text = JSON.stringify(integrateLayout(cloned), null, 2) + "\n";
await writeFile(layoutPath, text);
await writeFile(path.join(data, "install.json"), JSON.stringify({ version: 1, source: sourceName, layout: layoutName, backup, files: hashes, layoutHash: createHash("sha256").update(text).digest("hex"), project: root, installedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`安装完成：${layoutName}，命名模型 ${model}`);
console.log(`数据与日志：${data}`);
console.log("源布局、手动名称和终端会话保留；不会重启终端。");
