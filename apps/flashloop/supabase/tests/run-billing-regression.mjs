import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const db = new PGlite(); const root = new URL('../', import.meta.url); let assertions=0;
const user='b0000000-0000-4000-8000-000000000001',session='b1000000-0000-4000-8000-000000000001',project='b2000000-0000-4000-8000-000000000001';
const other='b0000000-0000-4000-8000-000000000002',otherSession='b1000000-0000-4000-8000-000000000002';
const check=(value,message)=>{assert.ok(value,message);assertions++};
async function q(sql,args=[]){return (await db.query(sql,args)).rows}
async function rpc(name,args=[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as v`,args))[0].v}finally{await db.exec('reset role')}}
async function rejects(fn,code,label){await assert.rejects(fn,e=>e.code===code,label);assertions++}
const now=Date.now(),start=new Date(now-3600000).toISOString(),end=new Date(now+86400000*30).toISOString(),at=new Date(now-1000).toISOString();
function snapshot(overrides={}){return {environment:'sandbox',companyId:'company_fixture',resourceId:'membership_fixture',whopUserId:'whop_fixture',observedAt:new Date().toISOString(),membership:{id:'membership_fixture',planKey:'starter',planId:'plan_fixture',productId:'product_fixture',status:'active',valid:true,createdAt:at,periodStart:start,periodEnd:end,cancelAtPeriodEnd:false,checkoutId:null},payment:{id:'payment_fixture',membershipId:'membership_fixture',planId:'plan_fixture',checkoutId:'checkout_fixture',status:'paid',paid:true,refunded:false,disputed:false,billingReason:'subscription_create',amountMinor:1000,currency:'USD',createdAt:at,paidAt:at,periodProven:true},...overrides}}
let event=0;async function receipt(s,eventType='membership.activated',evidence={membershipId:'membership_fixture',paymentId:s.payment?.id,periodStart:s.membership.periodStart,periodEnd:s.membership.periodEnd}){return rpc('billing_receive_webhook',['sandbox','event_'+(++event),eventType,s.resourceId,'a'.repeat(64),evidence])}
async function apply(s,type,evidence){const r=await receipt(s,type,evidence);return rpc('billing_apply_snapshot',[r.receiptId,s])}
try{
 await db.exec(await readFile(new URL('tests/auth-fixture.sql',root),'utf8'));
 for(const f of (await readdir(new URL('migrations/',root))).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL('migrations/'+f,root),'utf8'));
 const billingMigration=(await readdir(new URL('migrations/',root))).find(x=>x.endsWith('_whop_subscription_billing.sql'));
 const rollback=await readFile(new URL('rollback/'+billingMigration,root),'utf8');
 await db.exec(rollback);
 check((await q("select to_regclass('private.billing_policy') is null absent"))[0].absent,'empty billing rollback restores previous schema');
 await db.exec(await readFile(new URL('migrations/'+billingMigration,root),'utf8'));
 await db.exec(await readFile(new URL('tests/billing-regression.sql',root),'utf8'));
 check((await q('select private.billing_generation_allowed($1) as allowed',[user]))[0].allowed===false,'unconfigured billing denies generation');
 check((await q('select credits from public.video_credit_accounts where user_id=$1',[user]))[0].credits===0,'signup grants zero credits');
 check((await q('select count(*)::int n from private.billing_plans'))[0].n===0,'no commercial plans or prices seeded');
 check((await q("select proargnames from pg_proc where oid='public.billing_begin_checkout(uuid,uuid,text,text)'::regprocedure"))[0].proargnames.join(',')==='p_user_id,p_session_id,p_plan_key,p_request_key','PostgREST wrappers expose named RPC arguments');
 await rejects(()=>rpc('billing_begin_link',[user,session,'a'.repeat(64)]),'55000','unconfigured identity linking denied');
 await rpc('configure_billing_policy',['sandbox','company_fixture',true]);await rpc('configure_billing_plan',['sandbox','starter','plan_fixture','product_fixture',100,'USD',1000,true]);
 await rejects(()=>rpc('billing_bind_identity',[user,session,'whop_fixture']),'42501','binding requires consumed proof');
 await rpc('billing_begin_link',[user,session,'a'.repeat(64)]);
 await rejects(()=>rpc('billing_consume_link',[other,otherSession,'a'.repeat(64)]),'42501','OAuth state owner bound');
 await rpc('billing_consume_link',[user,session,'a'.repeat(64)]);
 await rejects(()=>rpc('billing_consume_link',[user,session,'a'.repeat(64)]),'42501','OAuth state single use');
 await rpc('billing_bind_identity',[user,session,'whop_fixture']);
 await rejects(()=>rpc('billing_bind_identity',[user,session,'whop_other']),'23505','identity immutable');
 await rpc('billing_begin_link',[other,otherSession,'b'.repeat(64)]);await rpc('billing_consume_link',[other,otherSession,'b'.repeat(64)]);
 await rejects(()=>rpc('billing_bind_identity',[other,otherSession,'whop_fixture']),'23505','provider identity cannot fund two users');
 await rejects(()=>rpc('billing_account',[user,otherSession]),'42501','billing DTO requires matching live verified session');
 const intent=await rpc('billing_begin_checkout',[user,session,'starter','checkout-request-000001']);check(intent.createAllowed===true,'first checkout has permanent create claim');
 check((await rpc('billing_begin_checkout',[user,session,'starter','checkout-request-000001'])).createAllowed===false,'checkout replay never creates twice');
 await rejects(()=>rpc('billing_begin_checkout',[user,session,'changed','checkout-request-000001']),'23505','request key immutable plan');
 await rpc('billing_unknown_checkout',[intent.intentId]);check((await rpc('billing_begin_checkout',[user,session,'starter','checkout-request-000001'])).createAllowed===false,'unknown checkout never recreates');
 await rpc('billing_finish_checkout',[intent.intentId,'checkout_fixture']);
 await rejects(()=>rpc('billing_finish_checkout',[intent.intentId,'checkout_changed']),'23505','checkout provider ID immutable');
 let foreign=snapshot({whopUserId:'external_unlinked'});check((await apply(foreign)).grantedCredits===0,'external unlinked purchases never auto-bind');
 let unknown=snapshot();unknown.payment.checkoutId='unknown_checkout';check((await apply(unknown)).grantedCredits===0,'unknown checkout cannot mint or bind membership');
 let unproven=snapshot();unproven.resourceId='payment_fixture';unproven.payment.periodProven=false;check((await apply(unproven,'payment.succeeded',{})).grantedCredits===0,'paid payment without signed activation proof cannot mint');
 check((await rpc('billing_account',[user,session])).billingAccess===false,'active membership without proven paid bucket has no access');
 let s=snapshot();let r=await receipt(s);check((await rpc('billing_receive_webhook',['sandbox','event_'+event,'membership.activated',s.resourceId,'a'.repeat(64),{membershipId:'membership_fixture',paymentId:'payment_fixture',periodStart:start,periodEnd:end}])).duplicate,'webhook duplicate durable');
 await rejects(()=>rpc('billing_receive_webhook',['sandbox','event_'+event,'membership.activated','other_resource','a'.repeat(64),{}]),'23505','changed event conflicts');
 let result=await rpc('billing_apply_snapshot',[r.receiptId,s]);check(result.grantedCredits===100,'verified paid period grants configured credits');
 check((await rpc('billing_apply_snapshot',[r.receiptId,s])).grantedCredits===0,'same receipt grants once');
 check((await apply(s)).grantedCredits===0,'different receipt same payment grants once');
 let another=snapshot();another.payment.id='duplicate_collection';check((await apply(another)).grantedCredits===0,'different payment same subscription period grants once');
 check((await rpc('billing_account',[user,session])).billingAccess===true,'active verified paid membership grants access');
 check((await q('select count(*)::int n from private.billing_credit_buckets'))[0].n===1,'one nonrollover bucket');
 const cancel=snapshot();cancel.payment=null;cancel.membership.cancelAtPeriodEnd=true;await apply(cancel,'membership.updated',{});check((await rpc('billing_account',[user,session])).billingAccess===true,'period-end cancellation retains paid access');
 const late=snapshot();late.payment=null;late.observedAt=new Date(now-120000).toISOString();late.membership.status='inactive';late.membership.valid=false;check((await apply(late,'membership.updated',{})).disposition==='ignored','older authoritative snapshot cannot replace newer period state');
 check((await rpc('billing_account',[user,session])).billingAccess===true,'older cancellation state cannot erase current paid access');
 const pastdue=snapshot();pastdue.payment=null;pastdue.membership.status='past_due';await apply(pastdue,'membership.updated',{});check((await rpc('billing_account',[user,session])).billingAccess===false,'past-due state denies immediately');
 const active=snapshot();await apply(active);check((await rpc('billing_account',[user,session])).billingAccess===true,'authoritative active paid state can recover from past due');
 const upgrade=snapshot();upgrade.payment.id='upgrade_payment';upgrade.payment.billingReason='subscription_update';check((await apply(upgrade)).grantedCredits===0,'upgrade/proration charges require review and grant nothing');

 check((await q('select enabled from private.generation_account_limits where user_id=$1',[user])).length===0,'payments never enable operator account');
 await rpc('configure_generation_policy',[true,'USD',10000,10000,10,'UTC']);await rpc('upsert_generation_price',['fixture.video',10,100,{provider:'fixture',model:'fixed'},true]);
 await rejects(()=>rpc('reserve_generation_for_user',[user,session,project,'generation-request-000001','fixture.video','prompt','label']),'42501','operator entitlement remains independent');
 await rpc('configure_generation_account',[user,true,null,null]);
 const reserved=await rpc('reserve_generation_for_user',[user,session,project,'generation-request-000001','fixture.video','prompt','label']);
 check((await q('select credits_remaining from private.billing_credit_buckets'))[0].credits_remaining===90,'reservation consumes expiring allocation');
 check((await q('select credits from public.video_credit_accounts where user_id=$1',[user]))[0].credits===90,'reservation debits once');
 await rpc('reserve_generation_for_user',[user,session,project,'generation-request-000001','fixture.video','prompt','label']);check((await q('select credits_remaining from private.billing_credit_buckets'))[0].credits_remaining===90,'reservation replay does not allocate twice');
 await rpc('reserve_generation_for_user',[user,session,project,'generation-release-live','fixture.video','prompt','label']);await rpc('release_generation',[user,'generation-release-live']);check((await q('select credits_remaining from private.billing_credit_buckets'))[0].credits_remaining===90,'unclaimed live-period release restores exact bucket allocation');await rpc('release_generation',[user,'generation-release-live']);check((await q('select credits from public.video_credit_accounts where user_id=$1',[user]))[0].credits===90,'unclaimed release replay cannot double refund');
 await db.query("update private.billing_credit_buckets set expires_at=clock_timestamp()-interval '1 minute'");
 const account=await rpc('billing_account',[user,session]);check(account.videoCredits===0,'expiry removes only unspent paid credits');
 await rpc('release_generation',[user,'generation-request-000001']);check((await rpc('billing_account',[user,session])).videoCredits===0,'release after expiry cannot resurrect paid credits');
 await rpc('release_generation',[user,'generation-request-000001']);check((await rpc('billing_account',[user,session])).videoCredits===0,'expired release replay cannot refund twice');
 // New fixture period paid charge; old payment bucket cannot grant the new cycle.
 const renewal=snapshot();renewal.membership.periodStart=new Date(now-500).toISOString();renewal.membership.periodEnd=new Date(now+86400000*31).toISOString();renewal.payment.id='renewal_payment';renewal.payment.createdAt=new Date(now).toISOString();renewal.payment.paidAt=new Date(now).toISOString();renewal.payment.billingReason='subscription_cycle';renewal.payment.checkoutId=null;
 check((await apply(renewal)).grantedCredits===100,'renewal uses immutable membership checkout binding');
 const claimed=await rpc('reserve_generation_for_user',[user,session,project,'generation-request-000002','fixture.video','prompt','label']);await rpc('claim_generation',[user,'generation-request-000002']);
 await rpc('reserve_generation_for_user',[user,session,project,'generation-request-000003','fixture.video','prompt','label']);
 const before=await q('select status,held_cost_micros from private.generation_reservations order by created_at,id');
 const refund=structuredClone(renewal);refund.observedAt=new Date().toISOString();refund.payment.refunded=true;refund.resourceId='refund_fixture';await apply(refund,'refund.created',{});
 check((await rpc('billing_account',[user,session])).reviewRequired===true,'refund latches billing review');
 await rejects(()=>rpc('reserve_generation_for_user',[user,session,project,'generation-request-000004','fixture.video','prompt','label']),'42501','refund hold denies new reservations');
 await rejects(()=>rpc('claim_generation',[user,'generation-request-000003']),'42501','refund hold denies unpaid dispatch claim');
 check(JSON.stringify(await q('select status,held_cost_micros from private.generation_reservations order by created_at,id'))===JSON.stringify(before),'revocation preserves all existing holds');
 await rpc('resolve_generation',[user,'generation-request-000002',50,'succeeded']);check((await q('select status from private.generation_reservations where id=$1',[claimed.reservationId]))[0].status==='committed','settlement remains possible after billing revocation');
 const restored=structuredClone(renewal);restored.observedAt=new Date().toISOString();await apply(restored);check((await rpc('billing_account',[user,session])).billingAccess===false,'ordinary active replay cannot clear refund review');
 await db.exec('set role authenticated');await rejects(()=>q('select public.billing_account($1,$2)',[user,session]),'42501','client cannot call service billing RPC');await db.exec('reset role');
 check((await q("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and relname like 'billing_%' and relkind='r' and (not relrowsecurity or not relforcerowsecurity)"))[0].n===0,'all billing tables force RLS');
 check((await q("select has_column_privilege('service_role','public.video_credit_accounts','credits','UPDATE') allowed"))[0].allowed===false,'no generic service balance write');
 await db.query("update private.session_verifications set state='failed',failed_at=clock_timestamp(),verified_at=null where session_id=$1",[session]);await rejects(()=>rpc('billing_account',[user,session]),'42501','billing DTO denies immediately after session revocation');
 await rpc('set_generation_enabled',[false]);await rejects(()=>db.exec(rollback),'55000','populated rollback preserves billing evidence');await db.exec('rollback');
 console.log(`PASS: ${assertions} billing SQL assertions, including identity, durable checkout/receipt idempotency, unique paid cycle, bucket consumption/expiry/release, separate operator gate, refund hold, and post-revocation settlement.`);
 console.log('Local synthetic Auth and provider facts only; no hosted migration, real signatures, payment, provider, or deployment acceptance.');
}catch(e){console.error('Billing SQL regression failed:',e.message,e.code??'');process.exitCode=1}finally{await db.close()}
