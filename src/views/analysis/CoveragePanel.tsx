import { useEffect, useMemo, useState } from 'react';
import { coveragePlan, danceScan, profileRows, zoneTarget, type CoveragePlan, type Proposal, type ZoneEval } from '../../engine/coverage';
import { fmt, L } from '../../i18n';
import { getDef } from '../../model/project';
import type { Area, Lang, Project } from '../../model/types';
import { applyCoverage, moveDanceGap, updateZone } from '../../store/actions';
import { st, useStore, useT } from '../../store/store';
import { Check, Icon, Num } from '../../ui/kit';
import { ZONE_STYLE } from '../common';
import { limitsOf } from '../../audio/meter';
import { PlanDrawing } from '../plan/PlanDrawing';
import type { TFn } from '../../i18n';

// Bölge hedefleri, öneriler, pist mesafesi ve mesafe profili
export function CoveragePanel({ area }: { area: Area }) {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const installer = useStore((s) => s.installer);
  const plan = coveragePlan(p, area.id);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [levelsToo, setLevelsToo] = useState(true);
  const propKey = plan.proposals.map((x) => x.id).join('|');
  useEffect(() => setChosen(new Set(plan.proposals.map((x) => x.id))), [propKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (plan.noZones)
    return (
      <div className="panel cov" data-testid="coverage-panel">
        <Head t={t} />
        <div className="panel-b">
          <p className="hint">{t('cov.noZones')}</p>
          <button className="btn sm" onClick={() => st().set({ view: 'plan', tool: 'zone' })}>
            <Icon name="zone" size={14} /> {t('cov.drawZone')}
          </button>
        </div>
      </div>
    );
  if (plan.noSpeakers)
    return (
      <div className="panel cov" data-testid="coverage-panel">
        <Head t={t} />
        <div className="panel-b">
          <p className="hint">{t('cov.noSpeakers')}</p>
        </div>
      </div>
    );

  const sel = plan.proposals.filter((x) => chosen.has(x.id));
  const apply = () => {
    const n = applyCoverage(sel.map((x) => x.id), levelsToo);
    st().notify(n ? t('cov.applied', { n }) : t('cov.appliedLevels'));
    st().set({ ghosts: false });
  };
  const hasLevel = plan.levelChanges.length > 0;
  return (
    <div className="panel cov" data-testid="coverage-panel">
      <Head t={t} />
      <div className="panel-b">
        <Summary plan={plan} lang={lang} t={t} />
        <ZoneTable now={plan.now} after={plan.proposals.length ? plan.final : hasLevel ? plan.levelOnly : null} lang={lang} t={t} readOnly={installer} />
        {plan.headShort > 1 ? (
          <div className="warnline" style={{ marginTop: 8 }}>
            ⚠ {t('cov.headShort', { d: fmt(plan.headShort, 0, lang) })}
          </div>
        ) : null}

        {(() => {
          const lim = limitsOf(p);
          const hi = Math.max(...plan.now.map((e) => e.target));
          return lim.on && hi > lim.laeq ? (
            <div className="cov-adv">
              <Icon name="warning" size={16} />
              <span>{t('cov.overLimit', { t: hi, l: lim.laeq })}</span>
            </div>
          ) : null;
        })()}
        {plan.advice.map((a, i) => (
          <div key={i} className="cov-adv">
            <Icon name={a.code === 'reverb' ? 'house' : 'info'} size={16} />
            <span>{t(('cov.adv.' + a.code) as 'cov.adv.reverb', a.vars)}</span>
          </div>
        ))}

        <div className="cov-grid">
          <div>
            <div className="cov-h">{t('cov.map')}</div>
            <CovMap p={p} area={area} ghosts={plan.proposals} lang={lang} t={t} />
            <DevLegend t={t} />
          </div>
          <div>
            <div className="cov-h">{t('cov.profile')}</div>
            <Profile p={p} area={area} plan={plan} lang={lang} t={t} />
          </div>
        </div>

        <div className="cov-h" style={{ marginTop: 14 }}>
          {t('cov.proposals')}
        </div>
        {!plan.proposals.length && !hasLevel ? <p className="hint">{t('cov.allGood')}</p> : null}
        <div className="cov-props">
          {plan.proposals.map((pr) => (
            <ProposalCard key={pr.id} pr={pr} p={p} lang={lang} t={t} on={chosen.has(pr.id)} onToggle={(v) => setChosen((s0) => { const n = new Set(s0); if (v) n.add(pr.id); else n.delete(pr.id); return n; })} disabled={installer} />
          ))}
          {hasLevel ? (
            <div className="cov-card">
              <div className="cov-ic" style={{ background: '#0ea5e918', color: '#0284c7' }}>
                <Icon name="sparkles" size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <b>{t('cov.p.levels')}</b>
                <ul>
                  {plan.levelChanges.map((c) => (
                    <li key={c.key}>
                      {c.key === 'main' ? t('cov.mainSystem') : t(('role.spk.' + c.role) as 'role.spk.main')} ({c.labels.join(', ')}): <b>{c.delta <= -20 ? t('cov.off') : `${c.delta > 0 ? '+' : ''}${fmt(c.delta, 1, lang)} dB`}</b>
                    </li>
                  ))}
                </ul>
                <div className="hint small">{t('cov.levelsHint')}</div>
              </div>
            </div>
          ) : null}
        </div>
        {!installer && (plan.proposals.length || hasLevel) ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }} className="no-print">
            <Check checked={levelsToo} onChange={setLevelsToo}>
              {t('cov.levelsToo')}
            </Check>
            <span style={{ flex: 1 }} />
            {plan.proposals.length ? (
              <button className="btn" onClick={() => st().set({ view: 'plan', ghosts: true })} data-testid="cov-show">
                <Icon name="eye" size={15} /> {t('cov.showOnPlan')}
              </button>
            ) : null}
            <button className="btn primary" disabled={!sel.length && !(levelsToo && hasLevel)} onClick={apply} data-testid="cov-apply">
              <Icon name="ok" size={15} /> {t('cov.apply')}
            </button>
          </div>
        ) : null}

        <DanceDistance p={p} area={area} lang={lang} t={t} readOnly={installer} />
      </div>
    </div>
  );
}

function Summary({ plan, lang, t }: { plan: CoveragePlan; lang: Lang; t: TFn }) {
  const after = plan.proposals.length ? plan.final : plan.levelChanges.length ? plan.levelOnly : null;
  const prim = plan.now.find((e) => e.kind === 'dance') || plan.now[0];
  const others = (l: ZoneEval[]) => l.filter((e) => e.zoneId !== prim.zoneId && !isNaN(e.avg));
  const avg = (l: ZoneEval[]) => (l.length ? l.reduce((s0, e) => s0 + e.avg, 0) / l.length : NaN);
  const clr = (l: ZoneEval[]) => {
    const v = l.filter((e) => !isNaN(e.clear));
    return v.length ? v.reduce((s0, e) => s0 + e.clear, 0) / v.length : NaN;
  };
  const pa = after?.find((e) => e.zoneId === prim.zoneId);
  const on = others(plan.now);
  const oa = after ? others(after) : [];
  const tgtO = on.length ? Math.round(avg(on.map((e) => ({ ...e, avg: e.target })))) : NaN;
  const tone = (v: number, tg: number) => (Math.abs(v - tg) <= 3 ? 'ok' : 'warn');
  const tile = (label: string, now: string, plan0: string | null, toneNow: string, tonePlan: string, sub: string) => (
    <div className="cov-big">
      <span className="l">{label}</span>
      <div>
        <b className={toneNow}>{now}</b>
        {plan0 ? (
          <>
            <span className="arrow">→</span>
            <b className={tonePlan}>{plan0}</b>
          </>
        ) : null}
      </div>
      <span className="hint small">{sub}</span>
    </div>
  );
  return (
    <div className="cov-sum">
      {tile(prim.name, `${fmt(prim.avg, 0, lang)} dB`, pa ? `${fmt(pa.avg, 0, lang)} dB` : null, tone(prim.avg, prim.target), pa ? tone(pa.avg, pa.target) : '', t('cov.targetShort', { d: prim.target }))}
      {on.length ? tile(t('cov.others'), `${fmt(avg(on), 0, lang)} dB`, oa.length ? `${fmt(avg(oa), 0, lang)} dB` : null, tone(avg(on), tgtO), oa.length ? tone(avg(oa), tgtO) : '', t('cov.targetShort', { d: tgtO })) : null}
      {!isNaN(clr(on)) ? tile(t('cov.clear'), `%${Math.round(clr(on) * 100)}`, oa.length && !isNaN(clr(oa)) ? `%${Math.round(clr(oa) * 100)}` : null, clr(on) >= 0.7 ? 'ok' : 'warn', clr(oa) >= 0.7 ? 'ok' : 'warn', t('cov.clearShort')) : null}
      <p className="hint small" style={{ flex: '1 1 220px', margin: 0 }}>
        {t('cov.devHint')}
      </p>
    </div>
  );
}

function Head({ t }: { t: TFn }) {
  return (
    <div className="panel-h">
      <Icon name="speakerline" size={16} /> {t('cov.title')}
    </div>
  );
}

function ZoneTable({ now, after, lang, t, readOnly }: { now: ZoneEval[]; after: ZoneEval[] | null; lang: Lang; t: TFn; readOnly: boolean }) {
  const p = useStore((s) => s.project);
  return (
    <div className="tbl-wrap" style={{ marginTop: 10 }}>
      <table className="tbl cov-tbl">
        <thead>
          <tr>
            <th>{t('cov.zone')}</th>
            <th className="n">{t('cov.target')}</th>
            <th className="n">{t('cov.avg')}</th>
            <th className="n">{t('cov.range')}</th>
            <th>{t('cov.ok')}</th>
            <th className="n" title={t('cov.clearHint')}>{t('cov.clear')}</th>
            {after ? <th className="n">{t('cov.after')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {now.map((e) => {
            const a = after?.find((x) => x.zoneId === e.zoneId);
            const z = p.zones.find((x) => x.id === e.zoneId);
            const col = (ZONE_STYLE[e.kind] || ZONE_STYLE.custom).stroke;
            const d = e.avg - e.target;
            return (
              <tr key={e.zoneId}>
                <td>
                  <span className="dot" style={{ background: col }} /> <b>{e.name}</b> <span className="hint small">{t(('zone.' + e.kind) as 'zone.dance')}</span>
                </td>
                <td className="n">
                  {readOnly || !z ? (
                    `${e.target} dB`
                  ) : (
                    <Num value={zoneTarget(z) ?? 0} onChange={(v) => updateZone(z.id, { target: Math.max(0, Math.min(125, Math.round(v))) })} unit="dB" step={1} digits={0} width={84} />
                  )}
                </td>
                <td className="n">
                  <b style={{ color: Math.abs(d) <= 3 ? 'var(--ok)' : 'var(--warn)' }}>{fmt(e.avg, 0, lang)} dB</b>
                  <div className="hint small">{d > 0 ? '+' : ''}{fmt(d, 0, lang)}</div>
                </td>
                <td className="n">
                  {fmt(e.p10, 0, lang)}–{fmt(e.p90, 0, lang)}
                </td>
                <td style={{ minWidth: 120 }}>
                  <OkBar e={e} lang={lang} />
                </td>
                <td className="n" title={t('cov.clearHint')}>
                  {isNaN(e.clear) ? '–' : <span style={{ color: e.clear >= 0.7 ? 'var(--ok)' : 'var(--warn)' }}>%{Math.round(e.clear * 100)}</span>}
                  {a && !isNaN(a.clear) && Math.abs(a.clear - e.clear) > 0.04 ? <div className="hint small">→ %{Math.round(a.clear * 100)}</div> : null}
                </td>
                {after ? (
                  <td className="n">
                    {a ? (
                      <>
                        <b style={{ color: Math.abs(a.avg - a.target) <= 3 ? 'var(--ok)' : 'var(--warn)' }}>{fmt(a.avg, 0, lang)} dB</b>
                        <div className="hint small">%{Math.round(a.ok * 100)}</div>
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OkBar({ e, lang }: { e: ZoneEval; lang: Lang }) {
  return (
    <div title={`${Math.round(e.under * 100)}% / ${Math.round(e.ok * 100)}% / ${Math.round(e.over * 100)}%`}>
      <div className="okbar">
        <span style={{ width: `${e.under * 100}%`, background: '#38bdf8' }} />
        <span style={{ width: `${e.ok * 100}%`, background: 'var(--ok)' }} />
        <span style={{ width: `${e.over * 100}%`, background: '#f97316' }} />
      </div>
      <span className="hint small">%{fmt(e.ok * 100, 0, lang)}</span>
    </div>
  );
}

function ProposalCard({ pr, p, lang, t, on, onToggle, disabled }: { pr: Proposal; p: Project; lang: Lang; t: TFn; on: boolean; onToggle: (v: boolean) => void; disabled: boolean }) {
  const def = pr.add[0] ? getDef(p, pr.add[0].defId) : null;
  const model = def ? L(def.name, lang) : '';
  const title =
    pr.kind === 'aim'
      ? t('cov.p.aim')
      : pr.kind === 'danceFill'
        ? t('cov.p.danceFill', { n: pr.add.length, m: model })
        : pr.kind === 'fill'
          ? t('cov.p.fill', { z: pr.zoneName || '', n: pr.add.length, m: model })
          : t('cov.p.delay', { z: pr.zoneName || '', n: pr.add.length, m: model });
  const col = pr.kind === 'aim' ? '#d97706' : pr.kind === 'danceFill' ? '#db2777' : pr.kind === 'fill' ? '#0891b2' : '#16a34a';
  return (
    <label className={'cov-card' + (on ? ' on' : '')} data-testid={'cov-prop-' + pr.kind}>
      <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} disabled={disabled} />
      <div className="cov-ic" style={{ background: col + '18', color: col }}>
        <Icon name={pr.kind === 'aim' ? 'rotate' : 'speaker'} size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>{title}</b>
        <ul>
          {pr.kind === 'aim'
            ? pr.change.map((c) => {
                const it = p.items.find((x) => x.id === c.itemId);
                return (
                  <li key={c.itemId}>
                    {it?.label}: {t('cov.aimLine', { z: fmt(c.patch.z ?? 0, 1, lang), r: c.patch.rot ?? 0, a: Math.abs(c.patch.tilt ?? 0) })}
                  </li>
                );
              })
            : pr.add.map((s, i) => (
                <li key={i}>
                  {i + 1}. x {fmt(s.x, 1, lang)} · y {fmt(s.y, 1, lang)} m · {t('cov.height', { h: fmt(s.z, 1, lang) })} · {t('cov.delayMs', { ms: fmt(s.delayMs, 1, lang) })}
                </li>
              ))}
        </ul>
        <div className="hint small">{pr.kind === 'aim' ? t('cov.why.aim') : pr.kind === 'danceFill' ? t('cov.why.dance') : pr.kind === 'fill' ? t('cov.why.fill') : pr.clarity ? t('cov.why.delayClear', { d: fmt(pr.dist ?? 0, 0, lang) }) : t('cov.why.delay', { d: fmt(pr.dist ?? 0, 0, lang) })}</div>
      </div>
      <span className="chip ok" title={t('cov.gainHint')}>
        −{Math.round(pr.gain * 100)}%
      </span>
    </label>
  );
}

function CovMap({ p, area, ghosts, lang, t }: { p: Project; area: Area; ghosts: Proposal[]; lang: Lang; t: TFn }) {
  const layers = useStore((s) => s.layers);
  const W = 560;
  const k = Math.min(W / (area.w + 2), 380 / (area.d + 2));
  return (
    <svg viewBox={`0 0 ${(area.w + 2) * k} ${(area.d + 2) * k}`} style={{ width: '100%', height: 'auto', background: 'var(--plan-bg)', borderRadius: 8 }} data-testid="cov-map">
      <g transform={`translate(${k} ${k}) scale(${k})`}>
        <PlanDrawing
          p={p}
          area={area}
          layers={{ ...layers, heatmap: true, cableTags: false, cables: false, labels: true, dims: false, grid: false, coverage: false }}
          sel={{ items: [], cables: [], zones: [], notes: [] }}
          k={k}
          lang={lang}
          t={t}
          vb={{ x0: -1, y0: -1, x1: area.w + 1, y1: area.d + 1 }}
          heat={{ band: 'mid', freq: 1000, coherent: false, mode: 'dev' }}
          ghosts={ghosts}
          print
        />
      </g>
    </svg>
  );
}

export function DevLegend({ t }: { t: TFn }) {
  const stops = ['#1e40af', '#3898ec', '#7dd3fc', '#22c55e', '#facc15', '#f97316', '#dc2626'];
  return (
    <div className="legend" style={{ marginTop: 6 }}>
      <div className="bar" style={{ background: `linear-gradient(90deg, ${stops.join(',')})` }} />
      <div className="scale">
        <span>−12</span>
        <span>−6</span>
        <span>
          <b>{t('cov.onTarget')}</b>
        </span>
        <span>+6</span>
        <span>+12 dB</span>
      </div>
      <div className="hint small">{t('cov.legendHint')}</div>
    </div>
  );
}

// —— Mesafe profili: sahneden uzaklığa göre bölge seviyeleri ——
function Profile({ p, area, plan, lang, t }: { p: Project; area: Area; plan: CoveragePlan; lang: Lang; t: TFn }) {
  const rows = useMemo(() => profileRows(plan), [plan]);
  if (!rows.length) return null;
  const zones = plan.now.map((e) => p.zones.find((z) => z.id === e.zoneId)!).filter(Boolean);
  const showPlan = plan.proposals.length > 0 || plan.levelChanges.length > 0;
  const tg = zones.map((z) => zoneTarget(z)!);
  const yMin = Math.floor((Math.min(...tg) - 15) / 5) * 5;
  const yMax = Math.ceil((Math.max(...tg, ...rows.map((r) => r.max)) + 3) / 5) * 5;
  const W = 560;
  const H = 300;
  const m = { l: 40, r: 12, t: 26, b: 34 };
  const X = (y: number) => m.l + (y / area.d) * (W - m.l - m.r);
  const Y = (db: number) => m.t + (1 - (Math.max(yMin, Math.min(yMax, db)) - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const spk = p.items.filter((it) => it.areaId === area.id && !it.hidden && getDef(p, it.defId).acoustic && getDef(p, it.defId).acoustic!.kind !== 'iem' && it.role !== 'monitor');
  const stage = p.zones.find((z) => z.areaId === area.id && z.kind === 'stage');
  const spkGroups: { y: number; labels: string[] }[] = [];
  for (const it of [...spk].sort((a, b) => a.y - b.y)) {
    const g = spkGroups.find((x) => Math.abs(x.y - it.y) < area.d / 18);
    if (g) g.labels.push(it.label);
    else spkGroups.push({ y: it.y, labels: [it.label] });
  }
  const ticksY: number[] = [];
  for (let v = yMin; v <= yMax; v += 5) ticksY.push(v);
  const stepX = area.d > 30 ? 5 : area.d > 14 ? 2 : 1;
  const ticksX: number[] = [];
  for (let v = 0; v <= area.d + 0.01; v += stepX) ticksX.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" data-testid="cov-profile">
      <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="var(--panel2)" />
      {stage ? <rect x={X(stage.y)} y={m.t} width={X(stage.y + stage.d) - X(stage.y)} height={H - m.t - m.b} fill="var(--line)" opacity={0.7} /> : null}
      {stage ? (
        <text x={(X(stage.y) + X(stage.y + stage.d)) / 2} y={m.t + 12} fontSize={10} textAnchor="middle" fill="var(--muted)">
          {stage.name}
        </text>
      ) : null}
      {ticksY.map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} stroke="var(--line)" strokeWidth={1} />
          <text x={m.l - 5} y={Y(v) + 3.5} fontSize={10} textAnchor="end" fill="var(--muted)">
            {v}
          </text>
        </g>
      ))}
      {ticksX.map((v) => (
        <text key={v} x={X(v)} y={H - m.b + 14} fontSize={10} textAnchor="middle" fill="var(--muted)">
          {fmt(v, 0, lang)}
        </text>
      ))}
      <text x={(m.l + W - m.r) / 2} y={H - 4} fontSize={10.5} textAnchor="middle" fill="var(--muted)">
        {t('cov.profileX')}
      </text>
      <text x={10} y={m.t - 10} fontSize={10.5} fill="var(--muted)">
        dB
      </text>
      {/* hedef bantları */}
      {zones.map((z) => {
        const T = zoneTarget(z)!;
        const col = (ZONE_STYLE[z.kind] || ZONE_STYLE.custom).stroke;
        return (
          <g key={z.id}>
            <rect x={X(z.y)} y={Y(T + 3)} width={Math.max(2, X(z.y + z.d) - X(z.y))} height={Y(T - 3) - Y(T + 3)} fill={col} opacity={0.13} />
            <line x1={X(z.y)} x2={X(z.y + z.d)} y1={Y(T)} y2={Y(T)} stroke={col} strokeWidth={1.2} strokeDasharray="2 3" />
          </g>
        );
      })}
      {/* bölge çizgileri */}
      {zones.map((z) => {
        const rs = rows.filter((r) => r.zone === z.id);
        if (!rs.length) return null;
        const col = (ZONE_STYLE[z.kind] || ZONE_STYLE.custom).stroke;
        const d = rs.map((r, i) => `${i ? 'L' : 'M'} ${X(r.y).toFixed(1)} ${Y(r.now).toFixed(1)}`).join(' ');
        const dp = rs.map((r, i) => `${i ? 'L' : 'M'} ${X(r.y).toFixed(1)} ${Y(r.plan).toFixed(1)}`).join(' ');
        const band = rs.map((r, i) => `${i ? 'L' : 'M'} ${X(r.y).toFixed(1)} ${Y(r.max).toFixed(1)}`).join(' ') + ' ' + [...rs].reverse().map((r) => `L ${X(r.y).toFixed(1)} ${Y(r.min).toFixed(1)}`).join(' ') + ' Z';
        return (
          <g key={z.id}>
            <path d={band} fill={col} opacity={0.12} />
            <path d={d} fill="none" stroke={col} strokeWidth={2.2} />
            {showPlan ? <path d={dp} fill="none" stroke={col} strokeWidth={1.8} strokeDasharray="6 4" /> : null}
          </g>
        );
      })}
      {/* hoparlör konumları (yakın olanlar tek etikette) */}
      {spkGroups.map((g, i) => (
        <g key={i}>
          <line x1={X(g.y)} x2={X(g.y)} y1={m.t} y2={H - m.b} stroke="var(--faint)" strokeWidth={1} strokeDasharray="1 3" />
          <text x={X(g.y)} y={m.t - 4} fontSize={9} textAnchor="middle" fill="var(--muted)">
            {g.labels.length > 2 ? `${g.labels[0]} +${g.labels.length - 1}` : g.labels.join(' ')}
          </text>
        </g>
      ))}
      {/* açıklama */}
      <g transform={`translate(${W - m.r - 150} ${H - m.b - (showPlan ? 34 : 18)})`}>
        <rect width={146} height={showPlan ? 30 : 15} fill="var(--panel)" opacity={0.85} rx={3} />
        <line x1={6} x2={26} y1={8} y2={8} stroke="var(--text)" strokeWidth={2} />
        <text x={30} y={11} fontSize={9.5} fill="var(--text)">
          {t('cov.lineNow')}
        </text>
        {showPlan ? (
          <>
            <line x1={6} x2={26} y1={22} y2={22} stroke="var(--text)" strokeWidth={1.6} strokeDasharray="5 3" />
            <text x={30} y={25} fontSize={9.5} fill="var(--text)">
              {t('cov.linePlan')}
            </text>
          </>
        ) : null}
      </g>
    </svg>
  );
}

// —— Pist mesafesi ——
function DanceDistance({ p, area, lang, t, readOnly }: { p: Project; area: Area; lang: Lang; t: TFn; readOnly: boolean }) {
  const sc = danceScan(p, area.id);
  if (!sc) return null;
  const W = 560;
  const H = 170;
  const m = { l: 40, r: 12, t: 12, b: 32 };
  const maxGap = Math.max(...sc.pts.map((x) => x.gap));
  const maxR = Math.max(...sc.pts.map((x) => x.rms)) * 1.1 + 0.2;
  const X = (g: number) => m.l + (g / Math.max(0.1, maxGap)) * (W - m.l - m.r);
  const Y = (r: number) => m.t + (1 - r / maxR) * (H - m.t - m.b);
  const d = sc.pts.map((x, i) => `${i ? 'L' : 'M'} ${X(x.gap).toFixed(1)} ${Y(x.rms).toFixed(1)}`).join(' ');
  const off = sc.current < sc.best[0] - 0.05 || sc.current > sc.best[1] + 0.05;
  return (
    <div style={{ marginTop: 16 }} data-testid="dance-distance">
      <div className="cov-h">{t('cov.danceDist')}</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <span>
          {t('cov.danceNow')}: <b>{fmt(sc.current, 1, lang)} m</b>
        </span>
        <span>
          {t('cov.danceBest')}: <b style={{ color: 'var(--ok)' }}>{fmt(sc.best[0], 1, lang)}–{fmt(sc.best[1], 1, lang)} m</b>
        </span>
        {!readOnly ? (
          <>
            <Num value={sc.current} onChange={(v) => moveDanceGap(Math.max(0, v), sc.ref)} unit="m" step={0.5} digits={1} width={96} />
            {off ? (
              <button className="btn sm primary" onClick={() => moveDanceGap(sc.bestGap, sc.ref)} data-testid="dance-move">
                {t('cov.danceMove', { m: fmt(sc.bestGap, 1, lang) })}
              </button>
            ) : (
              <span className="chip ok">{t('cov.danceOk')}</span>
            )}
          </>
        ) : null}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart">
        <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="var(--panel2)" />
        <rect x={X(sc.best[0])} y={m.t} width={Math.max(3, X(sc.best[1]) - X(sc.best[0]))} height={H - m.t - m.b} fill="var(--ok)" opacity={0.15} />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2.2} />
        {sc.pts.map((x) => (
          <circle key={x.gap} cx={X(x.gap)} cy={Y(x.rms)} r={2.2} fill="var(--accent)" />
        ))}
        <line x1={X(sc.current)} x2={X(sc.current)} y1={m.t} y2={H - m.b} stroke="#db2777" strokeWidth={2} />
        <text x={X(sc.current) + 4} y={m.t + 11} fontSize={10} fill="#db2777" fontWeight={700}>
          {t('cov.now')}
        </text>
        {[0, Math.round(maxGap / 2), Math.floor(maxGap)].map((g) => (
          <text key={g} x={X(g)} y={H - m.b + 14} fontSize={10} textAnchor="middle" fill="var(--muted)">
            {g} m
          </text>
        ))}
        <text x={(m.l + W - m.r) / 2} y={H - 3} fontSize={10.5} textAnchor="middle" fill="var(--muted)">
          {t('cov.danceAxis')}
        </text>
        <text x={m.l - 5} y={Y(0) + 3} fontSize={10} textAnchor="end" fill="var(--muted)">
          0
        </text>
        <text x={m.l - 5} y={Y(maxR / 1.1) + 3} fontSize={10} textAnchor="end" fill="var(--muted)">
          ±{fmt(maxR / 1.1, 1, lang)}
        </text>
      </svg>
      <p className="hint small">{t('cov.danceHint')}</p>
    </div>
  );
}
