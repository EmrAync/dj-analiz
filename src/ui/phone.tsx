// Telefon arayüzü: alt sekme çubuğu, seçimde açılan alt panel
import { useEffect, useState } from 'react';
import { st, useStore, useT, type View } from '../store/store';
import { Icon } from './kit';

export const PHONE_Q = '(max-width: 760px)';

export function isPhone(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_Q).matches;
}

export function useIsPhone(): boolean {
  const [on, setOn] = useState(isPhone);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_Q);
    if (!mq) return;
    const h = () => setOn(mq.matches);
    mq.addEventListener?.('change', h);
    return () => mq.removeEventListener?.('change', h);
  }, []);
  return on;
}

const TABS: { id: View; icon: string }[] = [
  { id: 'home', icon: 'home' },
  { id: 'plan', icon: 'plan' },
  { id: 'setup', icon: 'checklist' },
  { id: 'pack', icon: 'bag' },
  { id: 'measure', icon: 'mic' },
];

export function BottomNav() {
  const t = useT();
  const view = useStore((s) => s.view);
  return (
    <nav className="bnav" data-testid="bottom-nav">
      {TABS.map((x) => (
        <button
          key={x.id}
          className={view === x.id ? 'on' : ''}
          onClick={() => st().set({ view: x.id, leftOpen: false, rightOpen: false, packCase: x.id === 'pack' && view === 'pack' ? null : st().packCase })}
          data-testid={'bnav-' + x.id}
        >
          <Icon name={x.icon} size={22} stroke={view === x.id ? 2.2 : 1.7} />
          <span>{t(('bnav.' + x.id) as 'bnav.home')}</span>
        </button>
      ))}
    </nav>
  );
}

// Telefonda: planda bir şey seçilince özellikler alt paneli açılır, seçim kalkınca kapanır
export function usePhoneSheet(): void {
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.sel === prev.sel || !isPhone()) return;
        if (s.view !== 'plan' && s.view !== 'schema' && s.view !== '3d') return;
        const n = s.sel.items.length + s.sel.cables.length + s.sel.zones.length + s.sel.notes.length;
        const n0 = prev.sel.items.length + prev.sel.cables.length + prev.sel.zones.length + prev.sel.notes.length;
        if (n && !n0) st().set({ rightOpen: true, leftOpen: false });
        else if (!n && n0) st().set({ rightOpen: false });
      }),
    [],
  );
}
