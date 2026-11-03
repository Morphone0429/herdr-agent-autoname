import { generateTitle } from "../mods/agent-autoname/runner.mjs";
const config={command:process.env.AUTONAME_PI_COMMAND ?? "pi",model:process.env.AUTONAME_MODEL ?? "magpie/auto/deepseek-v4.1-flash",timeoutMs:22000};
const title=await generateTitle(config,{agent:{app:"custom-agent",program:{name:"Custom Agent"},cwd:"/example/project"},text:"用户要求：修复支付接口的重复扣款问题，并补充请求重试的回归测试。当前正在检查幂等键校验。"});
console.log(JSON.stringify({title,model:config.model,verified:true},null,2));
