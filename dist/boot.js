const status=document.querySelector('#appBootStatus');
function retry(message){
 if(!status)return;status.replaceChildren(document.createTextNode(message));
 const button=document.createElement('button');button.className='button-secondary';button.textContent='다시 열기';button.addEventListener('click',()=>location.reload());status.append(button);
}
const timer=setTimeout(()=>retry('화면 준비가 늦어지고 있어요. 연결을 확인한 뒤 다시 열어 주세요.'),10000);
import('./app.js').then(()=>{clearTimeout(timer);status?.remove();}).catch(()=>{clearTimeout(timer);console.error('FLOWAD_BOOT_FAILED');retry('화면을 준비하지 못했어요. 잠시 후 다시 열어 주세요.');});
