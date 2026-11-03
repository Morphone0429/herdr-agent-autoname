import assert from "node:assert/strict";
import test from "node:test";
import {integrateLayout} from "../scripts/layout.mjs";

test("接入只替换标题显示区域，保留文件面板和原布局",()=>{
 const layout={id:"root",type:"column",children:[
  {id:"tabs",type:"block",content:{mod:"tabs"}},
  {id:"agents",type:"block",content:{mod:"session-titles-agents"}},
  {id:"main",content:{pane:{header:{content:{mod:"session-titles-pane"}}}}},
  {id:"files",content:{mod:"files-plus"}},
  {id:"preview",content:{mod:"preview-plus"}},
  {id:"status",type:"block",size:{px:28},content:{mod:"workspace-status"}}
 ]};
 const before=structuredClone(layout);
 const result=integrateLayout(layout);
 assert.deepEqual(layout,before);
 assert.equal(result.children?.[0].content?.mod,"agent-autoname-tabs");
 assert.equal(result.children?.[1].content?.mod,"agent-autoname-agents");
 assert.equal(result.children?.[2].content?.pane?.header?.content?.mod,"agent-autoname-pane");
 assert.deepEqual(result.children?.slice(3,5),layout.children.slice(3,5));
 assert.equal(result.children?.[5].children?.[1].content?.mod,"agent-autoname");
});

test("不支持的布局显式拒绝，不写入部分变更",()=>{
 const layout={id:"root",type:"row",children:[]};
 assert.throws(()=>integrateLayout(layout),/不符合接入条件/);
 assert.deepEqual(layout,{id:"root",type:"row",children:[]});
});
