import { Check, Download, Laptop, Smartphone, Upload } from 'lucide-react';
import { useRef, type CSSProperties } from 'react';
import { THEMES } from '../data/constants';
import { useData } from '../data/store';
import type { ThemeId } from '../data/types';
import { todayKey } from '../lib/dates';
import { LESSONS, nPlural } from '../lib/format';
import { BillingPicker, DurationChips, PriceField } from '../ui/fields';
import { ask, useUi } from '../ui/uiStore';
import { SyncSection } from './SyncSection';
import { useSync } from '../data/sync';

export function SettingsScreen() {
  const settings = useData((s) => s.settings);
  const seeded = useData((s) => s.seeded);
  const update = useData((s) => s.updateSettings);
  const loadDemo = useData((s) => s.loadDemo);
  const clearAll = useData((s) => s.clearAll);
  const exportData = useData((s) => s.exportData);
  const importData = useData((s) => s.importData);
  const notify = useUi((s) => s.notify);
  const file = useRef<HTMLInputElement>(null);
  const connected = useSync((s) => s.configured);

  const download = () => {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `uroky-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = async (f: File) => {
    const ok = await ask({ title: 'Відновити з файлу?', text: 'Поточні дані на цьому пристрої буде замінено даними з файлу.', ok: 'Відновити', danger: true });
    if (!ok) return;
    notify(importData(await f.text()) ? 'Дані відновлено' : 'Не вдалося прочитати файл');
  };

  const startClean = async () => {
    const ok = await ask({
      title: 'Почати з чистого аркуша?',
      text: 'Усі учні та уроки на цьому пристрої буде видалено. Зробіть копію, якщо щось треба зберегти.',
      ok: 'Очистити',
      danger: true,
    });
    if (ok) {
      clearAll();
      notify('Готово — можна додавати своїх учнів');
    }
  };

  const restoreDemo = async () => {
    const ok = await ask({ title: 'Завантажити демо-дані?', text: 'Поточні дані на цьому пристрої буде замінено прикладом.', ok: 'Завантажити' });
    if (ok) loadDemo();
  };

  return (
    <div className="screen">
      <div className="screen-inner settings">
        <div className="screen-head">
          <h1>Налаштування</h1>
        </div>

        <section className="section">
          <h2 className="set-title">Оформлення</h2>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <ThemeCard key={t.id} id={t.id} label={t.label} active={settings.theme === t.id} onPick={() => update({ theme: t.id })} />
            ))}
          </div>
        </section>

        <section className="section card">
          <h2 className="set-title">Нові учні та оплати</h2>
          <div className="row">
            <PriceField label="Ціна нового учня" price={settings.defaultPrice} onPrice={(v) => update({ defaultPrice: v })} />
            <label className="field">
              <span className="field-label">Попередження про оплату</span>
              <select className="select" value={settings.lowBalanceLessons} onChange={(e) => update({ lowBalanceLessons: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'коли уроки закінчились' : `коли лишилось ${nPlural(n, LESSONS)}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <span className="field-label">Як зазвичай платять нові учні</span>
            <BillingPicker value={settings.defaultBilling} onChange={(b) => update({ defaultBilling: b })} />
          </div>
          <div className="field">
            <span className="field-label">Тривалість уроку за замовчуванням</span>
            <DurationChips value={settings.defaultDuration} onChange={(v) => update({ defaultDuration: v })} />
          </div>
        </section>

        <section className="section card">
          <h2 className="set-title">Календар</h2>
          <div className="row">
            <label className="field">
              <span className="field-label">День з</span>
              <select className="select" value={settings.dayStart} onChange={(e) => update({ dayStart: Number(e.target.value) })}>
                {hours(5, 14).map((h) => (
                  <option key={h} value={h}>
                    {h}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">до</span>
              <select className="select" value={settings.dayEnd} onChange={(e) => update({ dayEnd: Number(e.target.value) })}>
                {hours(15, 24).map((h) => (
                  <option key={h} value={h}>
                    {h}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Наперед</span>
              <select className="select" value={settings.horizonWeeks} onChange={(e) => update({ horizonWeeks: Number(e.target.value) })}>
                {[2, 4, 6, 8, 12].map((w) => (
                  <option key={w} value={w}>
                    {w} тиж.
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="field-hint" style={{ marginTop: 8 }}>
            «Наперед» — на скільки тижнів уроки з постійного розкладу з'являються в календарі.
          </p>
        </section>

        <SyncSection />

        <section className="section card">
          <h2 className="set-title">Дані</h2>
          {seeded === 'demo' && (
            <div className="banner" style={{ marginBottom: 14 }}>
              <span style={{ flex: 1 }}>Зараз показано демо-учнів. Коли будете готові — почніть з чистого аркуша.</span>
            </div>
          )}
          <div className="set-buttons">
            <button className="btn btn-ghost" onClick={download}>
              <Download size={18} /> Зберегти копію у файл
            </button>
            <button className="btn btn-ghost" onClick={() => file.current?.click()}>
              <Upload size={18} /> Відновити з файлу
            </button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = '';
              }}
            />
            {seeded === 'demo' ? (
              <button className="btn btn-primary" onClick={startClean}>
                Почати з чистого аркуша
              </button>
            ) : (
              !connected && (
                <button className="btn btn-ghost" onClick={restoreDemo}>
                  Показати демо-дані
                </button>
              )
            )}
            {seeded !== 'demo' && (
              <button className="btn btn-danger-soft" onClick={startClean}>
                Видалити всі дані
              </button>
            )}
          </div>
        </section>

        <section className="section card">
          <h2 className="set-title">Встановити як застосунок</h2>
          <div className="install">
            <Smartphone size={22} />
            <p>
              <b>iPhone:</b> відкрийте сайт у Chrome або Safari → кнопка «Поділитися» → «На початковий екран». З'явиться іконка «Уроки», і застосунок відкриватиметься на
              весь екран.
            </p>
          </div>
          <div className="install">
            <Laptop size={22} />
            <p>
              <b>Ноутбук:</b> у Chrome натисніть значок «Встановити» праворуч в адресному рядку (або знайдіть «Установити» в меню ⋮). Застосунок з'явиться в меню «Пуск»
              і відкриватиметься в окремому вікні.
            </p>
          </div>
        </section>

        <p className="faint" style={{ textAlign: 'center', fontSize: 12.5, margin: '24px 0 8px' }}>
          Уроки · версія {__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}

const hours = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function ThemeCard({ id, label, active, onPick }: { id: ThemeId; label: string; active: boolean; onPick: () => void }) {
  const preview = (theme: string) => (
    <div className="tp" data-theme={theme}>
      <div className="tp-card">
        <i className="tp-line" />
        <div className="tp-block" style={{ '--c': '#7c6cf2' } as CSSProperties} />
        <div className="tp-block" style={{ '--c': '#ec6a2c' } as CSSProperties} />
        <div className="tp-block short" style={{ '--c': '#14a38b' } as CSSProperties} />
      </div>
      <div className="tp-accent" />
    </div>
  );
  return (
    <button className="theme-card" aria-pressed={active} onClick={onPick}>
      <div className="tp-wrap">
        {id === 'system' ? (
          <div className="tp-split">
            {preview('light')}
            {preview('dark')}
          </div>
        ) : (
          preview(id)
        )}
        {active && (
          <span className="tp-check">
            <Check size={14} strokeWidth={3} />
          </span>
        )}
      </div>
      <span className="theme-name">{label}</span>
    </button>
  );
}
