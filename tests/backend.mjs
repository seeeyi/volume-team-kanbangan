import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
// Set PGLITE_MODULE when running outside a checkout with @electric-sql/pglite installed.
const {PGlite} = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
create publication supabase_realtime;`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/001_team_workspace.sql',import.meta.url),'utf8'));
const si='00000000-0000-0000-0000-000000000001',mitch='00000000-0000-0000-0000-000000000002', outsider='00000000-0000-0000-0000-000000000003',id='10000000-0000-0000-0000-000000000001';
await db.query('insert into auth.users values ($1),($2),($3)',[si,mitch,outsider]);
await db.query("insert into public.vp_team_members values($1,'Si','admin'),($2,'Mitch','editor')",[si,mitch]);
const data={version:1,tasks:[{id:'VP-1',title:'Test task',project:'Test',owner:'Mitch',priority:1,status:'To do',start:'',end:'',next:'Next',notes:'',source:'',dependency:'',dateKind:'Proposed',review:false,checklist:[],editedBy:'Ken',editedAt:'forged'}],meeting:{label:'TEAM',title:'Notes',body:'',editedBy:'Ken',editedAt:'forged'}};
async function asUser(user,sql,params=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);try{return await db.query(sql,params);}finally{await db.exec('reset role');}}
async function rpc(user,name,args){return (await asUser(user,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;}
const created=await rpc(si,'vp_create_workspace',[id,'Team',data]);assert.equal(created.revision,1);assert.equal(created.data.tasks[0].editedBy,'Si');assert.equal(created.activity[0].actor,'Si');
assert.equal((await rpc(mitch,'vp_read_workspace',[id])).id,id);
assert.equal((await asUser(outsider,'select * from public.vp_workspaces')).rows.length,0);
await assert.rejects(()=>rpc(outsider,'vp_read_workspace',[id]),/Team access required/);
await assert.rejects(()=>rpc(outsider,'vp_save_workspace',[id,1,'Team',data,'spoof']),/Team access required/);
await assert.rejects(()=>rpc(mitch,'vp_create_workspace',['10000000-0000-0000-0000-000000000002','No',data]),/Admin required/);
await assert.rejects(()=>rpc(mitch,'vp_save_workspace',[id,1,'Rename',data,'rename']),/Admin required/);
await assert.rejects(()=>asUser(mitch,"update public.vp_workspaces set name='Bad'"),/permission denied/);
await assert.rejects(()=>asUser(mitch,"update public.vp_team_members set role='admin'"),/permission denied/);
await assert.rejects(()=>asUser(mitch,"insert into public.vp_activity(workspace_id,actor_id,actor,message) values($1,$2,'Ken','fake')",[id,mitch]),/permission denied/);
const changed=structuredClone(data);changed.tasks[0].status='Done';changed.tasks[0].editedBy='Ken';
const saved=await rpc(mitch,'vp_save_workspace',[id,1,'Team',changed,'Task saved']);assert.equal(saved.revision,2);assert.equal(saved.data.tasks[0].editedBy,'Mitch');assert.equal(saved.activity.at(-1).actor,'Mitch');assert.equal(saved.data.meeting.editedBy,'Si');
await assert.rejects(()=>rpc(si,'vp_save_workspace',[id,1,'Team',data,'Stale save']),/Workspace changed/);assert.equal((await rpc(si,'vp_read_workspace',[id])).data.tasks[0].status,'Done');
for(const mutation of [d=>d.tasks.push(structuredClone(d.tasks[0])),d=>d.tasks[0].dependency='VP-1',d=>d.tasks[0].dependency='missing',d=>d.tasks[0].owner='Imposter',d=>d.tasks[0].start='2026-02-30',d=>d.tasks[0].start='2026-10-14',d=>d.tasks[0].checklist=[{text:'bad',done:'yes'}]]){const bad=structuredClone(data);mutation(bad);await assert.rejects(()=>rpc(si,'vp_save_workspace',[id,2,'Team',bad,'Invalid']));}
await db.exec('set role anon');await assert.rejects(()=>db.query('select public.vp_read_workspace($1)',[id]),/permission denied/);await db.exec('reset role');
assert.equal((await rpc(si,'vp_read_workspace',[id])).revision,2);
console.log('PASS: SQL migration, member access, anonymous denial, direct-write denial, admin permissions, server attribution, immutable history, stale-save rejection, invalid data rollback.');
await db.close();
