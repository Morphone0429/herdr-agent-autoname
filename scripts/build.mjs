import { mkdir, readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appHome = process.env.HERDR_APP_HOME ?? path.join(os.homedir(), ".config/herdr-app");

/**
 * 替换锚点必须唯一，Herdr 上游改版时显式失败。
 * @param {string} source
 * @param {string} before
 * @param {string} after
 */
function replace(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) throw new Error(`Herdr 模板锚点不唯一：${before.slice(0, 100)}`);
  return source.replace(before, after);
}

const helper = `import { shared, terminals } from "herdr";
import { agentKey, reportedTitle, reconcileTab } from "./engine.js";

// 控制器保存的进程身份与当前终端相符时，才显示生成的名称。
export function taskTitle(agent) {
  const address = agent.address ?? agent.terminal;
  const live = terminals().find(t => t.address === address);
  const value = { ...live, ...agent };
  const native = reportedTitle(value);
  if (native) return native;
  const record = shared("agent-autoname.state")?.agents?.[address];
  return record?.key === agentKey(value) ? record.title || "" : "";
}

export function tabTitle(tab, agent) {
  const record = shared("agent-autoname.state")?.tabs?.[tab.id];
  const owner = reconcileTab(tab, record, [agent?.program?.name ?? "", agent?.app ?? ""], Date.now());
  return owner.mode === "manual" ? tab.name : taskTitle(agent ?? {}) || tab.name;
}
`;

await mkdir(path.join(root, "mods"), { recursive: true });
for (const name of ["tabs", "agents", "pane"]) {
  const destination = path.join(root, "mods", `agent-autoname-${name}`);
  await mkdir(destination, { recursive: true });
  const source = path.join(appHome, "mods", name);
  let text = await readFile(path.join(source, "main.js"), "utf8");
  text = `// 基于本机 Herdr 的 ${name} 副本接入统一自动命名，保留原生交互与状态。\n${text}`;
  if (name === "tabs") {
    text = replace(text, 'import { h_flex } from "gpui-base";', 'import { h_flex } from "gpui-base";\nimport { tabTitle } from "./titles.js";');
    text = replace(text, '      const name = /^tb\\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;', '      const agent = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);\n      const name = tabTitle(c, agent) || program?.name || "Terminal";');
    text = replace(text, 'max_w(170)', 'max_w(280)');
  } else if (name === "agents") {
    text = replace(text, 'import { v_flex, h_flex } from "gpui-base";', 'import { v_flex, h_flex } from "gpui-base";\nimport { taskTitle } from "./titles.js";');
    text = replace(text, '      return tab ? title(tab, lead(tab)) : a.title || a.program?.name || "";', '      return taskTitle(a) || (tab ? title(tab, lead(tab)) : a.title || a.program?.name || "");');
    text = replace(text, '.child(k.name || k.template || k.program?.name || k.address)', '.child(taskTitle({ ...k, app: k.report?.app }) || k.name || k.template || k.program?.name || k.address)');
    text = replace(text, 'openOverlay({ mod: "agents", kind: "popup"', 'openOverlay({ mod: "agent-autoname-agents", kind: "popup"');
  } else {
    text = replace(text, 'import { h_flex } from "gpui-base";', 'import { h_flex } from "gpui-base";\nimport { taskTitle } from "./titles.js";');
    text = replace(text, '    const st = p.status;', '    const st = p.status;\n    const task = taskTitle(p);');
    text = replace(text, '      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))', '      .when(Boolean(task), el => el.child(div().min_w(0).max_w(360).flex_shrink_1().truncate().text_color(t.foreground).child(`· ${task}`)))\n      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(folder(p.cwd)))');
  }
  text = text.replaceAll(`mods/${name}/`, `mods/agent-autoname-${name}/`);
  await writeFile(path.join(destination, "main.js"), text);
  await writeFile(path.join(destination, "titles.js"), helper);
  await copyFile(path.join(root, "mods/agent-autoname/engine.js"), path.join(destination, "engine.js"));
  for (const file of await readdir(source)) if (file.endsWith(".svg")) await copyFile(path.join(source, file), path.join(destination, file));
  await writeFile(path.join(destination, "mod.json"), JSON.stringify({ place: "none", title: `自动命名 · ${name}`, cloned_from: { name, version: "0.1.12" } }, null, 2) + "\n");
  await copyFile(path.join(root, "LICENSE-APACHE-2.0"), path.join(destination, "LICENSE-APACHE-2.0"));
  await copyFile(path.join(root, "NOTICE.md"), path.join(destination, "NOTICE.md"));
  console.log(`生成 mods/agent-autoname-${name}`);
}
