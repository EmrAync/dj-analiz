import { useMemo, useState } from 'react';
import { buildSetup, PHASES, type SetupStep } from '../../engine/setup';
import { LANGS, makeT } from '../../i18n';
import { getDef } from '../../model/project';
import type { Lang } from '../../model/types';
import { toggleDone } from '../../store/actions';
import { st, useStore, useT } from '../../store/store';
import { Check, Icon } from '../../ui/kit';
import { catColor, itemImage } from '../common';
import { PrintHeader } from '../lists/ListsView';
import { PlanDrawing } from '../plan/PlanDrawing';

export function SetupView() {
  const t = useT();
  const p = useStore((s) => s.project);
  const uiLang = useStore((s) => s.lang);
  const installer = useStore((s) => s.installer);
  const [lang, setLang] = useState<Lang>(uiLang);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [withPlan, setWithPlan] = useState(true);
  const tt = useMemo(() => makeT(lang), [lang]);
  const steps = useMemo(() => buildSetup(p, tt, lang), [p, tt, lang]);
  const done = steps.filter((s) => p.done[s.id]).length;
  const byPhase = new Map<string, SetupStep[]>();
  for (const s of steps) {
    if (onlyOpen && p.done[s.id]) continue;
    const l = byPhase.get(s.phase);
    if (l) l.push(s);
    else byPhase.set(s.phase, [s]);
  }
  let n = 0;
  return (
    <div className="page" data-testid="setup-view">
      <div className="page-inner" style={{ maxWidth: 980 }}>
        <div className="page-head">
          <h1>{tt('setup.title')}</h1>
          <div className="progress no-print" title={`${done}/${steps.length}`}>
            <div style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} />
          </div>
          <span className="hint no-print">
            {done}/{steps.length}
          </span>
          <select className="inp no-print" style={{ width: 'auto' }} value={lang} onChange={(e) => setLang(e.target.value as Lang)} title={t('setup.langHint')}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button className="btn no-print" onClick={() => window.print()} data-testid="print-setup">
            <Icon name="print" size={15} /> {t('lists.print')}
          </button>
        </div>
        <div className="no-print" style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
          <Check checked={onlyOpen} onChange={setOnlyOpen}>
            {t('setup.onlyOpen')}
          </Check>
          <Check checked={withPlan} onChange={setWithPlan}>
            {t('setup.withPlan')}
          </Check>
          {done && !installer ? (
            <button
              className="btn sm ghost"
              onClick={() => {
                if (confirm(t('setup.resetConfirm'))) st().mutate((d) => void (d.done = {}));
              }}
            >
              {t('setup.reset')}
            </button>
          ) : null}
        </div>
        <PrintHeader />
        <p className="hint">{tt('setup.intro')}</p>
        {withPlan ? <PlanFigures /> : null}
        <div className="panel">
          {PHASES.map((ph) => {
            const list = byPhase.get(ph);
            if (!list?.length) return null;
            n++;
            return (
              <div key={ph}>
                <div className="phase-h">
                  <span className="num-c">{n}</span>
                  {tt(('phase.' + ph) as 'phase.prep')}
                  <span className="chip" style={{ marginLeft: 'auto' }}>
                    {list.filter((s) => p.done[s.id]).length}/{list.length}
                  </span>
                </div>
                {list.map((s) => (
                  <StepRow key={s.id} s={s} done={!!p.done[s.id]} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepRow({ s, done }: { s: SetupStep; done: boolean }) {
  const p = useStore((st0) => st0.project);
  const firstItem = s.items?.[0] ? p.items.find((i) => i.id === s.items![0]) : undefined;
  const def = firstItem ? getDef(p, firstItem.defId) : undefined;
  const img = firstItem && def ? itemImage(p, firstItem, def) : undefined;
  const col = def ? catColor(def) : 'var(--accent)';
  const focus = () => {
    const s0 = st();
    if (s.items?.length) {
      const it = p.items.find((i) => i.id === s.items![0]);
      s0.set({ sel: { items: s.items, cables: [], zones: [], notes: [] }, areaId: it?.areaId || s0.areaId, view: 'plan', focus: it ? { x: it.x, y: it.y, at: Date.now() } : null });
    } else if (s.cables?.length) {
      const c = p.cables.find((x) => x.id === s.cables![0]);
      const it = c ? p.items.find((i) => i.id === c.a.item) : undefined;
      s0.set({ sel: { items: [], cables: s.cables, zones: [], notes: [] }, areaId: it?.areaId || s0.areaId, view: 'plan', focus: it ? { x: it.x, y: it.y, at: Date.now() } : null });
    }
  };
  if (s.compact) {
    return (
      <div className={'step compact' + (done ? ' done' : '')}>
        <input type="checkbox" checked={done} onChange={() => toggleDone(s.id)} style={{ width: 17, height: 17, marginTop: 2, accentColor: 'var(--ok)' }} />
        <div>
          <div className="st-title" onClick={focus} style={{ cursor: 'pointer' }}>
            {s.title}
          </div>
          {s.lines.length ? <div className="hint small">{s.lines.join(' · ')}</div> : null}
          {s.warn?.map((w, i) => (
            <div key={i} className="warnline">
              ⚠ {w}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className={'step' + (done ? ' done' : '')}>
      <input type="checkbox" checked={done} onChange={() => toggleDone(s.id)} style={{ width: 18, height: 18, marginTop: 10, accentColor: 'var(--ok)' }} />
      <div className="st-ic" style={{ background: img ? undefined : typeof col === 'string' && col.startsWith('#') ? col + '18' : 'var(--panel2)' }}>
        {img ? <img src={img} alt="" /> : <Icon name={s.icon || def?.icon || 'checklist'} size={28} color={col} stroke={1.6} />}
      </div>
      <div>
        <div className="st-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{s.title}</span>
          {s.items?.length || s.cables?.length ? (
            <button className="ibtn sm no-print" onClick={focus} title="Plan">
              <Icon name="pin" size={14} />
            </button>
          ) : null}
        </div>
        <ul>
          {s.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        {s.warn?.map((w, i) => (
          <div key={i} className="warnline">
            ⚠ {w}
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanFigures() {
  const p = useStore((s) => s.project);
  const layers = useStore((s) => s.layers);
  const lang = useStore((s) => s.lang);
  const t = useT();
  return (
    <>
      {p.areas.map((area) => {
        const W = 900;
        const k = Math.min(W / (area.w + 3), 620 / (area.d + 3));
        return (
          <div key={area.id} className="panel" style={{ marginBottom: 12 }}>
            <div className="panel-h">
              <Icon name="plan" size={16} /> {area.name} — {area.w} × {area.d} m
            </div>
            <svg viewBox={`0 0 ${(area.w + 3) * k} ${(area.d + 3) * k}`} style={{ width: '100%', height: 'auto', background: 'var(--plan-bg)', display: 'block' }}>
              <g transform={`translate(${1.6 * k} ${1.6 * k}) scale(${k})`}>
                <PlanDrawing p={p} area={area} layers={{ ...layers, heatmap: false, coverage: false, grid: true, labels: true, dims: true }} sel={{ items: [], cables: [], zones: [], notes: [] }} k={k * 1.15} lang={lang} t={t} vb={{ x0: -1.5, y0: -1.5, x1: area.w + 1.5, y1: area.d + 1.5 }} print />
              </g>
            </svg>
          </div>
        );
      })}
    </>
  );
}
