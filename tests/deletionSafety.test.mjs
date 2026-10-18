import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
function moduleUrl(path,replacements={}) {
  let source=readFileSync(new URL(path,import.meta.url),'utf8')
  for(const [from,to] of Object.entries(replacements))source=source.replaceAll(from,to)
  return 'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')
}
const mutationUrl=moduleUrl('../src/lib/localMutation.ts')
const cvUrl=moduleUrl('../src/types/cv.ts')
const {commitLocalMutation,recoverLocalMutation,withLocalMutation}=await import(mutationUrl)
const {createDefaultLibrary,createEmptyMasterCv}=await import(cvUrl)
const {deleteLocalCv,removeCvTemplate}=await import(moduleUrl('../src/lib/cvLibrary.ts',{'./localMutation':mutationUrl,'../types/cv':cvUrl}))
const {purgeLocalJobs,purgeSnapshot,capturePurgeTargets}=await import(moduleUrl('../src/lib/purgeJobs.ts',{'./localMutation':mutationUrl}))
const {captureTailoringInput}=await import(moduleUrl('../src/lib/tailoringInputs.ts'))
const {validateJobSource,validateSearchSource,searchHasLiveSource}=await import(moduleUrl('../src/lib/cvSources.ts'))
const {storedCvContent}=await import(moduleUrl('../src/lib/storedCv.ts',{'../types/cv':cvUrl}))
const storage=initial=>{const values=new Map(Object.entries(initial));return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}}
const a='2026-10-18T00:00:00Z',b='2026-10-18T00:01:00Z'
test('fixed Trash set excludes later arrivals, restores, re-trash timestamps and unrelated documents',()=>{
  const initial=[{id:'eligible',deletedAt:a},{id:'restored',deletedAt:a},{id:'retrashed',deletedAt:a}]
  const targets=capturePurgeTargets(initial)
  const current=[initial[0],{id:'restored',deletedAt:null},{id:'retrashed',deletedAt:b},{id:'new',deletedAt:a},{id:'active',deletedAt:null}]
  const docs=current.map(job=>({id:'doc-'+job.id,jobApplicationId:job.id,masterCvSnapshot:{summary:'Keep '+job.id}}))
  const result=purgeSnapshot(current,docs,targets)
  assert.deepEqual(result.deleted,['eligible']);assert.deepEqual(result.jobs,current.slice(1));assert.deepEqual(result.docs,docs.slice(1))
  assert.throws(()=>purgeSnapshot(current,docs,[targets[0],targets[0]]),/Duplicate/)
})
test('purge transaction rolls back jobs/docs and crash recovery is owner-scoped',()=>{
  const store=storage({'job-tracker-applications':JSON.stringify([{id:'eligible',deletedAt:a}]),'applytrack-tailored-docs':JSON.stringify([{id:'doc',jobApplicationId:'eligible'}]),preference:'keep'})
  const before=new Map(store.values),write=store.setItem
  let fail=true
  store.setItem=(key,value)=>{if(key==='applytrack-tailored-docs'&&fail){fail=false;throw Error('disk full')}return write(key,value)}
  assert.throws(()=>purgeLocalJobs(store,[{id:'eligible',deletedAt:a}]),/disk full/);assert.deepEqual(store.values,before)
  const journal='applytrack-local-mutation-v1'
  write(journal,JSON.stringify({owner:'local',before:Object.fromEntries(before)}));write('job-tracker-applications','[]')
  assert.throws(()=>recoverLocalMutation(store,'other-owner'),/different account/)
  assert.ok(store.getItem(journal));recoverLocalMutation(store)
  assert.deepEqual(store.values,before)
  purgeLocalJobs(store,[{id:'eligible',deletedAt:a}]);assert.equal(store.getItem('job-tracker-applications'),'[]');assert.equal(store.getItem('applytrack-tailored-docs'),'[]');assert.equal(store.getItem('preference'),'keep')
})
test('failed rollback retains recovery journal until storage becomes writable',()=>{
  const store=storage({one:'original',two:'original'}),write=store.setItem
  let fail=true
  store.setItem=(key,value)=>{if(key==='two'&&fail)throw Error('still full');write(key,value)}
  assert.throws(()=>commitLocalMutation(store,{one:'new',two:'new'}),/still full/)
  assert.ok(store.getItem('applytrack-local-mutation-v1'));fail=false;recoverLocalMutation(store)
  assert.deepEqual(Object.fromEntries(store.values),{one:'original',two:'original'})
})
test('CV deletion pins implicit defaults and Saved Trash, pauses explicit searches only, never writes stored docs',()=>{
  const library=createDefaultLibrary()
  const jobs=[{id:'implicit',status:'saved',cvTrack:null,matchScore:88},{id:'trash',status:'saved',cvTrack:'powerPlatform',deletedAt:a},{id:'applied',status:'applied',cvTrack:'powerPlatform',notes:'history'},{id:'other',status:'saved',cvTrack:'frontend'}]
  const searches=[{id:'active',track:'powerPlatform',active:true},{id:'paused',track:'powerPlatform',active:false},{id:'auto',track:'auto',active:true}]
  const docs=JSON.stringify([{id:'doc',jobApplicationId:'implicit',masterCvSnapshot:createEmptyMasterCv({summary:'Original facts'}),tailoredCv:createEmptyMasterCv({summary:'Original output'}),coverLetter:'Original cover'}])
  const store=storage({'applytrack-master-cv':JSON.stringify(library),'job-tracker-applications':JSON.stringify(jobs),'applytrack-saved-searches':JSON.stringify(searches),'applytrack-inbox':'[]','applytrack-tailored-docs':docs})
  const next=deleteLocalCv(store,library,'powerPlatform')
  const updated=JSON.parse(store.getItem('job-tracker-applications')),saved=JSON.parse(store.getItem('applytrack-saved-searches'))
  for(const job of updated.slice(0,2)){assert.equal(job.cvTrack,'powerPlatform');assert.equal(job.needsCvSelection,true)}
  assert.equal(updated[0].matchScore,88);assert.deepEqual(updated.slice(2),jobs.slice(2));assert.equal(store.getItem('applytrack-tailored-docs'),docs)
  for(const search of saved.slice(0,2)){assert.equal(search.track,'powerPlatform');assert.equal(search.needsCvSelection,true);assert.equal(search.active,false)}
  assert.deepEqual(saved[2],searches[2]);assert.equal(next.activeTrack,'frontend')
  assert.equal(captureTailoringInput(updated[0],next),null)
  const chosen={...updated[0],cvTrack:'frontend',needsCvSelection:false}
  assert.ok(captureTailoringInput(chosen,next));assert.equal(store.getItem('applytrack-tailored-docs'),docs)
  assert.throws(()=>validateJobSource(next,{...updated[0],needsCvSelection:false}),/Choose/)
  assert.throws(()=>validateSearchSource(next,{...saved[0],active:true}),/Choose/)
  assert.equal(searchHasLiveSource(next,saved[0]),false)
})
test('library revision conflicts fail before mutation and deterministic default has local/SQL parity',()=>{
  const library=createDefaultLibrary();library.cvs.z=createEmptyMasterCv();library.cvs.a=createEmptyMasterCv()
  const next=removeCvTemplate(library,'powerPlatform',[],[],[]);assert.equal(next.library.activeTrack,'a')
  const store=storage({'applytrack-master-cv':JSON.stringify({...library,updatedAt:'new revision'})})
  const before=new Map(store.values)
  assert.throws(()=>deleteLocalCv(store,library,'powerPlatform'),/another tab/);assert.deepEqual(store.values,before)
})
test('serialized local operations use current storage and a rejection does not poison the queue',async()=>{
  const order=[]
  await Promise.allSettled([withLocalMutation(async()=>{order.push('first');await Promise.resolve();throw Error('expected')}),withLocalMutation(()=>order.push('second'))])
  assert.deepEqual(order,['first','second'])
})
test('legacy stored output remains usable without a source snapshot or fabricated personal fields',()=>{
  const legacy={summary:'Actual stored summary',headline:'Actual stored headline'}
  const before=JSON.stringify(legacy)
  const cv=storedCvContent(legacy)
  assert.equal(cv.summary,legacy.summary);assert.equal(cv.contact.location,'');assert.equal(cv.contact.name,'');assert.deepEqual(cv.skills,[]);assert.equal(JSON.stringify(legacy),before)
  assert.equal(storedCvContent(null),null)
})

test('source flags round-trip in database mappings and legacy rows default false', async()=>{
  const jobUrl=moduleUrl('../src/types/job.ts')
  const queryUrl=moduleUrl('../src/lib/adzunaQuery.ts')
  const db=await import(moduleUrl('../src/lib/database.ts',{'../types/cv':cvUrl,'../types/job':jobUrl,'./adzunaQuery':queryUrl}))
  const {createEmptyJob,createEmptySavedSearch}=await import(jobUrl)
  const job=createEmptyJob({cvTrack:'archived',needsCvSelection:true})
  assert.equal(db.rowToJob(db.jobToRow(job,'owner')).needsCvSelection,true)
  const row=db.jobToRow(job,'owner');delete row.needs_cv_selection
  assert.equal(db.rowToJob(row).needsCvSelection,false)
  const search=createEmptySavedSearch({track:'archived',active:false,needsCvSelection:true})
  assert.equal(db.rowToSavedSearch(db.savedSearchToRow(search,'owner')).needsCvSelection,true)
  const library=createDefaultLibrary();delete library.cvs.powerPlatform
  for(const active of [false,true]) {
    assert.equal(searchHasLiveSource(library,{...search,active}),false)
    assert.throws(()=>validateSearchSource(library,{...search,active:true}),/Choose/)
  }
  assert.doesNotThrow(()=>validateSearchSource(library,{...search,track:'auto',needsCvSelection:false,active:false}))
})

test('actual stored legacy content exports to DOCX and print without a live/default CV', async()=>{
  const exporter=await import(moduleUrl('../src/lib/docxExport.ts',{"'docx'":JSON.stringify(import.meta.resolve('docx')),"'jszip'":JSON.stringify(import.meta.resolve('jszip')),'../types/cv':cvUrl}))
  const JSZip=(await import('jszip')).default
  const cv=storedCvContent({summary:'Retained & original facts',headline:'Retained headline'})
  const before=JSON.stringify(cv)
  const zip=await JSZip.loadAsync(await (await exporter.buildCvDocxBlob(cv)).arrayBuffer())
  const xml=await zip.file('word/document.xml').async('string')
  assert.match(xml,/Retained &amp; original facts/)
  assert.doesNotMatch(xml,/Software Engineer|Canada/)
  const letter=await JSZip.loadAsync(await (await exporter.buildCoverLetterDocxBlob('Original retained letter',{company:'Synthetic',role:'Role',candidateName:''})).arrayBuffer())
  assert.match(await letter.file('word/document.xml').async('string'),/Original retained letter/)
  const oldWindow=globalThis.window
  let html='',printed=false
  globalThis.window={open:()=>({document:{open(){},write(value){html=value},close(){}},focus(){},print(){printed=true}})}
  try {exporter.openCvPrintWindow(cv,'Stored output');await new Promise(resolve=>setTimeout(resolve,275))}
  finally {globalThis.window=oldWindow}
  assert.match(html,/Retained &amp; original facts/);assert.doesNotMatch(html,/Software Engineer|Canada/);assert.equal(printed,true)
  assert.equal(JSON.stringify(cv),before)
})
