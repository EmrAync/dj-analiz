import { useEffect, useMemo, useRef, useState } from 'react';
import { calibrateTo, FINE, guessPreset, listDevices, resetAvg, setAvg, setCal, setChannel, setGen, startRta, stopRta, useRta, type MicPreset } from '../../audio/engine';
import { dB, demoCurve, ISO31, ms, octaveBands, parseCal, regroup, umikNominalOffset, weighted, type Bands } from '../../audio/dsp';
import { splPoint } from '../../engine/acoustics';
import { targetZones, zoneTarget } from '../../engine/coverage';
import { CURVES, EQ_DEFAULT, suggestEq, type EqResult } from '../../engine/eq';
import { fmt } from '../../i18n';
import type { TFn } from '../../i18n';
import { uid } from '../../model/project';
import type { Area, CurveId, EqTarget, Lang, Measurement, Project } from '../../model/types';
import { addMeasurement, deleteMeasurement, updateMeasurement } from '../../store/actions';
import { downloadText, pickFile, readText } from '../../store/persist';
import { st, useStore, useT } from '../../store/store';
import { Check, Icon, Num, Seg } from '../../ui/kit';
import { PlanDrawing } from '../plan/PlanDrawing';

export const OCT12: Bands = octaveBands(12);
const RES: Record<number, Bands> = { 1: octaveBands(1), 3: octaveBands(3), 6: octaveBands(6), 12: OCT12, 24: FINE };

// 1/24 dB → 1/12 dB
function fineTo12(fine: ArrayLike<number>): number[] {
  return Array.from(regroup(Array.from(fine, ms), FINE, OCT12), dB);
}

function avgMeasurements(list: Measurement[]): number[] | null {
  if (!list.length) return null;
  const n = OCT12.fc.length;
  const s = new Array(n).fill(0);
  for (const m of list) for (let i = 0; i < n; i++) s[i] += ms(m.bands[i] ?? -200);
  return s.map((v) => dB(v / list.length));
}

export function MeasureView() {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const areaId = useStore((s) => s.areaId);
  const area = p.areas.find((a) => a.id === areaId) || p.areas[0];
  const running = useRta((s) => s.running);
  const [res, setRes] = useState<number>(3);
  const [hold, setHold] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const eq: EqTarget = p.settings.eq || EQ_DEFAULT;
  const meas = (p.measurements || []).filter((m) => m.areaId === area.id);
  const chosen = meas.filter((m) => sel.has(m.id));
  useEffect(() => {
    void listDevices();
    return () => {
      // görünümden çıkınca ölçüm sürer (arka planda), üreteç kapanır
      if (useRta.getState().gen.on) setGen({ on: false });
    };
  }, []);
  return (
    <div className="page measure" data-testid="measure-view">
      <div className="page-inner" style={{ maxWidth: 1320 }}>
        <div className="page-head">
          <h1>{t('ms.title')}</h1>
          <DeviceBar t={t} />
        </div>
        <Intro t={t} />
        <div className="ms-grid">
          <div className="panel">
            <div className="panel-h">
              <Icon name="chart" size={16} /> {t('ms.rta')}
              <span style={{ flex: 1 }} />
              <Seg value={res} options={[1, 3, 6, 12, 24].map((v) => ({ v, l: `1/${v}` }))} onChange={setRes} />
            </div>
            <div className="panel-b">
              <RtaToolbar t={t} hold={hold} setHold={setHold} />
              <RtaChart res={res} hold={hold} eq={eq} overlays={chosen} />
              {!running ? <p className="hint small">{t('ms.chartIdle')}</p> : null}
            </div>
          </div>
          <div className="ms-side">
            <SplCard p={p} area={area} pos={pos} lang={lang} t={t} />
            <GenCard t={t} />
            <CalCard t={t} lang={lang} />
          </div>
        </div>
        <EqPanel p={p} eq={eq} chosen={chosen} lang={lang} t={t} />
        <MeasList p={p} area={area} meas={meas} sel={sel} setSel={setSel} pos={pos} setPos={setPos} lang={lang} t={t} />
      </div>
    </div>
  );
}

function Intro({ t }: { t: TFn }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('sahnecad.msIntro') !== '0';
    } catch {
      return true;
    }
  });
  if (!open) return null;
  return (
    <div className="ms-intro">
      <ol>
        <li>{t('ms.step1')}</li>
        <li>{t('ms.step2')}</li>
        <li>{t('ms.step3')}</li>
        <li>{t('ms.step4')}</li>
      </ol>
      <button
        className="ibtn sm"
        title={t('act.close')}
        onClick={() => {
          setOpen(false);
          try {
            localStorage.setItem('sahnecad.msIntro', '0');
          } catch {
            /* yok */
          }
        }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

function DeviceBar({ t }: { t: TFn }) {
  const { running, starting, devices, deviceId, channel, channels, sampleRate, error, deviceLabel } = useRta();
  return (
    <div className="ms-dev">
      <select className="inp" value={deviceId} onChange={(e) => void startRta(e.target.value)} title={t('ms.device')} data-testid="ms-device" style={{ maxWidth: 260 }}>
        {!devices.length ? <option value="">{t('ms.noDevice')}</option> : null}
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
      {channels > 1 ? <Seg value={channel} options={[{ v: 0, l: 'L / 1' }, { v: 1, l: 'R / 2' }]} onChange={setChannel} /> : null}
      {running ? (
        <>
          <span className="chip ok" title={deviceLabel}>
            ● {t('ms.live')} · {Math.round(sampleRate / 100) / 10} kHz
          </span>
          <button className="btn" onClick={() => stopRta()} data-testid="ms-stop">
            <Icon name="close" size={15} /> {t('ms.stop')}
          </button>
        </>
      ) : (
        <button className="btn primary" disabled={starting} onClick={() => void startRta()} data-testid="ms-start">
          <Icon name="play" size={15} /> {starting ? t('ms.starting') : t('ms.start')}
        </button>
      )}
      {error ? <span className="chip err">{t(('ms.err.' + error) as 'ms.err.denied')}</span> : null}
    </div>
  );
}

function RtaToolbar({ t, hold, setHold }: { t: TFn; hold: boolean; setHold: (v: boolean) => void }) {
  const avg = useRta((s) => s.avg);
  const frozen = useRta((s) => s.frozen);
  const secs = useRta((s) => s.frame?.secs ?? 0);
  return (
    <div className="ms-tools">
      <span className="hint small">{t('ms.avg')}</span>
      <Seg
        value={avg}
        options={[
          { v: 'fast', l: t('ms.avg.fast') },
          { v: 'slow', l: t('ms.avg.slow') },
          { v: 'inf', l: t('ms.avg.inf') },
        ]}
        onChange={setAvg}
      />
      {avg === 'inf' ? <span className="chip">{Math.round(secs)} s</span> : null}
      <Check checked={hold} onChange={setHold}>
        {t('ms.hold')}
      </Check>
      <span style={{ flex: 1 }} />
      <button className={'btn sm' + (frozen ? ' primary' : '')} onClick={() => useRta.setState({ frozen: !frozen })}>
        {frozen ? t('ms.resume') : t('ms.freeze')}
      </button>
      <button className="btn sm" onClick={resetAvg}>
        {t('ms.reset')}
      </button>
    </div>
  );
}

// —— RTA grafiği (canvas) ——
function RtaChart({ res, hold, eq, overlays }: { res: number; hold: boolean; eq: EqTarget; overlays: Measurement[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = useRta((s) => s.frame);
  const fb = useRta((s) => s.fb);
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) cv.width = Math.round(W * dpr);
    if (cv.height !== Math.round(H * dpr)) cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(cv);
    const col = (v: string, d: string) => css.getPropertyValue(v).trim() || d;
    const C = { bg: col('--panel2', '#f4f6f9'), grid: col('--line', '#e2e8f0'), txt: col('--muted', '#64748b'), acc: col('--accent', '#2563eb') };
    g.clearRect(0, 0, W, H);
    const m = { l: 38, r: 10, t: 10, b: 24 };
    const f0 = 20;
    const f1 = 20000;
    const X = (f: number) => m.l + (Math.log10(f / f0) / Math.log10(f1 / f0)) * (W - m.l - m.r);
    // dikey aralık: canlı seviyeye göre
    let top = 110;
    if (frame) {
      const mx = Math.max(...Array.from(frame.bands).filter((v) => isFinite(v)));
      if (isFinite(mx)) top = Math.ceil((mx + 8) / 10) * 10;
    } else if (overlays.length) top = Math.ceil((Math.max(...overlays.flatMap((o) => o.bands)) + 8) / 10) * 10;
    const bot = top - 70;
    const Y = (d: number) => m.t + (1 - (Math.max(bot, Math.min(top, d)) - bot) / (top - bot)) * (H - m.t - m.b);
    g.fillStyle = C.bg;
    g.fillRect(m.l, m.t, W - m.l - m.r, H - m.t - m.b);
    g.strokeStyle = C.grid;
    g.lineWidth = 1;
    g.fillStyle = C.txt;
    g.font = '10px system-ui, sans-serif';
    for (const f of [20, 31.5, 50, 63, 100, 125, 200, 250, 500, 1000, 2000, 4000, 8000, 16000]) {
      g.beginPath();
      g.moveTo(X(f), m.t);
      g.lineTo(X(f), H - m.b);
      g.stroke();
      if ([20, 50, 100, 200, 500, 1000, 2000, 4000, 8000, 16000].includes(f)) {
        g.textAlign = 'center';
        g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), X(f), H - 8);
      }
    }
    for (let d = bot; d <= top; d += 10) {
      g.beginPath();
      g.moveTo(m.l, Y(d));
      g.lineTo(W - m.r, Y(d));
      g.stroke();
      g.textAlign = 'right';
      g.fillText(String(d), m.l - 4, Y(d) + 3);
    }
    const b = RES[res];
    if (frame) {
      const coarse = res === 24 ? Array.from(frame.bands) : Array.from(regroup(Array.from(frame.bands, ms), FINE, b), dB);
      // çubuklar
      const grad = g.createLinearGradient(0, m.t, 0, H - m.b);
      grad.addColorStop(0, theme === 'dark' ? '#60a5fa' : '#2563eb');
      grad.addColorStop(1, theme === 'dark' ? '#1e3a8a' : '#93c5fd');
      g.fillStyle = grad;
      for (let i = 0; i < b.fc.length; i++) {
        const x0 = X(Math.max(f0, b.lo[i])) + (res <= 6 ? 1 : 0.3);
        const x1 = X(Math.min(f1, b.hi[i])) - (res <= 6 ? 1 : 0.3);
        const y = Y(coarse[i]);
        if (x1 > x0) g.fillRect(x0, y, x1 - x0, H - m.b - y);
      }
      if (hold) {
        const pk = res === 24 ? Array.from(frame.peak) : Array.from(regroup(Array.from(frame.peak, ms), FINE, b), dB);
        g.strokeStyle = '#f97316';
        g.lineWidth = 2;
        for (let i = 0; i < b.fc.length; i++) {
          g.beginPath();
          g.moveTo(X(Math.max(f0, b.lo[i])), Y(pk[i]));
          g.lineTo(X(Math.min(f1, b.hi[i])), Y(pk[i]));
          g.stroke();
        }
      }
    }
    // kaydedilmiş ölçümler
    const pal = ['#7c3aed', '#db2777', '#059669', '#d97706', '#0891b2', '#dc2626'];
    overlays.forEach((o, j) => {
      g.strokeStyle = pal[j % pal.length];
      g.lineWidth = 1.6;
      g.beginPath();
      OCT12.fc.forEach((f, i) => (i ? g.lineTo(X(f), Y(o.bands[i])) : g.moveTo(X(f), Y(o.bands[i]))));
      g.stroke();
    });
    // hedef eğri (canlı/ortalamaya hizalı)
    const src = frame ? fineTo12(frame.bands) : avgMeasurements(overlays);
    if (src) {
      const r = suggestEq(OCT12.fc, src, eq);
      g.strokeStyle = '#16a34a';
      g.setLineDash([6, 4]);
      g.lineWidth = 1.8;
      g.beginPath();
      OCT12.fc.forEach((f, i) => (i ? g.lineTo(X(f), Y(r.target[i])) : g.moveTo(X(f), Y(r.target[i]))));
      g.stroke();
      g.setLineDash([]);
    }
    // geri besleme işaretleri
    g.fillStyle = '#dc2626';
    for (const x of fb.filter((q) => q.seen >= 8)) {
      g.beginPath();
      g.moveTo(X(x.f), m.t + 2);
      g.lineTo(X(x.f) - 5, m.t + 12);
      g.lineTo(X(x.f) + 5, m.t + 12);
      g.fill();
    }
  }, [frame, fb, res, hold, eq, overlays, theme]);
  return <canvas ref={ref} className="rta-canvas" data-testid="rta-canvas" />;
}

// —— SPL göstergesi ——
function SplCard({ p, area, pos, lang, t }: { p: Project; area: Area; pos: { x: number; y: number } | null; lang: Lang; t: TFn }) {
  const frame = useRta((s) => s.frame);
  const cal = useRta((s) => s.cal);
  const zones = targetZones(p, area.id);
  const auto = pos ? zones.find((z) => pos.x >= z.x && pos.x <= z.x + z.w && pos.y >= z.y && pos.y <= z.y + z.d) : undefined;
  const [zid, setZid] = useState<string>('');
  const zone = zones.find((z) => z.id === zid) || auto || zones[0];
  const target = zone ? zoneTarget(zone) : null;
  const la = frame?.spl.a ?? NaN;
  const diff = target != null && isFinite(la) ? target - la : NaN;
  const model = pos ? splPoint(p, area.id, pos.x, pos.y).mid : NaN;
  const inPk = frame?.inPeak ?? -120;
  return (
    <div className="panel">
      <div className="panel-h">
        <Icon name="speakerline" size={16} /> {t('ms.spl')}
        {!cal.calibrated ? (
          <span className="chip warn" style={{ marginLeft: 'auto' }} title={t('ms.uncalHint')}>
            {t('ms.uncal')}
          </span>
        ) : (
          <span className="chip ok" style={{ marginLeft: 'auto' }}>
            {t('ms.cal')}
          </span>
        )}
      </div>
      <div className="panel-b">
        <div className="spl-big" data-testid="ms-spl">
          <b>{isFinite(la) ? fmt(la, 1, lang) : '–'}</b>
          <span>dB(A)</span>
        </div>
        <div className="spl-row">
          <span>
            C <b>{frame ? fmt(frame.spl.c, 1, lang) : '–'}</b>
          </span>
          <span>
            Z <b>{frame ? fmt(frame.spl.z, 1, lang) : '–'}</b>
          </span>
          <span>
            Leq <b>{frame ? fmt(frame.spl.leq, 1, lang) : '–'}</b>
          </span>
          <span>
            Max <b>{frame ? fmt(frame.spl.max, 1, lang) : '–'}</b>
          </span>
        </div>
        {frame && frame.spl.leq > 99 && frame.secs > 20 ? <div className="warnline">⚠ {t('ms.din', { l: fmt(frame.spl.leq, 1, lang) })}</div> : null}
        <div className="inmeter" title={t('ms.input')}>
          <div style={{ width: `${Math.max(0, Math.min(100, ((inPk + 60) / 60) * 100))}%`, background: frame?.clip ? 'var(--err)' : inPk > -6 ? 'var(--warn)' : 'var(--ok)' }} />
        </div>
        <div className="hint small" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>
            {t('ms.input')}: {inPk > -119 ? fmt(inPk, 0, lang) : '–'} dBFS
          </span>
          {frame?.clip ? <b style={{ color: 'var(--err)' }}>{t('ms.clip')}</b> : null}
        </div>
        {zones.length ? (
          <div style={{ marginTop: 10 }}>
            <select className="inp" value={zone?.id || ''} onChange={(e) => setZid(e.target.value)}>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} · {t('cov.targetShort', { d: zoneTarget(z)! })}
                </option>
              ))}
            </select>
            {isFinite(diff) ? (
              <div className={'ms-verdict ' + (Math.abs(diff) <= 2 ? 'ok' : 'warn')}>
                {Math.abs(diff) <= 2 ? t('ms.onTarget') : diff > 0 ? t('ms.louder', { d: fmt(diff, 0, lang) }) : t('ms.quieter', { d: fmt(-diff, 0, lang) })}
              </div>
            ) : null}
          </div>
        ) : null}
        {isFinite(model) ? (
          <div className="hint small" style={{ marginTop: 6 }}>
            {t('ms.model', { m: fmt(model, 0, lang) })}
            {isFinite(la) ? ` · ${t('ms.modelDiff', { d: (la - model > 0 ? '+' : '') + fmt(la - model, 0, lang) })}` : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// —— Sinyal üreteci ——
function GenCard({ t }: { t: TFn }) {
  const gen = useRta((s) => s.gen);
  return (
    <div className="panel">
      <div className="panel-h">
        <Icon name="wave" size={16} /> {t('ms.gen')}
      </div>
      <div className="panel-b">
        <Seg
          value={gen.kind}
          options={[
            { v: 'pink', l: t('ms.gen.pink') },
            { v: 'white', l: t('ms.gen.white') },
            { v: 'sine', l: t('ms.gen.sine') },
          ]}
          onChange={(v) => setGen({ kind: v })}
        />
        <div className="row2" style={{ marginTop: 8 }}>
          <Num label={t('ms.gen.level')} value={gen.level} onChange={(v) => setGen({ level: Math.max(-60, Math.min(0, v)) })} unit="dBFS" step={1} digits={0} />
          {gen.kind === 'sine' ? <Num label={t('ms.gen.freq')} value={gen.freq} onChange={(v) => setGen({ freq: Math.max(20, Math.min(20000, v)) })} unit="Hz" step={10} digits={0} /> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <Seg
            value={gen.out}
            options={[
              { v: 'both', l: 'L+R' },
              { v: 'L', l: 'L' },
              { v: 'R', l: 'R' },
            ]}
            onChange={(v) => setGen({ out: v })}
          />
          <span style={{ flex: 1 }} />
          <button className={'btn' + (gen.on ? ' danger' : ' primary')} onClick={() => setGen({ on: !gen.on })} data-testid="ms-gen">
            <Icon name={gen.on ? 'close' : 'play'} size={15} /> {gen.on ? t('ms.gen.stop') : t('ms.gen.play')}
          </button>
        </div>
        <p className="hint small">{t('ms.gen.hint')}</p>
      </div>
    </div>
  );
}

// —— Kalibrasyon ——
function CalCard({ t, lang }: { t: TFn; lang: Lang }) {
  const cal = useRta((s) => s.cal);
  const running = useRta((s) => s.running);
  const label = useRta((s) => s.deviceLabel);
  const [ref, setRef] = useState(94);
  const [w, setW] = useState<'A' | 'C' | 'Z'>('C');
  const loadFile = async () => {
    const f = await pickFile('.txt,.cal,.frd,text/plain');
    if (!f) return;
    const c = parseCal(await readText(f), f.name);
    if (!c) {
      st().notify(t('ms.calBad'), 'err');
      return;
    }
    setCal({ file: c, preset: cal.preset === 'other' && c.sens != null ? 'umik1' : cal.preset });
    st().notify(t('ms.calLoaded', { n: c.pts.length }));
  };
  return (
    <div className="panel">
      <div className="panel-h">
        <Icon name="mic" size={16} /> {t('ms.calTitle')}
      </div>
      <div className="panel-b">
        <select className="inp" value={cal.preset} onChange={(e) => setCal({ preset: e.target.value as MicPreset })} data-testid="ms-preset">
          <option value="umik1">miniDSP UMIK-1 (USB)</option>
          <option value="ecm8000">Behringer ECM8000 (XLR)</option>
          <option value="other">{t('ms.otherMic')}</option>
        </select>
        <p className="hint small">{t(('ms.hint.' + cal.preset) as 'ms.hint.umik1')}</p>
        {label && guessPreset(label) !== 'other' && guessPreset(label) !== cal.preset ? (
          <button className="btn sm" onClick={() => setCal({ preset: guessPreset(label) })}>
            {t('ms.usePreset', { m: guessPreset(label) === 'umik1' ? 'UMIK-1' : 'ECM8000' })}
          </button>
        ) : null}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <button className="btn sm" onClick={() => void loadFile()}>
            <Icon name="upload" size={13} /> {t('ms.calFile')}
          </button>
          {cal.file ? (
            <span className="chip info" title={cal.file.name}>
              {cal.file.serial || cal.file.name} · {cal.file.pts.length} {t('ms.points')}
            </span>
          ) : null}
          {cal.file ? (
            <button className="ibtn sm" title={t('act.delete')} onClick={() => setCal({ file: null })}>
              <Icon name="trash" size={13} />
            </button>
          ) : null}
        </div>
        {cal.file?.sens != null && !cal.calibrated ? (
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setCal({ offset: Math.round(umikNominalOffset(cal.file!.sens!) * 10) / 10 })}>
            {t('ms.useSens', { s: fmt(cal.file.sens, 2, lang) })}
          </button>
        ) : null}
        <div className="cal-ref">
          <b>{t('ms.refTitle')}</b>
          <div className="row2">
            <Num label={t('ms.refValue')} value={ref} onChange={setRef} unit="dB" step={0.5} digits={1} />
            <div>
              <span className="hint small">{t('ms.weight')}</span>
              <Seg
                value={w}
                options={[
                  { v: 'A', l: 'A' },
                  { v: 'C', l: 'C' },
                  { v: 'Z', l: 'Z' },
                ]}
                onChange={setW}
              />
            </div>
          </div>
          <button
            className="btn sm primary"
            disabled={!running}
            onClick={() => (calibrateTo(ref, w) ? st().notify(t('ms.calDone')) : st().notify(t('ms.calNoSignal'), 'warn'))}
            data-testid="ms-calibrate"
          >
            {t('ms.calNow')}
          </button>
          <p className="hint small">{t('ms.refHint')}</p>
        </div>
        <div className="row2" style={{ marginTop: 6 }}>
          <Num label={t('ms.offset')} value={cal.offset} onChange={(v) => setCal({ offset: v })} unit="dB" step={0.5} digits={1} />
        </div>
      </div>
    </div>
  );
}

// —— EQ önerileri ——
function EqPanel({ p, eq, chosen, lang, t }: { p: Project; eq: EqTarget; chosen: Measurement[]; lang: Lang; t: TFn }) {
  const frame = useRta((s) => s.frame);
  // canlı veri her karede değişir; öneriyi saniyede bir güncelle
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const liveRef = useRef<number[] | null>(null);
  liveRef.current = frame ? fineTo12(frame.bands) : null;
  const src = chosen.length ? avgMeasurements(chosen) : liveRef.current;
  const r: EqResult | null = useMemo(() => (src ? suggestEq(OCT12.fc, src, eq) : null), [tick, chosen, eq, !!src]); // eslint-disable-line react-hooks/exhaustive-deps
  const fb = useRta((s) => s.fb).filter((x) => x.seen >= 8);
  const setEq = (patch: Partial<EqTarget>) => st().mutate((d) => void (d.settings.eq = { ...(d.settings.eq || EQ_DEFAULT), ...patch }));
  const copy = () => {
    if (!r) return;
    const txt = r.filters.map((f, i) => `${i + 1}. ${fmt(f.f, f.f < 100 ? 1 : 0, lang)} Hz  ${f.gain > 0 ? '+' : ''}${fmt(f.gain, 1, lang)} dB  Q ${fmt(f.q, 1, lang)}`).join('\n');
    navigator.clipboard?.writeText(txt).then(
      () => st().notify(t('ms.copied')),
      () => st().notify(txt, 'ok'),
    );
  };
  return (
    <div className="panel" style={{ marginTop: 12 }} data-testid="eq-panel">
      <div className="panel-h">
        <Icon name="sparkles" size={16} /> {t('ms.eqTitle')}
        <span className="hint small" style={{ marginLeft: 8 }}>
          {chosen.length ? t('ms.eqFromSaved', { n: chosen.length }) : frame ? t('ms.eqFromLive') : ''}
        </span>
      </div>
      <div className="panel-b">
        <div className="ms-tools">
          <span className="hint small">{t('ms.curve')}</span>
          <Seg
            value={eq.curve}
            options={(Object.keys(CURVES) as CurveId[]).map((c) => ({ v: c, l: t(('ms.curve.' + c) as 'ms.curve.flat') }))}
            onChange={(c) => setEq({ curve: c, bass: CURVES[c].bass, tilt: CURVES[c].tilt })}
          />
          <Num label={t('ms.bass')} value={eq.bass} onChange={(v) => setEq({ bass: Math.max(-12, Math.min(15, v)) })} unit="dB" step={1} digits={0} width={104} />
          <Num label={t('ms.tilt')} value={eq.tilt} onChange={(v) => setEq({ tilt: Math.max(-4, Math.min(2, v)) })} unit="dB/okt" step={0.5} digits={1} width={140} />
          <Num label={t('ms.lo')} value={eq.lo} onChange={(v) => setEq({ lo: Math.max(20, Math.min(500, v)) })} unit="Hz" step={5} digits={0} width={104} />
          <Num label={t('ms.hi')} value={eq.hi} onChange={(v) => setEq({ hi: Math.max(2000, Math.min(20000, v)) })} unit="Hz" step={500} digits={0} width={122} />
          <Check checked={eq.boost} onChange={(v) => setEq({ boost: v })}>
            {t('ms.allowBoost')}
          </Check>
        </div>
        {!r ? (
          <p className="hint">{t('ms.eqEmpty')}</p>
        ) : (
          <div className="eq-grid">
            <div>
              <div className="cov-h">{t('ms.peq')}</div>
              {r.filters.length ? (
                <table className="tbl" data-testid="peq-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="n">{t('ms.freq')}</th>
                      <th className="n">{t('ms.gain')}</th>
                      <th className="n">Q</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.filters.map((f, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td className="n">
                          <b>{fmt(f.f, f.f < 100 ? 1 : 0, lang)} Hz</b>
                        </td>
                        <td className="n" style={{ color: f.gain < 0 ? 'var(--err)' : 'var(--ok)' }}>
                          {f.gain > 0 ? '+' : ''}
                          {fmt(f.gain, 1, lang)} dB
                        </td>
                        <td className="n">{fmt(f.q, 1, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="hint">{t('ms.noCuts')}</p>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn sm" onClick={copy} disabled={!r.filters.length}>
                  <Icon name="copy" size={13} /> {t('ms.copy')}
                </button>
              </div>
              {r.advice.length || chosen.length < 3 ? (
                <ul className="ms-adv">
                  {(chosen.length < 3 ? [{ code: 'tooFew' as const, vars: {} }, ...r.advice] : r.advice).map((a, i) => (
                    <li key={i}>{t(('ms.adv.' + a.code) as 'ms.adv.mode', a.vars)}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div>
              <div className="cov-h">{t('ms.devChart')}</div>
              <DevChart r={r} t={t} />
              <div className="cov-h" style={{ marginTop: 10 }}>
                {t('ms.geq')}
              </div>
              <GeqChart geq={r.geq} lang={lang} />
            </div>
          </div>
        )}
        <div className="cov-h" style={{ marginTop: 12 }}>
          {t('ms.fbTitle')}
        </div>
        {fb.length ? (
          <div className="fb-list">
            {fb.map((x, i) => {
              const near = ISO31.reduce((a, b) => (Math.abs(Math.log2(b / x.f)) < Math.abs(Math.log2(a / x.f)) ? b : a), ISO31[0]);
              return (
                <span key={i} className="chip err">
                  {fmt(x.f, 0, lang)} Hz → −6 dB, Q 10 · GEQ {near >= 1000 ? fmt(near / 1000, near % 1000 ? 2 : 0, lang) + 'k' : near}
                </span>
              );
            })}
            <button className="btn sm" onClick={() => useRta.setState({ fb: [] })}>
              {t('ms.clear')}
            </button>
          </div>
        ) : (
          <p className="hint small">{t('ms.fbHint')}</p>
        )}
      </div>
    </div>
  );
}

function DevChart({ r, t }: { r: EqResult; t: TFn }) {
  const W = 560;
  const H = 180;
  const m = { l: 30, r: 8, t: 8, b: 20 };
  const X = (f: number) => m.l + (Math.log10(f / 20) / 3) * (W - m.l - m.r);
  const Y = (d: number) => m.t + (1 - (Math.max(-15, Math.min(15, d)) + 15) / 30) * (H - m.t - m.b);
  const path = (v: number[]) => r.fc.map((f, i) => `${i ? 'L' : 'M'} ${X(f).toFixed(1)} ${Y(v[i]).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="var(--panel2)" />
      <rect x={m.l} y={Y(3)} width={W - m.l - m.r} height={Y(-3) - Y(3)} fill="var(--ok)" opacity={0.12} />
      {[-12, -6, 0, 6, 12].map((d) => (
        <g key={d}>
          <line x1={m.l} x2={W - m.r} y1={Y(d)} y2={Y(d)} stroke="var(--line)" />
          <text x={m.l - 4} y={Y(d) + 3} fontSize={9.5} textAnchor="end" fill="var(--muted)">
            {d > 0 ? '+' + d : d}
          </text>
        </g>
      ))}
      {[50, 100, 200, 500, 1000, 2000, 5000, 10000].map((f) => (
        <text key={f} x={X(f)} y={H - 6} fontSize={9.5} textAnchor="middle" fill="var(--muted)">
          {f >= 1000 ? f / 1000 + 'k' : f}
        </text>
      ))}
      <path d={path(r.dev)} fill="none" stroke="#dc2626" strokeWidth={2} />
      <path d={path(r.after)} fill="none" stroke="#16a34a" strokeWidth={2} strokeDasharray="6 4" />
      <g transform={`translate(${W - m.r - 170} ${m.t + 4})`}>
        <rect width={166} height={30} rx={3} fill="var(--panel)" opacity={0.9} />
        <line x1={6} x2={24} y1={9} y2={9} stroke="#dc2626" strokeWidth={2} />
        <text x={28} y={12} fontSize={9.5} fill="var(--text)">
          {t('ms.devNow')}
        </text>
        <line x1={6} x2={24} y1={22} y2={22} stroke="#16a34a" strokeWidth={2} strokeDasharray="5 3" />
        <text x={28} y={25} fontSize={9.5} fill="var(--text)">
          {t('ms.devAfter')}
        </text>
      </g>
    </svg>
  );
}

function GeqChart({ geq, lang }: { geq: { f: number; gain: number }[]; lang: Lang }) {
  const W = 560;
  const H = 130;
  const bw = (W - 20) / geq.length;
  const Y = (g: number) => 50 + (-g / 12) * 60;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" data-testid="geq-chart">
      <line x1={10} x2={W - 10} y1={50} y2={50} stroke="var(--muted)" />
      {geq.map((b, i) => {
        const x = 10 + i * bw;
        const y = Y(b.gain);
        return (
          <g key={b.f}>
            <rect x={x + 2} y={Math.min(50, y)} width={bw - 4} height={Math.abs(y - 50) || 1} rx={2} fill={b.gain < 0 ? '#ef4444' : b.gain > 0 ? '#22c55e' : 'var(--line)'} />
            {b.gain ? (
              <text x={x + bw / 2} y={b.gain < 0 ? y + 10 : y - 3} fontSize={8.5} textAnchor="middle" fill="var(--text)" fontWeight={700}>
                {fmt(b.gain, b.gain % 1 ? 1 : 0, lang)}
              </text>
            ) : null}
            {i % 2 === 0 ? (
              <text x={x + bw / 2} y={H - 4} fontSize={8} textAnchor="middle" fill="var(--muted)">
                {b.f >= 1000 ? fmt(b.f / 1000, b.f % 1000 ? 1 : 0, lang) + 'k' : b.f}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

// —— Ölçüm noktaları ——
function MeasList({ p, area, meas, sel, setSel, pos, setPos, lang, t }: { p: Project; area: Area; meas: Measurement[]; sel: Set<string>; setSel: (s: Set<string>) => void; pos: { x: number; y: number } | null; setPos: (v: { x: number; y: number } | null) => void; lang: Lang; t: TFn }) {
  const frame = useRta((s) => s.frame);
  const cal = useRta((s) => s.cal);
  const label = useRta((s) => s.deviceLabel);
  const installer = useStore((s) => s.installer);
  const save = () => {
    if (!frame) return;
    const bands = fineTo12(frame.bands).map((v) => Math.round(v * 10) / 10);
    const m: Measurement = {
      id: uid('ms'),
      name: t('ms.pointName', { n: meas.length + 1 }),
      areaId: area.id,
      x: pos?.x,
      y: pos?.y,
      at: Date.now(),
      device: label || cal.preset,
      calibrated: cal.calibrated,
      freqs: OCT12.fc.map((f) => Math.round(f * 10) / 10),
      bands,
      spl: { a: r1(frame.spl.a), c: r1(frame.spl.c), z: r1(frame.spl.z), leq: r1(frame.spl.leq), max: r1(frame.spl.max) },
      secs: Math.round(frame.secs),
    };
    addMeasurement(m);
    setSel(new Set([...sel, m.id]));
    setPos(null);
    st().notify(t('ms.saved'));
  };
  const demo = () => {
    const lv = demoCurve(OCT12.fc, 98 + Math.random() * 2);
    const msb = lv.map(ms);
    const m: Measurement = {
      id: uid('ms'),
      name: t('ms.demoName', { n: meas.length + 1 }),
      areaId: area.id,
      x: pos?.x ?? area.w / 2 + (Math.random() - 0.5) * 3,
      y: pos?.y ?? area.d * 0.45 + (Math.random() - 0.5) * 3,
      at: Date.now(),
      device: 'demo',
      calibrated: false,
      freqs: OCT12.fc.map((f) => Math.round(f * 10) / 10),
      bands: lv.map((v) => Math.round(v * 10) / 10),
      spl: { a: r1(weighted(msb, OCT12, 'A')), c: r1(weighted(msb, OCT12, 'C')), z: r1(weighted(msb, OCT12, 'Z')), leq: r1(weighted(msb, OCT12, 'A')), max: r1(weighted(msb, OCT12, 'A') + 4) },
      secs: 30,
      demo: true,
    };
    addMeasurement(m);
    setSel(new Set([...sel, m.id]));
  };
  const csv = () => {
    const rows = [['Hz', ...meas.map((m) => m.name)].join(';')];
    OCT12.fc.forEach((f, i) => rows.push([fmt(f, 1, lang), ...meas.map((m) => fmt(m.bands[i], 1, lang))].join(';')));
    rows.push(['dB(A)', ...meas.map((m) => fmt(m.spl.a, 1, lang))].join(';'));
    downloadText((p.name || 'olcum').replace(/[^\w-]+/g, '_') + '-rta.csv', '﻿' + rows.join('\r\n'), 'text/csv');
  };
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-h">
        <Icon name="pin" size={16} /> {t('ms.points')}
      </div>
      <div className="panel-b">
        <div className="ms-pts">
          <div>
            <PosPicker p={p} area={area} pos={pos} setPos={setPos} lang={lang} t={t} />
            <p className="hint small">{pos ? t('ms.posSet', { x: fmt(pos.x, 1, lang), y: fmt(pos.y, 1, lang) }) : t('ms.posHint')}</p>
          </div>
          <div style={{ minWidth: 0 }}>
            {!installer ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <button className="btn primary" disabled={!frame} onClick={save} data-testid="ms-save">
                  <Icon name="save" size={15} /> {t('ms.save')}
                </button>
                <button className="btn" onClick={demo} data-testid="ms-demo">
                  <Icon name="sparkles" size={15} /> {t('ms.demo')}
                </button>
                <button className="btn" disabled={!meas.length} onClick={csv}>
                  <Icon name="download" size={15} /> CSV
                </button>
              </div>
            ) : null}
            {meas.length ? (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th title={t('ms.inAvg')}>Ø</th>
                      <th>{t('ms.name')}</th>
                      <th className="n">dB(A)</th>
                      <th className="n">dB(C)</th>
                      <th>{t('ms.where')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {meas.map((m, i) => (
                      <tr key={m.id}>
                        <td>
                          <input type="checkbox" checked={sel.has(m.id)} onChange={(e) => setSel(e.target.checked ? new Set([...sel, m.id]) : new Set([...sel].filter((x) => x !== m.id)))} />
                        </td>
                        <td>
                          <input className="inp" style={{ height: 26 }} value={m.name} onChange={(e) => updateMeasurement(m.id, { name: e.target.value })} disabled={installer} />
                          <div className="hint small">
                            {i + 1}. {new Date(m.at).toLocaleString(lang === 'en' ? 'en-GB' : lang)} · {m.demo ? t('ms.demoTag') : m.device}
                            {!m.calibrated ? ' · ' + t('ms.uncal') : ''}
                          </div>
                        </td>
                        <td className="n">
                          <b>{fmt(m.spl.a, 1, lang)}</b>
                        </td>
                        <td className="n">{fmt(m.spl.c, 1, lang)}</td>
                        <td className="hint small">{m.x != null ? `${fmt(m.x, 1, lang)} / ${fmt(m.y ?? 0, 1, lang)} m` : '–'}</td>
                        <td>
                          {!installer ? (
                            <button className="ibtn sm" title={t('act.delete')} onClick={() => deleteMeasurement(m.id)}>
                              <Icon name="trash" size={13} />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="hint">{t('ms.noPoints')}</p>
            )}
            {sel.size > 1 ? <p className="hint small">{t('ms.avgHint', { n: sel.size })}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function PosPicker({ p, area, pos, setPos, lang, t }: { p: Project; area: Area; pos: { x: number; y: number } | null; setPos: (v: { x: number; y: number } | null) => void; lang: Lang; t: TFn }) {
  const layers = useStore((s) => s.layers);
  const ref = useRef<SVGSVGElement>(null);
  const W = 460;
  const k = Math.min(W / (area.w + 2), 320 / (area.d + 2));
  const onClick = (e: React.MouseEvent) => {
    const svg = ref.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return;
    const q = pt.matrixTransform(m.inverse());
    const x = q.x / k - 1;
    const y = q.y / k - 1;
    if (x < 0 || y < 0 || x > area.w || y > area.d) return;
    setPos({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  };
  return (
    <svg ref={ref} viewBox={`0 0 ${(area.w + 2) * k} ${(area.d + 2) * k}`} onClick={onClick} style={{ width: '100%', height: 'auto', background: 'var(--plan-bg)', borderRadius: 8, cursor: 'crosshair' }} data-testid="ms-pos">
      <g transform={`translate(${k} ${k}) scale(${k})`} style={{ pointerEvents: 'none' }}>
        <PlanDrawing p={p} area={area} layers={{ ...layers, heatmap: false, cableTags: false, cables: false, labels: false, dims: false, grid: false, coverage: false, measure: true }} sel={{ items: [], cables: [], zones: [], notes: [] }} k={k} lang={lang} t={t} vb={{ x0: -1, y0: -1, x1: area.w + 1, y1: area.d + 1 }} print />
        {pos ? (
          <g transform={`translate(${pos.x} ${pos.y})`}>
            <circle r={10 / k} fill="none" stroke="#7c3aed" strokeWidth={2.5 / k} />
            <path d={`M ${-16 / k} 0 H ${16 / k} M 0 ${-16 / k} V ${16 / k}`} stroke="#7c3aed" strokeWidth={1.5 / k} />
          </g>
        ) : null}
      </g>
    </svg>
  );
}
