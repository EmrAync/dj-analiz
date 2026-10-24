// Kanal EQ asistanı (line check): kanal kanal dinle → "şurayı kıs, şurayı aç", seçilen miksere göre talimat.
import { useEffect, useMemo, useRef, useState } from 'react';
import { captureBegin, captureCancel, captureEnd, captureSecs, micCorr, startRta, useRta } from '../../audio/engine';
import { analyzeTake, pitchStats } from '../../audio/voice';
import { roomAcoustics } from '../../engine/acoustics';
import { capacity, channelPlan, eqDiff, eqResponse, mixAdvice, monoNotes, procAdvice, useOf, type ChannelPlan, type MixAdvice } from '../../engine/chanEq';
import { EQ_DEFAULT } from '../../engine/eq';
import { MIXER_BY_ID, MIXERS } from '../../engine/mixers';
import { dbStr, fHz, mixerLines, moveText } from '../../engine/mixerText';
import { MICS, REGIONS, SOURCES, srcDef, type MicType, type RegionKey, type SourceGroup, type SourceId } from '../../engine/sources';
import { fmt, L, type TFn } from '../../i18n';
import type { Area, ChanAnalysis, Lang, MixChannel, MixSetup, Project } from '../../model/types';
import { addSource, deleteLineup, ensureMix, importFromProject, markApplied, removeChannel, saveLineup, saveMeas, setMix, updateChannel, applyLineup } from '../../store/mixActions';
import { st, useStore } from '../../store/store';
import { Check, Icon, Menu, Seg } from '../../ui/kit';

const GROUPS: SourceGroup[] = ['vocal', 'string', 'wind', 'perc', 'drums', 'keys', 'other'];

export function LineCheck({ p, area, lang, t, goTab }: { p: Project; area: Area; lang: Lang; t: TFn; goTab: (tab: 'eq' | 'rta') => void }) {
  const mix = p.mix;
  const [open, setOpen] = useState<string | null>(null);
  const advice = useMemo(() => (mix ? mixAdvice(mix) : null), [mix]);
  if (!mix || !advice) return <MixStart t={t} />;
  const ch = open && open !== 'mix' ? mix.channels.find((c) => c.id === open) : undefined;
  const page = open === 'mix' ? <MixMap mix={mix} advice={advice} lang={lang} t={t} /> : ch ? <ChannelPage key={ch.id} ch={ch} mix={mix} advice={advice} p={p} area={area} lang={lang} t={t} goTab={goTab} /> : null;
  return (
    <div className="lc" data-testid="linecheck">
      <MixHeader p={p} mix={mix} area={area} lang={lang} t={t} goTab={goTab} />
      <div className={'lc-grid' + (page ? ' has-page' : '')}>
        <div className="lc-list-col">
          <ChannelList mix={mix} open={open} setOpen={setOpen} lang={lang} t={t} />
          <Checklist mix={mix} lang={lang} t={t} />
        </div>
        {page ? (
          <div className="lc-page">
            <button className="btn ghost lc-back" onClick={() => setOpen(null)} data-testid="lc-back">
              <Icon name="arrowback" size={16} /> {t('lc.channels')}
            </button>
            {page}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// —— Başlangıç ——
function MixStart({ t }: { t: TFn }) {
  const lineups = useStore((s) => s.library.lineups);
  return (
    <div className="panel" style={{ marginTop: 12 }} data-testid="lc-start">
      <div className="panel-h">
        <Icon name="sparkles" size={16} /> {t('lc.title')}
      </div>
      <div className="panel-b">
        <p style={{ marginTop: 0 }}>{t('lc.intro')}</p>
        <ol className="lc-howto">
          <li>{t('lc.how1')}</li>
          <li>{t('lc.how2')}</li>
          <li>{t('lc.how3')}</li>
          <li>{t('lc.how4')}</li>
        </ol>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            onClick={() => {
              ensureMix();
              const n = importFromProject();
              st().notify(n ? t('lc.imported', { n }) : t('lc.importNone'), n ? 'ok' : 'warn');
            }}
            data-testid="lc-import"
          >
            <Icon name="list" size={15} /> {t('lc.fromProject')}
          </button>
          <button className="btn" onClick={() => ensureMix()} data-testid="lc-empty">
            <Icon name="plus" size={15} /> {t('lc.empty')}
          </button>
          {lineups.map((l) => (
            <button
              key={l.id}
              className="btn"
              onClick={() => {
                ensureMix();
                applyLineup(l);
              }}
            >
              <Icon name="folder" size={15} /> {l.name} <span className="hint">· {l.channels.length}</span>
            </button>
          ))}
        </div>
        <p className="hint small">{t('lc.mixers', { m: MIXERS.filter((m) => m.id !== 'other').map((m) => m.name).join(', ') })}</p>
      </div>
    </div>
  );
}

// —— Üst bilgi: mikser, mono, kapasite, kadro, sistem ölçümü ——
function MixHeader({ p, mix, area, lang, t, goTab }: { p: Project; mix: MixSetup; area: Area; lang: Lang; t: TFn; goTab: (tab: 'eq' | 'rta') => void }) {
  const spec = MIXER_BY_ID[mix.mixer];
  const cap = capacity(mix);
  const lineups = useStore((s) => s.library.lineups);
  const meas = (p.measurements || []).filter((m) => m.areaId === area.id && !m.demo);
  const sys = meas.find((m) => m.id === mix.sysId) || null;
  return (
    <div className="panel lc-head">
      <div className="lc-head-row">
        <label className="lc-field">
          <span className="hint small">{t('lc.mixer')}</span>
          <select className="inp" value={mix.mixer} onChange={(e) => setMix({ mixer: e.target.value as MixSetup['mixer'] })} data-testid="lc-mixer">
            {MIXERS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === 'other' ? t('lc.otherMixer') : m.name}
              </option>
            ))}
          </select>
        </label>
        <div className="lc-field">
          <span className="hint small">{t('lc.output')}</span>
          <Seg
            value={mix.mono ? 'mono' : 'stereo'}
            options={[
              { v: 'mono', l: 'Mono' },
              { v: 'stereo', l: 'Stereo' },
            ]}
            onChange={(v) => setMix({ mono: v === 'mono' })}
          />
        </div>
        <div className="lc-field">
          <span className="hint small">{t('lc.capacity')}</span>
          <span className={'chip ' + (cap.ok ? 'ok' : 'err')} title={t('lc.capTip', { m: spec.mic, l: spec.line })}>
            {t('lc.capVal', { a: cap.mic, b: spec.mic, c: cap.line })}
          </span>
        </div>
        <label className="lc-field" style={{ minWidth: 0, flex: '1 1 200px' }}>
          <span className="hint small">{t('lc.system')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select className="inp" value={mix.sysId || ''} onChange={(e) => setMix({ sysId: e.target.value || undefined })} data-testid="lc-sys">
              <option value="">{meas.length ? t('lc.sysNone') : t('lc.sysEmpty')}</option>
              {meas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button className="btn sm" onClick={() => goTab('eq')} title={t('lc.sysTip')}>
              EQ
            </button>
          </div>
        </label>
        <Menu
          button={(_, toggle) => (
            <button className="btn sm" onClick={toggle} data-testid="lc-lineups">
              <Icon name="folder" size={14} /> {t('lc.lineups')}
            </button>
          )}
        >
          {(close) => (
            <>
              <button
                onClick={async () => {
                  close();
                  const name = prompt(t('lc.lineupName'), p.meta.client || p.name);
                  if (name) {
                    await saveLineup(name);
                    st().notify(t('lc.lineupSaved'));
                  }
                }}
              >
                <Icon name="save" size={15} /> {t('lc.saveLineup')}
              </button>
              {lineups.length ? <hr /> : null}
              {lineups.map((l) => (
                <div key={l.id} className="pk-tpl">
                  <button style={{ flex: 1 }} onClick={() => (close(), confirm(t('lc.useLineupQ', { n: l.name })) && applyLineup(l))}>
                    <Icon name="folder" size={15} /> {l.name} <span className="hint">· {l.channels.length}</span>
                  </button>
                  <button className="ibtn sm danger" onClick={() => confirm(t('lc.delLineupQ', { n: l.name })) && deleteLineup(l.id)}>
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              ))}
            </>
          )}
        </Menu>
      </div>
      {!cap.ok ? <div className="warnline">⚠ {cap.micOk ? t('lc.capTotal', { n: cap.total, m: spec.mic + spec.line }) : t('lc.capMic', { n: cap.mic, m: spec.mic })}</div> : null}
      {mix.channels.length && !sys ? <div className="hint small" style={{ marginTop: 6 }}>{t('lc.sysHint')}</div> : null}
      <div className="lc-mono">
        {monoNotes(mix).map((n, i) => (
          <div key={i} className="hint small">
            • {L(n, lang)}
          </div>
        ))}
      </div>
    </div>
  );
}

// —— Kanal listesi ——
function ChannelList({ mix, open, setOpen, lang, t }: { mix: MixSetup; open: string | null; setOpen: (v: string | null) => void; lang: Lang; t: TFn }) {
  const chans = [...mix.channels].sort((a, b) => a.ch - b.ch);
  const done = chans.filter((c) => c.done).length;
  return (
    <div className="panel">
      <div className="panel-h">
        <Icon name="list" size={16} /> {t('lc.channels')} <span className="chip">{chans.length}</span>
        <span style={{ flex: 1 }} />
        <span className="hint small">{t('lc.doneN', { a: done, b: chans.length })}</span>
      </div>
      <div className="lc-list">
        {chans.map((c) => {
          const s = srcDef(c.src);
          return (
            <button key={c.id} className={'lc-row' + (open === c.id ? ' on' : '') + (c.done ? ' done' : '')} onClick={() => setOpen(c.id)} data-testid="lc-row">
              <span className="lc-ch">{c.ch}</span>
              <span className="lc-name">
                <b>{c.name}</b>
                <span className="hint small">
                  {L(s.name, lang)}
                  {s.group === 'vocal' && s.id !== 'speech' ? ` · ${t(('lc.use.' + useOf(c)) as 'lc.use.sing')}` : ''}
                </span>
              </span>
              <span className={'chip ' + (c.done ? 'ok' : c.meas ? 'info' : '')}>{c.done ? '✓' : c.meas ? t('lc.measured') : t('lc.todo')}</span>
            </button>
          );
        })}
        {chans.length ? (
          <button className={'lc-row mix' + (open === 'mix' ? ' on' : '')} onClick={() => setOpen('mix')} data-testid="lc-mixmap">
            <span className="lc-ch">
              <Icon name="chart" size={14} />
            </span>
            <span className="lc-name">
              <b>{t('lc.mixMap')}</b>
              <span className="hint small">{t('lc.mixMapSub')}</span>
            </span>
            <Icon name="chevron" size={14} color="var(--faint)" />
          </button>
        ) : (
          <div className="hint" style={{ padding: 12 }}>
            {t('lc.noChannels')}
          </div>
        )}
      </div>
      <div className="lc-add">
        <select
          className="inp"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const id = addSource(v as SourceId);
            if (id && v !== 'pa5x' && v !== 'drumkit') setOpen(id);
          }}
          data-testid="lc-add"
        >
          <option value="">+ {t('lc.addChannel')}</option>
          <optgroup label={t('lc.sets')}>
            <option value="pa5x">{t('lc.setPa5x')}</option>
            <option value="drumkit">{t('lc.setDrums')}</option>
          </optgroup>
          {GROUPS.map((g) => (
            <optgroup key={g} label={t(('lc.grp.' + g) as 'lc.grp.vocal')}>
              {SOURCES.filter((s) => s.group === g).map((s) => (
                <option key={s.id} value={s.id}>
                  {L(s.name, lang)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="btn sm" onClick={() => st().notify(t('lc.imported', { n: importFromProject() }))} title={t('lc.fromProject')}>
          <Icon name="list" size={14} />
        </button>
      </div>
    </div>
  );
}

// —— Kanal sayfası ——
function ChannelPage({ ch, mix, advice, p, area, lang, t, goTab }: { ch: MixChannel; mix: MixSetup; advice: MixAdvice; p: Project; area: Area; lang: Lang; t: TFn; goTab: (tab: 'eq' | 'rta') => void }) {
  const s = srcDef(ch.src);
  const sys = (p.measurements || []).find((m) => m.id === mix.sysId) || null;
  const plan: ChannelPlan = useMemo(() => channelPlan(ch, mix, advice, sys, p.settings.eq || EQ_DEFAULT), [ch, mix, advice, sys, p.settings.eq]);
  const rt = roomAcoustics(area)?.rt[1] ?? null;
  const proc = procAdvice(ch, rt);
  const [withSlots, setWithSlots] = useState(true);
  const eq = withSlots ? plan.eq : plan.sugg ? plan.sugg.eq : plan.base;
  const lines = mixerLines(mix, ch, eq, proc, lang);
  const diff = ch.applied ? eqDiff(ch.applied, eq) : null;
  const vocal = s.group === 'vocal' && s.id !== 'speech';
  const mic = (ch.mic || s.mic) as MicType;
  const up = (patch: Partial<MixChannel>) => updateChannel(ch.id, patch);
  return (
    <div className="lc-ch-page" data-testid="lc-channel">
      <div className="panel">
        <div className="panel-b lc-ch-head">
          <input className="inp lc-chnum" type="number" min={1} value={ch.ch} onChange={(e) => up({ ch: Math.max(1, Number(e.target.value) || 1) })} aria-label={t('lc.chNum')} />
          <input className="inp lc-chname" value={ch.name} onChange={(e) => up({ name: e.target.value })} data-testid="lc-chname" />
          <select className="inp" value={ch.src} onChange={(e) => up({ src: e.target.value, meas: undefined })} data-testid="lc-src">
            {GROUPS.map((g) => (
              <optgroup key={g} label={t(('lc.grp.' + g) as 'lc.grp.vocal')}>
                {SOURCES.filter((x) => x.group === g).map((x) => (
                  <option key={x.id} value={x.id}>
                    {L(x.name, lang)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select className="inp" value={mic} onChange={(e) => up({ mic: e.target.value })} aria-label={t('lc.mic')}>
            {(Object.keys(MICS) as MicType[]).map((m) => (
              <option key={m} value={m}>
                {L(MICS[m].name, lang)}
              </option>
            ))}
          </select>
          {vocal ? (
            <div className="lc-segs">
              <Seg value={useOf(ch)} options={(['sing', 'speech', 'both'] as const).map((v) => ({ v, l: t(('lc.use.' + v) as 'lc.use.sing') }))} onChange={(v) => up({ use: v })} />
              <Seg value={ch.voice || 'normal'} options={(['normal', 'muffled', 'harsh', 'thin'] as const).map((v) => ({ v, l: t(('lc.voice.' + v) as 'lc.voice.normal') }))} onChange={(v) => up({ voice: v })} />
            </div>
          ) : null}
          <button className="ibtn sm danger" title={t('act.delete')} onClick={() => confirm(t('lc.delQ', { n: ch.name })) && removeChannel(ch.id)}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      </div>

      <div className="panel" data-testid="lc-settings">
        <div className="panel-h">
          <Icon name="mixer" size={16} /> {t('lc.enter', { m: MIXER_BY_ID[mix.mixer].id === 'other' ? t('lc.otherMixer') : MIXER_BY_ID[mix.mixer].name })}
          <span className={'chip ' + (plan.sugg ? 'ok' : 'info')} style={{ marginLeft: 6 }}>
            {plan.sugg ? t('lc.fromListen') : t('lc.fromStart')}
          </span>
          <span style={{ flex: 1 }} />
          {plan.slots.length ? (
            <Check checked={withSlots} onChange={setWithSlots}>
              {t('lc.withSlots')}
            </Check>
          ) : null}
        </div>
        <div className="panel-b">
          {!plan.sugg ? <p className="hint small" style={{ marginTop: 0 }}>{t('lc.startHint')}</p> : null}
          <div className="lc-lines">
            {lines.map((l, i) => (
              <div key={i} className={'lc-line ' + l.key + (l.move ? (l.move.gain < 0 ? ' cut' : ' boost') : '')} data-testid={l.key === 'band' ? 'lc-band' : undefined}>
                <span className="lc-k">{l.k}</span>
                <span className="lc-v">{l.v}</span>
                {l.sub ? <span className="lc-sub">{l.sub}</span> : null}
              </div>
            ))}
          </div>
          {diff && diff.length ? (
            <div className="lc-diff">
              <b>{t('lc.changes')}</b>
              {diff.map((d) => (
                <div key={d.band} className="hint small">
                  Band {d.band}: {d.from ? moveText(MIXER_BY_ID[mix.mixer], d.from, lang) : t('lc.flat')} → <b>{d.to ? moveText(MIXER_BY_ID[mix.mixer], d.to, lang) : t('lc.flat')}</b>
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button className={'btn ' + (ch.done && !(diff && diff.length) ? '' : 'primary')} onClick={() => (markApplied(ch.id, eq), st().notify(t('lc.appliedOk')))} data-testid="lc-applied">
              <Icon name="ok" size={15} /> {ch.done && !(diff && diff.length) ? t('lc.appliedAgain') : t('lc.applied')}
            </button>
          </div>
        </div>
      </div>

      <Listener ch={ch} mix={mix} lang={lang} t={t} goTab={goTab} />

      {plan.sugg ? <Result ch={ch} plan={plan} lang={lang} t={t} /> : null}

      <div className="panel">
        <div className="panel-h">
          <Icon name="info" size={16} /> {t('lc.tips')}
        </div>
        <div className="panel-b">
          <ul className="lc-tips">
            {proc.loud ? <li className="warnline">{t('lc.loud')}</li> : null}
            {s.tips.map((x, i) => (
              <li key={i}>{L(x, lang)}</li>
            ))}
            {MICS[mic]?.tip ? <li>{L(MICS[mic].tip, lang)}</li> : null}
            {vocal && ch.voice === 'muffled' ? <li>{t('lc.muffledTip')}</li> : null}
          </ul>
          <div className="lc-regions">
            {s.regions.map((r) => (
              <span key={r.key + r.lo} className="lc-reg" style={{ borderColor: REGIONS[r.key].color }}>
                <b style={{ color: REGIONS[r.key].color }}>{L(REGIONS[r.key].name, lang)}</b> {fHz(r.lo, lang)}–{fHz(r.hi, lang)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// —— Dinleme ——
function Listener({ ch, mix, lang, t, goTab }: { ch: MixChannel; mix: MixSetup; lang: Lang; t: TFn; goTab: (tab: 'eq' | 'rta') => void }) {
  const running = useRta((s) => s.running);
  const starting = useRta((s) => s.starting);
  const inPeak = useRta((s) => s.frame?.inPeak ?? -120);
  const [mode, setMode] = useState<'room' | 'direct'>(() => ch.meas?.mode || 'room');
  const [dur, setDur] = useState(15);
  const [phase, setPhase] = useState<'idle' | 'noise' | 'listen' | 'busy'>('idle');
  const [secs, setSecs] = useState(0);
  const [eqOn, setEqOn] = useState(!!ch.applied);
  const noise = useRef<number[] | undefined>(undefined);
  const s = srcDef(ch.src);
  useEffect(() => () => captureCancel(), []);
  useEffect(() => {
    if (phase !== 'listen' && phase !== 'noise') return;
    const id = setInterval(() => {
      const x = captureSecs();
      setSecs(x);
      if ((phase === 'noise' && x >= 2.5) || (phase === 'listen' && x >= dur)) finish();
    }, 150);
    return () => clearInterval(id);
  }); // her çizimde güncel kapanış
  const corr = (fc: number[], db: number[]) => (mode === 'room' ? db.map((v, i) => v + micCorr(fc[i])) : db);
  const finish = () => {
    const cap = captureEnd();
    const ph = phase;
    setPhase('busy');
    setTimeout(() => {
      if (!cap) {
        setPhase('idle');
        return;
      }
      if (ph === 'noise') {
        const l = analyzeTake(cap.x, cap.fs, true);
        noise.current = l ? corr(l.fc, l.db) : undefined;
        st().notify(t('lc.noiseOk'));
        setPhase('idle');
        return;
      }
      const l = analyzeTake(cap.x, cap.fs);
      if (!l) {
        st().notify(t('lc.tooShort'), 'warn');
        setPhase('idle');
        return;
      }
      const pitched = s.group === 'vocal' || s.group === 'wind' || s.group === 'string';
      const f0 = pitched ? pitchStats(cap.x, cap.fs) : null;
      const meas: ChanAnalysis = {
        at: Date.now(),
        fc: l.fc,
        db: corr(l.fc, l.db),
        noise: noise.current,
        f0: f0 && isFinite(f0.med) ? f0 : undefined,
        active: l.active,
        peak: l.peak,
        crest: l.crest,
        mode,
        eqAt: eqOn && ch.applied ? ch.applied : undefined,
        sysId: mix.sysId,
      };
      saveMeas(ch.id, meas);
      setPhase('idle');
      st().notify(t('lc.analyzed'));
    }, 30);
  };
  const begin = (ph: 'noise' | 'listen') => {
    if (!captureBegin()) return;
    setSecs(0);
    setPhase(ph);
  };
  const what = s.group === 'vocal' ? (useOf(ch) === 'speech' ? t('lc.doSpeak') : t('lc.doSing')) : t('lc.doPlay');
  return (
    <div className="panel" data-testid="lc-listen">
      <div className="panel-h">
        <Icon name="mic" size={16} /> {t('lc.listen')}
        <span style={{ flex: 1 }} />
        <Seg
          value={mode}
          options={[
            { v: 'room', l: t('lc.modeRoom') },
            { v: 'direct', l: t('lc.modeDirect') },
          ]}
          onChange={setMode}
        />
      </div>
      <div className="panel-b">
        <p className="hint small" style={{ marginTop: 0 }}>
          {mode === 'room' ? t('lc.roomHint') : t('lc.directHint')}
        </p>
        <ol className="lc-howto">
          <li>{t('lc.step1', { ch: ch.ch })}</li>
          <li>{what}</li>
          <li>{t('lc.step3')}</li>
        </ol>
        {!running ? (
          <button className="btn primary" onClick={() => void startRta()} disabled={starting} data-testid="lc-mic">
            <Icon name="mic" size={15} /> {t('lc.micOn')}
          </button>
        ) : (
          <>
            <div className="lc-meter">
              <span style={{ width: Math.max(0, Math.min(100, ((inPeak + 60) / 60) * 100)) + '%', background: inPeak > -3 ? 'var(--err)' : inPeak > -20 ? 'var(--ok)' : 'var(--warn)' }} />
            </div>
            {phase === 'listen' || phase === 'noise' ? (
              <div className="lc-rec">
                <span className="lc-dot" />
                <b>
                  {phase === 'noise' ? t('lc.silence') : t('lc.listening')} {fmt(secs, 0, lang)} / {phase === 'noise' ? 2.5 : dur} s
                </b>
                <div className="pk-bar" style={{ flex: 1 }}>
                  <span style={{ width: Math.min(100, (secs / (phase === 'noise' ? 2.5 : dur)) * 100) + '%', background: 'var(--accent)' }} />
                </div>
                {phase === 'listen' ? (
                  <button className="btn primary" onClick={finish} data-testid="lc-stop">
                    {t('lc.done')}
                  </button>
                ) : null}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn primary" onClick={() => begin('listen')} disabled={phase === 'busy'} data-testid="lc-go">
                  <Icon name="play" size={15} /> {phase === 'busy' ? t('lc.analyzing') : ch.meas ? t('lc.listenAgain') : t('lc.listenGo')}
                </button>
                <Seg value={dur} options={[8, 15, 20].map((v) => ({ v, l: `${v} s` }))} onChange={setDur} />
                <button className="btn sm" onClick={() => begin('noise')} disabled={phase === 'busy'} title={t('lc.noiseTip')}>
                  {noise.current ? '✓ ' : ''}
                  {t('lc.noise')}
                </button>
                {ch.applied ? (
                  <Check checked={eqOn} onChange={setEqOn}>
                    {t('lc.eqOn')}
                  </Check>
                ) : null}
              </div>
            )}
            {mode === 'room' && !mix.sysId ? (
              <p className="hint small">
                {t('lc.noSys')}{' '}
                <button className="btn sm ghost" onClick={() => goTab('eq')}>
                  EQ →
                </button>
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// —— Sonuç: grafik, notlar, anlaşılırlık ——
function Result({ ch, plan, lang, t }: { ch: MixChannel; plan: ChannelPlan; lang: Lang; t: TFn }) {
  const sg = plan.sugg!;
  const s = srcDef(ch.src);
  const a = ch.meas!;
  return (
    <div className="panel" data-testid="lc-result">
      <div className="panel-h">
        <Icon name="chart" size={16} /> {t('lc.result')}
        <span className="hint small" style={{ marginLeft: 8 }}>
          {new Date(a.at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })} · {a.mode === 'room' ? t('lc.modeRoom') : t('lc.modeDirect')}
          {a.f0 ? ` · ${t('lc.pitch', { f: Math.round(a.f0.med) })}` : ''}
          {sg.detected ? ` (${t(('lc.det.' + sg.detected) as 'lc.det.male')})` : ''}
        </span>
      </div>
      <div className="panel-b">
        {sg.clarity ? (
          <div className="lc-clarity">
            <div>
              <span className="hint small">{t('lc.clarity')}</span>
              <b>
                {sg.clarity.before}% → <span style={{ color: 'var(--ok)' }}>{sg.clarity.after}%</span>
              </b>
            </div>
            <div className="pk-bar" style={{ flex: 1, height: 10 }}>
              <span style={{ width: sg.clarity.after + '%', background: 'var(--ok)' }} />
            </div>
            {sg.clarity.mud > 1 ? <span className="chip warn">{t('lc.mudDb', { d: fmt(sg.clarity.mud, 1, lang) })}</span> : null}
          </div>
        ) : null}
        <DevChart fc={sg.fc} ok={sg.ok} before={sg.before} after={sg.after} regions={s.regions} lang={lang} t={t} />
        <div className="lc-moves">
          <b>{t('lc.whatToDo')}</b>
          <div className="lc-move">
            <span className="lc-arrow cut">✂</span> HPF {fHz(sg.eq.hpf, lang)}
          </div>
          {sg.eq.moves.map((m, i) => (
            <div key={i} className="lc-move">
              <span className={'lc-arrow ' + (m.gain < 0 ? 'cut' : 'boost')}>{m.gain < 0 ? '▼' : '▲'}</span>
              <span>
                <b>
                  {fHz(m.f, lang)} {m.gain < 0 ? t('lc.cut') : t('lc.boost')} {dbStr(Math.abs(m.gain), lang).replace(/^[+−]/, '')}
                </b>{' '}
                <span className="hint small">— {L(REGIONS[m.why as RegionKey]?.[m.gain < 0 ? 'cut' : 'boost'], lang)}</span>
              </span>
            </div>
          ))}
        </div>
        {sg.notes.map((n, i) => (
          <div key={i} className={n.level === 'warn' ? 'warnline' : n.level === 'ok' ? 'okline' : 'hint small'} style={{ marginTop: 4 }}>
            {n.level === 'ok' ? '✓ ' : n.level === 'warn' ? '⚠ ' : 'ℹ '}
            {L(n.text, lang)}
          </div>
        ))}
      </div>
    </div>
  );
}

function DevChart({ fc, ok, before, after, regions, lang, t }: { fc: number[]; ok: boolean[]; before: number[]; after: number[]; regions: { key: RegionKey; lo: number; hi: number }[]; lang: Lang; t: TFn }) {
  const W = 640;
  const H = 210;
  const pad = { l: 34, r: 8, t: 22, b: 22 };
  const fx = (f: number) => pad.l + ((Math.log10(f) - Math.log10(50)) / (Math.log10(16000) - Math.log10(50))) * (W - pad.l - pad.r);
  const yy = (d: number) => pad.t + ((12 - Math.max(-12, Math.min(12, d))) / 24) * (H - pad.t - pad.b);
  const path = (v: number[]) => {
    let d = '';
    let pen = false;
    fc.forEach((f, i) => {
      if (!ok[i] || !isFinite(v[i]) || f < 50) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${fx(f).toFixed(1)},${yy(v[i]).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  return (
    <svg className="lc-chart" viewBox={`0 0 ${W} ${H}`} data-testid="lc-chart">
      {regions.map((r, i) => (
        <g key={i}>
          <rect x={fx(Math.max(50, r.lo))} y={pad.t} width={Math.max(2, fx(Math.min(16000, r.hi)) - fx(Math.max(50, r.lo)))} height={H - pad.t - pad.b} fill={REGIONS[r.key].color} opacity={0.09} />
          <text x={(fx(Math.max(50, r.lo)) + fx(Math.min(16000, r.hi))) / 2} y={pad.t - 6 - (i % 2) * 0} fontSize={9.5} textAnchor="middle" fill={REGIONS[r.key].color}>
            {L(REGIONS[r.key].name, lang).split(' ')[0]}
          </text>
        </g>
      ))}
      {[-12, -6, 0, 6, 12].map((d) => (
        <g key={d}>
          <line x1={pad.l} x2={W - pad.r} y1={yy(d)} y2={yy(d)} stroke={d === 0 ? 'var(--ok)' : 'var(--line)'} strokeDasharray={d === 0 ? '5 4' : undefined} />
          <text x={pad.l - 4} y={yy(d) + 3} fontSize={9} textAnchor="end" fill="var(--muted)">
            {d > 0 ? '+' + d : d}
          </text>
        </g>
      ))}
      {[100, 200, 500, 1000, 2000, 5000, 10000].map((f) => (
        <text key={f} x={fx(f)} y={H - 6} fontSize={9} textAnchor="middle" fill="var(--muted)">
          {f >= 1000 ? f / 1000 + 'k' : f}
        </text>
      ))}
      <path d={path(before)} fill="none" stroke="var(--warn)" strokeWidth={2} />
      <path d={path(after)} fill="none" stroke="var(--accent)" strokeWidth={2.4} />
      <g fontSize={10} transform={`translate(${pad.l + 6} ${H - pad.b - 8})`}>
        <rect x={0} y={-4} width={150} height={14} rx={3} fill="var(--panel)" opacity={0.85} />
        <rect x={4} y={1} width={10} height={3} fill="var(--warn)" />
        <text x={17} y={6} fill="var(--text)">
          {t('lc.now')}
        </text>
        <rect x={56} y={1} width={10} height={3} fill="var(--accent)" />
        <text x={69} y={6} fill="var(--text)">
          {t('lc.withEq')}
        </text>
        <text x={118} y={6} fill="var(--ok)">
          {t('lc.target')}
        </text>
      </g>
    </svg>
  );
}

// —— Frekans haritası (mix) ——
function MixMap({ mix, advice, lang, t }: { mix: MixSetup; advice: MixAdvice; lang: Lang; t: TFn }) {
  const chans = [...mix.channels].sort((a, b) => a.ch - b.ch);
  const W = 640;
  const rowH = 22;
  const pad = { l: 130, r: 8, t: 18 };
  const H = pad.t + chans.length * rowH + 20;
  const fx = (f: number) => pad.l + ((Math.log10(f) - Math.log10(30)) / (Math.log10(16000) - Math.log10(30))) * (W - pad.l - pad.r);
  const spec = MIXER_BY_ID[mix.mixer];
  return (
    <div className="lc-ch-page" data-testid="lc-map">
      <div className="panel">
        <div className="panel-h">
          <Icon name="chart" size={16} /> {t('lc.mixMap')}
        </div>
        <div className="panel-b">
          <p className="hint small" style={{ marginTop: 0 }}>
            {t('lc.mapHint')}
          </p>
          <svg className="lc-chart" viewBox={`0 0 ${W} ${H}`}>
            {[50, 100, 200, 500, 1000, 2000, 5000, 10000].map((f) => (
              <g key={f}>
                <line x1={fx(f)} x2={fx(f)} y1={pad.t - 4} y2={H - 16} stroke="var(--line)" />
                <text x={fx(f)} y={H - 4} fontSize={9} textAnchor="middle" fill="var(--muted)">
                  {f >= 1000 ? f / 1000 + 'k' : f}
                </text>
              </g>
            ))}
            {chans.map((c, i) => {
              const s = srcDef(c.src);
              const y = pad.t + i * rowH;
              const hpf = advice.hpf.find((h) => h.chId === c.id)?.hpf || s.hpf;
              const col = s.group === 'vocal' ? '#16a34a' : s.group === 'drums' || s.group === 'perc' ? '#7c3aed' : s.group === 'keys' ? '#0891b2' : s.group === 'wind' ? '#d97706' : '#2563eb';
              return (
                <g key={c.id}>
                  <text x={4} y={y + 14} fontSize={10.5} fill="var(--text)">
                    {c.ch}. {c.name.length > 18 ? c.name.slice(0, 17) + '…' : c.name}
                  </text>
                  <rect x={fx(Math.max(30, hpf))} y={y + 9} width={Math.max(1, fx(Math.min(16000, s.f0[1] * 8)) - fx(Math.max(30, hpf)))} height={4} fill={col} opacity={0.25} rx={2} />
                  {s.key.map((k, j) => (
                    <rect key={j} x={fx(Math.max(30, k.lo))} y={y + 4} width={Math.max(2, fx(k.hi) - fx(Math.max(30, k.lo)))} height={14} fill={col} opacity={0.25 + k.w * 0.55} rx={3} />
                  ))}
                  {advice.cuts
                    .filter((x) => x.chId === c.id)
                    .map((x, j) => (
                      <text key={'c' + j} x={fx(x.f)} y={y + 15} fontSize={10} textAnchor="middle" fill="var(--err)" fontWeight={700}>
                        ▼
                      </text>
                    ))}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div className="panel">
        <div className="panel-h">
          <Icon name="sparkles" size={16} /> {t('lc.slotTitle')}
        </div>
        <div className="panel-b">
          {advice.notes.map((n, i) => (
            <p key={i} style={{ marginTop: 0 }}>
              • {L(n, lang)}
            </p>
          ))}
          {advice.cuts.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('lc.channel')}</th>
                  <th>{t('lc.cutCol')}</th>
                  <th>{t('lc.forCol')}</th>
                </tr>
              </thead>
              <tbody>
                {chans
                  .filter((c) => advice.cuts.some((x) => x.chId === c.id))
                  .map((c) => {
                    const cs = advice.cuts.filter((x) => x.chId === c.id);
                    return (
                      <tr key={c.id}>
                        <td>
                          {c.ch}. {c.name}
                        </td>
                        <td>
                          {cs.map((x, i) => (
                            <div key={i}>{moveText(spec, { f: x.f, gain: x.gain, q: x.q, type: 'bell', why: x.why }, lang)}</div>
                          ))}
                        </td>
                        <td className="hint">{[...new Set(cs.flatMap((x) => x.forCh))].join(', ')}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ) : (
            <p className="hint">{t('lc.noSlots')}</p>
          )}
          <p className="hint small">{t('lc.slotAuto')}</p>
        </div>
      </div>
      <div className="panel">
        <div className="panel-h">
          <Icon name="list" size={16} /> {t('lc.hpfPlan')}
        </div>
        <div className="panel-b lc-hpf">
          {chans.map((c) => (
            <span key={c.id} className="lc-reg">
              <b>{c.ch}.</b> {c.name}: HPF {fHz(advice.hpf.find((h) => h.chId === c.id)?.hpf || 0, lang)}
            </span>
          ))}
        </div>
      </div>
      <ResponsePreview mix={mix} advice={advice} lang={lang} />
    </div>
  );
}

// Tüm kanalların EQ eğrileri üst üste (küçük)
function ResponsePreview({ mix, advice, lang }: { mix: MixSetup; advice: MixAdvice; lang: Lang }) {
  const chans = mix.channels.slice(0, 24);
  const W = 640;
  const H = 120;
  const fx = (f: number) => 30 + ((Math.log10(f) - Math.log10(30)) / (Math.log10(16000) - Math.log10(30))) * (W - 38);
  const yy = (d: number) => 10 + ((12 - Math.max(-12, Math.min(12, d))) / 24) * (H - 24);
  const fs = Array.from({ length: 60 }, (_, i) => 30 * Math.pow(16000 / 30, i / 59));
  return (
    <div className="panel">
      <div className="panel-b">
        <svg className="lc-chart" viewBox={`0 0 ${W} ${H}`}>
          <line x1={30} x2={W - 8} y1={yy(0)} y2={yy(0)} stroke="var(--line2)" />
          {chans.map((c) => {
            const plan = channelPlan(c, mix, advice);
            const d = fs.map((f, i) => `${i ? 'L' : 'M'}${fx(f).toFixed(1)},${yy(eqResponse(plan.eq, f)).toFixed(1)}`).join('');
            const s = srcDef(c.src);
            return <path key={c.id} d={d} fill="none" stroke={s.group === 'vocal' ? '#16a34a' : '#64748b'} strokeWidth={s.group === 'vocal' ? 2 : 1} opacity={0.75} />;
          })}
          <text x={34} y={H - 2} fontSize={9} fill="var(--muted)">
            {lang === 'de' ? 'EQ aller Kanäle' : lang === 'en' ? 'EQ of all channels' : 'Tüm kanalların EQ eğrisi'}
          </text>
        </svg>
      </div>
    </div>
  );
}

// —— Unutulmaması gerekenler ——
function Checklist({ mix, lang, t }: { mix: MixSetup; lang: Lang; t: TFn }) {
  const spec = MIXER_BY_ID[mix.mixer];
  const items = [
    t('lc.ck.order'),
    t('lc.ck.chain'),
    t('lc.ck.phantom'),
    t('lc.ck.polarity'),
    t('lc.ck.mix'),
    t('lc.ck.vocalTop'),
    t('lc.ck.monitor') + (spec.fbAssist ? ` (${L(spec.fbAssist, lang)})` : ''),
    t('lc.ck.sub'),
    t('lc.ck.reverb'),
    t('lc.ck.wireless'),
    t('lc.ck.scene', { s: L(spec.scene, lang) }),
    t('lc.ck.record', { u: L(spec.usb, lang) }),
  ];
  return (
    <div className="panel" data-testid="lc-checklist">
      <div className="panel-h">
        <Icon name="checklist" size={16} /> {t('lc.ckTitle')}
      </div>
      <div className="panel-b">
        <ul className="lc-tips">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
          {spec.extras.map((x, i) => (
            <li key={'e' + i} className="hint">
              {spec.name}: {L(x, lang)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
