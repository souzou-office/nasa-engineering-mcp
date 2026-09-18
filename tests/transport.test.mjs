import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { FileTaskStore } from '../src/tasks.mjs';
import { createEngineeringHttpServer } from '../src/http.mjs';

const init = {protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'regression-test',version:'1'}};
function directory(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-transport-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir; }
function client(t, dir) {
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/stdio.mjs',import.meta.url))],{env:{...process.env,ENGINEERING_STATE_DIR:dir},stdio:['pipe','pipe','pipe']});
  let seq=0;const pending=new Map();child.stderr.resume();
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);});
  const close=async()=>{lines.close();if(child.exitCode===null && child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}};
  t.after(close);
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC timeout: '+method));},5000);pending.set(id,result=>{clearTimeout(timer);pending.delete(id);resolve(result);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  return {close,rpc,tool:async(name,args)=>{const r=await rpc('tools/call',{name,arguments:args});if(r.error||r.result?.isError)return {error:r};return JSON.parse(r.result.content[0].text);},initialize:async()=>{await rpc('initialize',init);child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');}};
}

test('stdio: server-owned rules persist across process restart and reject old contracts', async t => {
  const dir=directory(t), c=client(t,dir);await c.initialize();
  assert.equal((await c.rpc('tools/list',{})).result.tools.length,7);
  assert.equal((await c.tool('engineering_catalog',{})).rule_count,168);
  const first=await c.tool('engineering_rules_for_task',{taskType:'feature'});
  assert.equal(first.active_rule_ids.length,26);
  assert.ok((await c.tool('engineering_rules_for_task',{taskType:'authentcation'})).error);
  assert.equal((await c.tool('engineering_lookup',{ruleIds:[first.active_rule_ids[0]]}))[0].found,true);
  assert.ok((await c.tool('engineering_search',{query:'SWE-146'})).length>0);
  assert.ok((await c.tool('engineering_update_active_rules',{taskId:first.task_id,currentRuleIds:[]})).error);
  const updated=await c.tool('engineering_update_active_rules',{taskId:first.task_id,changedFiles:['package.json']});
  assert.equal(updated.active_count,35);
  await c.close();
  const resumed=client(t,dir);await resumed.initialize();
  const prepared=await resumed.tool('engineering_prepare_review',{taskId:first.task_id,changedFiles:['db/migrations/001.sql']});
  assert.equal(prepared.active_rule_ids.length,42);
  const base={taskId:first.task_id,reviewRevision:prepared.review_revision};
  assert.ok((await resumed.tool('engineering_validate_review',{activeRuleIds:[],reviewItems:[]})).error);
  assert.ok((await resumed.tool('engineering_validate_review',{...base,activeRuleIds:[],reviewItems:[]})).error);
  assert.equal((await resumed.tool('engineering_validate_review',{...base,reviewItems:[]})).missing_must_rules.length,42);
  const items=prepared.active_rule_ids.map(rule_id=>({rule_id,status:'pass',evidence:'Synthetic transport fixture'}));
  assert.equal((await resumed.tool('engineering_validate_review',{...base,reviewItems:items.slice(0,1)})).complete,false);
  assert.equal((await resumed.tool('engineering_validate_review',{...base,reviewItems:[{...items[0],status:'fail'},...items]})).complete,false);
  assert.equal((await resumed.tool('engineering_validate_review',{...base,reviewItems:items})).complete,true);
  await resumed.tool('engineering_update_active_rules',{taskId:first.task_id});
  assert.ok((await resumed.tool('engineering_validate_review',{...base,reviewItems:items})).error);
});

async function httpFixture(t, env) {
  const {server}=createEngineeringHttpServer({env:{PORT:'0',...env},store:new FileTaskStore(directory(t))});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const url=`http://127.0.0.1:${server.address().port}/mcp`;
  return async(method,params,extra={})=>{
    const {status,text}=await new Promise((resolve,reject)=>{
      const req=httpRequest(url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...extra}},res=>{let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,text}));});
      req.on('error',reject);req.end(JSON.stringify({jsonrpc:'2.0',id:1,method,params}));
    });
    let message;
    if(status===200) message=JSON.parse(text.startsWith('event:') ? text.split('\n').find(l=>l.startsWith('data: ')).slice(6) : text);
    return {status,message};
  };
}
test('HTTP: non-default ports work, absent Origin works, unknown Origin/Host are denied',async t=>{
  const request=await httpFixture(t,{});
  assert.equal((await request('initialize',init)).status,200);
  assert.equal((await request('initialize',init,{origin:'https://untrusted.example'})).status,403);
  assert.equal((await request('initialize',init,{host:'untrusted.example'})).status,403);
  assert.throws(()=>createEngineeringHttpServer({env:{ALLOWED_HOSTS:''}}),/must not be empty/);
});
test('HTTP: explicit Origin and state across independent requests',async t=>{
  const request=await httpFixture(t,{ALLOWED_ORIGINS:'https://allowed.example'});
  assert.equal((await request('initialize',init,{origin:'https://allowed.example'})).status,200);
  assert.equal((await request('initialize',init,{origin:'https://untrusted.example'})).status,403);
  const tool=async(name,args)=>{const r=await request('tools/call',{name,arguments:args});assert.equal(r.status,200);assert.ok(!r.message.result.isError,JSON.stringify(r.message));return JSON.parse(r.message.result.content[0].text);};
  const first=await tool('engineering_rules_for_task',{taskType:'feature'});
  await tool('engineering_update_active_rules',{taskId:first.task_id,changedFiles:['package.json']});
  const review=await tool('engineering_prepare_review',{taskId:first.task_id,changedFiles:[]});
  const result=await tool('engineering_validate_review',{taskId:first.task_id,reviewRevision:review.review_revision,reviewItems:[]});
  assert.equal(result.complete,false);assert.equal(result.missing_must_rules.length,35);
});
