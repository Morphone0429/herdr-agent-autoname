import { shared, terminals } from "herdr";
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
