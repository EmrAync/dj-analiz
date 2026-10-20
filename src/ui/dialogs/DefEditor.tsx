import { useState } from 'react';
import { CATEGORIES, DEPTS } from '../../catalog/categories';
import { CONNECTORS, DOMAINS, DOMAIN_ORDER } from '../../catalog/connectors';
import { ICONS } from '../../catalog/icons';
import { L } from '../../i18n';
import { uid } from '../../model/project';
import type { AcousticKind, Asset, CatId, ConnFamily, Dept, Domain, EquipDef, MountType, PortDir, PortGroup } from '../../model/types';
import { changeModel, saveCustomDef } from '../../store/actions';
import { imageToAsset, pickFile } from '../../store/persist';
import { st, useStore, useT } from '../../store/store';
import { Icon, Modal, Num, Section } from '../kit';

const SHAPES = ['box', 'speaker', 'sub', 'wedge', 'array', 'column', 'console', 'rack', 'djcontroller', 'djplayer', 'djmixer', 'laptop', 'turntable', 'mic', 'person', 'pipe', 'string', 'guitar', 'keyboard', 'drumkit', 'davul', 'darbuka', 'piano', 'ampcombo', 'movinghead', 'par', 'ledbar', 'tbar', 'truss', 'trusstower', 'ledwall', 'screen', 'tv', 'camera', 'projector', 'distro', 'generator', 'deck', 'table', 'roundtable', 'sofa', 'backdrop', 'arch', 'tie', 'external', 'djbooth', 'rackcase', 'pillar', 'wall', 'door'];

function blank(): EquipDef {
  return {
    id: uid('cd'),
    cat: 'hoparlor',
    dept: 'ses',
    name: { tr: 'Yeni malzeme', de: 'Neues Gerät', en: 'New item' },
    icon: 'box',
    shape: 'box',
    w: 0.5,
    d: 0.4,
    h: 0.5,
    kg: 10,
    ports: [],
    mount: 'floor',
    custom: true,
  };
}

export function DefEditor({ def: initial, applyTo }: { def?: EquipDef; applyTo?: string }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const p = useStore((s) => s.project);
  const [d, setD] = useState<EquipDef>(() => (initial ? JSON.parse(JSON.stringify(initial)) : blank()));
  const [asset, setAsset] = useState<Asset | undefined>(() => (initial?.imageId ? p.assets[initial.imageId] : undefined));
  const up = (patch: Partial<EquipDef>) => setD((x) => ({ ...x, ...patch }));
  const name = typeof d.name === 'string' ? { tr: d.name } : d.name;
  const setName = (k: 'tr' | 'de' | 'en', v: string) => up({ name: { ...name, [k]: v } as EquipDef['name'] });
  const close = () => st().set({ dialog: null });
  const save = async () => {
    const def: EquipDef = { ...d, custom: true };
    if (asset) {
      def.imageId = asset.id;
      st().mutate((dd) => {
        dd.assets[asset.id] = asset;
      });
    }
    await saveCustomDef(def, asset);
    if (applyTo) changeModel([applyTo], def.id);
    st().set({ dialog: null });
    st().notify(t('def.saved'));
  };
  const setPort = (i: number, patch: Partial<PortGroup>) => up({ ports: d.ports.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  const ac = d.acoustic;
  return (
    <Modal
      title={initial ? t('def.editTitle') : t('def.newTitle')}
      icon="gear"
      onClose={close}
      wide
      foot={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            {t('def.libHint')}
          </span>
          <button className="btn" onClick={close}>
            {t('btn.cancel')}
          </button>
          <button className="btn primary" onClick={save} data-testid="def-save">
            <Icon name="save" size={15} /> {t('btn.save')}
          </button>
        </>
      }
    >
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <label className="field-l">
            <span>{t('def.nameTr')}</span>
            <input className="inp" value={name.tr} onChange={(e) => setName('tr', e.target.value)} data-testid="def-name" />
          </label>
          <div className="form-grid">
            <label className="field-l">
              <span>Deutsch</span>
              <input className="inp" value={(name as { de?: string }).de || ''} onChange={(e) => setName('de', e.target.value)} />
            </label>
            <label className="field-l">
              <span>English</span>
              <input className="inp" value={(name as { en?: string }).en || ''} onChange={(e) => setName('en', e.target.value)} />
            </label>
            <label className="field-l">
              <span>{t('col.brand')}</span>
              <input className="inp" value={d.brand || ''} onChange={(e) => up({ brand: e.target.value || undefined })} />
            </label>
            <label className="field-l">
              <span>{t('col.model')}</span>
              <input className="inp" value={d.model || ''} onChange={(e) => up({ model: e.target.value || undefined })} />
            </label>
            <label className="field-l">
              <span>{t('insp.category')}</span>
              <select className="inp" value={d.cat} onChange={(e) => up({ cat: e.target.value as CatId })}>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {L(c.name, lang)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-l">
              <span>{t('insp.dept')}</span>
              <select className="inp" value={d.dept} onChange={(e) => up({ dept: e.target.value as Dept })}>
                {DEPTS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {L(c.name, lang)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field-l">
            <span>{t('def.size')}</span>
            <div className="row3">
              <Num label={t('zone.w')} value={d.w} onChange={(v) => up({ w: Math.max(0.01, v) })} unit="m" />
              <Num label={t('zone.d')} value={d.d} onChange={(v) => up({ d: Math.max(0.01, v) })} unit="m" />
              <Num label="H" value={d.h} onChange={(v) => up({ h: Math.max(0.01, v) })} unit="m" />
            </div>
          </div>
          <div className="row3">
            <Num label="kg" value={d.kg} onChange={(v) => up({ kg: Math.max(0, v) })} step={0.5} digits={1} />
            <Num label="W" value={d.watt} onChange={(v) => up({ watt: Math.max(0, v) })} step={10} digits={0} />
            <select className="inp" value={d.mount || 'floor'} onChange={(e) => up({ mount: e.target.value as MountType })} title={t('insp.mount')}>
              {(['floor', 'stand', 'pole', 'table', 'flown', 'wall'] as MountType[]).map((m) => (
                <option key={m} value={m}>
                  {t(('mount.' + m) as 'mount.floor')}
                </option>
              ))}
            </select>
          </div>
          {d.mount && d.mount !== 'floor' ? <Num label={t('insp.height')} value={d.mountH} onChange={(v) => up({ mountH: Math.max(0, v) })} unit="m" /> : null}
          <label className="field-l">
            <span>{t('def.shape')}</span>
            <select className="inp" value={d.shape} onChange={(e) => up({ shape: e.target.value })}>
              {SHAPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field-l">
            <span>{t('def.desc')}</span>
            <textarea className="inp" rows={2} value={typeof d.desc === 'string' ? d.desc : d.desc?.tr || ''} onChange={(e) => up({ desc: e.target.value || undefined })} />
          </label>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="field-l">
            <span>{t('def.icon')}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <div style={{ width: 56, height: 56, borderRadius: 10, background: 'var(--panel2)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>{asset ? <img src={asset.data} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <Icon name={d.icon} size={40} color="var(--accent)" />}</div>
              <button
                className="btn sm"
                onClick={async () => {
                  const f = await pickFile('image/*');
                  if (f) setAsset(await imageToAsset(f));
                }}
              >
                <Icon name="image" size={13} /> {t('def.uploadImage')}
              </button>
              {asset ? (
                <button className="btn sm ghost" onClick={() => setAsset(undefined)}>
                  {t('img.remove')}
                </button>
              ) : null}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(34px, 1fr))', gap: 3, maxHeight: 150, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 4 }}>
              {Object.keys(ICONS).map((k) => (
                <button key={k} type="button" title={k} className={'ibtn sm' + (d.icon === k ? ' on' : '')} style={{ height: 32 }} onClick={() => up({ icon: k })}>
                  <Icon name={k} size={20} />
                </button>
              ))}
            </div>
          </div>
          <Section title={t('def.acoustic')} id="d-ac" defaultOpen={!!ac}>
            <label className="chk">
              <input type="checkbox" checked={!!ac} onChange={(e) => up({ acoustic: e.target.checked ? { kind: 'top', maxSpl: 128, hDisp: 90, vDisp: 60, fLow: 50, fHigh: 20000, powered: true, ampW: 1000 } : undefined })} /> {t('def.isSpeaker')}
            </label>
            {ac ? (
              <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                <select className="inp" value={ac.kind} onChange={(e) => up({ acoustic: { ...ac, kind: e.target.value as AcousticKind } })}>
                  {(['top', 'sub', 'monitor', 'array', 'column', 'fill'] as AcousticKind[]).map((k) => (
                    <option key={k} value={k}>
                      {t(('def.kind.' + k) as 'def.kind.top')}
                    </option>
                  ))}
                </select>
                <div className="row3">
                  <Num label="SPL" value={ac.maxSpl} onChange={(v) => up({ acoustic: { ...ac, maxSpl: v } })} unit="dB" step={1} digits={0} />
                  <Num label="H°" value={ac.hDisp} onChange={(v) => up({ acoustic: { ...ac, hDisp: v } })} step={5} digits={0} />
                  <Num label="V°" value={ac.vDisp} onChange={(v) => up({ acoustic: { ...ac, vDisp: v } })} step={5} digits={0} />
                  <Num label="Hz" value={ac.fLow} onChange={(v) => up({ acoustic: { ...ac, fLow: v } })} step={1} digits={0} />
                  <Num label="W" value={ac.ampW} onChange={(v) => up({ acoustic: { ...ac, ampW: v } })} step={50} digits={0} />
                  <Num label="Ω" value={ac.impedance} onChange={(v) => up({ acoustic: { ...ac, impedance: v } })} step={1} digits={0} />
                </div>
                <label className="chk">
                  <input type="checkbox" checked={ac.powered} onChange={(e) => up({ acoustic: { ...ac, powered: e.target.checked } })} /> {t('def.powered')}
                </label>
              </div>
            ) : null}
          </Section>
          <Section title={t('def.source')} id="d-src" defaultOpen={!!d.source}>
            <label className="chk">
              <input type="checkbox" checked={!!d.source} onChange={(e) => up({ source: e.target.checked ? { voltage: 230, breakerA: 16, phases: 1 } : undefined })} /> {t('def.isSource')}
            </label>
            {d.source ? (
              <div className="row3" style={{ marginTop: 6 }}>
                <select className="inp" value={d.source.voltage} onChange={(e) => up({ source: { ...d.source!, voltage: Number(e.target.value) as 230 | 400, phases: Number(e.target.value) === 400 ? 3 : 1 } })}>
                  <option value={230}>230 V</option>
                  <option value={400}>400 V 3~</option>
                </select>
                <Num label="A" value={d.source.breakerA} onChange={(v) => up({ source: { ...d.source!, breakerA: v } })} step={1} digits={0} />
                <Num label="kVA" value={d.source.kva} onChange={(v) => up({ source: { ...d.source!, kva: v || undefined } })} step={1} digits={0} />
              </div>
            ) : null}
          </Section>
        </div>
      </div>
      <Section title={`${t('insp.ports')} (${d.ports.reduce((s, g) => s + (g.count || 1), 0)})`} id="d-ports">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('def.portName')}</th>
                <th>{t('def.conn')}</th>
                <th>{t('def.dir')}</th>
                <th>{t('def.domain')}</th>
                <th>{t('def.count')}</th>
                <th>{t('def.names')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {d.ports.map((g, i) => (
                <tr key={i}>
                  <td>
                    <input className="inp" value={typeof g.name === 'string' ? g.name : g.name.tr} onChange={(e) => setPort(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <select className="inp" value={g.conn} onChange={(e) => setPort(i, { conn: e.target.value as ConnFamily })}>
                      {(Object.keys(CONNECTORS) as ConnFamily[]).map((c) => (
                        <option key={c} value={c}>
                          {L(CONNECTORS[c].name, lang)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="inp" value={g.dir} onChange={(e) => setPort(i, { dir: e.target.value as PortDir })}>
                      <option value="in">{t('def.in')}</option>
                      <option value="out">{t('def.out')}</option>
                      <option value="io">{t('def.io')}</option>
                    </select>
                  </td>
                  <td>
                    <select className="inp" value={g.domain} onChange={(e) => setPort(i, { domain: e.target.value as Domain })}>
                      {DOMAIN_ORDER.map((x) => (
                        <option key={x} value={x}>
                          {L(DOMAINS[x].name, lang)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ width: 70 }}>
                    <Num value={g.count || 1} onChange={(v) => setPort(i, { count: Math.max(1, Math.min(96, Math.round(v))) })} step={1} digits={0} />
                  </td>
                  <td>
                    <input className="inp" value={(g.names || []).join(',')} placeholder="L,R" onChange={(e) => setPort(i, { names: e.target.value ? e.target.value.split(',').map((x) => x.trim()) : undefined })} />
                  </td>
                  <td>
                    <button className="ibtn sm danger" onClick={() => up({ ports: d.ports.filter((_, j) => j !== i) })}>
                      <Icon name="trash" size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn sm" onClick={() => up({ ports: [...d.ports, { key: 'p' + Math.random().toString(36).slice(2, 6), name: t('def.newPort'), conn: 'xlr', dir: 'in', domain: 'audio' }] })}>
            <Icon name="plus" size={13} /> {t('def.addPort')}
          </button>
          <button className="btn sm" onClick={() => up({ ports: [...d.ports, { key: 'pwr', name: t('def.pwrIn'), conn: 'schuko', dir: 'in', domain: 'power' }] })}>
            <Icon name="bolt" size={13} /> {t('def.addPower')}
          </button>
        </div>
      </Section>
    </Modal>
  );
}
