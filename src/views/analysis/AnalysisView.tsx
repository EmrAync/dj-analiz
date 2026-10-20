import { useMemo } from 'react';
import { MATERIALS, farField, listenZones, roomAcoustics, sourcesOf, speedOfSound, splGrid, splPoint, suggestDelay } from '../../engine/acoustics';
import { runChecks } from '../../engine/checks';
import { analyzePower } from '../../engine/power';
import { fmt, L, makeT } from '../../i18n';
import { getDef } from '../../model/project';
import type { Environment, ProjectSettings } from '../../model/types';
import { applySuggestedDelay } from '../../store/actions';
import { st, useStore, useT } from '../../store/store';
import { Check, Icon, Num, Row, Text } from '../../ui/kit';
import { PlanDrawing } from '../plan/PlanDrawing';
import { HeatLegend } from '../HeatLegend';

export function AnalysisView() {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const areaId = useStore((s) => s.areaId);
  const heat = useStore((s) => s.heat);
  const layers = useStore((s) => s.layers);
  const area = p.areas.find((a) => a.id === areaId) || p.areas[0];
  const mid = splGrid(p, area.id, { band: 'mid', freq: 1000, coherent: false });
  const low = splGrid(p, area.id, { band: 'low', freq: 63, coherent: false });
  const ra = roomAcoustics(area);
  const pw = analyzePower(p);
  const issues = runChecks(p);
  const srcs = sourcesOf(p, area.id);
  const foh = p.zones.find((z) => z.areaId === area.id && z.kind === 'foh');
  const fohSpl = foh ? splPoint(p, area.id, foh.x + foh.w / 2, foh.y + foh.d / 2) : null;
  const target = p.settings.targetSpl;
  const setS = (patch: Partial<ProjectSettings>) => st().mutate((d) => void Object.assign(d.settings, patch));
  const setE = (patch: Partial<Environment>) => st().mutate((d) => void Object.assign(d.env, patch));
  const c = speedOfSound(p.env.tempC);
  const speakers = p.items.filter((i) => i.areaId === area.id && getDef(p, i.defId).acoustic && getDef(p, i.defId).acoustic!.kind !== 'iem');
  const recs = useMemo(() => recommendations(), [p, area.id, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  function recommendations(): string[] {
    const tt = makeT(lang);
    const r: string[] = [];
    if (!srcs.length) return [tt('rec.noSpeakers')];
    if (mid?.stats) {
      const spread = mid.stats.p90 - mid.stats.p10;
      if (mid.stats.avg < target - 6) r.push(tt('rec.tooQuiet', { d: (target - mid.stats.avg).toFixed(0) }));
      else if (mid.stats.avg > target + 6) r.push(tt('rec.tooLoud'));
      if (spread > 10) r.push(tt('rec.uneven', { d: spread.toFixed(0) }));
      else r.push(tt('rec.evenOk', { d: spread.toFixed(0) }));
    }
    if (ra) {
      if (ra.verdict === 'reverberant' || ra.verdict === 'very') r.push(tt('rec.reverb', { rt: ra.rt[1].toFixed(1), dc: ra.dc.toFixed(1) }));
      const depth = area.d;
      if (depth > ra.dc * 3 && !speakers.some((s) => s.role === 'delay')) r.push(tt('rec.delayTowers', { d: depth.toFixed(0) }));
      if (ra.rt[0] > ra.rt[1] * 1.5) r.push(tt('rec.bassBoom'));
    }
    const subs = speakers.filter((s) => getDef(p, s.defId).acoustic!.kind === 'sub');
    if (!subs.length) r.push(tt('rec.noSubs'));
    else if (subs.length >= 2) r.push(tt('rec.subTips'));
    if (pw.unpowered.length) r.push(tt('rec.power', { n: pw.unpowered.length }));
    if (!area.indoor) r.push(tt('rec.outdoor'));
    return r;
  }

  return (
    <div className="page" data-testid="analysis-view">
      <div className="page-inner">
        <div className="page-head">
          <h1>
            {t('view.analysis')} — {area.name}
          </h1>
          <button className="btn no-print" onClick={() => st().set({ view: 'plan', layers: { ...layers, heatmap: true } })}>
            <Icon name="heat" size={15} /> {t('an.showOnPlan')}
          </button>
        </div>
        <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 12 }}>
          <Stat l={t('an.avg')} v={mid?.stats ? `${fmt(mid.stats.avg, 0, lang)} dB` : '–'} tone={mid?.stats ? (mid.stats.avg < target - 6 ? 'warn' : 'ok') : undefined} />
          <Stat l={t('an.spread')} v={mid?.stats ? `±${fmt((mid.stats.p90 - mid.stats.p10) / 2, 1, lang)} dB` : '–'} tone={mid?.stats ? (mid.stats.p90 - mid.stats.p10 > 10 ? 'warn' : 'ok') : undefined} />
          <Stat l={t('an.max')} v={mid?.stats ? `${fmt(mid.stats.max, 0, lang)} dB` : '–'} tone={mid?.stats && mid.stats.max > 115 ? 'warn' : undefined} />
          <Stat l={t('an.low')} v={low?.stats ? `${fmt(low.stats.avg, 0, lang)} dB` : '–'} />
          <Stat l={t('an.foh')} v={fohSpl && !isNaN(fohSpl.mid) ? `${fmt(fohSpl.mid, 0, lang)} dB` : '–'} />
          <Stat l={t('an.rt')} v={ra ? `${fmt(ra.rt[1], 2, lang)} s` : t('an.outdoor')} tone={ra ? (ra.rt[1] > 1.6 ? 'warn' : 'ok') : undefined} />
        </div>
        <div className="grid-2">
          <div className="panel">
            <div className="panel-h">
              <Icon name="heat" size={16} /> {t('an.map')}
            </div>
            <div className="panel-b">
              <MiniMap />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <HeatLegend />
              </div>
              <p className="hint small">{t('an.mapHint', { h: p.settings.earH, b: heat.band === 'mid' ? '1 kHz' : heat.freq + ' Hz' })}</p>
            </div>
          </div>
          <div className="panel">
            <div className="panel-h">
              <Icon name="sparkles" size={16} /> {t('an.recs')}
            </div>
            <div className="panel-b">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {recs.map((r, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {r}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="chip err">
                  {issues.filter((i) => i.level === 'error').length} {t('checks.err')}
                </span>
                <span className="chip warn">
                  {issues.filter((i) => i.level === 'warn').length} {t('checks.warn')}
                </span>
                <span className="chip info">
                  {issues.filter((i) => i.level === 'info').length} {t('checks.info')}
                </span>
                <button className="btn sm" onClick={() => st().set({ leftTab: 'checks', leftOpen: true })}>
                  {t('an.openChecks')}
                </button>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-h">
              <Icon name="speakerline" size={16} /> {t('an.system')}
            </div>
            <div className="panel-b">
              <Row label={t('an.level')}>
                <Num value={p.settings.level} onChange={(v) => setS({ level: Math.max(-30, Math.min(0, v)) })} unit="dB" step={1} digits={0} />
              </Row>
              <Row label={t('an.target')}>
                <Num value={p.settings.targetSpl} onChange={(v) => setS({ targetSpl: Math.max(70, Math.min(115, v)) })} unit="dB" step={1} digits={0} />
              </Row>
              <Row label={t('an.earH')}>
                <Num value={p.settings.earH} onChange={(v) => setS({ earH: Math.max(0.8, Math.min(2.2, v)) })} unit="m" step={0.1} />
              </Row>
              <Row label={t('an.crest')}>
                <Num value={p.settings.crest} onChange={(v) => setS({ crest: Math.max(0, Math.min(20, v)) })} unit="dB" step={1} digits={0} />
              </Row>
              <Row label={t('an.slack')}>
                <div className="row2">
                  <Num value={p.settings.slackPct} onChange={(v) => setS({ slackPct: Math.max(0, Math.min(50, v)) })} unit="%" step={1} digits={0} />
                  <Num value={p.settings.slackM} onChange={(v) => setS({ slackM: Math.max(0, Math.min(10, v)) })} unit="m" step={0.5} digits={1} />
                </div>
              </Row>
              <p className="hint small">{t('an.systemHint')}</p>
            </div>
          </div>
          <div className="panel">
            <div className="panel-h">
              <Icon name="house" size={16} /> {t('an.room')}
            </div>
            <div className="panel-b">
              {ra ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '6px 10px', alignItems: 'center' }}>
                    {(['125 Hz', '500 Hz', '2 kHz'] as const).map((f, i) => {
                      const v = ra.rt[i];
                      const col = v > 2 ? 'var(--err)' : v > 1.4 ? 'var(--warn)' : 'var(--ok)';
                      return (
                        <FragmentRow key={f} f={f} v={v} col={col} lang={lang} />
                      );
                    })}
                  </div>
                  <p style={{ marginBottom: 4 }}>
                    <b>{t(('an.verdict.' + ra.verdict) as 'an.verdict.good')}</b>
                  </p>
                  <dl className="kv">
                    <dt>{t('an.volume')}</dt>
                    <dd>{fmt(ra.V, 0, lang)} m³</dd>
                    <dt>{t('an.absorb')}</dt>
                    <dd>{fmt(ra.A[1], 0, lang)} m² Sabine</dd>
                    <dt>{t('an.dc')}</dt>
                    <dd>{fmt(ra.dc, 1, lang)} m</dd>
                    <dt>{t('an.materials')}</dt>
                    <dd>
                      {L(MATERIALS[area.floor].name, lang)} / {L(MATERIALS[area.walls].name, lang)} / {L(MATERIALS[area.ceiling].name, lang)}
                    </dd>
                  </dl>
                  <button className="btn sm" style={{ marginTop: 8 }} onClick={() => st().set({ dialog: { kind: 'area', data: { id: area.id } } })}>
                    <Icon name="gear" size={13} /> {t('an.editRoom')}
                  </button>
                </>
              ) : (
                <p className="hint">{t('an.outdoorRoom')}</p>
              )}
            </div>
          </div>
          <div className="panel">
            <div className="panel-h">
              <Icon name="thermo" size={16} /> {t('an.env')}
            </div>
            <div className="panel-b">
              <div className="row2">
                <Num label="°C" value={p.env.tempC} onChange={(v) => setE({ tempC: v })} step={1} digits={0} />
                <Num label="%RH" value={p.env.humidity} onChange={(v) => setE({ humidity: Math.max(0, Math.min(100, v)) })} step={5} digits={0} />
                <Num label={t('an.wind')} value={p.env.wind} onChange={(v) => setE({ wind: Math.max(0, v) })} unit="m/s" step={1} digits={0} />
                <Num label={t('an.noiseLimit')} value={p.env.noiseLimit} onChange={(v) => setE({ noiseLimit: Math.max(0, v) })} unit="dB(A)" step={1} digits={0} />
                <Num label={t('an.neighbor')} value={p.env.neighborDist} onChange={(v) => setE({ neighborDist: Math.max(0, v) })} unit="m" step={5} digits={0} />
              </div>
              <Row label={t('an.curfew')}>
                <Text value={p.env.curfew} onChange={(v) => setE({ curfew: v })} placeholder="22:00" />
              </Row>
              <Check checked={p.env.rain} onChange={(v) => setE({ rain: v })}>
                {t('an.rain')}
              </Check>
              <dl className="kv" style={{ marginTop: 8 }}>
                <dt>{t('an.c')}</dt>
                <dd>{fmt(c, 1, lang)} m/s</dd>
                <dt>{t('an.msPerM')}</dt>
                <dd>{fmt(1000 / c, 2, lang)} ms/m</dd>
                {p.env.neighborDist > 0 ? (
                  <>
                    <dt>{t('an.atNeighbor')}</dt>
                    <dd>{fmt(farField(p, p.env.neighborDist), 0, lang)} dB</dd>
                  </>
                ) : null}
              </dl>
              <p className="hint small">{t('an.envHint')}</p>
            </div>
          </div>
          <div className="panel">
            <div className="panel-h">
              <Icon name="bolt" size={16} /> {t('an.power')}
            </div>
            <div className="panel-b">
              <dl className="kv">
                <dt>{t('lists.totalPower')}</dt>
                <dd>
                  <b>{fmt(pw.totalW / 1000, 2, lang)} kW</b>
                </dd>
                <dt>{t('an.current230')}</dt>
                <dd>{fmt(pw.totalW / 230 / 0.95, 1, lang)} A</dd>
              </dl>
              {pw.circuits
                .filter((c2) => c2.perPhase)
                .map((c2, i) => (
                  <div key={i} style={{ marginTop: 10 }}>
                    <b>{c2.label}</b>
                    {(['L1', 'L2', 'L3'] as const).map((ph) => {
                      const a = c2.perPhase![ph] / 230 / 0.95;
                      const pct = a / c2.breakerA;
                      const col = pct > 1 ? 'var(--err)' : pct > 0.8 ? 'var(--warn)' : 'var(--ok)';
                      return (
                        <div key={ph} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 70px', gap: 8, alignItems: 'center', marginTop: 4 }}>
                          <span>{ph}</span>
                          <div className="bar-track">
                            <div className="bar-fill" style={{ width: `${Math.min(100, pct * 100)}%`, background: col }} />
                          </div>
                          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(a, 1, lang)} A</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              <button className="btn sm" style={{ marginTop: 10 }} onClick={() => st().set({ view: 'schema', schemaMode: 'power' })}>
                <Icon name="schema" size={13} /> {t('an.powerSchema')}
              </button>
            </div>
          </div>
        </div>
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-h">
            <Icon name="wave" size={16} /> {t('an.delays')}
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('col.label')}</th>
                  <th>{t('col.model')}</th>
                  <th>{t('insp.role')}</th>
                  <th className="n">{t('an.distFoh')}</th>
                  <th className="n">{t('insp.delay')}</th>
                  <th className="n">{t('insp.suggestDelay')}</th>
                  <th className="n">{t('insp.gain')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {speakers.map((s) => {
                  const d = getDef(p, s.defId);
                  const sd = suggestDelay(p, s);
                  const dist = foh ? Math.hypot(s.x - (foh.x + foh.w / 2), s.y - (foh.y + foh.d / 2)) : null;
                  return (
                    <tr key={s.id} onClick={() => st().select({ items: [s.id] })} style={{ cursor: 'pointer' }}>
                      <td>
                        <b>{s.label}</b>
                      </td>
                      <td>{[d.brand, d.model].filter(Boolean).join(' ') || L(d.name, lang)}</td>
                      <td>{s.role ? t(('role.spk.' + s.role) as 'role.spk.main') : ''}</td>
                      <td className="n">{dist != null ? fmt(dist, 1, lang) + ' m' : '–'}</td>
                      <td className="n">{fmt(s.delayMs || 0, 1, lang)} ms</td>
                      <td className="n">{sd != null ? fmt(sd, 1, lang) + ' ms' : '–'}</td>
                      <td className="n">{fmt(s.gainDb || 0, 1, lang)} dB</td>
                      <td>
                        {sd != null && Math.abs((s.delayMs || 0) - sd) > 0.5 ? (
                          <button
                            className="btn sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              applySuggestedDelay(s.id);
                            }}
                          >
                            {t('insp.apply')}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint small" style={{ padding: '0 14px 10px' }}>
            {t('an.delayHint')}
          </p>
        </div>
        {listenZones(p, area.id).length === 0 ? <p className="hint">{t('an.noZones')}</p> : null}
      </div>
    </div>
  );
}

function FragmentRow({ f, v, col, lang }: { f: string; v: number; col: string; lang: 'tr' | 'de' | 'en' }) {
  return (
    <>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{f}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${Math.min(100, (v / 3) * 100)}%`, background: col }} />
      </div>
      <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(v, 2, lang)} s</b>
    </>
  );
}

function Stat({ l, v, tone }: { l: string; v: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="stat">
      <span className="l">{l}</span>
      <span className="v" style={{ color: tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : undefined }}>
        {v}
      </span>
    </div>
  );
}

function MiniMap() {
  const p = useStore((s) => s.project);
  const areaId = useStore((s) => s.areaId);
  const layers = useStore((s) => s.layers);
  const heat = useStore((s) => s.heat);
  const lang = useStore((s) => s.lang);
  const t = useT();
  const area = p.areas.find((a) => a.id === areaId) || p.areas[0];
  const W = 560;
  const k = Math.min(W / (area.w + 2), 380 / (area.d + 2));
  const H = (area.d + 2) * k;
  return (
    <svg viewBox={`0 0 ${(area.w + 2) * k} ${H}`} style={{ width: '100%', height: 'auto', background: 'var(--plan-bg)', borderRadius: 8 }}>
      <g transform={`translate(${k} ${k}) scale(${k})`}>
        <PlanDrawing p={p} area={area} layers={{ ...layers, heatmap: true, cableTags: false, cables: false, labels: false, dims: false, grid: false, coverage: false }} sel={{ items: [], cables: [], zones: [], notes: [] }} k={k} lang={lang} t={t} vb={{ x0: -1, y0: -1, x1: area.w + 1, y1: area.d + 1 }} heat={heat} print />
      </g>
    </svg>
  );
}
