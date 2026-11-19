let activeLogin;

export async function startTeslaLogin(button, authorize, onError) {
  if (activeLogin) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'tesla-login-loading';
  dialog.setAttribute('aria-labelledby', 'tesla-login-title');
  dialog.setAttribute('aria-describedby', 'tesla-login-description');
  dialog.innerHTML = '<div class="tesla-login-spinner" aria-hidden="true"></div><h2 id="tesla-login-title">Tesla 로그인으로 이동 중</h2><p id="tesla-login-description" role="status">로그인 페이지를 준비하고 있어요.<br>잠시만 기다려 주세요.</p>';
  dialog.addEventListener('cancel', event => event.preventDefault());
  const controller = new AbortController();
  const reset = () => {
    clearTimeout(timeout);
    window.removeEventListener('pageshow', reset);
    controller.abort();
    dialog.close();
    dialog.remove();
    button.disabled = false;
    button.removeAttribute('aria-busy');
    activeLogin = null;
  };
  activeLogin = reset;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  document.body.append(dialog);
  dialog.showModal();
  const timeout = setTimeout(() => controller.abort(), 20000);
  window.addEventListener('pageshow', reset);
  try {
    const {url} = await authorize(controller.signal);
    location.assign(url);
  } catch (error) {
    reset();
    button.focus();
    onError(controller.signal.aborted && error.name === 'AbortError' ? new Error('LOGIN_TIMEOUT') : error);
  }
}
