/**
 * @typedef {{id?: string, type?: string, content?: {mod?: string, props?: Record<string, unknown>, pane?: {header?: {content?: {mod?: string}}}}, children?: LayoutNode[], [key: string]: unknown}} LayoutNode
 */

/** 只修改个人布局中的三个标题显示位置，并在现有状态栏增加控制器。
 * @param {LayoutNode} input
 */
export function integrateLayout(input) {
  const copy = structuredClone(input);
  let tabs = 0, agents = 0, headers = 0, status = 0;
  /** @param {LayoutNode} node */
  function walk(node) {
    if (node.id === "tabs" && node.content?.mod === "tabs") {
      node.content.mod = "agent-autoname-tabs";
      tabs++;
    }
    if (node.content && ["agents", "session-titles-agents"].includes(node.content.mod ?? "")) {
      node.content.mod = "agent-autoname-agents";
      agents++;
    }
    const header = node.content?.pane?.header?.content;
    if (header && ["pane", "session-titles-pane"].includes(header.mod ?? "")) {
      header.mod = "agent-autoname-pane";
      headers++;
    }
    if (node.id === "status" && node.type === "block" && node.content?.mod === "workspace-status") {
      const original = node.content;
      delete node.content;
      node.type = "row";
      node.resizable = false;
      node.children = [
        { id: "autoname-original-status", type: "block", size: { weight: 1 }, content: original },
        { id: "autoname-controller", type: "block", size: { px: 180 }, content: { mod: "agent-autoname" } },
      ];
      status++;
      return;
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(copy);
  if (tabs !== 1 || agents !== 1 || headers !== 1 || status !== 1) throw new Error(`当前布局不符合接入条件：tabs=${tabs}, agents=${agents}, pane=${headers}, status=${status}。没有修改源布局。`);
  return copy;
}
