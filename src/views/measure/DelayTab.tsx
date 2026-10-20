// Gecikme ölçümü: tarama ile dürtü yanıtı → varış zamanları, sub–tepe ve ana–delay hizalama, yankı süresi.
import { useEffect, useMemo, useRef, useState } from 'react';
import { measureSweep, removeRun, setLatency, sweepSpec, useRta, type SweepRun } from '../../audio/engine';
import { alignSubTop, pinkNoise, sweepSequence, wavBlob } from '../../audio/sweep';
import { roomAcoustics, speedOfSound } from '../../engine/acoustics';
import { fmt, type TFn } from '../../i18n';
import { getDef } from '../../model/project';
import type { Area, Lang, Project } from '../../model/types';
import { updateItem } from '../../store/actions';
import { downloadBlob } from '../../store/persist';
import { st, useStore } from '../../store/store';
import { Icon, Num, Seg } from '../../ui/kit';

const PAL = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#65a30d'];

export function DelayTab({ p, area, lang, t }: { p: Project; area: Area; lang: Lang; t: TFn }) {
  const running = useRta((s) => s.running);
  const sweep = useRta((s) => s.sweep);
  const runs = useRta((s) => s.runs);
  const latency = useRta((s) => s.latency);
  const installer = useStore((s) => s.installer);
  const [source, setSource] = useState<'self' | 'external'>('self');
  const [out, setOut] = useState<'both' | 'L' | 'R'>('both');
  const [label, setLabel] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const c = speedOfSound(p.env.tempC);
  const cur = runs.find((r) => r.id === sel) || runs[runs.length - 1];
  const busy = sweep.phase !== 'idle';
  const go = async (lbl: string, zero = false) => {
    const r = await measureSweep(source, lbl || t('dl.run', { n: runs.length + 1 }), out);
    if (!r) {
      const e = useRta.getState().sweep.error;
      st().notify(t(e === 'lowsnr' ? 'dl.err.lowsnr' : e === 'notfound' ? 'dl.err.notfound' : 'dl.err.other'), 'warn');
      return;
    }
    setSel(r.id);
    if (zero && r.absMs != null) {
      setLatency(r.absMs);
      st().notify(t('dl.zeroDone', { ms: fmt(r.absMs, 1, lang) }));
    }
  };
  const wav = (kind: 'sweep' | 'pink') => {
    const fs = 48000;
    if (kind === 'sweep') {
      const seq = sweepSequence({ ...sweepSpec(), fs, repeats: 3 }, 0.5, 1.5);
      downloadBlob('SahneCAD-tarama-3x.wav', wavBlob([seq.data, seq.data], fs));
    } else {
      const x = pinkNoise(fs * 60, 3);
      downloadBlob('SahneCAD-pembe-gurultu-60s.wav', wavBlob([x, x], fs));
    }
  };
  return (
    <div data-testid="delay-tab">
      <div className="panel">
        <div className="panel-h">
          <Icon name="wave" size={16} /> {t('dl.title')}
        </div>
        <div className="panel-b">
          <ol className="dl-steps">
            <li>{t('dl.s1')}</li>
            <li>{t('dl.s2')}</li>
            <li>{t('dl.s3')}</li>
          </ol>
          <div className="ms-tools">
            <span className="hint small">{t('dl.source')}</span>
            <Seg
              value={source}
              options={[
                { v: 'self', l: t('dl.self') },
                { v: 'external', l: t('dl.external') },
              ]}
              onChange={setSource}
            />
            {source === 'self' ? (
              <Seg
                value={out}
                options={[
                  { v: 'both', l: 'L+R' },
                  { v: 'L', l: 'L' },
                  { v: 'R', l: 'R' },
                ]}
                onChange={setOut}
              />
            ) : (
              <>
                <button className="btn sm" onClick={() => wav('sweep')}>
                  <Icon name="download" size={13} /> {t('dl.wavSweep')}
                </button>
                <button className="btn sm" onClick={() => wav('pink')}>
                  <Icon name="download" size={13} /> {t('dl.wavPink')}
                </button>
              </>
            )}
          </div>
          <p className="hint small">{source === 'self' ? t('dl.selfHint') : t('dl.extHint')}</p>
          <div className="ms-tools">
            <input className="inp" style={{ maxWidth: 200 }} placeholder={t('dl.labelPh')} value={label} onChange={(e) => setLabel(e.target.value)} />
            {[t('dl.q.main'), t('dl.q.sub'), t('dl.q.top'), t('dl.q.delay')].map((q) => (
              <button key={q} className="btn sm ghost" onClick={() => setLabel(q)}>
                {q}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn primary" disabled={!running || busy} onClick={() => void go(label)} data-testid="dl-measure">
              <Icon name="play" size={15} /> {busy ? t(('dl.ph.' + sweep.phase) as 'dl.ph.play') : t('dl.measure')}
            </button>
            {source === 'self' ? (
              <button className="btn" disabled={!running || busy} onClick={() => void go(t('dl.zeroLabel'), true)} title={t('dl.zeroHint')}>
                {t('dl.zero')}
              </button>
            ) : null}
            {latency != null ? (
              <span className="chip info">
                {t('dl.latency', { ms: fmt(latency, 1, lang) })}
                <button className="ibtn sm" onClick={() => setLatency(null)} title={t('act.delete')}>
                  <Icon name="close" size={11} />
                </button>
              </span>
            ) : null}
            {!running ? <span className="hint small">{t('dl.needMic')}</span> : null}
          </div>
          {busy && sweep.until ? <Progress until={sweep.until} /> : null}
        </div>
      </div>

      {runs.length ? (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-h">
            <Icon name="chart" size={16} /> {t('dl.results')}
          </div>
          <div className="panel-b">
            <IrChart runs={runs} cur={cur} t={t} />
            <div className="tbl-wrap" style={{ marginTop: 8 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th></th>
                    <th>{t('dl.name')}</th>
                    <th>{t('dl.arrivals')}</th>
                    <th className="n">{t('dl.abs')}</th>
                    <th className="n">RT</th>
                    <th className="n">S/N</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => {
                    const dist = r.absMs != null && latency != null ? ((r.absMs - latency) / 1000) * c : null;
                    const rtb = r.an.rt.find((x) => x.f === 0);
                    return (
                      <tr key={r.id} className={r === cur ? 'sel' : ''} onClick={() => setSel(r.id)} style={{ cursor: 'pointer' }}>
                        <td>
                          <span className="dot" style={{ background: PAL[i % PAL.length] }} />
                        </td>
                        <td>
                          <b>{r.label}</b>
                          <div className="hint small">{r.source === 'self' ? t('dl.self') : t('dl.external')}</div>
                        </td>
                        <td className="small">
                          {r.an.arrivals.map((a, k) => (
                            <span key={k}>
                              {k ? ' · ' : ''}
                              {k === 0 ? '0' : '+' + fmt(a.ms, 1, lang)} ms{k ? ` (${fmt(a.db, 0, lang)} dB)` : ''}
                            </span>
                          ))}
                        </td>
                        <td className="n">
                          {r.absMs != null ? `${fmt(r.absMs, 2, lang)} ms` : '–'}
                          {dist != null ? <div className="hint small">≈ {fmt(dist, 2, lang)} m</div> : null}
                        </td>
                        <td className="n">{rtb?.t20 ? `${fmt(rtb.t20, 2, lang)} s` : '–'}</td>
                        <td className="n">{fmt(r.snr, 0, lang)} dB</td>
                        <td>
                          <button
                            className="ibtn sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRun(r.id);
                            }}
                            title={t('act.delete')}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {cur ? <RunDetail r={cur} area={area} lang={lang} t={t} /> : null}
          </div>
        </div>
      ) : null}

      {runs.length ? <Compare p={p} area={area} runs={runs} lang={lang} t={t} readOnly={installer} /> : null}
    </div>
  );
}

function Progress({ until }: { until: number }) {
  const [, setN] = useState(0);
  const start = useRef(performance.now());
  useEffect(() => {
    start.current = performance.now();
    const id = setInterval(() => setN((x) => x + 1), 200);
    return () => clearInterval(id);
  }, [until]);
  const left = Math.max(0, until - performance.now());
  const total = Math.max(1, until - start.current);
  return (
    <div className="dl-prog">
      <div style={{ width: `${Math.min(100, 100 - (left / total) * 100)}%` }} />
      <span>{Math.ceil(left / 1000)} s</span>
    </div>
  );
}

function RunDetail({ r, area, lang, t }: { r: SweepRun; area: Area; lang: Lang; t: TFn }) {
  const ra = roomAcoustics(area);
  const modelRt = ra ? [0, ra.rt[0], ra.rt[0], ra.rt[1], ra.rt[1], ra.rt[2], ra.rt[2]] : null;
  const two = r.an.arrivals.length > 1;
  return (
    <div className="dl-detail">
      <div>
        <div className="cov-h">{r.label}</div>
        {two ? (
          <p>{t('dl.twoArrivals', { ms: fmt(r.an.arrivals[1].ms, 1, lang), db: fmt(r.an.arrivals[1].db, 0, lang) })}</p>
        ) : (
          <p>{t('dl.oneArrival')}</p>
        )}
        <p className="hint small">
          {t('dl.lfhf', { d: (r.an.lfMs - r.an.hfMs >= 0 ? '+' : '') + fmt(r.an.lfMs - r.an.hfMs, 1, lang) })}
        </p>
      </div>
      <div>
        <div className="cov-h">{t('dl.rtTitle')}</div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Hz</th>
              {r.an.rt.map((b) => (
                <th key={b.f} className="n">
                  {b.f === 0 ? t('dl.broad') : b.f >= 1000 ? b.f / 1000 + 'k' : b.f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>T20</td>
              {r.an.rt.map((b) => (
                <td key={b.f} className="n">
                  {b.t20 ? fmt(b.t20, 2, lang) : '–'}
                </td>
              ))}
            </tr>
            <tr>
              <td>T30</td>
              {r.an.rt.map((b) => (
                <td key={b.f} className="n">
                  {b.t30 ? fmt(b.t30, 2, lang) : '–'}
                </td>
              ))}
            </tr>
            {modelRt ? (
              <tr className="grp">
                <td>{t('dl.model')}</td>
                {r.an.rt.map((b, i) => (
                  <td key={b.f} className="n">
                    {i ? fmt(modelRt[i], 2, lang) : fmt(ra!.rt[1], 2, lang)}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="hint small">{t('dl.rtHint')}</p>
      </div>
    </div>
  );
}

function IrChart({ runs, cur, t }: { runs: SweepRun[]; cur?: SweepRun; t: TFn }) {
  const W = 760;
  const H = 220;
  const m = { l: 34, r: 8, t: 8, b: 22 };
  const span = 120; // ms
  // kendi çalınan ölçümler mutlak zamanda hizalanır (ilk varışların en küçüğü 0), diğerleri kendi ilk varışında
  const selfRuns = runs.filter((r) => r.absMs != null);
  const base = selfRuns.length ? Math.min(...selfRuns.map((r) => r.absMs!)) : 0;
  const X = (ms: number) => m.l + ((ms + 5) / (span + 5)) * (W - m.l - m.r);
  const Y = (d: number) => m.t + (-Math.max(-40, Math.min(0, d)) / 40) * (H - m.t - m.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" data-testid="ir-chart">
      <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="var(--panel2)" />
      {[0, -10, -20, -30, -40].map((d) => (
        <g key={d}>
          <line x1={m.l} x2={W - m.r} y1={Y(d)} y2={Y(d)} stroke="var(--line)" />
          <text x={m.l - 4} y={Y(d) + 3} fontSize={9.5} textAnchor="end" fill="var(--muted)">
            {d}
          </text>
        </g>
      ))}
      {[0, 20, 40, 60, 80, 100, 120].map((ms) => (
        <text key={ms} x={X(ms)} y={H - 6} fontSize={9.5} textAnchor="middle" fill="var(--muted)">
          {ms} ms
        </text>
      ))}
      {runs.map((r, i) => {
        const shift = r.absMs != null ? r.absMs - base : 0;
        const d = Array.from(r.an.envDb)
          .map((v, k) => {
            const ms = -10 + k * r.an.stepMs + shift;
            return ms > span ? '' : `${k ? 'L' : 'M'} ${X(ms).toFixed(1)} ${Y(v).toFixed(1)}`;
          })
          .join(' ');
        return <path key={r.id} d={d} fill="none" stroke={PAL[i % PAL.length]} strokeWidth={r === cur ? 2.2 : 1.2} opacity={r === cur ? 1 : 0.55} />;
      })}
      <text x={W - m.r - 4} y={m.t + 12} fontSize={10} textAnchor="end" fill="var(--muted)">
        {t('dl.chartHint')}
      </text>
    </svg>
  );
}

function shiftIr(r: SweepRun, ms: number): Float64Array {
  const n = Math.round((ms / 1000) * r.fs);
  const out = new Float64Array(r.ir.length);
  for (let i = 0; i < out.length; i++) {
    const j = i - n;
    if (j >= 0 && j < r.ir.length) out[i] = r.ir[j];
  }
  return out;
}

const guess = (runs: SweepRun[], re: RegExp, not?: string) => runs.filter((r) => re.test(r.label) && r.id !== not).pop()?.id || '';

function Compare({ p, area, runs, lang, t, readOnly }: { p: Project; area: Area; runs: SweepRun[]; lang: Lang; t: TFn; readOnly: boolean }) {
  const selfRuns = runs.filter((r) => r.absMs != null);
  const speakers = p.items.filter((it) => it.areaId === area.id && getDef(p, it.defId).acoustic && getDef(p, it.defId).acoustic!.kind !== 'iem');
  const [subId, setSubId] = useState(() => guess(selfRuns, /sub|bas/i));
  const [topId, setTopId] = useState(() => guess(selfRuns, /tepe|top|sat|ana|main/i, subId));
  const [mainId, setMainId] = useState(() => guess(selfRuns, /ana|main|pa/i));
  const [dlId, setDlId] = useState(() => guess(selfRuns, /delay|dl/i, mainId));
  const [fc, setFc] = useState(100);
  const [haas, setHaas] = useState(8);
  const [subItem, setSubItem] = useState('');
  const [topItem, setTopItem] = useState('');
  const [dlItem, setDlItem] = useState('');
  const R = (id: string) => selfRuns.find((r) => r.id === id);
  const sub = R(subId);
  const top = R(topId);
  const al = useMemo(() => {
    if (!sub || !top || sub === top) return null;
    // aynı zaman tabanına getir: ir[pre] = peakMs
    const base = Math.min(sub.peakMs!, top.peakMs!) - (sub.pre / sub.fs) * 1000;
    return alignSubTop(shiftIr(sub, sub.peakMs! - (sub.pre / sub.fs) * 1000 - base), shiftIr(top, top.peakMs! - (top.pre / top.fs) * 1000 - base), sub.fs, fc);
  }, [sub, top, fc]);
  const mr = R(mainId);
  const dr = R(dlId);
  const dDelta = mr && dr && mr !== dr ? mr.absMs! - dr.absMs! : null; // + : delay hoparlörü daha önce geliyor
  const runSel = (v: string, on: (v: string) => void) => (
    <select className="inp" value={v} onChange={(e) => on(e.target.value)}>
      <option value="">—</option>
      {selfRuns.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </select>
  );
  const itemSel = (v: string, on: (v: string) => void) => (
    <select className="inp" value={v} onChange={(e) => on(e.target.value)}>
      <option value="">{t('dl.pickItem')}</option>
      {speakers.map((it) => (
        <option key={it.id} value={it.id}>
          {it.label} · {fmt(it.delayMs || 0, 1, lang)} ms
        </option>
      ))}
    </select>
  );
  if (selfRuns.length < 2)
    return (
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-h">
          <Icon name="link" size={16} /> {t('dl.compare')}
        </div>
        <div className="panel-b">
          <p className="hint">{t('dl.needTwo')}</p>
        </div>
      </div>
    );
  return (
    <div className="dl-cmp" style={{ marginTop: 12 }}>
      <div className="panel" data-testid="dl-subtop">
        <div className="panel-h">
          <Icon name="sub" size={16} /> {t('dl.subTop')}
        </div>
        <div className="panel-b">
          <div className="row2">
            <label>
              <span className="hint small">{t('dl.subRun')}</span>
              {runSel(subId, setSubId)}
            </label>
            <label>
              <span className="hint small">{t('dl.topRun')}</span>
              {runSel(topId, setTopId)}
            </label>
          </div>
          <Num label={t('dl.xover')} value={fc} onChange={(v) => setFc(Math.max(40, Math.min(250, v)))} unit="Hz" step={10} digits={0} />
          {al ? (
            <>
              <div className="ms-verdict ok">
                {Math.abs(al.delayMs) < 0.2 ? t('dl.alignNone') : al.delayMs > 0 ? t('dl.delayTop', { ms: fmt(al.delayMs, 1, lang) }) : t('dl.delaySub', { ms: fmt(-al.delayMs, 1, lang) })}
                {al.invert ? ' · ' + t('dl.invertSub') : ''}
              </div>
              <p className="hint small">{t('dl.alignGain', { g: fmt(al.gainDb, 1, lang), c: Math.round(al.coherence * 100) })}</p>
              {!readOnly ? (
                <div className="row2">
                  {itemSel(al.delayMs >= 0 ? topItem : subItem, al.delayMs >= 0 ? setTopItem : setSubItem)}
                  <button
                    className="btn sm primary"
                    disabled={!(al.delayMs >= 0 ? topItem : subItem)}
                    onClick={() => {
                      const id = al.delayMs >= 0 ? topItem : subItem;
                      const it = p.items.find((x) => x.id === id);
                      if (!it) return;
                      updateItem(id, { delayMs: Math.round(((it.delayMs || 0) + Math.abs(al.delayMs)) * 10) / 10 });
                      if (al.invert && subItem) {
                        const s0 = p.items.find((x) => x.id === subItem);
                        if (s0) updateItem(subItem, { polarity: (s0.polarity || 1) === 1 ? -1 : 1 });
                      }
                      st().notify(t('dl.applied'));
                    }}
                  >
                    {t('dl.apply')}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="hint small">{t('dl.subTopHint')}</p>
          )}
        </div>
      </div>
      <div className="panel" data-testid="dl-maindelay">
        <div className="panel-h">
          <Icon name="speakerline" size={16} /> {t('dl.mainDelay')}
        </div>
        <div className="panel-b">
          <div className="row2">
            <label>
              <span className="hint small">{t('dl.mainRun')}</span>
              {runSel(mainId, setMainId)}
            </label>
            <label>
              <span className="hint small">{t('dl.delayRun')}</span>
              {runSel(dlId, setDlId)}
            </label>
          </div>
          <Num label={t('dl.haas')} value={haas} onChange={(v) => setHaas(Math.max(0, Math.min(30, v)))} unit="ms" step={1} digits={0} />
          {dDelta != null ? (
            <>
              <div className="ms-verdict ok">{dDelta > -haas ? t('dl.setDelay', { ms: fmt(Math.max(0, dDelta + haas), 1, lang) }) : t('dl.tooLate', { ms: fmt(-dDelta, 1, lang) })}</div>
              <p className="hint small">{t('dl.mainDelayHint', { d: (dDelta >= 0 ? '+' : '') + fmt(dDelta, 1, lang) })}</p>
              {!readOnly ? (
                <div className="row2">
                  {itemSel(dlItem, setDlItem)}
                  <button
                    className="btn sm primary"
                    disabled={!dlItem}
                    onClick={() => {
                      const it = p.items.find((x) => x.id === dlItem);
                      if (!it) return;
                      updateItem(dlItem, { delayMs: Math.max(0, Math.round(((it.delayMs || 0) + dDelta + haas) * 10) / 10) });
                      st().notify(t('dl.applied'));
                    }}
                  >
                    {t('dl.apply')}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="hint small">{t('dl.mainDelayHint0')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
