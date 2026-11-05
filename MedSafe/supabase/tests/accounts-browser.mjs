// Real browser + bundled Supabase SDK + real PostgreSQL RLS. Auth and the HTTP
// PostgREST adapter are simulated; no requests reach the live Supabase project.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.MEDSAFE_TEST_PGLITE ? pathToFileURL(process.env.MEDSAFE_TEST_PGLITE).href : '@electric-sql/pglite');
const {chromium}=await import(process.env.MEDSAFE_TEST_PLAYWRIGHT ? pathToFileURL(process.env.MEDSAFE_TEST_PLAYWRIGHT).href : 'playwright');
const base=process.env.MEDSAFE_TEST_URL || 'http://127.0.0.1:8002';
const output=fileURLToPath(new URL('./test-output/',import.meta.url));
await mkdir(output,{recursive:true});
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as
 $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated;
 grant execute on function auth.uid() to anon,authenticated;`);
await db.exec(await readFile(new URL('../setup.sql',import.meta.url),'utf8'));
let queue=Promise.resolve();
function serial(fn){const pending=queue.then(fn);queue=pending.catch(()=>{});return pending;}
const password='LocalTestPassword!234';
const people=new Map();
const tokens=new Map();
let nextId=1;
let lastReset=null;
let failWrite=false;
let delayRead=false;
const seen=[];
function addPerson(email,name,role){
 const id=String(nextId++).padStart(8,'0')+'-0000-4000-8000-000000000000';
 const user={id,aud:'authenticated',role:'authenticated',email,created_at:new Date().toISOString(),
  app_metadata:{provider:'email',providers:['email']},user_metadata:{display_name:name,medsafe_role:role}};
 const record={user,password,confirmed:true};people.set(email,record);return record;
}
const A=addPerson('patient-a@example.test','Patient A','patient');
const B=addPerson('patient-b@example.test','Patient B','patient');
const C=addPerson('caregiver@example.test','Caregiver <img src=x onerror="window.bad=true">','caregiver');
for(const person of people.values())await db.query('insert into auth.users values($1)',[person.user.id]);
function session(person){
 const exp=Math.floor(Date.now()/1000)+3600;
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const access=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:person.user.id,role:'authenticated',aud:'authenticated',exp})+'.local-test-signature';
 tokens.set(access,person);
 return {access_token:access,refresh_token:'refresh-'+person.user.id,expires_in:3600,expires_at:exp,token_type:'bearer',user:person.user};
}
function actor(request){return tokens.get((request.headers().authorization || '').replace(/^Bearer /,''));}
const columns={profiles:['id','display_name','role','date_of_birth','created_at','updated_at'],
 medicines:['id','patient_id','patient_role','name','dosage','frequency','stock','created_by','created_at','updated_at'],
 caregiver_links:['patient_id','caregiver_id','patient_role','caregiver_role','can_edit','created_at','updated_at']};
function ident(table,name){assert.ok(columns[table]?.includes(name),'Unexpected SQL column: '+name);return '"'+name+'"';}
async function rest(request,url){
 const person=actor(request),table=url.pathname.split('/').at(-1),method=request.method();
 if(!person)return {status:401,data:{message:'Not signed in'}};
 if(!columns[table])return {status:404,data:{code:'PGRST205',message:'Missing table'}};
 if(failWrite && method!=='GET')return {status:503,data:{message:'Network test: could not save'}};
 if(delayRead && method==='GET')await new Promise(resolve=>setTimeout(resolve,400));
 return serial(async()=>{
  await db.exec('begin; set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[person.user.id]);
  try{
   const values=[],where=[];
   const put=value=>{values.push(value);return '$'+values.length;};
   for(const [key,value] of url.searchParams){
    if(['select','order','offset','limit'].includes(key))continue;
    assert.ok(value.startsWith('eq.'),'Unexpected filter '+value);
    where.push(ident(table,key)+'='+put(value.slice(3)));
   }
   const filter=where.length?' where '+where.join(' and '):'';
   const selection=url.searchParams.get('select') || '*';
   const select=selection==='*'?'*':selection.split(',').map(name=>ident(table,name)).join(',');
   let sql;
   if(method==='GET'){
    sql='select '+select+' from public.'+table+filter;
    const order=url.searchParams.get('order');
    if(order)sql+=' order by '+order.split(',').map(term=>ident(table,term.split('.')[0])+(term.endsWith('.desc')?' desc':' asc')).join(',');
    if(url.searchParams.has('limit'))sql+=' limit '+put(Number(url.searchParams.get('limit')));
    if(url.searchParams.has('offset'))sql+=' offset '+put(Number(url.searchParams.get('offset')));
   }else if(method==='POST'){
    const record=request.postDataJSON();
    const names=Object.keys(record);
    sql='insert into public.'+table+' ('+names.map(name=>ident(table,name)).join(',')+') values ('+names.map(name=>put(record[name])).join(',')+')';
   }else if(method==='PATCH'){
    const record=request.postDataJSON();
    sql='update public.'+table+' set '+Object.keys(record).map(name=>ident(table,name)+'='+put(record[name])).join(',')+filter;
   }else if(method==='DELETE')sql='delete from public.'+table+filter;
   else throw new Error('Unexpected REST method '+method);
   const representation=method==='GET' || (request.headers().prefer || '').includes('return=representation');
   if(method!=='GET' && representation)sql+=' returning '+select;
   const result=await db.query(sql,values);
   // PostgREST serializes a PostgreSQL date as YYYY-MM-DD, whereas PGlite's
   // JavaScript driver returns Date objects. Match the actual HTTP contract.
   for(const row of result.rows){
    if(row.date_of_birth instanceof Date)row.date_of_birth=row.date_of_birth.toISOString().slice(0,10);
   }
   await db.exec('commit');
   if(!representation)return {status:method==='POST'?201:204,data:null};
   if((request.headers().accept || '').includes('vnd.pgrst.object')){
    if(result.rows.length!==1)return {status:406,data:{code:'PGRST116',message:'Expected one row'}};
    return {status:200,data:result.rows[0]};
   }
   return {status:200,data:result.rows};
  }catch(error){await db.exec('rollback');return {status:error.code==='42501'?403:400,data:{code:error.code,message:error.message}};}
 });
}
async function intercept(route){
 const request=route.request(),url=new URL(request.url());
 seen.push(url.pathname);
 const reply=async(status,data)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'},body:data===null?'':JSON.stringify(data)});
 if(request.method()==='OPTIONS')return reply(204,null);
 if(url.pathname.startsWith('/rest/')){const response=await rest(request,url);return reply(response.status,response.data);}
 const body=request.postData()?request.postDataJSON():{};
 if(url.pathname.endsWith('/token')){
  if(url.searchParams.get('grant_type')==='pkce'){
   assert.ok(body.code_verifier?.length>=43);return reply(200,session(people.get(lastReset.email)));
  }
  const person=people.get(body.email);
  if(!person || person.password!==body.password)return reply(400,{code:'invalid_credentials',error_code:'invalid_credentials',message:'Invalid login credentials'});
  if(!person.confirmed)return reply(400,{code:'email_not_confirmed',error_code:'email_not_confirmed',message:'Email not confirmed'});
  return reply(200,session(person));
 }
 if(url.pathname.endsWith('/signup')){
  const person=addPerson(body.email,body.data.display_name,body.data.medsafe_role);
  person.password=body.password;person.confirmed=false;
  await serial(()=>db.query('insert into auth.users values($1)',[person.user.id]));
  return reply(200,person.user);
 }
 if(url.pathname.endsWith('/recover')){lastReset={email:body.email,redirect:url.searchParams.get('redirect_to')};return reply(200,{});}
 if(url.pathname.endsWith('/logout'))return reply(204,null);
 if(url.pathname.endsWith('/user')){
  const person=actor(request);if(!person)return reply(401,{message:'Not signed in'});
  if(request.method()==='PUT' && body.password)person.password=body.password;
  return reply(200,person.user);
 }
 throw new Error('Unexpected live-service request: '+request.method()+' '+url.pathname);
}
const browser=await chromium.launch(process.env.MEDSAFE_TEST_BROWSER?{executablePath:process.env.MEDSAFE_TEST_BROWSER,headless:true}:{channel:'msedge',headless:true});
const errors=[];
async function page(){
 const context=await browser.newContext({viewport:{width:1366,height:1000}});
 await context.route('https://*.supabase.co/**',intercept);
 const p=await context.newPage();p.on('pageerror',error=>errors.push(error.message));
 await p.goto(base);return p;
}
async function login(p,person,pass=person.password){
 await p.evaluate(()=>goSignIn('patient'));
 await p.locator('#email').fill(person.user.email);await p.locator('#password').fill(pass);
 await p.locator('#auth-submit').click();
}
async function loaded(p){await p.locator('#account-feedback').filter({hasText:/up to date|saved|granted|removed|view only/}).waitFor();}
async function nav(p,name){await p.locator('.dash-nav-item').filter({hasText:name}).click();}
async function addMed(p,name='Calcium carbonate',dose='500 mg'){
 await p.locator('#add-med-input').fill(name);await p.locator('#add-med-dosage').fill(dose);
 await p.locator('#add-med-stock').fill('30');await p.locator('#dash-page-medicines').getByRole('button',{name:'+ Add',exact:true}).click();
 await p.locator('#account-feedback').filter({hasText:'Medicine saved.'}).waitFor();
}
const results=[];
async function check(name,fn){await fn();results.push(name);console.log('PASS',name);}
try{
 const pa=await page(),pb=await page(),pc=await page();
 await check('Incorrect password is rejected without opening the dashboard',async()=>{
  await login(pa,A,'Incorrect!123');await pa.locator('#auth-feedback').filter({hasText:'incorrect'}).waitFor();
  assert.equal(await pa.locator('#dashboard-overlay').evaluate(el=>el.classList.contains('open')),false);
 });
 await check('Valid login creates an own profile and opens the saved role',async()=>{
  await login(pa,A);await loaded(pa);await login(pb,B);await loaded(pb);await login(pc,C);await loaded(pc);
  await nav(pc,'Patients');assert.equal(await pc.locator('#caregiver-share-code').innerText(),C.user.id);
 });
 await check('Profile edits persist after reload and do not change another account',async()=>{
  await pa.locator('#dash-user-pill').click();await pa.getByRole('button',{name:'Edit profile',exact:true}).click();
  assert.equal(await pa.locator('#profile-name').inputValue(),'Patient A');
  assert.equal(await pa.locator('#profile-email').innerText(),A.user.email);
  assert.equal(await pa.locator('#profile-role').innerText(),'Patient');
  await pa.locator('#profile-name').fill('Updated patient');await pa.locator('#profile-birth-date').fill('2000-01-02');
  await pa.screenshot({path:output+'/profile-desktop.png',animations:'disabled'});
  await pa.setViewportSize({width:320,height:740});
  assert.ok(await pa.locator('#profile-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && el.scrollWidth<=el.clientWidth;}));
  await pa.screenshot({path:output+'/profile-mobile.png',animations:'disabled'});
  await pa.locator('#profile-save').click();await pa.locator('#account-feedback').filter({hasText:'Profile saved.'}).waitFor();
  assert.match(await pa.locator('#dash-user-pill').innerText(),/Updated patient/);
  assert.match(await pa.locator('#dash-greeting').innerText(),/Updated patient/);
  await pa.reload();await loaded(pa);await pa.locator('#dash-user-pill').click();await pa.locator('#dash-account-edit').click();
  assert.equal(await pa.locator('#profile-name').inputValue(),'Updated patient');
  assert.equal(await pa.locator('#profile-birth-date').inputValue(),'2000-01-02');
  await pa.locator('#profile-cancel').click();
  await pb.getByRole('button',{name:'Refresh records',exact:true}).click();await loaded(pb);
  assert.match(await pb.locator('#dash-user-pill').innerText(),/Patient B/);
  await pa.setViewportSize({width:1366,height:1000});
 });
 await check('Cancel, invalid values and write failure preserve the saved profile',async()=>{
  await pa.locator('#dash-user-pill').click();await pa.locator('#dash-account-edit').click();
  await pa.locator('#profile-name').fill('Discard this');await pa.keyboard.press('Escape');
  assert.equal(await pa.locator('#profile-dialog').isVisible(),false);
  await pa.locator('#dash-user-pill').click();await pa.locator('#dash-account-edit').click();
  assert.equal(await pa.locator('#profile-name').inputValue(),'Updated patient');
  await pa.locator('#profile-name').fill('   ');await pa.locator('#profile-save').click();
  await pa.locator('#profile-feedback').filter({hasText:'Enter a name'}).waitFor();
  await pa.locator('#profile-name').fill('Failed edit');await pa.locator('#profile-birth-date').fill('2999-01-01');
  assert.equal(await pa.locator('#profile-birth-date').evaluate(el=>el.checkValidity()),false);
  await pa.locator('#profile-birth-date').fill('2000-01-02');failWrite=true;
  await pa.locator('#profile-save').click();await pa.locator('#profile-feedback[data-error="true"]').filter({hasText:'connection failed'}).waitFor();
  assert.equal(await pa.locator('#profile-dialog').isVisible(),true);
  assert.equal(await pa.locator('#profile-name').inputValue(),'Failed edit');
  assert.match(await pa.locator('#dash-user-pill').innerText(),/Updated patient/);
  failWrite=false;await pa.locator('#profile-cancel').click();
  await pa.reload();await loaded(pa);assert.match(await pa.locator('#dash-user-pill').innerText(),/Updated patient/);
 });
 await check('Medicine save, reload and cross-account isolation',async()=>{
  await nav(pa,'My Medicines');await addMed(pa);
  await pa.reload();await loaded(pa);await nav(pa,'My Medicines');
  assert.match(await pa.locator('#med-page-tbody').innerText(),/Calcium carbonate/);
  await pb.getByRole('button',{name:'Refresh records',exact:true}).click();await loaded(pb);
  assert.equal(await pb.locator('#stat-patients').innerText(),'0');
  assert.equal(await pc.locator('#stat-patients').innerText(),'0');
 });
 await check('Write failure is visible and does not add a phantom record',async()=>{
  failWrite=true;
  await pa.locator('#add-med-input').fill('Dolutegravir');
  await pa.locator('#dash-page-medicines').getByRole('button',{name:'+ Add',exact:true}).click();
  await pa.locator('#account-feedback[data-error="true"]').waitFor();
  assert.equal(await pa.locator('#med-page-tbody tr').count(),1);failWrite=false;
 });
 await check('Patient grants read-only access; saved profile markup is rendered as text',async()=>{
  await nav(pa,'Caregiver access');await pa.locator('#caregiver-code').fill(C.user.id);
  await pa.getByRole('button',{name:'Grant access',exact:true}).click();await pa.locator('#account-feedback').filter({hasText:'Caregiver access granted.'}).waitFor();
  assert.match(await pa.locator('#caregiver-access-list').innerText(),/<img/);assert.equal(await pa.locator('#caregiver-access-list img').count(),0);
  await pc.getByRole('button',{name:'Refresh records',exact:true}).click();await loaded(pc);await nav(pc,'Patient medicines');
  assert.equal(await pc.locator('#assign-med-row').isVisible(),false);
  assert.match(await pc.locator('#assign-patient-meds-tbody').innerText(),/Calcium carbonate/);
  assert.equal(await pc.locator('#assign-patient-meds-tbody button').count(),0);
 });
 await check('Patient may grant editing; caregiver saves stock to the same record',async()=>{
  await pa.locator('#caregiver-access-list input[type=checkbox]').check();await pa.locator('#account-feedback').filter({hasText:'Editing permission granted.'}).waitFor();
  await pc.getByRole('button',{name:'Refresh records',exact:true}).click();await loaded(pc);
  assert.equal(await pc.locator('#assign-med-row').isVisible(),true);
  await pc.locator('#assign-patient-meds-tbody').getByRole('button',{name:'Edit Stock',exact:false}).last().click();
  await pc.locator('#edit-stock-input').fill('12');await pc.evaluate(()=>saveStockModalChanges());
  await pc.locator('#account-feedback').filter({hasText:'Stock saved.'}).waitFor();
  await pa.getByRole('button',{name:'Refresh records',exact:true}).click();await loaded(pa);await nav(pa,'My Medicines');
  assert.match(await pa.locator('#med-page-tbody').innerText(),/12 left/);
 });
 await check('Patient revocation removes caregiver records on refresh',async()=>{
  await nav(pa,'Caregiver access');await pa.getByRole('button',{name:'Remove access',exact:true}).click();
  await pa.locator('#account-feedback').filter({hasText:'Caregiver access removed.'}).waitFor();
  await pc.getByRole('button',{name:'Refresh records',exact:true}).click();await loaded(pc);
  assert.equal(await pc.locator('#assign-meds-content').isVisible(),false);
  assert.equal(await pc.locator('#stat-patients').innerText(),'0');
 });
 await check('Logout clears data and a delayed read cannot restore it',async()=>{
  delayRead=true;await pa.getByRole('button',{name:'Refresh records',exact:true}).click();
  await pa.locator('.dash-logout-btn').click();
  await pa.locator('#auth-feedback').filter({hasText:'Signed out.'}).waitFor();
  await new Promise(resolve=>setTimeout(resolve,600));delayRead=false;
  assert.equal(await pa.locator('#dashboard-overlay').evaluate(el=>el.classList.contains('open')),false);
  assert.equal(await pa.locator('#med-page-tbody tr').count(),0);
  assert.equal(await pa.evaluate(()=>JSON.parse(localStorage.getItem('medsafe-auth-session'))),null);
 });
 await check('Caregiver can edit own profile and clear the optional birth date',async()=>{
  await pc.locator('#dash-user-pill').click();await pc.locator('#dash-account-edit').click();
  assert.equal(await pc.locator('#profile-role').innerText(),'Caregiver');
  await pc.locator('#profile-name').fill('Updated caregiver');await pc.locator('#profile-birth-date').fill('1995-01-02');
  await pc.locator('#profile-save').click();await pc.locator('#account-feedback').filter({hasText:'Profile saved.'}).waitFor();
  await pc.locator('#dash-user-pill').click();await pc.locator('#dash-account-edit').click();
  await pc.locator('#profile-birth-date').fill('');await pc.locator('#profile-save').click();
  await pc.locator('#account-feedback').filter({hasText:'Profile saved.'}).waitFor();
  await pc.reload();await loaded(pc);await pc.locator('#dash-user-pill').click();await pc.locator('#dash-account-edit').click();
  assert.equal(await pc.locator('#profile-name').inputValue(),'Updated caregiver');
  assert.equal(await pc.locator('#profile-birth-date').inputValue(),'');
  await pc.locator('#profile-cancel').click();
 });
 await check('Signup requires confirmation; simulated confirmed user can sign in',async()=>{
  await pa.locator('#auth-switch').click();await pa.locator('#auth-name').fill('New patient');
  await pa.locator('#email').fill('new@example.test');await pa.locator('#password').fill(password);await pa.locator('#auth-confirm').fill(password);
  await pa.locator('#auth-submit').click();await pa.locator('#auth-feedback').filter({hasText:'check your inbox'}).waitFor();
  const person=people.get('new@example.test');assert.equal(person.confirmed,false);person.confirmed=true;
  await login(pa,person);await loaded(pa);assert.equal(await pa.locator('#stat-patients').innerText(),'0');
  await pa.locator('.dash-logout-btn').click();await pa.locator('#auth-feedback').filter({hasText:'Signed out.'}).waitFor();
 });
 await check('Password reset uses PKCE callback and returns to login after update',async()=>{
  await pa.locator('#auth-forgot').click();await pa.locator('#email').fill(A.user.email);await pa.locator('#auth-submit').click();
  await pa.locator('#auth-feedback').filter({hasText:'reset link will arrive'}).waitFor();
  assert.equal(lastReset.redirect,base+'/?recovery=1');
  await pa.goto(base+'/?recovery=1&code=local-test-code');await pa.locator('#auth-title').filter({hasText:'Choose a new password'}).waitFor();
  await pa.locator('#password').fill('UpdatedLocalPassword!234');await pa.locator('#auth-confirm').fill('UpdatedLocalPassword!234');
  await pa.locator('#auth-submit').click();await pa.locator('#auth-feedback').filter({hasText:'Password updated.'}).waitFor();
  assert.equal(A.password,'UpdatedLocalPassword!234');
 });
 await check('Mobile signup and desktop caregiver page fit their viewports',async()=>{
  await pa.setViewportSize({width:390,height:844});await pa.locator('#auth-switch').click();
  assert.ok(await pa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok(await pa.evaluate(()=>document.querySelector('#screen-signin .back-btn').getBoundingClientRect().bottom <= document.querySelector('#auth-title').getBoundingClientRect().top));
  await pa.screenshot({path:output+'/signup-mobile.png',fullPage:true});
  await nav(pc,'Patients');await pc.screenshot({path:output+'/caregiver-desktop.png',fullPage:true});
 });
 assert.deepEqual(errors,[]);
 assert.ok(seen.includes('/auth/v1/token') && seen.includes('/rest/v1/medicines'));
 await writeFile(output+'/results.json',JSON.stringify({scope:'Mock Auth and HTTP adapter with real Supabase SDK, browser and PostgreSQL RLS. No live signup or email delivery tested.',passed:results.length,checks:results},null,2)+'\n');
 console.log('All',results.length,'browser checks passed; no live accounts or messages created.');
}finally{await browser.close();await db.close();}
