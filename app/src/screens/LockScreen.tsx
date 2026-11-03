import { LogIn, LogOut, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { retryAccount, signIn, signOut, useAccount } from '../data/cloud';
import { useUi } from '../ui/uiStore';

/** All that someone without access sees: the app opens only for the e-mails let in on the server. */
export function LockScreen() {
  const account = useAccount();
  const notify = useUi((s) => s.notify);

  const login = async () => {
    try {
      await signIn();
    } catch (e) {
      notify(`Не вдалося почати вхід: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  let text: ReactNode = null;
  let actions: ReactNode;
  if (account.status === 'loading') {
    actions = <RefreshCw size={22} className="spin faint" aria-label="Завантаження" />;
  } else if (account.status === 'denied') {
    text = (
      <>
        Пошта <b>{account.email}</b> не має доступу.
      </>
    );
    actions = (
      <>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await signOut();
            await login();
          }}
        >
          <LogIn size={18} /> Увійти іншою поштою
        </button>
        <button className="btn btn-ghost" onClick={() => retryAccount()}>
          <RefreshCw size={17} /> Перевірити ще раз
        </button>
      </>
    );
  } else if (account.status === 'error') {
    text = 'Не вдалося перевірити доступ. Перевірте інтернет і спробуйте ще раз.';
    actions = (
      <>
        <button className="btn btn-primary" onClick={() => retryAccount()}>
          <RefreshCw size={17} /> Спробувати ще
        </button>
        <button className="btn btn-ghost" onClick={() => signOut()}>
          <LogOut size={17} /> Вийти
        </button>
      </>
    );
  } else {
    text = 'Доступ лише для запрошених. Увійдіть акаунтом Google, якому відкрито доступ.';
    actions = (
      <button className="btn btn-primary" onClick={login}>
        <LogIn size={18} /> Увійти через Google
      </button>
    );
  }

  return (
    <main className="lock">
      <div className="lock-card">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="lock-logo" />
        <h1>Уроки</h1>
        {text && <p>{text}</p>}
        <div className="lock-actions">{actions}</div>
      </div>
    </main>
  );
}
