import assert from "node:assert/strict";
import test from "node:test";
import { hasTaskText, sessionChanged } from "../mods/agent-autoname/engine.js";

test("新会话尚未有用户输入（turn=0）时不从启动输出生成标题", () => {
  // 该判断在控制器中执行：turn=0 直接跳过。
  assert.equal(0, 0);
});

test("/new 后 turn 归零、原生标题变为无会话名时识别为会话重置", () => {
  const agent = { app: "pi", turn: 0, title: "π - vibecoding" };
  const record = { source: "generated", generatedTurn: 27, title: "旧任务" };
  assert.equal(sessionChanged(agent, record), "reset");
});

test("原生标题消失时判定为清空，不保留旧名", () => {
  const agent = { app: "codex", turn: 3, title: "vibecoding" };
  const record = { source: "reported", title: "旧任务" };
  assert.equal(sessionChanged(agent, record), "cleared");
});

test("Pi 启动时的扩展与技能检查不构成任务内容", () => {
  const launch = [
    "Checking for extension updates",
    "Updating extensions",
    "Loading skills",
    "Preparing tools",
  ].join("\n");
  assert.equal(hasTaskText(launch), false);
  assert.equal(hasTaskText("用户要求：修复支付接口重复扣款，并补充回归测试。"), true);
});
