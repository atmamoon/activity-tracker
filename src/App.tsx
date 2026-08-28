import { useEffect } from 'react';
import { useStore } from './state/store';
import Header from './components/Header';
import DayQueue from './components/DayQueue';
import Timeline from './components/Timeline';
import BooksShelf from './components/BooksShelf';
import History from './components/History';
import TaskEditModal from './components/TaskEditModal';
import BookEditModal from './components/BookEditModal';
import SettingsModal from './components/SettingsModal';
import Toasts from './components/Toasts';

const SYNC_INTERVAL_MS = 10 * 60 * 1000;

export default function App() {
  const init = useStore((s) => s.init);
  const refreshToday = useStore((s) => s.refreshToday);
  const editingTask = useStore((s) => s.editingTask);
  const editingBook = useStore((s) => s.editingBook);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const view = useStore((s) => s.view);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const tick = window.setInterval(refreshToday, 30_000);
    const sync = window.setInterval(() => {
      const s = useStore.getState();
      if (s.calendar && s.calendar.mode !== 'none') s.syncNow(true);
    }, SYNC_INTERVAL_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(sync);
    };
  }, [refreshToday]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const s = useStore.getState();
      // Day-navigation shortcuts only make sense on the planner.
      if (typing || s.editingTask || s.editingBook || s.settingsOpen || s.view !== 'planner') return;
      if (e.key === 't') s.goToday();
      else if (e.key === 'ArrowLeft') s.shiftDay(-1);
      else if (e.key === 'ArrowRight') s.shiftDay(1);
      else if (e.key === 'n') {
        e.preventDefault();
        document.getElementById('quick-add-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Header />
      {view === 'history' ? (
        <main className="layout single">
          <History />
        </main>
      ) : (
        <main className="layout">
          <section className="main-col">
            <DayQueue />
            <BooksShelf />
          </section>
          <aside className="side-col">
            <Timeline />
          </aside>
        </main>
      )}
      {editingTask && <TaskEditModal />}
      {editingBook && <BookEditModal />}
      {settingsOpen && <SettingsModal />}
      <Toasts />
    </div>
  );
}
