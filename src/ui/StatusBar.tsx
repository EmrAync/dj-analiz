import { useEffect, useState } from 'react';
import { runChecks } from '../engine/checks';
import { analyzePower } from '../engine/power';
import { fmt } from '../i18n';
import { st, useStore, useT } from '../store/store';
import { Icon } from './kit';

export function StatusBar() {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const sel = useStore((s) => s.sel);
  const savedAt = useStore((s) => s.savedAt);
  const areaId = useStore((s) => s.areaId);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const h = (e: Event) => setCursor((e as CustomEvent).detail);
    window.addEventListener('sahnecad:cursor', h);
    return () => window.removeEventListener('sahnecad:cursor', h);
  }, []);
  const issues = runChecks(p);
  const nE = issues.filter((i) => i.level === 'error').length;
  const nW = issues.filter((i) => i.level === 'warn').length;
  const nI = issues.filter((i) => i.level === 'info').length;
  const pw = analyzePower(p);
  const area = p.areas.find((a) => a.id === areaId);
  const nSel = sel.items.length + sel.cables.length + sel.zones.length + sel.notes.length;
  return (
    <footer className="status" data-testid="status">
      <span>
        {area?.name} · <b>{p.items.filter((i) => i.areaId === areaId).length}</b> {t('status.items')} · <b>{p.cables.length}</b> {t('status.cables')}
      </span>
      <span className="hide-sm">
        <Icon name="bolt" size={12} /> <b>{fmt(pw.totalW / 1000, 1, lang)} kW</b>
      </span>
      {cursor ? (
        <span className="hide-sm" style={{ fontFamily: 'var(--mono)' }}>
          x {fmt(cursor.x, 2, lang)} · y {fmt(cursor.y, 2, lang)} m
        </span>
      ) : null}
      {nSel ? <span>{t('status.selected', { n: nSel })}</span> : null}
      <span className="spacer" />
      <span className="hide-sm">{savedAt ? t('status.saved') : ''}</span>
      <button className="warnbtn" onClick={() => st().set({ leftTab: 'checks', leftOpen: true })} title={t('left.checks')} data-testid="status-checks">
        {nE ? (
          <>
            <Icon name="error" size={13} color="var(--err)" /> <b style={{ color: 'var(--err)' }}>{nE}</b>
          </>
        ) : null}
        {nW ? (
          <>
            <Icon name="warning" size={13} color="var(--warn)" /> <b style={{ color: 'var(--warn)' }}>{nW}</b>
          </>
        ) : null}
        {nI ? (
          <>
            <Icon name="info" size={13} color="var(--info)" /> <b style={{ color: 'var(--info)' }}>{nI}</b>
          </>
        ) : null}
        {!nE && !nW && !nI ? (
          <>
            <Icon name="ok" size={13} color="var(--ok)" /> {t('status.ok')}
          </>
        ) : null}
      </button>
    </footer>
  );
}
