import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {getFirestore,doc,getDoc,onSnapshot,runTransaction} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
const config={apiKey:'AIzaSyCKSWObv6oueliMX7bRhTTsAy3nS065Zvg',authDomain:'farm-ai-system.firebaseapp.com',projectId:'farm-ai-system',storageBucket:'farm-ai-system.firebasestorage.app',messagingSenderId:'469927403647',appId:'1:469927403647:web:cd05e7ddc50d33ac169f4a'};
const ADMIN='ZSbRiqTgDyVBxKf4SJTN5k1KiQP2';
const auth=getAuth(initializeApp(config)),db=getFirestore();
const $=id=>document.getElementById(id);
let user=null,ref=null,unsubscribe=null,ready=false,cloudExists=false,busy=false,halted=false;
const pendingKey='boujo_cloud_test_pending_v1';
let pending=JSON.parse(localStorage.getItem(pendingKey)||'[]');
let localOnlyChanges=false;
function status(message,good=false){$('cloudStatus').className=good?'ok':'warn';$('cloudStatus').textContent=message;$('cloudDetail').textContent=`未同期操作：${pending.length}件 ／ ${user?'ログイン済み':'未ログイン'}`;$('cloudRetry').classList.toggle('hidden',!user||!pending.length);}
function persist(){localStorage.setItem(pendingKey,JSON.stringify(pending));}
function norm(r){const a=Array.isArray(r)?r:[r.date,r.pesticide,r.category,r.group,r.target,r.memo,r.id];return [...Array.from({length:6},(_,i)=>a[i]??null),a[6]||crypto.randomUUID()];}
function toCloud(r){const a=norm(r);return {date:a[0],pesticide:a[1],category:a[2],group:a[3],target:a[4],memo:a[5],id:a[6]};}
function display(items){records=items.map(norm);saveData();clearEditMode();render();}
function apply(items,op){const a=items.map(norm),i=a.findIndex(r=>r[6]===(op.id||op.record?.[6]));if(op.type==='delete'){if(i>=0)a.splice(i,1);}else if(i>=0)a[i]=norm(op.record);else a.push(norm(op.record));return a;}
function merge(base){return pending.reduce((a,op)=>apply(a,op),base);}
function remoteRead(snap){cloudExists=snap.exists();if(!cloudExists){ready=false;$('cloudImport').classList.remove('hidden');status('クラウドにデータがありません。初回移行ボタンで登録してください。');return;} $('cloudImport').classList.add('hidden');const data=snap.data();if(!Array.isArray(data.records)){halted=true;status('クラウドの形式が想定と異なります。同期を停止しました。');return;}if(localOnlyChanges&&!pending.length){halted=true;status('未同期の端末内変更があります。クラウドで上書きせず同期を停止しました。JSONバックアップを保存してください。');return;}ready=true;display(merge(data.records));if(pending.length)flush();else status(`同期済み：クラウド ${data.records.length}件`,true);}
async function flush(){if(busy||!ready||!user||!navigator.onLine||halted||!pending.length)return;busy=true;status('クラウドへ保存中…');try{while(pending.length&&navigator.onLine){const op=pending[0];await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists()||!Array.isArray(snap.data().records))throw Error('クラウドデータがありません');const a=apply(snap.data().records,op);tx.update(ref,{records:a.map(toCloud),updatedAt:new Date().toISOString()});});pending.shift();persist();}status(pending.length?'一部未同期です':'クラウドに保存しました',!pending.length);}catch(e){status('同期できません：'+e.message+'。操作は端末に保持されています。');}finally{busy=false;}}
cloudBridge={queue(op){if(!user||!ready||halted){localOnlyChanges=true;status('クラウド未接続：変更はこの端末に保存されています。ログイン後に確認してください。');return;}pending.push(op);persist();status('クラウドへの保存待ち…');flush();},onRestore(){if(ready){halted=true;status('バックアップ復元後の自動同期は停止しました。復元データは端末に保存されています。クラウドを誤って上書きしないため再ログインして確認してください。');}else status('復元済み。初回移行前に内容を確認してください。');}};
$('cloudLogin').onclick=async()=>{try{await signInWithPopup(auth,new GoogleAuthProvider());}catch(e){status('ログイン失敗：'+e.message);}};
$('cloudLogout').onclick=()=>signOut(auth);
$('cloudRetry').onclick=()=>{if(halted)return;flush();};
$('cloudImport').onclick=async()=>{if(!user||ready)return;if(!confirm(`この端末の${records.length}件をクラウドへ初回移行します。クラウドに既存データがある場合は上書きしません。続けますか？`))return;status('初回移行中…');try{const copy=records.map(toCloud);await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(snap.exists())throw Error('既にクラウドに記録があります。移行は中止しました');tx.set(ref,{schemaVersion:2,records:copy,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});});status('初回移行に成功しました。同期を開始します。',true);}catch(e){status('初回移行できません：'+e.message);}};
window.addEventListener('online',()=>flush());
onAuthStateChanged(auth,async u=>{unsubscribe?.();unsubscribe=null;user=null;ref=null;ready=false;halted=false;$('cloudImport').classList.add('hidden');$('cloudLogout').classList.toggle('hidden',!u);$('cloudLogin').classList.toggle('hidden',!!u);if(!u){status('未ログイン：端末内のテストデータのみ表示中');return;}if(u.uid!==ADMIN){status('このGoogleアカウントにはアクセス権がありません。');return;}user=u;ref=doc(db,'boujo_test',ADMIN);status('クラウドへ接続中…');unsubscribe=onSnapshot(ref,remoteRead,e=>status('クラウドの読み込みに失敗：'+e.message));});
