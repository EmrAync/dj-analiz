// Ses seviyesi ölçer: LAeq (kayan pencere), LAF/LAS, LCpeak, LAFmax, zaman grafiği, yasal sınır ve protokol.
import { useEffect, useRef, useState } from 'react';
import { clearHistory, keepAwake, meterHistory, resetAvg, useRta } from '../../audio/engine';
import { LIMIT_PRESETS, limitsOf, rollingLeq } from '../../audio/meter';
import { targetZones, zoneTarget } from '../../engine/coverage';
import { fmt, type TFn } from '../../i18n';
import type { Area, Lang, Project, SoundLimits } from '../../model/types';
import { downloadText } from '../../store/persist';
import { st, useStore } from '../../store/store';
import { Check, Icon, Num, Seg } from '../../ui/kit';

const dbOf = (ms: number, off: number) => (ms > 0 ? 10 * Math.log10(ms) + off : NaN);

export function SplTab({ p, area, pos, lang, t }: { p: Project; area: Area; pos: { x: number; y: number } | null; lang: Lang; t: TFn }) {
  const lv = useRta((s) => s.lv);
  const histN = useRta((s) => s.histN);
  const running = useRta((s) => s.running);
  const off = useRta((s) => s.cal.offset);
  const calibrated = useRta((s) => s.cal.calibrated);
  const installer = useStore((s) => s.installer);
  const lim = limitsOf(p);
  const [awake, setAwake] = useState(false);
  void histN;
  const hist = meterHistory();
  const win = rollingLeq(hist, lim.minutes * 60);
  const laeqWin = dbOf(win.ms, off);
  let pkWin = 0;
  for (let i = Math.max(0, hist.length - lim.minutes * 60); i < hist.length; i++) pkWin = Math.max(pkWin, hist[i].cpk);
  const lcpk = dbOf(pkWin, off);
  const fill = Math.min(1, win.n / (lim.minutes * 60));
  const state = !lim.on || !isFinite(laeqWin) ? 'none' : laeqWin > lim.laeq ? 'over' : laeqWin > lim.laeq - 3 ? 'near' : 'ok';
  const pkState = !lim.on || !isFinite(lcpk) ? 'none' : lcpk > lim.lcpeak ? 'over' : lcpk > lim.lcpeak - 3 ? 'near' : 'ok';
  const setLim = (patch: Partial<SoundLimits>) => st().mutate((d) => void (d.settings.limits = { ...limitsOf(d as Project), ...patch }));
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const csv = () => {
    const rows = [['Zaman', 'LAeq,1s', 'LCeq,1s', 'LAFmax,1s', 'LCpeak,1s', `LAeq,${lim.minutes}min`].join(';')];
    let acc = 0;
    const W = lim.minutes * 60;
    hist.forEach((h, i) => {
      acc += h.a;
      if (i >= W) acc -= hist[i - W].a;
      const n = Math.min(i + 1, W);
      rows.push([new Date(h.t).toLocaleTimeString(lang === 'en' ? 'en-GB' : lang), fmt(dbOf(h.a, off), 1, lang), fmt(dbOf(h.c, off), 1, lang), fmt(dbOf(h.af, off), 1, lang), fmt(dbOf(h.cpk, off), 1, lang), fmt(dbOf(acc / n, off), 1, lang)].join(';'));
    });
    rows.push('');
    rows.push(`${t('spl.csvNote')};${calibrated ? t('ms.cal') : t('ms.uncal')};${lim.on ? `${lim.laeq} dB(A) / ${lim.minutes} min; LCpeak ${lim.lcpeak} dB(C)` : '-'}`);
    downloadText((p.name || 'olcum').replace(/[^\w-]+/g, '_') + '-ses-seviyesi.csv', '﻿' + rows.join('\r\n'), 'text/csv');
  };
  return (
    <div data-testid="spl-tab">
      <div className="spl-grid">
        <div className={'spl-tile big ' + state} data-testid="spl-laeq">
          <span className="l">
            LAeq · {t('spl.window', { m: lim.minutes })}
          </span>
          <b>{isFinite(laeqWin) ? fmt(laeqWin, 1, lang) : '–'}</b>
          <span className="u">dB(A)</span>
          {lim.on ? (
            <>
              <div className="limbar">
                <div style={{ width: `${isFinite(laeqWin) ? Math.max(0, Math.min(100, ((laeqWin - (lim.laeq - 30)) / 33) * 100)) : 0}%` }} />
                <span style={{ left: `${(30 / 33) * 100}%` }} />
              </div>
              <span className="s">
                {state === 'over' ? (fill < 1 ? t('spl.overPace', { d: fmt(laeqWin - lim.laeq, 1, lang) }) : t('spl.over', { d: fmt(laeqWin - lim.laeq, 1, lang) })) : isFinite(laeqWin) ? t('spl.margin', { d: fmt(lim.laeq - laeqWin, 1, lang), l: lim.laeq }) : t('spl.limitIs', { l: lim.laeq })}
                {fill < 1 && isFinite(laeqWin) ? ` · ${t('spl.partial', { t: mmss(win.n), w: lim.minutes })}` : ''}
              </span>
            </>
          ) : (
            <span className="s">{t('spl.noLimit')}</span>
          )}
        </div>
        <div className="spl-tile big">
          <span className="l">LAF · {t('spl.now')}</span>
          <b data-testid="spl-laf">{lv && isFinite(lv.af) ? fmt(lv.af, 1, lang) : '–'}</b>
          <span className="u">dB(A)</span>
          <span className="s">
            LAS {lv && isFinite(lv.as) ? fmt(lv.as, 1, lang) : '–'} · LCS {lv && isFinite(lv.cs) ? fmt(lv.cs, 1, lang) : '–'}
          </span>
        </div>
        <div className={'spl-tile ' + pkState}>
          <span className="l">LCpeak</span>
          <b>{isFinite(lcpk) ? fmt(lcpk, 1, lang) : '–'}</b>
          <span className="u">dB(C)</span>
          {lim.on ? <span className="s">{t('spl.peakLimit', { l: lim.lcpeak })}</span> : null}
        </div>
        <div className="spl-tile">
          <span className="l">LAeq · {t('spl.sinceStart')}</span>
          <b>{lv && isFinite(lv.leqA) ? fmt(lv.leqA, 1, lang) : '–'}</b>
          <span className="u">dB(A)</span>
          <span className="s">{lv ? mmss(lv.secs) : '0:00'}</span>
        </div>
        <div className="spl-tile">
          <span className="l">LAFmax</span>
          <b>{lv && isFinite(lv.maxAF) ? fmt(lv.maxAF, 1, lang) : '–'}</b>
          <span className="u">dB(A)</span>
          <span className="s">LAFmin {lv && isFinite(lv.minAF) ? fmt(lv.minAF, 1, lang) : '–'}</span>
        </div>
        <div className="spl-tile">
          <span className="l">LCeq − LAeq</span>
          <b>{lv && isFinite(lv.leqC) && isFinite(lv.leqA) ? fmt(lv.leqC - lv.leqA, 1, lang) : '–'}</b>
          <span className="u">dB</span>
          <span className="s">{t('spl.bassShare')}</span>
        </div>
      </div>
      {!calibrated && running ? <div className="warnline" style={{ margin: '8px 0' }}>⚠ {t('ms.uncalHint')}</div> : null}
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-h">
          <Icon name="chart" size={16} /> {t('spl.history')}
        </div>
        <div className="panel-b">
          <HistoryChart lim={lim} off={off} lang={lang} t={t} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            <button className="btn sm" onClick={() => (resetAvg(), clearHistory())} data-testid="spl-reset">
              <Icon name="undo" size={13} /> {t('spl.reset')}
            </button>
            <button className="btn sm" disabled={!hist.length} onClick={csv}>
              <Icon name="download" size={13} /> {t('spl.csv')}
            </button>
            <Check
              checked={awake}
              onChange={(v) => {
                setAwake(v);
                void keepAwake(v).then((ok) => !ok && v && st().notify(t('spl.noWake'), 'warn'));
              }}
            >
              {t('spl.awake')}
            </Check>
          </div>
        </div>
      </div>
      <div className="ms-grid2" style={{ marginTop: 12 }}>
        <ZoneCompare p={p} area={area} pos={pos} laeq1={dbOf(rollingLeq(hist, 60).ms, off)} lang={lang} t={t} />
        <div className="panel">
          <div className="panel-h">
            <Icon name="warning" size={16} /> {t('spl.limits')}
          </div>
          <div className="panel-b">
            <Check checked={lim.on} onChange={(v) => !installer && setLim({ on: v })}>
              {t('spl.limitOn')}
            </Check>
            {lim.on ? (
              <>
                <select className="inp" style={{ marginTop: 8 }} value={lim.preset} disabled={installer} onChange={(e) => {
                  const v = e.target.value as SoundLimits['preset'];
                  setLim(v === 'custom' ? { preset: v } : { preset: v, ...LIMIT_PRESETS[v] });
                }} data-testid="limit-preset">
                  <option value="din15905">{t('spl.p.din')}</option>
                  <option value="who">{t('spl.p.who')}</option>
                  <option value="custom">{t('spl.p.custom')}</option>
                </select>
                <div className="row2" style={{ marginTop: 8 }}>
                  <Num label="LAeq" value={lim.laeq} onChange={(v) => setLim({ laeq: Math.max(60, Math.min(130, v)), preset: 'custom' })} unit="dB(A)" step={1} digits={0} disabled={installer} />
                  <Num label={t('spl.minutes')} value={lim.minutes} onChange={(v) => setLim({ minutes: Math.max(1, Math.min(240, Math.round(v))), preset: 'custom' })} unit={t('spl.min')} step={5} digits={0} disabled={installer} />
                  <Num label="LCpeak" value={lim.lcpeak} onChange={(v) => setLim({ lcpeak: Math.max(90, Math.min(150, v)), preset: 'custom' })} unit="dB(C)" step={1} digits={0} disabled={installer} />
                </div>
                <p className="hint small">{t(('spl.h.' + lim.preset) as 'spl.h.din15905')}</p>
              </>
            ) : (
              <p className="hint small">{t('spl.offHint')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoneCompare({ p, area, pos, laeq1, lang, t }: { p: Project; area: Area; pos: { x: number; y: number } | null; laeq1: number; lang: Lang; t: TFn }) {
  const zones = targetZones(p, area.id);
  const auto = pos ? zones.find((z) => pos.x >= z.x && pos.x <= z.x + z.w && pos.y >= z.y && pos.y <= z.y + z.d) : undefined;
  const [zid, setZid] = useState('');
  const zone = zones.find((z) => z.id === zid) || auto || zones[0];
  if (!zone) return <div />;
  const target = zoneTarget(zone)!;
  const diff = isFinite(laeq1) ? target - laeq1 : NaN;
  return (
    <div className="panel">
      <div className="panel-h">
        <Icon name="zone" size={16} /> {t('spl.zone')}
      </div>
      <div className="panel-b">
        <select className="inp" value={zone.id} onChange={(e) => setZid(e.target.value)}>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name} · {t('cov.targetShort', { d: zoneTarget(z)! })}
            </option>
          ))}
        </select>
        <div className="hint small" style={{ marginTop: 6 }}>
          LAeq 1 {t('spl.min')}: <b>{isFinite(laeq1) ? fmt(laeq1, 1, lang) : '–'} dB(A)</b>
        </div>
        {isFinite(diff) ? <div className={'ms-verdict ' + (Math.abs(diff) <= 2 ? 'ok' : 'warn')}>{Math.abs(diff) <= 2 ? t('ms.onTarget') : diff > 0 ? t('ms.louder', { d: fmt(diff, 0, lang) }) : t('ms.quieter', { d: fmt(-diff, 0, lang) })}</div> : <p className="hint small">{t('spl.zoneHint')}</p>}
      </div>
    </div>
  );
}

function HistoryChart({ lim, off, lang, t }: { lim: SoundLimits; off: number; lang: Lang; t: TFn }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const histN = useRta((s) => s.histN);
  const theme = useStore((s) => s.theme);
  const [span, setSpan] = useState<number>(15);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(cv);
    const col = (v: string, d: string) => css.getPropertyValue(v).trim() || d;
    const C = { bg: col('--panel2', '#f4f6f9'), grid: col('--line', '#e2e8f0'), txt: col('--muted', '#64748b') };
    const hist = meterHistory();
    const n = span > 0 ? Math.min(hist.length, span * 60) : hist.length;
    const h = hist.slice(hist.length - n);
    const m = { l: 34, r: 8, t: 8, b: 20 };
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.bg;
    g.fillRect(m.l, m.t, W - m.l - m.r, H - m.t - m.b);
    const vals = h.map((x) => dbOf(x.a, off)).filter((v) => isFinite(v));
    let top = Math.ceil(Math.max(lim.on ? lim.laeq + 5 : 0, ...(vals.length ? vals : [90])) / 10) * 10 + 5;
    let bot = Math.floor(Math.min(...(vals.length ? vals : [60])) / 10) * 10 - 5;
    if (top - bot < 30) bot = top - 30;
    top = Math.min(140, top);
    const total = Math.max(60, span > 0 ? span * 60 : n);
    const X = (i: number) => m.l + ((i + (total - n)) / total) * (W - m.l - m.r);
    const Y = (d: number) => m.t + (1 - (Math.max(bot, Math.min(top, d)) - bot) / (top - bot)) * (H - m.t - m.b);
    g.strokeStyle = C.grid;
    g.fillStyle = C.txt;
    g.font = '10px system-ui, sans-serif';
    g.textAlign = 'right';
    for (let d = Math.ceil(bot / 10) * 10; d <= top; d += 10) {
      g.beginPath();
      g.moveTo(m.l, Y(d));
      g.lineTo(W - m.r, Y(d));
      g.stroke();
      g.fillText(String(d), m.l - 4, Y(d) + 3);
    }
    g.textAlign = 'center';
    const mins = total / 60;
    const stepM = mins > 90 ? 30 : mins > 30 ? 10 : mins > 10 ? 5 : 1;
    for (let k = 0; k <= mins; k += stepM) g.fillText(k === 0 ? '0' : `−${k}`, W - m.r - (k * 60 * (W - m.l - m.r)) / total, H - 6);
    if (lim.on) {
      g.strokeStyle = '#dc2626';
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(m.l, Y(lim.laeq));
      g.lineTo(W - m.r, Y(lim.laeq));
      g.stroke();
      g.setLineDash([]);
    }
    // saniyelik LAeq
    g.strokeStyle = theme === 'dark' ? '#60a5fa' : '#93c5fd';
    g.lineWidth = 1;
    g.beginPath();
    h.forEach((x, i) => (i ? g.lineTo(X(i), Y(dbOf(x.a, off))) : g.moveTo(X(i), Y(dbOf(x.a, off)))));
    g.stroke();
    // kayan LAeq (sınır penceresi)
    const Wn = lim.minutes * 60;
    let acc = 0;
    const start = hist.length - n;
    for (let i = Math.max(0, start - Wn); i < start; i++) acc += hist[i].a;
    g.strokeStyle = theme === 'dark' ? '#f472b6' : '#db2777';
    g.lineWidth = 2.4;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const gi = start + i;
      acc += hist[gi].a;
      if (gi - Wn >= 0) acc -= hist[gi - Wn].a;
      const cnt = Math.min(gi + 1, Wn);
      const y = Y(dbOf(acc / cnt, off));
      if (i) g.lineTo(X(i), y);
      else g.moveTo(X(i), y);
    }
    g.stroke();
  }, [histN, span, lim.on, lim.laeq, lim.minutes, off, theme]);
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <Seg
          value={span}
          options={[
            { v: 5, l: `5 ${t('spl.min')}` },
            { v: 15, l: `15 ${t('spl.min')}` },
            { v: 60, l: `60 ${t('spl.min')}` },
            { v: 0, l: t('spl.all') },
          ]}
          onChange={setSpan}
        />
        <span className="hint small">
          <span style={{ color: '#3b82f6' }}>━</span> LAeq 1 s · <span style={{ color: '#db2777' }}>━</span> LAeq {lim.minutes} {t('spl.min')} {lim.on ? <>· <span style={{ color: '#dc2626' }}>┅</span> {t('spl.limit')} {fmt(lim.laeq, 0, lang)}</> : null}
        </span>
      </div>
      <canvas ref={ref} className="hist-canvas" data-testid="spl-history" />
    </div>
  );
}
