import { useMemo, useState } from 'react';
import { autoRoom, runWizard, WIZ_DEFAULT, type WizardParams } from '../../engine/wizard';
import { buildBom } from '../../engine/bom';
import { analyzePower } from '../../engine/power';
import { splGrid } from '../../engine/acoustics';
import { fmt, type TFn } from '../../i18n';
import type { EventType, ZoneKind } from '../../model/types';
import { saveProject } from '../../store/persist';
import { st, useStore, useT } from '../../store/store';
import { Icon, Modal, Num, Seg } from '../kit';

export function zoneNames(t: TFn): Record<ZoneKind, string> {
  return {
    stage: t('zone.stage'),
    audience: t('zone.audience'),
    dance: t('zone.dance'),
    tables: t('zone.tables'),
    foh: t('zone.foh'),
    walkway: t('zone.walkway'),
    backstage: t('zone.backstage'),
    bar: t('zone.bar'),
    nogo: t('zone.nogo'),
    custom: t('zone.custom'),
  };
}

const EVENTS: EventType[] = ['dugun', 'kina', 'nisan', 'sunnet', 'konser', 'kurumsal', 'parti', 'festival', 'diger'];

export function WizardDialog() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const [par, setPar] = useState<Omit<WizardParams, 'zoneNames'>>({ ...WIZ_DEFAULT, name: '' });
  const up = (patch: Partial<typeof par>) => setPar((p) => ({ ...p, ...patch }));
  const auto = autoRoom(par.guests, par.indoor);
  const preview = useMemo(() => {
    try {
      const p = runWizard({ ...par, name: par.name || t('wiz.defaultName'), zoneNames: zoneNames(t) });
      const bom = buildBom(p, t, lang);
      const spl = splGrid(p, p.areas[0].id, { band: 'mid', freq: 1000, coherent: false });
      return { p, bom, kw: analyzePower(p).totalW / 1000, spl: spl?.stats?.avg };
    } catch {
      return null;
    }
  }, [par, t, lang]);
  const create = async () => {
    if (!preview) return;
    const p = preview.p;
    p.meta.eventType = par.eventType;
    st().setProject(p);
    await saveProject(p);
    st().set({ dialog: null, view: 'plan' });
    setTimeout(() => window.dispatchEvent(new Event('sahnecad:fit')), 50);
    st().notify(t('wiz.created'));
  };
  const close = () => st().set({ dialog: null });
  return (
    <Modal
      title={t('wiz.title')}
      icon="magic"
      onClose={close}
      wide
      foot={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            {t('wiz.replaceHint')}
          </span>
          <button className="btn" onClick={close}>
            {t('btn.cancel')}
          </button>
          <button className="btn primary" onClick={create} data-testid="wiz-create">
            <Icon name="magic" size={15} /> {t('wiz.create')}
          </button>
        </>
      }
    >
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <label className="field-l">
            <span>{t('wiz.name')}</span>
            <input className="inp" value={par.name} placeholder={t('wiz.namePh')} onChange={(e) => up({ name: e.target.value })} />
          </label>
          <div className="field-l">
            <span>{t('wiz.event')}</span>
            <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
              {EVENTS.map((e) => (
                <button key={e} className={'card-opt' + (par.eventType === e ? ' on' : '')} onClick={() => up({ eventType: e })} type="button">
                  {t(('event.' + e) as 'event.dugun')}
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid">
            <label className="field-l">
              <span>{t('wiz.guests')}</span>
              <Num value={par.guests} onChange={(v) => up({ guests: Math.max(10, Math.round(v)) })} step={10} digits={0} unit={t('area.people')} />
            </label>
            <div className="field-l">
              <span>{t('wiz.place')}</span>
              <Seg
                value={par.indoor ? 'in' : 'out'}
                options={[
                  { v: 'in', l: t('area.indoor') },
                  { v: 'out', l: t('area.outdoor') },
                ]}
                onChange={(v) => up({ indoor: v === 'in' })}
              />
            </div>
          </div>
          <div className="field-l">
            <span>
              {t('wiz.room')} <span className="hint">({t('wiz.roomAuto', { w: auto.w, d: auto.d, h: auto.h })})</span>
            </span>
            <div className="row3">
              <Num label={t('zone.w')} value={par.w || undefined} onChange={(v) => up({ w: Math.max(0, v) })} unit="m" step={1} digits={1} />
              <Num label={t('zone.d')} value={par.d || undefined} onChange={(v) => up({ d: Math.max(0, v) })} unit="m" step={1} digits={1} />
              <Num label="H" value={par.h || undefined} onChange={(v) => up({ h: Math.max(0, v) })} unit="m" step={0.5} digits={1} />
            </div>
          </div>
          <div className="field-l">
            <span>{t('wiz.music')}</span>
            <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
              {(['dj', 'band', 'djband', 'davulzurna'] as const).map((m) => (
                <button key={m} className={'card-opt' + (par.music === m ? ' on' : '')} onClick={() => up({ music: m })} type="button">
                  <Icon name={m === 'dj' ? 'djcontroller' : m === 'band' ? 'drums' : m === 'djband' ? 'keyboard' : 'davul'} size={28} />
                  {t(('wiz.music.' + m) as 'wiz.music.dj')}
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid">
            <label className="field-l">
              <span>{t('wiz.wireless')}</span>
              <Num value={par.wirelessMics} onChange={(v) => up({ wirelessMics: Math.max(0, Math.min(8, Math.round(v))) })} step={1} digits={0} />
            </label>
            <div className="field-l">
              <span>{t('wiz.lights')}</span>
              <Seg
                value={par.lights}
                options={[
                  { v: 'none', l: t('wiz.none') },
                  { v: 'basic', l: t('wiz.basic') },
                  { v: 'full', l: t('wiz.full') },
                ]}
                onChange={(v) => up({ lights: v })}
              />
            </div>
            <div className="field-l">
              <span>{t('wiz.power')}</span>
              <select className="inp" value={par.power} onChange={(e) => up({ power: e.target.value as WizardParams['power'] })}>
                <option value="schuko">{t('wiz.power.schuko')}</option>
                <option value="cee16">{t('wiz.power.cee16')}</option>
                <option value="cee32">{t('wiz.power.cee32')}</option>
                <option value="generator">{t('wiz.power.generator')}</option>
              </select>
            </div>
            <div className="field-l">
              <span>{t('wiz.quality')}</span>
              <Seg
                value={par.quality}
                options={[
                  { v: 'compact', l: t('wiz.q.compact') },
                  { v: 'standard', l: t('wiz.q.standard') },
                  { v: 'pro', l: t('wiz.q.pro') },
                ]}
                onChange={(v) => up({ quality: v })}
              />
            </div>
          </div>
          <label className="chk">
            <input type="checkbox" checked={par.tables} onChange={(e) => up({ tables: e.target.checked })} /> {t('wiz.tables')}
          </label>
        </div>
        <div className="panel" style={{ position: 'sticky', top: 0 }}>
          <div className="panel-h">
            <Icon name="sparkles" size={16} /> {t('wiz.preview')}
          </div>
          <div className="panel-b">
            {preview ? (
              <>
                <dl className="kv">
                  <dt>{t('wiz.pv.room')}</dt>
                  <dd>
                    {preview.p.areas[0].w} × {preview.p.areas[0].d} × {preview.p.areas[0].h} m
                  </dd>
                  <dt>{t('wiz.pv.items')}</dt>
                  <dd>{preview.p.items.length}</dd>
                  <dt>{t('wiz.pv.cables')}</dt>
                  <dd>{preview.p.cables.length}</dd>
                  <dt>{t('wiz.pv.power')}</dt>
                  <dd>{fmt(preview.kw, 1, lang)} kW</dd>
                  <dt>{t('wiz.pv.spl')}</dt>
                  <dd>{preview.spl ? `${fmt(preview.spl, 0, lang)} dB` : '–'}</dd>
                </dl>
                <div style={{ marginTop: 10, maxHeight: 300, overflow: 'auto' }}>
                  {preview.bom.rows
                    .filter((r) => ['hoparlor', 'sub', 'linearray', 'monitor', 'mikser', 'islem', 'dj', 'mikrofon', 'isik', 'elektrik'].includes(r.group))
                    .map((r) => (
                      <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0', borderBottom: '1px dashed var(--line)' }}>
                        <span>{[r.brand, r.model].filter(Boolean).join(' ') || r.name}</span>
                        <b>{r.qty}×</b>
                      </div>
                    ))}
                </div>
                <p className="hint small">{t('wiz.pvHint')}</p>
              </>
            ) : (
              <p className="hint">…</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
