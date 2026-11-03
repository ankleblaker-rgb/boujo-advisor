import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,getRedirectResult,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {getFirestore,doc,onSnapshot,runTransaction,getDocFromServer,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {applyWrite,readState} from './cultivation-sync-core.js';
const config={apiKey:'AIzaSyCKSWObv6oueliMX7bRhTTsAy3nS065Zvg',authDomain:'farm-ai-system.firebaseapp.com',projectId:'farm-ai-system',storageBucket:'farm-ai-system.firebasestorage.app',messagingSenderId:'469927403647',appId:'1:469927403647:web:cd05e7ddc50d33ac169f4a'};
const OWNER='ZSbRiqTgDyVBxKf4SJTN5k1KiQP2';
const auth=getAuth(initializeApp(config)),db=getFirestore();
let user=null,unsubscribe=null,epoch=0,initialResolve;
const initialAuth=new Promise(resolve=>{initialResolve=resolve});
const mappedError=e=>{if(e.status)return e;if(e.code==='permission-denied')return Object.assign(new Error('栽培管理の保存権限が未設定です。Firebaseの設定を確認してください。'),{status:403});return e};
function announce(type,detail){window.dispatchEvent(new CustomEvent(type,{detail}))}
getRedirectResult(auth).catch(error=>announce('cultivation-auth-error',{message:error.message}));
onAuthStateChanged(auth,u=>{
 epoch++;unsubscribe?.();unsubscribe=null;user=u?.uid===OWNER?u:null;initialResolve();
 announce('cultivation-auth-changed',{signedIn:!!user,wrongAccount:!!u&&!user});
 if(!user)return;
 const token=epoch,ref=doc(db,'cultivation_accounts',OWNER);
 unsubscribe=onSnapshot(ref,snap=>{if(token!==epoch||snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;try{announce('cultivation-cloud-change',readState(snap.exists()?snap.data():null,OWNER))}catch(e){announce('cultivation-cloud-error',{message:e.message})}},error=>{if(token===epoch)announce('cultivation-cloud-error',{message:mappedError(error).message})});
});
export const cloud={
 async login(){try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(e){if(e.code==='auth/popup-blocked')await signInWithRedirect(auth,new GoogleAuthProvider());else throw e}},
 logout(){return signOut(auth)},
 async request(method='GET',payload){
  await initialAuth;
  if(!user)throw Object.assign(new Error('Googleログインが必要です'),{status:401});
  if(!navigator.onLine)throw new Error('オフラインです');
  const account=user.uid,token=epoch,ref=doc(db,'cultivation_accounts',account);
  try{
   if(method==='GET'){const snap=await getDocFromServer(ref);if(token!==epoch)throw Object.assign(new Error('アカウントが変わりました'),{status:401});return readState(snap.exists()?snap.data():null,account)}
   if(method!=='PUT')throw new Error('Unsupported operation');
   const result=await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(token!==epoch)throw Object.assign(new Error('ログインし直してください'),{status:401});const next=applyWrite(snap.exists()?snap.data():null,payload,account);tx.set(ref,{schemaVersion:1,revision:next.revision,recordsJson:JSON.stringify(next.records),updatedAt:serverTimestamp()});return next});
   if(token!==epoch)throw Object.assign(new Error('ログインし直してください'),{status:401});return result;
  }catch(e){throw mappedError(e)}
 }
};

