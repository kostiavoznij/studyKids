import { BarChart3, CalendarDays, Landmark, Settings, Users } from 'lucide-react';
import { useEffect } from 'react';
import { useAccess, type Access } from './data/access';
import { cloudEnabled, useAccount } from './data/cloud';
import { dayOffLabel } from './data/constants';
import { dayOffOn, lessonsByDay, useCalendarDaysOff, useCalendarLessons, useMissingTaxes } from './data/selectors';
import { summarize } from './data/stats';
import { useData } from './data/store';
import { isoWeekday, todayKey } from './lib/dates';
import { LESSONS, money, nPlural } from './lib/format';
import { CalendarScreen } from './screens/CalendarScreen';
import { BankSheet } from './screens/BankSheet';
import { DayOffSheet } from './screens/DayOffSheet';
import { FinanceScreen } from './screens/FinanceScreen';
import { NewLessonSheet } from './screens/LessonForm';
import { PaymentSheet } from './screens/PaymentSheet';
import { LessonSheet } from './screens/LessonSheet';
import { LockScreen } from './screens/LockScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StatsScreen } from './screens/StatsScreen';
import { GroupSheet, StudentSheet } from './screens/StudentSheet';
import { StudentPage, StudentsScreen } from './screens/StudentsScreen';
import { SyncBadge } from './screens/SyncSection';
import { TaxPlanSheet } from './screens/TaxPlanSheet';
import { TaxSheet } from './screens/TaxSheet';
import { TeacherSheet } from './screens/TeacherSheet';
import { ConfirmHost, ToastHost, useNow } from './ui/components';
import { useRoute } from './ui/router';
import { useUi } from './ui/uiStore';

const NAV: { href: string; label: string; icon: typeof Users; match: (p: string) => boolean; shown: (a: Access) => boolean }[] = [
  { href: '/', label: 'Розклад', icon: CalendarDays, match: (p) => p === '/', shown: () => true },
  { href: '/students', label: 'Учні', icon: Users, match: (p) => p.startsWith('/students'), shown: () => true },
  { href: '/stats', label: 'Статистика', icon: BarChart3, match: (p) => p.startsWith('/stats'), shown: (a) => a.manage },
  { href: '/finance', label: 'Фінанси', icon: Landmark, match: (p) => p.startsWith('/finance'), shown: (a) => a.finance },
  { href: '/settings', label: 'Налаштування', icon: Settings, match: (p) => p.startsWith('/settings'), shown: () => true },
];

/** Without access only the sign-in screen is shown, never the app itself. */
export function App() {
  const account = useAccount();
  useTheme();
  if (cloudEnabled && !(account.status === 'in' && account.role)) {
    return (
      <>
        <LockScreen />
        <ToastHost />
      </>
    );
  }
  return <Shell />;
}

function Shell() {
  const { path, parts } = useRoute();
  const access = useAccess();
  const taxesDue = useMissingTaxes().length > 0 && access.finance;
  const nav = NAV.filter((n) => n.shown(access));

  let screen;
  if (parts[0] === 'students' && parts[1]) screen = <StudentPage key={parts[1]} id={parts[1]} />;
  else if (parts[0] === 'students') screen = <StudentsScreen />;
  else if (parts[0] === 'stats' && access.manage) screen = <StatsScreen />;
  else if (parts[0] === 'finance' && access.finance) screen = <FinanceScreen />;
  else if (parts[0] === 'settings') screen = <SettingsScreen />;
  else screen = <CalendarScreen />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <span style={{ flex: 1 }}>Уроки</span>
          <SyncBadge />
        </div>
        {nav.map((n) => (
          <a key={n.href} className="side-link" href={`#${n.href}`} aria-current={n.match(path) ? 'page' : undefined}>
            <n.icon size={20} />
            {n.label}
            {n.href === '/finance' && taxesDue && <i className="nav-dot" aria-label="Не внесено податок" />}
          </a>
        ))}
        <TodayCard />
      </aside>

      <main className="main">{screen}</main>

      <nav className="tabbar">
        {nav.map((n) => (
          <a key={n.href} className="tab" href={`#${n.href}`} aria-current={n.match(path) ? 'page' : undefined}>
            <n.icon size={23} strokeWidth={2.1} />
            {n.label === 'Налаштування' ? 'Ще' : n.label}
            {n.href === '/finance' && taxesDue && <i className="nav-dot" aria-label="Не внесено податок" />}
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
    case 'payment':
      return <PaymentSheet key={overlay.id ?? 'new'} prefill={overlay} onClose={close} />;
    case 'dayOff':
      return <DayOffSheet key={overlay.id ?? overlay.day ?? 'new'} id={overlay.id} day={overlay.day} teacherId={overlay.teacherId} onClose={close} />;
    case 'tax':
      return <TaxSheet key={overlay.id ?? `${overlay.taxKind}:${overlay.period}`} prefill={overlay} onClose={close} />;
    case 'taxPlan':
      return <TaxPlanSheet onClose={close} />;
    case 'bank':
      return <BankSheet key={overlay.month} month={overlay.month} onClose={close} />;
    case 'teacher':
      return <TeacherSheet key={overlay.id ?? 'new'} id={overlay.id} onClose={close} />;
  }
}

function TodayCard() {
  const rec = useCalendarLessons();
  const workDays = useData((s) => s.settings.workDays);
  const finance = useAccess().finance;
  const off = dayOffOn(useCalendarDaysOff(), todayKey());
  const now = useNow();
  const today = todayKey();
  const sum = summarize(lessonsByDay(rec).get(today) ?? [], null, now);
  const count = sum.done + sum.planned + sum.trials;
  const empty = off ? dayOffLabel(off.kind) : workDays.includes(isoWeekday(new Date())) ? 'Немає уроків' : 'Вихідний';
  return (
    <div className="side-today">
      <div className="faint" style={{ fontSize: 12.5, fontWeight: 700 }}>
        Сьогодні
      </div>
      <div style={{ fontWeight: 800, fontSize: 17, marginTop: 2 }}>{count ? nPlural(count, LESSONS) : empty}</div>
      {count > 0 && (
        <div className="muted" style={{ fontSize: 13.5 }}>
          {finance && `${money(sum.earned + sum.expected)} · `}проведено {sum.done}
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
