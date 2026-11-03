import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {getFirestore,doc,onSnapshot,runTransaction,getDoc} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
const config={apiKey:'AIzaSyCKSWObv6oueliMX7bRhTTsAy3nS065Zvg',authDomain:'farm-ai-system.firebaseapp.com',projectId:'farm-ai-system',storageBucket:'farm-ai-system.firebasestorage.app',messagingSenderId:'469927403647',appId:'1:469927403647:web:cd05e7ddc50d33ac169f4a'};
const ADMIN='ZSbRiqTgDyVBxKf4SJTN5k1KiQP2';
const auth=getAuth(initializeApp(config)),db=getFirestore(),S=window.BoujoSync,$=id=>document.getElementById(id);
S.adapterVersion=9;
let user=null,ref=null,unsubscribe=null,ready=false,busy=false,lastRemote=null,conflict=null,epoch=0,renderVersion=0,migrating=false;
function status(text,good=false){$('cloudStatus').className=good?'ok':'warn';$('cloudStatus').textContent=text;const n=S.pending().length;$('cloudDetail').textContent=`未同期の変更：${n}件 ／ ${user?'ログイン済み':'未ログイン'}。散布履歴・農薬一覧・使用条件・確認状態・公式検索データを共有します。`;$('cloudRetry').classList.toggle('hidden',!user||!n);}
function clearConflict(){conflict=null;$('cloudConflict').classList.add('hidden');$('cloudConflictData').textContent='';}
function showConflict(op,error){conflict={id:op.id};$('cloudConflict').classList.remove('hidden');$('cloudConflictData').textContent=JSON.stringify(error.changes?.map(c=>({項目:c.domain==='record'?'散布記録':c.domain==='catalog'?'農薬一覧':'公式検索データ',名称またはID:c.id,端末の変更:c.domain==='lookup'?c.after?.date:c.after,クラウドの内容:c.current})),null,2);status('同じ項目が別の端末で変更されています。ホームの比較内容を確認してください。');}
async function paint(state){const token=++renderVersion;const local=window.getSharedUI();const localRaw=window.getLookupUI();const raw=state.lookup&&localRaw&&local.lookup?.digest===state.lookup.digest?localRaw:await S.unpack(state.lookup);if(token!==renderVersion)return;S.backupOnce();S.accept(state,raw);window.applySharedUI(state,raw);}
async function receive(snap){const e=epoch;try{
 if(!snap.exists()){ready=false;lastRemote=null;$('cloudImport').classList.remove('hidden');$('cloudImport').textContent='この端末の全データをクラウドへ初回保存';status('クラウドにデータがありません。内容が新しい端末で初回保存してください。');return;}
 const data=snap.data();if((data.minClientVersion||0)>6)throw Error('新しいアプリへの更新が必要です');
 lastRemote=S.readCloud(data);if(lastRemote.catalog===null){ready=false;$('cloudImport').classList.remove('hidden');$('cloudImport').textContent='この端末の農薬一覧・公式データを共有開始';S.backupOnce();if(e===epoch)status('農薬情報の初回共有が必要です。内容が新しいパソコンで「共有開始」を押してください。');return;}
 $('cloudImport').classList.add('hidden');ready=true;const state=S.merge(lastRemote);await paint(state);if(e!==epoch)return;if(conflict)return;if(S.pending().length)flush();else status(`全データ同期済み：散布${state.records.length}件・農薬${state.catalog.length}件・公式データ${state.lookup?.date||'未取込'}`,true);
 }catch(error){if(e===epoch){ready=false;status('クラウドを読み込めません：'+error.message+'。端末データは保持しています。');}}
}
async function flush(){if(busy||!ready||!user||!navigator.onLine||conflict||migrating)return;const token=epoch,target=ref;busy=true;try{
 while(S.pending().length&&navigator.onLine&&token===epoch){const op=S.pending()[0];status('全データをクラウドへ保存中…');
  try{await runTransaction(db,async tx=>{const snap=await tx.get(target);if(!snap.exists())throw Error('初回共有が必要です');const state=S.readCloud(snap.data());if(state.catalog===null)throw Error('農薬情報の初回共有が必要です');const next=S.apply(state,op);tx.update(target,S.writeCloud(next));});S.ack([op.id]);}
  catch(error){if(error.code==='sync-conflict')showConflict(op,error);else status('同期できません：'+error.message+'。変更は再読み込み後も端末に残ります。');return;}
 }
 if(token===epoch){status(S.pending().length?'未同期の変更を端末に保持しています。':'全データをクラウドに保存しました',!S.pending().length);if(!S.pending().length){const snap=await getDoc(target);if(token===epoch)await receive(snap);}}
 }finally{busy=false;if(token!==epoch&&ready&&user)flush();}}
async function resolve(useLocal){if(!conflict||!user)return;const id=conflict.id;try{const snap=await getDoc(ref);const state=S.readCloud(snap.data());S.rebase(id,state,useLocal);clearConflict();lastRemote=state;await paint(S.merge(state));if(state.catalog!==null){ready=true;flush();}else status('内容の選択を保存しました。初回共有をもう一度押してください。');}catch(e){status('競合を解決できません：'+e.message);}}
$('cloudKeepLocal').onclick=()=>resolve(true);$('cloudKeepRemote').onclick=()=>resolve(false);
$('cloudLogin').onclick=async()=>{try{await signInWithPopup(auth,new GoogleAuthProvider());}catch(e){status('ログイン失敗：'+e.message);}};
$('cloudLogout').onclick=()=>signOut(auth);
$('cloudRetry').onclick=async()=>{if(conflict)return;try{if(!ready&&ref)await receive(await getDoc(ref));else await flush();}catch(e){status('再接続できません：'+e.message);}};
$('cloudImport').onclick=async()=>{
 if(!user||migrating||ready)return;const target=ref,token=epoch,source=window.getSharedUI(),raw=window.getLookupUI(),ops=S.pending(),ids=ops.map(o=>o.id);
 if(!confirm(`この端末の農薬一覧${source.catalog.length}件と公式検索データ${raw?.date||'未取込'}を共有の初期データにします。先にバックアップを保存し、内容が新しい端末であることを確認してください。続けますか？`))return;
 migrating=true;try{S.backupOnce();status('農薬一覧・公式データの共有を準備しています…');source.lookup=raw?await S.pack(raw):null;
 await runTransaction(db,async tx=>{const snap=await tx.get(target);let state;if(snap.exists()){state=S.readCloud(snap.data());if(state.catalog!==null)throw Error('別の端末で共有開始済みです。再読み込みしてください');state.catalog=source.catalog;state.lookup=source.lookup;for(const op of ops){const recordChanges=op.changes.filter(c=>c.domain==='record');if(recordChanges.length){try{state=S.apply(state,{...op,changes:recordChanges});}catch(e){e.failedOp=op;throw e;}}}}else state=source;
 const fields=S.writeCloud(state);if(snap.exists())tx.update(target,fields);else tx.set(target,{...fields,createdAt:new Date().toISOString()});});
 S.ack(ids);clearConflict();if(token===epoch){await receive(await getDoc(target));status('全データの共有を開始しました。ほかの端末も同じGoogleアカウントでログインしてください。',true);}
 }catch(error){if(error.code==='sync-conflict'&&error.failedOp)showConflict(error.failedOp,error);else status('共有開始できません：'+error.message+'。元のデータは保持しています。');}finally{migrating=false;if(ready&&S.pending().length)flush();}
};
window.addEventListener('online',()=>{if(!ready&&ref)getDoc(ref).then(receive).catch(e=>status('接続できません：'+e.message));else flush();});
window.addEventListener('offline',()=>status('オフライン：変更は端末に保存し、接続後に送信します。'));
window.addEventListener('boujo-local-change',()=>{renderVersion++;status(user?'変更を端末に保存しました。クラウドへ送信待ちです。':'未ログイン：変更を端末に保存しました。ログイン後に同期します。');flush();});
window.addEventListener('storage',e=>{if(e.key===S.keys.pending){if(lastRemote)paint(S.merge(lastRemote)).then(flush).catch(error=>status(error.message));}});
onAuthStateChanged(auth,u=>{
 epoch++;renderVersion++;unsubscribe?.();unsubscribe=null;user=null;ref=null;ready=false;lastRemote=null;clearConflict();$('cloudImport').classList.add('hidden');$('cloudLogout').classList.toggle('hidden',!u);$('cloudLogin').classList.toggle('hidden',!!u);
 if(!u){status('未ログイン：全データの変更はこの端末に保持されています。');return;}
 if(u.uid!==ADMIN){status('このGoogleアカウントにはアクセス権がありません。保存済みデータは送信しません。');return;}
 user=u;ref=doc(db,'boujo_test',ADMIN);status('全データをクラウドから読み込み中…');const subscribedEpoch=epoch;unsubscribe=onSnapshot(ref,snap=>{if(subscribedEpoch===epoch&&user)receive(snap);},error=>{if(subscribedEpoch!==epoch)return;ready=false;status('同期に接続できません：'+error.message+'。端末の変更は保持しています。');});
});



