const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
class Element{
 constructor(){this.value='';this.style={};this.dataset={};this.firstChild={textContent:''};this.classList={add(){},remove(){},toggle(){}};this.listeners={};this.innerHTML='';this.textContent='';this.open=false;}
 addEventListener(k,v){this.listeners[k]=v;} setAttribute(){} hasAttribute(){return false;} showModal(){this.open=true;} close(){this.open=false;} closest(){return this;} querySelector(){return this;} click(){}
}
const elements=new Map(),get=s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s)};get('#group').value='status';get('#focus-length').value='15';
const storage=new Map(),timers=[],context={console,structuredClone,Date,Intl,Set,JSON,Math,String,Number,Error,crypto:require('crypto').webcrypto,setTimeout:fn=>{timers.push(fn);return 1;},clearTimeout(){},setInterval(){},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},document:{querySelector:get,querySelectorAll:()=>[],body:new Element(),createElement:()=>new Element()},window:{addEventListener(){}},confirm:()=>true,alert(){},Blob,URL};
vm.createContext(context);const run=s=>vm.runInContext(s,context);
run(fs.readFileSync(new URL('../dist/app.js',`file://${__filename}`),'utf8'));run(fs.readFileSync(new URL('../dist/focus.js',`file://${__filename}`),'utf8'));
run("persist()");const localOriginal=storage.get('volume-workspace-v1');
const boardId='10000000-0000-0000-0000-000000000001';let row={id:boardId,name:'Shared team',data:JSON.parse(localOriginal),revision:1,activity:[]},saveCount=0,signoutCount=0,fail=false,releaseSave;
const member={user_id:'member-id',name:'Mitch',role:'editor'},user={id:'member-id',email:'mitch@example.test'};
const client={auth:{onAuthStateChange(){},getSession:async()=>({data:{session:null}}),signInWithPassword:async()=>({data:{user}}),signOut:async()=>{signoutCount++;return {}; }},
from(table){const q={select(){return q},eq(){return q},single:async()=>({data:member}),order:async()=>({data:[{id:boardId,name:row.name}]})};return q;},
channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel:async()=>{},
async rpc(name,args){if(name==='vp_read_workspace')return {data:structuredClone(row)};if(name==='vp_save_workspace'){saveCount++;if(releaseSave)await new Promise(resolve=>releaseSave.resolve=resolve);if(fail)return {error:{code:'40001',message:'conflict'}};assert.equal(args.p_revision,row.revision);row={...row,name:args.p_name,data:structuredClone(args.p_data),revision:row.revision+1,activity:[{id:'event',actor:'Mitch',at:new Date().toISOString(),message:args.p_message,targets:[]}]};row.data.tasks[0].editedBy='Mitch';row.data.tasks[0].editedAt=new Date().toISOString();return {data:structuredClone(row)};}throw Error(name);}};
context.mockSdk={createClient:()=>client};context.window.VOLUME_TEAM_CONFIG={enabled:true,supabaseUrl:'https://test-project.supabase.co',publishableKey:'public-test-key'};
run(fs.readFileSync(new URL('../dist/team-sync.js',`file://${__filename}`),'utf8').replace("import('https://esm.sh/@supabase/supabase-js@2')",'Promise.resolve(mockSdk)'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
await tick();get('#team-email').value=user.email;get('#team-password').value='not-a-real-password';await get('#team-auth-form').listeners.submit({preventDefault(){}});
assert.equal(run('actor'),'Mitch');assert.equal(run('workspaceId'),boardId);assert.equal(get('#editing-as').disabled,true);assert.equal(get('#team-local-import').hidden,true);assert.equal(get('#team-password').value,'');
await run("commit(()=>{tasks[0].status='Done'},'Task saved')");assert.equal(row.data.tasks[0].status,'Done');assert.equal(run('tasks[0].editedBy'),'Mitch');assert.equal(storage.get('volume-workspace-v1'),localOriginal);assert.equal(run('undoStack.length'),1);
await get('#undo').onclick();assert.equal(row.data.tasks[0].status,'In progress');assert.equal(run('undoStack.length'),0);
releaseSave={};const save=run("commit(()=>{tasks[0].status='Waiting'},'Task saved')");await tick();const count=saveCount;await run("commit(()=>{tasks[0].status='Done'},'Other save')");assert.equal(saveCount,count);releaseSave.resolve();releaseSave=null;await save;
fail=true;await run("commit(()=>{tasks[0].status='Done'},'Conflict')");assert.equal(run('tasks[0].status'),'Waiting');assert.equal(get('#team-conflict').open,true);assert.match(get('#team-conflict-message').textContent,/teammate/);
await get('#team-signout').onclick();assert.equal(signoutCount,0);const before=saveCount;await run("commit(()=>{tasks[0].status='Done'},'Blocked')");assert.equal(saveCount,before);
get('#team-conflict-dismiss').onclick();await tick();fail=false;
await get('#team-signout').onclick();assert.equal(signoutCount,1);assert.equal(run('tasks.length'),0);assert.equal(storage.get('volume-workspace-v1'),localOriginal);
console.log('PASS: authenticated actor, shared save, local-data preservation, undo, concurrent edit guard, conflict recovery, unsaved signout guard, session clearing.');
})().catch(e=>{console.error(e);process.exitCode=1});
