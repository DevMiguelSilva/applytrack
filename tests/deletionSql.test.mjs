import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

test('isolated PostgreSQL: fixed-target purge, owner isolation, CV archive/pause, guarded saves and rollback', {skip:!process.env.APPLYTRACK_SQL_TEST_RUNTIME}, async () => {
  const {PGlite}=await import(pathToFileURL(process.env.APPLYTRACK_SQL_TEST_RUNTIME).href)
  const db=new PGlite()
  await db.exec("set statement_timeout='5s'")
  const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002'
  const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
  const t0='2026-10-18T00:00:00.000Z',t1='2026-10-18T00:01:00.000Z'
  const q=async(sql,args=[])=> (await db.query(sql,args)).rows
  const root=()=>db.exec('reset role')
  const actor=async user=>{await root();await q("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await db.exec('set role authenticated')}
  const count=async(table,job)=>Number((await q(`select count(*) n from ${table} where ${table==='tailored_documents'?'job_application_id':'id'}=$1`,[id(job)]))[0].n)
  const library={version:2,activeTrack:'a',names:{a:'Original',b:'Remaining'},cvs:{a:{summary:'Original facts'},b:{summary:'Other facts'}},attachments:{a:{extractedText:'original attachment'},b:null},updatedAt:t0}
  const job=async(n,user=A,cv='a')=>q('insert into job_applications(id,user_id,company,role,cv_track,match_score) values($1,$2,$3,$4,$5,86)',[id(n),user,'Synthetic','Synthetic role',cv])
  const doc=async(n,user=A)=>q('insert into tailored_documents(id,user_id,job_application_id,master_cv_snapshot,tailored_cv,cover_letter) values($1,$2,$3,$4,$5,$6)',[id(n+1000),user,id(n),JSON.stringify({summary:'Original snapshot',contact:{name:'Synthetic'}}),JSON.stringify({summary:'Tailored facts'}),'Saved original cover letter'])
  const purge=targets=>q('select purge_trashed_jobs($1::jsonb) deleted',[JSON.stringify(targets.map(([n,date])=>({id:id(n),deleted_at:date})))])
  const libraryNow=async()=> (await q('select document from master_cvs where user_id=$1',[A]))[0].document
  const deleteCv=(name,expected,owner=A)=>q('select delete_cv_template_v2($1,$2::jsonb,$3) document',[name,JSON.stringify(expected),owner])
  const originalDocs=()=>q('select id,master_cv_snapshot,tailored_cv,cover_letter,gap_report,match_score,created_at,updated_at from tailored_documents order by id')
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`)
    await db.exec(await fs.readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'))
    const migration=await fs.readFile(new URL('../supabase/migrations/202610180001_deletion_safety.sql',import.meta.url),'utf8')
    await db.exec(migration);await db.exec(migration)
    console.log('SQL phase: schema/migration ready')
    await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated')
    await q('insert into auth.users(id) values($1),($2)',[A,B])
    for(const user of [A,B])await q('insert into master_cvs(user_id,document) values($1,$2::jsonb)',[user,JSON.stringify(library)])
    for(const n of [101,102,103,104]){await job(n);await doc(n)}
    await job(201,B);await doc(201,B)
    await q('update job_applications set deleted_at=$1 where id=any($2::uuid[])',[t0,[id(101),id(102),id(201)]])
    // Confirmation occurs here; new arrival/restored/re-trashed rows must survive.
    const targets=[[101,t0],[102,t0],[103,t0],[201,t0]]
    await q('update job_applications set deleted_at=null where id=$1',[id(102)])
    await q('update job_applications set deleted_at=$1 where id=$2',[t1,id(102)])
    await q('update job_applications set deleted_at=$1 where id=$2',[t0,id(104)])
    await actor(A)
    console.log('SQL phase: confirmed purge')
    assert.equal((await q('select count(*) n from job_applications where user_id=$1',[B]))[0].n,0)
    assert.deepEqual((await purge(targets))[0].deleted,[id(101)])
    assert.equal(await count('job_applications',101),0);assert.equal(await count('tailored_documents',101),0)
    for(const n of [102,103,104]){assert.equal(await count('job_applications',n),1);assert.equal(await count('tailored_documents',n),1)}
    await root();assert.equal(await count('job_applications',201),1);assert.equal(await count('tailored_documents',201),1)
    await actor(A)
    await assert.rejects(q('select purge_trashed_jobs($1::jsonb)',[JSON.stringify([{id:id(104),deleted_at:t0},{id:'invalid uuid',deleted_at:t0}])]))
    assert.equal(await count('job_applications',104),1)
    await assert.rejects(purge([[104,t0],[104,t0]]),/Duplicate/)
    await actor(null);await assert.rejects(purge([[104,t0]]),/Sign in/)
    await root();await db.exec('set role anon');await assert.rejects(purge([[104,t0]]),/permission denied/)
    await root()
    await db.exec(`create function reject_test_cascade() returns trigger language plpgsql as $$begin raise exception 'Synthetic cascade failure';end$$;create trigger test_cascade before delete on tailored_documents for each row execute function reject_test_cascade();`)
    await actor(A);await assert.rejects(purge([[104,t0]]),/Synthetic cascade failure/)
    assert.equal(await count('job_applications',104),1);assert.equal(await count('tailored_documents',104),1)
    await root();await db.exec('drop trigger test_cascade on tailored_documents;drop function reject_test_cascade()')

    for(const n of [111,112,113,114,115,116])await job(n,A,n===112?null:n===116?'b':'a')
    for(const n of [111,114,115])await doc(n)
    await q("update job_applications set status='applied' where id=$1",[id(114)])
    await q("update job_applications set status='offer' where id=$1",[id(115)])
    await q('update job_applications set deleted_at=$1 where id=$2',[t0,id(113)])
    for(const [n,track,active] of [[501,'a',true],[502,'a',false],[503,'auto',true],[504,'b',true]])await q('insert into saved_searches(id,user_id,query,track,active) values($1,$2,$3,$4,$5)',[id(n),A,'synthetic',track,active])
    for(const [n,search,status] of [[601,501,'new'],[602,503,'new'],[603,501,'approved']])await q('insert into job_inbox(id,user_id,external_id,matched_track,match_score,saved_search_id,status) values($1,$2,$3,$4,90,$5,$6)',[id(n),A,'synthetic-'+n,'a',id(search),status])
    const preserved=await originalDocs()
    console.log('SQL phase: CV deletion fixture ready')
    const historical=await q('select * from job_applications where id=any($1::uuid[]) order by id',[[id(114),id(115)]])
    await actor(A)
    await assert.rejects(deleteCv('a',library,B),/Account changed/)
    const next=(await deleteCv('a',library))[0].document
    console.log('SQL phase: CV deleted; checking references')
    assert.deepEqual(Object.keys(next.cvs),['b']);assert.equal(next.activeTrack,'b')
    for(const n of [111,112,113]){const row=(await q('select * from job_applications where id=$1',[id(n)]))[0];assert.equal(row.cv_track,'a');assert.equal(row.needs_cv_selection,true);assert.equal(row.match_score,86)}
    assert.equal((await q('select needs_cv_selection from job_applications where id=$1',[id(116)]))[0].needs_cv_selection,false)
    assert.deepEqual(await q('select * from job_applications where id=any($1::uuid[]) order by id',[[id(114),id(115)]]),historical)
    for(const n of [501,502]){const row=(await q('select track,active,needs_cv_selection from saved_searches where id=$1',[id(n)]))[0];assert.deepEqual(row,{track:'a',active:false,needs_cv_selection:true})}
    assert.equal((await q('select active from saved_searches where id=$1',[id(503)]))[0].active,true)
    const inbox=await q('select matched_track,needs_cv_selection,status,match_score from job_inbox order by external_id')
    assert.deepEqual(inbox[0],{matched_track:null,needs_cv_selection:true,status:'new',match_score:0})
    assert.equal(inbox[1].needs_cv_selection,false);assert.equal(inbox[1].matched_track,null)
    assert.deepEqual(inbox[2],{matched_track:'a',needs_cv_selection:false,status:'approved',match_score:90})
    await assert.rejects(q("update job_inbox set matched_track='a',match_score=99 where id=$1",[id(601)]),/source changed/)
    await assert.rejects(q("update job_inbox set matched_track='b',match_score=99 where id=$1",[id(601)]),/Choose a CV/)
    await assert.rejects(q('update saved_searches set active=true'),/Choose a CV/)
    await assert.rejects(q('update saved_searches set needs_cv_selection=false where id=$1',[id(501)]),/Explicitly/)
    await assert.rejects(q('update job_applications set cv_track=null,needs_cv_selection=false where id=$1',[id(111)]),/Explicitly/)
    await assert.rejects(q('update job_applications set match_score=99 where id=$1',[id(111)]),/rescoring/)
    await assert.rejects(deleteCv('b',library),/library changed/)
    await assert.rejects(deleteCv('b',next),/at least one/)
    await q('update job_applications set deleted_at=null where id=$1',[id(113)])
    assert.equal((await q('select needs_cv_selection from job_applications where id=$1',[id(113)]))[0].needs_cv_selection,true)
    await q("update job_applications set status='applied' where id=$1",[id(111)])
    await q("update saved_searches set track='b',needs_cv_selection=false,active=false where id=$1",[id(501)])
    assert.equal((await q('select active from saved_searches where id=$1',[id(501)]))[0].active,false)
    await q('update saved_searches set active=true where id=$1',[id(501)])
    await q("update saved_searches set track='auto',needs_cv_selection=false,active=false where id=$1",[id(502)])
    await root();assert.deepEqual(await originalDocs(),preserved)
    assert.deepEqual((await q('select document from master_cvs where user_id=$1',[B]))[0].document,library)
    assert.ok((await q("select to_regprocedure('delete_cv_template(text,text,jsonb)') name"))[0].name)

    // A delayed result cannot overwrite files after source deletion/reselection or submission.
    await actor(A)
    const oldJob=(await q('select to_jsonb(j) data from job_applications j where id=$1',[id(112)]))[0].data
    await q("update job_applications set cv_track='b',needs_cv_selection=false where id=$1",[id(112)])
    const currentJob=(await q('select to_jsonb(j) data from job_applications j where id=$1',[id(112)]))[0].data
    const document={id:id(1112),job_application_id:id(112),master_cv_snapshot:{summary:'New intentional source'},tailored_cv:{summary:'New intentional output'},cover_letter:'Intentional new letter',gap_report:{},match_score:75,created_at:t0}
    const save=(expectedLibrary,expectedJob)=>q('select save_tailored_document_v2($1::jsonb,$2::jsonb,$3::jsonb,$4)',[JSON.stringify(document),JSON.stringify(expectedLibrary),JSON.stringify(expectedJob),A])
    await assert.rejects(save(library,oldJob),/library changed/)
    await assert.rejects(save(next,oldJob),/inputs changed/)
    await save(next,currentJob)
    assert.equal((await q('select cover_letter from tailored_documents where job_application_id=$1',[id(112)]))[0].cover_letter,'Intentional new letter')
    await q("update job_applications set status='applied' where id=$1",[id(112)])
    await assert.rejects(save(next,currentJob),/Application changed/)
    await root();assert.deepEqual((await originalDocs()).filter(row=>row.id!==id(1112)),preserved)
    console.log('PostgreSQL assertions passed: owner/RLS, tuple predicates, cascades/rollback, CV archived references, paused searches, snapshots/history, last CV/revision, explicit selection and stale/submitted save guards.')
  } finally {await db.close()}
})
