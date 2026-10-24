// Ana sayfa: işin adımları sırayla — ne bitti, sırada ne var (telefonda başlangıç ekranı)
import { useMemo, useState } from 'react';
import { runChecks } from '../../engine/checks';
import { caseProgress, packingNeeds } from '../../engine/packing';
import { analyzePower } from '../../engine/power';
import { buildSetup } from '../../engine/setup';
import { fmt } from '../../i18n';
import { getDef } from '../../model/project';
import { makePowerAlternatives } from '../../store/variantActions';
import { addVenue } from '../../store/venueActions';
import { st, useStore, useT, type View } from '../../store/store';
import { Icon } from '../../ui/kit';

type Status = 'ok' | 'todo' | 'warn';

interface Step {
  id: string;
  icon: string;
  title: string;
  info: string;
  status: Status;
  go: () => void;
  extra?: JSX.Element | null;
}

export function HomeView() {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const installer = useStore((s) => s.installer);
  const venues = useStore((s) => s.library.venues);
  const [venueOpen, setVenueOpen] = useState(false);
  const issues = runChecks(p);
  const pw = analyzePower(p);
  const setup = useMemo(() => buildSetup(p, t, lang), [p, t, lang]);
  const needs = useMemo(() => packingNeeds(p, t, lang), [p, t, lang]);
  const go = (view: View, extra?: Partial<ReturnType<typeof st>>) => st().set({ view, ...extra });
  const m = p.meta;
  const zones = p.zones.length;
  const area = p.areas[0];
  const speakers = p.items.filter((i) => getDef(p, i.defId).acoustic).length;
  const powerErr = issues.filter((i) => i.level === 'error' && /power|breaker|overload|phase|unpowered|generator|voltage/i.test(i.code)).length;
  const groups = p.variants || [];
  const cases = p.cases || [];
  const missing = needs.filter((n) => n.need > n.packed).reduce((s, n) => s + n.need - n.packed, 0);
  const prog = cases.map((c) => caseProgress(p, c));
  const total = prog.reduce((s, x) => s + x.total, 0);
  const out = prog.reduce((s, x) => s + x.out, 0);
  const doneSteps = setup.filter((s) => p.done[s.id]).length;
  const meas = p.measurements?.length || 0;
  const errors = issues.filter((i) => i.level === 'error').length;

  const steps: Step[] = [
    {
      id: 'info',
      icon: 'file',
      title: t('home.info'),
      info: [m.client, m.venue, m.date].filter(Boolean).join(' · ') || t('home.infoTodo'),
      status: m.date && (m.venue || m.client) ? 'ok' : 'todo',
      go: () => st().set({ dialog: { kind: 'project' } }),
    },
    {
      id: 'venue',
      icon: 'venue',
      title: t('home.venue'),
      info: area ? `${fmt(area.w, 1, lang)} × ${fmt(area.d, 1, lang)} m · ${t('home.zones', { n: zones })}` : '',
      status: zones ? 'ok' : 'todo',
      go: () => go('plan'),
      extra:
        venues.length && !installer ? (
          <button className="btn sm" onClick={(e) => (e.stopPropagation(), setVenueOpen(!venueOpen))} data-testid="home-venues">
            <Icon name="venue" size={13} /> {t('home.fromVenue')}
          </button>
        ) : null,
    },
    {
      id: 'gear',
      icon: 'speaker',
      title: t('home.gear'),
      info: t('home.gearInfo', { n: p.items.length, s: speakers, c: p.cables.length }),
      status: speakers ? (errors ? 'warn' : 'ok') : 'todo',
      go: () => (speakers || installer ? go('plan') : st().set({ dialog: { kind: 'wizard' } })),
    },
    {
      id: 'power',
      icon: 'bolt',
      title: t('home.power'),
      info:
        t('home.powerInfo', { kw: fmt(pw.totalW / 1000, 1, lang), n: pw.unpowered.length }) +
        (groups.length ? ' · ' + groups.map((g) => g.variants.map((v) => (v.id === g.active ? `[${v.label}]` : v.label)).join('/')).join(', ') : ''),
      status: powerErr || pw.unpowered.length ? 'warn' : pw.roots.length ? 'ok' : 'todo',
      go: () => go('schema', { schemaMode: 'power' }),
      extra:
        !groups.length && !installer && pw.roots.length ? (
          <button
            className="btn sm"
            onClick={(e) => {
              e.stopPropagation();
              const src = p.items.find((i) => getDef(p, i.defId).source && getDef(p, i.defId).mount === 'wall');
              if (src && makePowerAlternatives({ item: src.id })) go('schema', { schemaMode: 'power', sel: { items: [], cables: [], zones: [], notes: [] } });
            }}
            data-testid="home-make-alts"
          >
            <Icon name="bolt" size={13} /> {t('home.makeAlts')}
          </button>
        ) : null,
    },
    {
      id: 'pack',
      icon: 'bag',
      title: t('home.pack'),
      info: cases.length ? t('home.packInfo', { n: cases.length, a: out, b: total }) + (missing ? ' · ' + t('home.packMissing', { n: missing }) : '') : t('home.packTodo'),
      status: cases.length ? (missing ? 'warn' : 'ok') : 'todo',
      go: () => go('pack', { packCase: null }),
    },
    {
      id: 'setup',
      icon: 'checklist',
      title: t('home.setup'),
      info: t('home.setupInfo', { a: doneSteps, b: setup.length }),
      status: setup.length && doneSteps >= setup.length ? 'ok' : doneSteps ? 'warn' : 'todo',
      go: () => go('setup'),
    },
    {
      id: 'measure',
      icon: 'mic',
      title: t('home.measure'),
      info: meas ? t('home.measInfo', { n: meas }) : t('home.measTodo'),
      status: meas ? 'ok' : 'todo',
      go: () => go('measure'),
    },
  ];
  const next = steps.find((s) => s.status !== 'ok');
  const nOk = steps.filter((s) => s.status === 'ok').length;
  return (
    <div className="page home" data-testid="home-view">
      <div className="page-inner home-inner">
        <div className="home-hero">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="hint small">{m.date ? `${m.date}${m.time ? ' · ' + m.time : ''}` : t('home.hello')}</div>
            <h1 className="home-title">{p.name}</h1>
            <div className="home-prog">
              <div className="pk-bar" style={{ flex: 1 }}>
                <span style={{ width: Math.round((nOk / steps.length) * 100) + '%', background: nOk === steps.length ? 'var(--ok)' : 'var(--accent)' }} />
              </div>
              <span className="hint small">{t('home.progress', { a: nOk, b: steps.length })}</span>
            </div>
          </div>
          <button className="ibtn" onClick={() => st().set({ dialog: { kind: 'projects' } })} title={t('menu.projects')}>
            <Icon name="folder" size={20} />
          </button>
        </div>
        {next ? (
          <button className="home-next" onClick={next.go} data-testid="home-next">
            <span className="hint small">{t('home.next')}</span>
            <b>
              <Icon name={next.icon} size={18} /> {next.title}
            </b>
            <span className="home-next-go">
              {t('home.go')} <Icon name="chevron" size={14} />
            </span>
          </button>
        ) : (
          <div className="home-next done">✓ {t('home.allDone')}</div>
        )}
        <div className="home-steps">
          {steps.map((s, i) => (
            <div key={s.id} className={'home-step ' + s.status + (next?.id === s.id ? ' next' : '')} onClick={s.go} role="button" tabIndex={0} data-testid={'home-' + s.id}>
              <span className="home-num">{s.status === 'ok' ? <Icon name="ok" size={16} color="#fff" stroke={2.4} /> : i + 1}</span>
              <div className="home-txt">
                <b>
                  <Icon name={s.icon} size={15} /> {s.title}
                </b>
                <span>{s.info}</span>
                {s.extra ? <div style={{ marginTop: 6 }}>{s.extra}</div> : null}
                {s.id === 'venue' && venueOpen ? (
                  <div className="home-venues" onClick={(e) => e.stopPropagation()}>
                    {venues.map((v) => (
                      <button key={v.id} className="btn sm" onClick={() => (addVenue(v), setVenueOpen(false), st().notify(t('home.venueAdded', { n: v.name })))}>
                        <Icon name="plus" size={12} /> {v.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <Icon name="chevron" size={16} color="var(--faint)" />
            </div>
          ))}
        </div>
        <div className="home-foot">
          <button className={'btn' + (installer ? ' primary' : '')} onClick={() => st().set({ installer: !installer, tool: 'select', placing: null })} data-testid="home-installer">
            <Icon name={installer ? 'unlock' : 'lock'} size={15} /> {installer ? t('menu.editMode') : t('home.crewMode')}
          </button>
          <span className="hint small">{installer ? t('home.crewOn') : t('home.crewHint')}</span>
        </div>
      </div>
    </div>
  );
}
