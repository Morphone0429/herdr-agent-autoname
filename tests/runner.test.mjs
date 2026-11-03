import assert from "node:assert/strict";
import test from "node:test";
import { execute } from "../mods/agent-autoname/runner.mjs";

test("真实子进程保留 argv，关闭继承的 Herdr 会话标识", async () => {
  const source = "console.log(JSON.stringify({argument:process.argv[1],terminal:process.env.HC_TERMINAL_ID,offline:process.env.PI_OFFLINE}))";
  const argument = '中文任务 $() ; "quote"';
  const result = await execute(process.execPath, ["-e", source, argument]);
  const value = JSON.parse(result.stdout);
  assert.equal(value.argument, argument);
  assert.equal(value.terminal, "");
  assert.equal(value.offline, "1");
});

test("失败与超时显式返回错误，不伪造成功标题", async () => {
  await assert.rejects(execute(process.execPath, ["-e", 'process.stderr.write("failed");process.exit(2)', "private-terminal-text" ]), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /failed/);
    assert.ok(!error.message.includes("private-terminal-text"));
    return true;
  });
  await assert.rejects(execute(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 50 }), /node:/);
});
