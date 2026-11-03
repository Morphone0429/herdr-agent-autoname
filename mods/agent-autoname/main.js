import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, terminals, spaces, shared, setShared, props, appHome, exec, hc, readTextFile, writeTextFile, run, openOverlay, closeOverlay, theme, nextCommand } from "herdr";
import { mkdir, unlink } from "fs/promises";
import { agentKey, hasTaskText, isAgent, planTabName, reportedTitle, snapshotText } from "./engine.js";

const STATE = "agent-autoname.state";
const ENABLED = "agent-autoname.enabled";
const REFRESH = "agent-autoname.refresh";
const DIRECTORY = () => `${appHome()}/data/agent-autoname`;

function liveAgents() {
  const all = terminals().filter(t => t.state === "live");
  const known = new Map(agents().map(a => [a.address, a]));
  for (const t of all) {
    if (isAgent({ ...t, app: t.report?.app, status: t.status })) {
      const current = known.get(t.address);
      known.set(t.address, { ...t, ...current, address: t.address, app: current?.app ?? t.report?.app ?? t.program?.key ?? "agent" });
    }
  }
  return [...known.values()].map(a => ({ ...all.find(t => t.address === a.address), ...a }));
}

function state() {
  const current = shared(STATE) ?? { version: 1, agents: {}, tabs: {} };
  return { ...current, agents: { ...current.agents }, tabs: { ...current.tabs } };
}

function save(next) {
  if (JSON.stringify(shared(STATE)) !== JSON.stringify(next)) setShared(STATE, next);
}

function control(id, label, action, t) {
  return div().id(id).px(10).h(30).rounded(6).border_1().border_color(t.border).items_center().flex().text_size(12)
    .role("button").accessibility_label(label).cursor_pointer().hover(s => s.bg(t.hover))
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation()).on_click(action).child(label);
}

export default class AgentAutoname extends View {
  init(_props, cx) {
    this.overlay = props()?.overlay;
    this.popup = Boolean(this.overlay);
    this.busy = false;
    this.configError = null;
    this.runtimeError = null;
    this.address = null;
    if (this.popup) return;
    this.address = `copy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.loadConfig(cx);
    cx.timer.every(3000, cx => this.tick(cx));
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        try {
          if (command.startsWith("manual-")) this.manualTitle(command.slice(7));
          else if (command === "pause") setShared(ENABLED, false);
          else if (command === "resume") setShared(ENABLED, true);
          else if (command === "refresh") setShared(REFRESH, Date.now());
          else if (command === "settings") this.loadConfig(cx);
          else if (command.startsWith("automatic-")) this.automaticTab(command.slice(10));
        } catch (error) {
          this.runtimeError = String(error.message ?? error);
        }
        cx.notify();
      }
    });
  }

  loadConfig(cx) {
    cx.spawn(async cx => {
      try {
        const raw = await readTextFile(`${DIRECTORY()}/config.json`);
        if (!raw) throw new Error("缺少 data/agent-autoname/config.json");
        const config = JSON.parse(raw);
        if (config.version !== 1 || typeof config.command !== "string" || typeof config.node !== "string" || typeof config.model !== "string" || !Number.isFinite(config.refreshMs) || config.refreshMs < 30000) throw new Error("自动命名配置格式无效");
        this.config = config;
        this.configError = null;
        this.tick(cx);
      } catch (error) {
        this.configError = String(error.message ?? error);
      }
      cx.notify();
    });
  }

  tick(cx) {
    if (this.busy || !this.config || shared(ENABLED) === false) return;
    this.busy = true;
    cx.spawn(async cx => {
      try {
        const requested = shared(REFRESH) ?? 0;
        const currentState = state();
        const now = Date.now();
        if (currentState.lock?.until > now && currentState.lock.owner !== this.address) return;
        currentState.lock = { owner: this.address, until: now + 8000 };
        save(currentState);
        const current = liveAgents();
        const currentIds = new Set(current.map(a => a.address));
        const next = state();
        next.agents = Object.fromEntries(Object.entries(next.agents).filter(([id]) => currentIds.has(id)));
        // 每轮最多一次模型调用；已有任务名不占用模型请求。
        let generated = false;
        for (const agent of current) {
          const key = agentKey(agent), now = Date.now();
          const previous = state().agents[agent.address];
          const record = previous?.key === key ? { ...previous } : { key, title: "", source: "waiting", generatedTurn: null, updatedAt: 0, attemptedAt: 0, error: null };
          const native = reportedTitle(agent);
          if (native) {
            if (record.title !== native || record.source !== "reported") this.storeAgent(agent.address, { ...record, title: native, source: "reported", updatedAt: now, error: null });
            continue;
          }
          if (record.source === "reported") Object.assign(record, { title: "", source: "waiting", updatedAt: 0 });
          const force = requested > (record.refreshedAt ?? 0);
          const changedTurn = agent.turn !== record.generatedTurn;
          const due = force || !record.title || (changedTurn && now - record.updatedAt >= this.config.refreshMs);
          if (!generated && due && (force || now - record.attemptedAt >= (record.error ? 60000 : 15000))) {
            generated = true;
            record.attemptedAt = now;
            record.refreshedAt = requested;
            record.error = null;
            this.storeAgent(agent.address, { ...record, source: "reading" });
            try {
              const result = await hc(["read", agent.address, "--json", "--lines", "30"]);
              if (result.code !== 0) throw new Error(result.stderr.trim() || "无法读取终端");
              const snapshot = JSON.parse(result.stdout);
              if (typeof snapshot.text !== "string") throw new Error("终端快照缺少文本");
              const text = snapshotText(snapshot.text);
              if (!hasTaskText(text)) {
                this.storeAgent(agent.address, { ...record, source: record.title ? "generated" : "waiting" });
                continue;
              }
              this.storeAgent(agent.address, { ...record, source: "generating" });
              const title = await this.generate(agent, text);
              const live = liveAgents().find(a => a.address === agent.address);
              if (!live || agentKey(live) !== key) continue;
              const reported = reportedTitle(live);
              this.storeAgent(agent.address, { ...record, title: reported || title, source: reported ? "reported" : "generated", generatedTurn: agent.turn, updatedAt: Date.now(), error: null });
            } catch (error) {
              this.storeAgent(agent.address, { ...record, source: "error", error: String(error.message ?? error) });
            }
          } else if (!previous || previous.key !== key) this.storeAgent(agent.address, record);
        }
        const final = state();
        if (final.lock?.owner === this.address) {
          if (shared(ENABLED) !== false) this.renameTabs(current);
          const latest = state();
          latest.lock = { owner: this.address, until: Date.now() + 8000 };
          save(latest);
        }
        this.runtimeError = null;
      } catch (error) {
        this.runtimeError = String(error.message ?? error);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  manualTitle(address) {
    const record = state().agents[address];
    if (!record?.title) throw new Error("该 Agent 暂无可固定的自动标题");
    const tab = spaces().flatMap(space => space.tabs).find(tab => tab.id === liveAgents().find(agent => agent.address === address)?.tab);
    if (!tab) throw new Error("该 Agent 当前没有可命名的标签");
    const next = state();
    next.tabs = { ...next.tabs, [tab.id]: { mode: "manual", applied: record.title } };
    save(next);
    run("tab.rename", { id: tab.id, name: record.title });
  }

  automaticTab(id) {
    const tab = spaces().flatMap(space => space.tabs).find(tab => tab.id === id);
    if (!tab) throw new Error("目标标签已关闭");
    const next = state();
    next.tabs = { ...next.tabs, [id]: { mode: "auto", applied: null } };
    save(next);
    run("tab.rename", { id: tab.id, name: "" });
  }

  storeAgent(address, record) {
    const next = state();
    next.agents = { ...next.agents, [address]: record };
    save(next);
  }

  async generate(agent, text) {
    await mkdir(DIRECTORY(), { recursive: true });
    const file = `${DIRECTORY()}/request-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    const request = { version: 1, agent: { address: agent.address, app: agent.app, cwd: agent.cwd, program: { name: agent.program?.name } }, text, config: this.config };
    await writeTextFile(file, JSON.stringify(request), null);
    try {
      const result = await exec(this.config.node, [`${appHome()}/mods/agent-autoname/runner.mjs`, file]);
      if (result.code !== 0) throw new Error(result.stderr.trim().slice(-600) || "命名进程失败");
      const response = JSON.parse(result.stdout);
      if (typeof response.title !== "string" || !response.title) throw new Error("命名进程没有返回标题");
      return response.title;
    } finally {
      // 执行器正常结束时已删除文件；启动失败时由当前进程清理。
      if (await readTextFile(file) !== null) await unlink(file);
    }
  }

  renameTabs(current) {
    const next = state();
    const entries = spaces().flatMap(space => space.tabs);
    const ids = new Set(entries.map(tab => tab.id));
    next.tabs = Object.fromEntries(Object.entries(next.tabs).filter(([id]) => ids.has(id)));
    for (const tab of entries) {
      const members = current.filter(a => a.tab === tab.id || (!a.tab && a.labels?.["herdr.tab"] === tab.id));
      const plan = planTabName(tab, next.tabs[tab.id], members, next.agents, Date.now());
      if (!plan) continue;
      next.tabs[tab.id] = plan.record;
      if (!plan.rename) continue;
      save(next);
      run("tab.rename", { id: tab.id, name: plan.rename });
    }
    save(next);
  }

  render(cx) {
    const t = theme(), entries = Object.entries(state().agents), enabled = shared(ENABLED) !== false;
    const failed = this.configError || this.runtimeError || entries.some(([, a]) => a.error);
    const generated = entries.filter(([, a]) => a.title).length;
    if (!this.popup) {
      return h_flex().size_full().px(10).gap(6).items_center().justify_end().text_size(11.8).text_color(failed ? t.blocked : t.muted)
        .id("agent-autoname-status").role("button").accessibility_label("自动命名详情").cursor_pointer().hover(s => s.bg(t.hover))
        .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
        .on_click(() => openOverlay({ mod: "agent-autoname", kind: "dialog", width: 720, height: 580 }))
        .when(this.busy, el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).spin(900)))
        .child(failed ? "自动命名：有错误" : enabled ? `自动命名 ${generated}/${entries.length}` : "自动命名：暂停");
    }
    const names = liveAgents();
    const manualTabs = spaces().flatMap(space => space.tabs.map(tab => ({ space, tab })))
      .filter(({ tab }) => state().tabs[tab.id]?.mode === "manual");
    return v_flex().size_full().p(20).gap(14).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(h_flex().items_center().gap(10).child(div().text_size(18).font_medium().child("跨 Agent 自动命名")).child(div().flex_1())
        .child(control("close", "关闭", () => closeOverlay(this.overlay), t)))
      .child(div().text_color(t.muted).child("自动读取现有标题；缺失时，用短终端快照生成任务名。手动标签名优先。"))
      .child(h_flex().gap(8)
        .child(control("toggle", enabled ? "暂停自动命名" : "恢复自动命名", () => setShared(ENABLED, !enabled), t))
        .child(control("refresh", "重新生成", () => setShared(REFRESH, Date.now()), t)))
      .when(Boolean(this.configError || this.runtimeError), el => el.child(div().text_color(t.blocked).child(this.configError || this.runtimeError)))
      .child(v_flex().id("autoname-list").flex_1().min_h(0).overflow_y_scrollbar().gap(6)
        .children(entries.map(([address, a]) => v_flex().p(10).gap(3).border_b_1().border_color(t.border)
          .child(h_flex().gap(8).child(div().text_color(t.dim).child(`${address} · ${names.find(n => n.address === address)?.program?.name ?? "Agent"}`))
            .child(div().flex_1()).child(div().text_size(11).text_color(t.dim).child(({reported:"原生标题",generated:"模型生成",waiting:"等待内容",reading:"读取终端",generating:"生成中",error:"失败"})[a.source] ?? a.source)))
          .child(div().child(a.title || "等待任务名称"))
          .when(Boolean(a.error), el => el.child(div().text_size(12).text_color(t.blocked).child(a.error)))
          .when(a.title && a.source === "generated", el => el.child(control(`manual-${address}`, "固定此名称", () => this.manualTitle(address), t))))))
      .when(manualTabs.length > 0, el => el.child(v_flex().gap(5)
        .child(div().text_size(12).text_color(t.muted).child("手动标签名（保留不变）"))
        .children(manualTabs.map(({ space, tab }) => h_flex().id(`manual-tab-${tab.id}`).gap(8).items_center()
          .child(div().min_w(0).flex_1().truncate().child(`${space.name} · ${tab.name}`))
          .child(control(`automatic-${tab.id}`, "恢复自动", () => this.automaticTab(tab.id), t))))))
      .child(div().text_size(11.5).text_color(t.dim).child("缺少原生任务标题时，会把最近最多 6000 个字符的终端快照发送给你配置的模型。常见密钥格式会脱敏，但无法保证识别所有秘密；日志只存标题和脱敏后的错误。"));
  }
}
