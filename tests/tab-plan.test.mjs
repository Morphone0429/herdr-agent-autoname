import assert from "node:assert/strict";
import test from "node:test";
import { planTabName } from "../mods/agent-autoname/engine.js";

test("启动时没有 Agent 数据，不把启动器默认标签记为手动名称", () => {
  const tab = { id: "tab", name: "Pi", named: true };
  assert.equal(planTabName(tab, undefined, [], {}, 0), null);
  assert.equal(planTabName(tab, undefined, [{ address: "t1", app: "pi", program: { name: "Pi" } }], {}, 0)?.record.mode, "auto");
  const agent = { address: "t1", app: "pi", program: { name: "Pi" } };
  const result = planTabName(tab, undefined, [agent], { t1: { title: "修复支付" } }, 1);
  assert.equal(result?.rename, "修复支付");
  assert.equal(result?.record.mode, "auto");
});

test("用户指定的任务名保持原样，不跟随模型结果", () => {
  const result = planTabName({ id: "tab", name: "本周重点", named: true }, undefined, [{ address: "t1", app: "pi", program: { name: "Pi" } }], { t1: { title: "修复支付" } }, 0);
  assert.equal(result?.record.mode, "manual");
  assert.equal(result?.rename, null);
});

test("等待 core 确认改名期间不重复发送，不覆盖随后手动改名", () => {
  const members = [{ address: "t1", app: "pi", program: { name: "Pi" } }];
  const titles = { t1: { title: "修复支付" } };
  const planned = planTabName({ id: "tab", name: "Pi", named: true }, undefined, members, titles, 0);
  assert.equal(planTabName({ id: "tab", name: "Pi", named: true }, planned?.record, members, titles, 100)?.rename, null);
  assert.equal(planTabName({ id: "tab", name: "人工标注", named: true }, planned?.record, members, titles, 100)?.record.mode, "manual");
});
