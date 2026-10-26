import { BarChart3, CalendarDays, Settings, Users } from 'lucide-react';
import { useEffect } from 'react';
import { lessonsByDay } from './data/selectors';
import { summarize } from './data/stats';
import { useData } from './data/store';
import { todayKey } from './lib/dates';
import { LESSONS, money, nPlural } from './lib/format';
import { CalendarScreen } from './screens/CalendarScreen';
import { NewLessonSheet } from './screens/LessonForm';
import { LessonSheet } from './screens/LessonSheet';
import { SettingsScreen } from './screens/SettingsScreen';
import { StatsScreen } from './screens/StatsScreen';
import { GroupSheet, StudentSheet } from './screens/StudentSheet';
import { StudentPage, StudentsScreen } from './screens/StudentsScreen';
import { ConfirmHost, ToastHost, useNow } from './ui/components';
import { useRoute } from './ui/router';
import { useUi } from './ui/uiStore';

const NAV = [
  { href: '/', label: 'Розклад', icon: CalendarDays, match: (p: string) => p === '/' },
  { href: '/students', label: 'Учні', icon: Users, match: (p: string) => p.startsWith('/students') },
  { href: '/stats', label: 'Статистика', icon: BarChart3, match: (p: string) => p.startsWith('/stats') },
  { href: '/settings', label: 'Налаштування', icon: Settings, match: (p: string) => p.startsWith('/settings') },
];

export function App() {
  const { path, parts } = useRoute();
  useTheme();

  let screen;
  if (parts[0] === 'students' && parts[1]) screen = <StudentPage key={parts[1]} id={parts[1]} />;
  else if (parts[0] === 'students') screen = <StudentsScreen />;
  else if (parts[0] === 'stats') screen = <StatsScreen />;
  else if (parts[0] === 'settings') screen = <SettingsScreen />;
  else screen = <CalendarScreen />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          Уроки
        </div>
        {NAV.map((n) => (
          <a key={n.href} className="side-link" href={`#${n.href}`} aria-current={n.match(path) ? 'page' : undefined}>
            <n.icon size={20} />
            {n.label}
          </a>
        ))}
        <TodayCard />
      </aside>

      <main className="main">{screen}</main>

      <nav className="tabbar">
        {NAV.map((n) => (
          <a key={n.href} className="tab" href={`#${n.href}`} aria-current={n.match(path) ? 'page' : undefined}>
            <n.icon size={23} strokeWidth={2.1} />
            {n.label === 'Налаштування' ? 'Ще' : n.label}
          </a>
        ))}
      </nav>

      <OverlayHost />
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}

function OverlayHost() {
  const overlay = useUi((s) => s.overlay);
  const close = useUi((s) => s.close);
  if (!overlay) return null;
  switch (overlay.kind) {
    case 'lesson':
      return <LessonSheet key={overlay.id} id={overlay.id} onClose={close} />;
    case 'newLesson':
      return <NewLessonSheet key={JSON.stringify(overlay)} prefill={overlay} onClose={close} />;
    case 'student':
      return <StudentSheet key={overlay.id ?? 'new'} id={overlay.id} onClose={close} />;
    case 'group':
      return <GroupSheet key={overlay.id ?? 'new'} id={overlay.id} onClose={close} />;
  }
}

function TodayCard() {
  const rec = useData((s) => s.lessons);
  const settings = useData((s) => s.settings);
  const now = useNow();
  const today = todayKey();
  const sum = summarize(lessonsByDay(rec).get(today) ?? [], settings, null, now);
  const count = sum.done + sum.planned;
  return (
    <div className="side-today">
      <div className="faint" style={{ fontSize: 12.5, fontWeight: 700 }}>
        Сьогодні
      </div>
      <div style={{ fontWeight: 800, fontSize: 17, marginTop: 2 }}>{count ? nPlural(count, LESSONS) : 'Вихідний'}</div>
      {count > 0 && (
        <div className="muted" style={{ fontSize: 13.5 }}>
          {money(sum.earned + sum.expected, settings.baseCurrency)} · проведено {sum.done}
        </div>
      )}
    </div>
  );
}

/** Applies the chosen theme to <html> and keeps the browser chrome color in sync. */
function useTheme() {
  const theme = useData((s) => s.settings.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const resolved = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme;
      document.documentElement.setAttribute('data-theme', resolved);
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    };
    apply();
    if (theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}
