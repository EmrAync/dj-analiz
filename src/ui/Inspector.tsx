import { useMemo } from 'react';
import { CAT_BY_ID, DEPTS } from '../catalog/categories';
import { CABLE_TYPES, CONNECTORS, DOMAINS, cableFits } from '../catalog/connectors';
import { EQUIPMENT } from '../catalog/equipment';
import { MATERIALS, suggestDelay, splPoint } from '../engine/acoustics';
import { analyzeCables, portUse, suggestCableTypes } from '../engine/cables';
import { analyzePower, ownWatt } from '../engine/power';
import { aimPoint, posText } from '../engine/setup';
import { fmt, L } from '../i18n';
import { findPort, getDef, itemBaseZ, itemDims, portLabel, portsOf } from '../model/project';
import type { Area, Cable, EquipDef, Item, MaterialId, MountType, Note, SpeakerRole, Zone, ZoneKind } from '../model/types';
import {
  applySuggestedDelay,
  autoWire,
  changeModel,
  cloneDef,
  deleteSelection,
  duplicateSelection,
  rotateSelection,
  setDefImage,
  setItemImage,
  toggleHidden,
  toggleLock,
  updateArea,
  updateCable,
  updateItem,
  updateItems,
  updateNote,
  updateZone,
  uploadImage,
} from '../store/actions';
import { pickFile } from '../store/persist';
import { st, useStore, useT } from '../store/store';
import { ZONE_KINDS, catColor, itemImage } from '../views/common';
import { Check, Icon, Num, Row, Section, Seg, Text } from './kit';

export function Inspector() {
  const open = useStore((s) => s.rightOpen);
  const sel = useStore((s) => s.sel);
  const p = useStore((s) => s.project);
  let body: JSX.Element;
  if (sel.items.length === 1) {
    const it = p.items.find((i) => i.id === sel.items[0]);
    body = it ? <ItemInspector it={it} /> : <AreaInspector />;
  } else if (sel.items.length > 1) body = <MultiInspector ids={sel.items} />;
  else if (sel.cables.length === 1) {
    const c = p.cables.find((x) => x.id === sel.cables[0]);
    body = c ? <CableInspector c={c} /> : <AreaInspector />;
  } else if (sel.zones.length === 1) {
    const z = p.zones.find((x) => x.id === sel.zones[0]);
    body = z ? <ZoneInspector z={z} /> : <AreaInspector />;
  } else if (sel.notes.length === 1) {
    const n = p.notes.find((x) => x.id === sel.notes[0]);
    body = n ? <NoteInspector n={n} /> : <AreaInspector />;
  } else body = <AreaInspector />;
  return (
    <aside className={'right' + (open ? '' : ' closed')} data-testid="inspector">
      {body}
    </aside>
  );
}

// ————————————————— Öğe —————————————————
function ItemInspector({ it }: { it: Item }) {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const installer = useStore((s) => s.installer);
  const def = getDef(p, it.defId);
  const dims = itemDims(it, def);
  const img = itemImage(p, it, def);
  const col = catColor(def);
  const area = p.areas.find((a) => a.id === it.areaId)!;
  const base = itemBaseZ(p, it);
  const up = (patch: Partial<Item>) => updateItem(it.id, patch);
  const ac = def.acoustic;
  const sameCat = useMemo(() => [...EQUIPMENT, ...p.defs].filter((d) => d.cat === def.cat), [def.cat, p.defs]);
  const title = [def.brand, def.model].filter(Boolean).join(' ');
  const pw = analyzePower(p).nodes.get(it.id);
  return (
    <div data-testid="item-inspector">
      <div className="insp-head">
        <div className="thumb" style={{ background: img ? 'var(--panel2)' : col + '18' }}>
          {img ? <img src={img} alt="" /> : <Icon name={def.icon} size={32} color={col} stroke={1.6} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <input className="inp" value={it.label} onChange={(e) => up({ label: e.target.value })} style={{ fontWeight: 700, height: 28 }} disabled={installer} data-testid="item-label" />
          <div className="meta" style={{ marginTop: 3 }}>
            {title ? <b>{title} · </b> : null}
            {L(def.name, lang)}
          </div>
        </div>
      </div>
      {!installer ? (
        <div style={{ display: 'flex', gap: 2, padding: '6px 8px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <button className="ibtn sm" title={t('act.rotL')} onClick={() => rotateSelection(-15)}>
            <Icon name="rotate" size={14} /> −15°
          </button>
          <button className="ibtn sm" title={t('act.rotR')} onClick={() => rotateSelection(15)}>
            +15°
          </button>
          <button className="ibtn sm" title={t('act.duplicate') + ' (Ctrl+D)'} onClick={() => duplicateSelection()}>
            <Icon name="copy" size={14} />
          </button>
          <button className="ibtn sm" title={t('act.mirror') + ' (Shift+M)'} onClick={() => duplicateSelection(0, 0, true)} data-testid="mirror">
            <Icon name="mirror" size={14} />
          </button>
          <button className={'ibtn sm' + (it.locked ? ' on' : '')} title={t('act.lock') + ' (L)'} onClick={toggleLock}>
            <Icon name={it.locked ? 'lock' : 'unlock'} size={14} />
          </button>
          <button className="ibtn sm" title={t('act.hide')} onClick={() => toggleHidden([it.id])}>
            <Icon name="eyeoff" size={14} />
          </button>
          <span className="spacer" />
          <button className="ibtn sm danger" title={t('act.delete') + ' (Del)'} onClick={deleteSelection} data-testid="delete">
            <Icon name="trash" size={14} />
          </button>
        </div>
      ) : null}

      <Section title={t('insp.position')} id="i-pos">
        <div className="row2">
          <Num label="X" value={it.x} onChange={(v) => up({ x: v })} unit="m" disabled={installer || it.locked} />
          <Num label="Y" value={it.y} onChange={(v) => up({ y: v })} unit="m" disabled={installer || it.locked} />
        </div>
        <div className="hint small" style={{ margin: '4px 0 6px' }}>
          {posText(t, lang, area, it.x, it.y)}
        </div>
        <Row label={t('insp.rotation')}>
          <div style={{ display: 'flex', gap: 4 }}>
            <Num value={it.rot} onChange={(v) => up({ rot: ((v % 360) + 360) % 360 })} unit="°" step={5} digits={1} disabled={installer} />
            {!installer
              ? [0, 90, 180, 270].map((a) => (
                  <button key={a} className={'ibtn sm' + (Math.round(it.rot) === a ? ' on' : '')} onClick={() => up({ rot: a })} style={{ minWidth: 30 }}>
                    {a}
                  </button>
                ))
              : null}
          </div>
        </Row>
        <Row label={t('insp.mount')}>
          <select className="inp" value={it.mount} disabled={installer} onChange={(e) => up({ mount: e.target.value as MountType, z: e.target.value === 'floor' || e.target.value === 'stage' ? 0 : it.z || def.mountH || 1.8 })}>
            {(['floor', 'stand', 'pole', 'table', 'flown', 'wall'] as MountType[]).map((m) => (
              <option key={m} value={m}>
                {t(('mount.' + m) as 'mount.floor')}
              </option>
            ))}
          </select>
        </Row>
        {it.mount !== 'floor' ? (
          <Row label={it.mount === 'flown' ? t('insp.trim') : t('insp.height')}>
            <Num value={it.z} onChange={(v) => up({ z: v })} unit="m" min={0} disabled={installer} />
          </Row>
        ) : null}
        {ac || def.cat === 'isik' ? (
          <Row label={t('insp.tilt')}>
            <Num value={it.tilt} onChange={(v) => up({ tilt: v })} unit="°" step={1} digits={1} min={-90} max={90} disabled={installer} />
          </Row>
        ) : null}
        <dl className="kv" style={{ marginTop: 6 }}>
          <dt>{t('insp.absHeight')}</dt>
          <dd>
            {fmt(base, 2, lang)} m → {fmt(base + dims.h, 2, lang)} m
          </dd>
        </dl>
      </Section>

      {ac ? <SpeakerSection it={it} def={def} /> : null}
      {def.cat === 'mikrofon' && def.icon !== 'receiver' ? (
        <Section title={t('insp.mic')} id="i-mic">
          <Row label={t('insp.channel')}>
            <Text value={it.channel} onChange={(v) => up({ channel: v })} placeholder={t('insp.channelPh')} />
          </Row>
          <Row label={t('insp.stand')}>
            <select className="inp" value={it.stand || 'none'} onChange={(e) => up({ stand: e.target.value as Item['stand'] })} disabled={installer}>
              {(['boom', 'straight', 'short', 'table', 'clip', 'none'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(('stand.' + s) as 'stand.boom')}
                </option>
              ))}
            </select>
          </Row>
          <Check checked={!!it.phantom} onChange={(v) => up({ phantom: v })}>
            {t('insp.phantom')}
          </Check>
        </Section>
      ) : null}
      {def.cat === 'enstruman' ? (
        <Section title={t('insp.instrument')} id="i-ins">
          <Row label={t('insp.channel')}>
            <Text value={it.channel} onChange={(v) => up({ channel: v })} placeholder={t('insp.channelPh')} />
          </Row>
        </Section>
      ) : null}
      {def.cat === 'hazirlik' ? (
        <Section title={t('insp.handoff')} id="i-ho">
          <div className="hint small" style={{ marginBottom: 6 }}>
            {t('insp.handoffHint')}
          </div>
          <Row label={t('insp.target')}>
            <Text value={it.target} onChange={(v) => up({ target: v })} placeholder={t('insp.targetPh')} />
          </Row>
        </Section>
      ) : null}

      <PortsSection it={it} def={def} />

      {pw && (pw.ownW > 0 || pw.children.length > 0) ? (
        <Section title={t('insp.power')} id="i-pw">
          <dl className="kv">
            <dt>{t('insp.ownW')}</dt>
            <dd>{Math.round(pw.ownW)} W</dd>
            {pw.children.length ? (
              <>
                <dt>{t('insp.downW')}</dt>
                <dd>{Math.round(pw.downW)} W</dd>
              </>
            ) : null}
            <dt>{t('insp.phase')}</dt>
            <dd>{pw.phase || '—'}</dd>
            <dt>{t('insp.fedBy')}</dt>
            <dd>{pw.rootId ? p.items.find((i) => i.id === pw.rootId)?.label : <span style={{ color: 'var(--warn)' }}>{t('insp.notFed')}</span>}</dd>
          </dl>
          {!installer && !pw.feed && portsOf(def).some((x) => x.group.domain === 'power' && x.group.dir === 'in') ? (
            <button
              className="btn sm"
              style={{ marginTop: 8 }}
              onClick={() => {
                const n = autoWire('power', true);
                st().notify(n ? t('toast.autoPower', { n }) : t('toast.noSource'), n ? 'ok' : 'warn');
              }}
            >
              <Icon name="bolt" size={13} /> {t('insp.autoPowerOne')}
            </button>
          ) : null}
        </Section>
      ) : null}

      <Section title={t('insp.image')} id="i-img" defaultOpen={false}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            className="btn sm"
            onClick={async () => {
              const f = await pickFile('image/*');
              if (!f) return;
              const a = await uploadImage(f);
              setItemImage([it.id], a.id);
            }}
            data-testid="upload-item-image"
          >
            <Icon name="image" size={13} /> {t('img.forItem')}
          </button>
          <button
            className="btn sm"
            onClick={async () => {
              const f = await pickFile('image/*');
              if (!f) return;
              const a = await uploadImage(f);
              setDefImage(def.id, a.id);
            }}
          >
            <Icon name="image" size={13} /> {t('img.forModel')}
          </button>
          {it.imageId ? (
            <button className="btn sm ghost" onClick={() => setItemImage([it.id], undefined)}>
              {t('img.remove')}
            </button>
          ) : null}
          {p.defImages[def.id] ? (
            <button className="btn sm ghost" onClick={() => setDefImage(def.id, undefined)}>
              {t('img.removeModel')}
            </button>
          ) : null}
        </div>
        <div className="hint small" style={{ marginTop: 6 }}>
          {t('img.hint')}
        </div>
      </Section>

      <Section title={t('insp.specs')} id="i-spec" defaultOpen={false}>
        {!installer ? (
          <Row label={t('insp.model')}>
            <select className="inp" value={def.id} onChange={(e) => changeModel([it.id], e.target.value)}>
              {sameCat.map((d) => (
                <option key={d.id} value={d.id}>
                  {[d.brand, d.model].filter(Boolean).join(' ') || L(d.name, lang)}
                  {d.brand ? ` — ${L(d.name, lang)}` : ''}
                </option>
              ))}
            </select>
          </Row>
        ) : null}
        <Row label={t('insp.size')}>
          <div className="row3">
            <Num value={dims.w} onChange={(v) => up({ w: v })} digits={2} disabled={installer} />
            <Num value={dims.d} onChange={(v) => up({ d: v })} digits={2} disabled={installer} />
            <Num value={it.h ?? def.h} onChange={(v) => up({ h: v })} digits={2} disabled={installer || ac?.kind === 'array'} />
          </div>
        </Row>
        <Row label={t('insp.watt')}>
          <Num value={ownWatt(p, it)} onChange={(v) => up({ watt: v })} unit="W" step={10} digits={0} min={0} disabled={installer} />
        </Row>
        <Row label={t('insp.dept')}>
          <select className="inp" value={it.dept || def.dept} onChange={(e) => up({ dept: e.target.value as Item['dept'] })} disabled={installer}>
            {DEPTS.map((d) => (
              <option key={d.id} value={d.id}>
                {L(d.name, lang)}
              </option>
            ))}
          </select>
        </Row>
        <dl className="kv" style={{ marginTop: 6 }}>
          <dt>{t('insp.category')}</dt>
          <dd>{L(CAT_BY_ID[def.cat]?.name, lang)}</dd>
          {def.kg ? (
            <>
              <dt>{t('insp.weight')}</dt>
              <dd>{fmt((def.kg || 0) * (ac?.kind === 'array' ? it.count || 1 : 1), 1, lang)} kg</dd>
            </>
          ) : null}
          {def.source ? (
            <>
              <dt>{t('insp.source')}</dt>
              <dd>
                {def.source.voltage} V · {def.source.phases === 3 ? '3~' : '1~'} · {it.breakerA ?? def.source.breakerA} A{def.source.kva ? ` · ${def.source.kva} kVA` : ''}
              </dd>
            </>
          ) : null}
        </dl>
        {def.source && !installer ? (
          <Row label={t('insp.breaker')}>
            <Num value={it.breakerA ?? def.source.breakerA} onChange={(v) => up({ breakerA: v })} unit="A" step={1} digits={0} />
          </Row>
        ) : null}
        {def.desc ? <p className="hint">{L(def.desc, lang)}</p> : null}
        {!installer ? (
          <button
            className="btn sm"
            style={{ marginTop: 6 }}
            onClick={() => {
              const nd = cloneDef(def.id, t('def.copySuffix'));
              st().set({ dialog: { kind: 'defEditor', data: { def: nd, applyTo: it.id } } });
            }}
          >
            <Icon name="gear" size={13} /> {t('insp.customize')}
          </button>
        ) : null}
      </Section>

      <Section title={t('insp.notes')} id="i-notes">
        <Text value={it.notes} onChange={(v) => up({ notes: v })} multiline placeholder={t('insp.notesPh')} />
      </Section>
    </div>
  );
}

function SpeakerSection({ it, def }: { it: Item; def: EquipDef }) {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const installer = useStore((s) => s.installer);
  const ac = def.acoustic!;
  const up = (patch: Partial<Item>) => updateItem(it.id, patch);
  const sd = suggestDelay(p, it);
  const ap = ac.kind !== 'sub' ? aimPoint(p, it) : null;
  const area = p.areas.find((a) => a.id === it.areaId)!;
  const foh = p.zones.find((z) => z.areaId === it.areaId && z.kind === 'foh');
  const fohSpl = foh ? splPoint(p, it.areaId, foh.x + foh.w / 2, foh.y + foh.d / 2) : null;
  const roles: SpeakerRole[] = ac.kind === 'sub' ? ['sub'] : ac.kind === 'monitor' ? ['monitor', 'sidefill'] : ['main', 'fill', 'delay', 'outfill', 'sidefill', 'monitor'];
  return (
    <Section title={t('insp.speaker')} id="i-spk">
      {roles.length > 1 ? (
        <Row label={t('insp.role')}>
          <select className="inp" value={it.role || roles[0]} onChange={(e) => up({ role: e.target.value as SpeakerRole })} disabled={installer}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(('role.spk.' + r) as 'role.spk.main')}
              </option>
            ))}
          </select>
        </Row>
      ) : null}
      {ac.kind === 'array' ? (
        <>
          <Row label={t('insp.elements')}>
            <Num
              value={it.count || 1}
              onChange={(v) => {
                const n = Math.max(1, Math.min(24, Math.round(v)));
                const sp = (it.splays || []).slice(0, n);
                while (sp.length < n) sp.push(sp.length ? Math.min(10, (sp[sp.length - 1] || 0) + 1) : 0);
                up({ count: n, splays: sp });
              }}
              step={1}
              digits={0}
              min={1}
              max={24}
              disabled={installer}
            />
          </Row>
          <div className="lbl hint small" style={{ margin: '6px 0 4px' }}>
            {t('insp.splays')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
            {(it.splays || []).map((s, i) =>
              i === 0 ? null : (
                <Num
                  key={i}
                  label={`${i}/${i + 1}`}
                  value={s}
                  onChange={(v) => {
                    const sp = (it.splays || []).slice();
                    sp[i] = Math.max(0, Math.min(15, v));
                    up({ splays: sp });
                  }}
                  step={0.5}
                  digits={1}
                  disabled={installer}
                />
              ),
            )}
          </div>
        </>
      ) : null}
      <div className="row2" style={{ marginTop: 6 }}>
        <Num label={t('insp.delay')} value={it.delayMs || 0} onChange={(v) => up({ delayMs: v })} unit="ms" step={0.1} digits={1} min={0} disabled={installer} />
        <Num label={t('insp.gain')} value={it.gainDb || 0} onChange={(v) => up({ gainDb: v })} unit="dB" step={0.5} digits={1} min={-40} max={12} disabled={installer} />
      </div>
      {sd != null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <span className="chip info">
            {t('insp.suggestDelay')}: {fmt(sd, 1, lang)} ms
          </span>
          {!installer ? (
            <button className="btn sm" onClick={() => applySuggestedDelay(it.id)}>
              {t('insp.apply')}
            </button>
          ) : null}
        </div>
      ) : null}
      <Check checked={it.polarity === -1} onChange={(v) => up({ polarity: v ? -1 : 1 })}>
        {t('insp.polarity')}
      </Check>
      {ap ? (
        <div className="hint small" style={{ marginTop: 6 }}>
          <b>{t('insp.aim')}:</b> {posText(t, lang, area, ap.x, ap.y)}
        </div>
      ) : null}
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>{t('spec.maxSpl')}</dt>
        <dd>{ac.maxSpl} dB</dd>
        {ac.kind !== 'sub' ? (
          <>
            <dt>{t('spec.coverage')}</dt>
            <dd>
              {ac.hDisp}° × {ac.kind === 'array' ? `${ac.vDisp}°/${t('insp.element')}` : `${ac.vDisp}°`}
            </dd>
          </>
        ) : null}
        <dt>{t('spec.freq')}</dt>
        <dd>
          {ac.fLow} Hz – {ac.fHigh >= 1000 ? `${ac.fHigh / 1000} kHz` : `${ac.fHigh} Hz`}
        </dd>
        <dt>{ac.powered ? t('spec.amp') : t('spec.handling')}</dt>
        <dd>
          {ac.ampW} W{ac.impedance ? ` · ${ac.impedance} Ω` : ''}
        </dd>
        {fohSpl && !isNaN(fohSpl.mid) ? (
          <>
            <dt>{t('insp.atFoh')}</dt>
            <dd>{fmt(fohSpl.mid, 0, lang)} dB</dd>
          </>
        ) : null}
      </dl>
    </Section>
  );
}

function PortsSection({ it, def }: { it: Item; def: EquipDef }) {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const installer = useStore((s) => s.installer);
  const used = portUse(p);
  const ports = portsOf(def);
  if (!ports.length) return null;
  const ci = analyzeCables(p);
  return (
    <Section title={`${t('insp.ports')} (${ports.filter((x) => used.has(it.id + '#' + x.id)).length}/${ports.length})`} id="i-ports">
      <div className="port-list">
        {ports.map((pi) => {
          const c = used.get(it.id + '#' + pi.id);
          const inf = c ? ci.get(c.id) : undefined;
          const other = inf ? (inf.cable.a.item === it.id && inf.cable.a.port === pi.id ? { it: inf.b, port: inf.portB } : { it: inf.a, port: inf.portA }) : null;
          const col = DOMAINS[pi.group.domain].color;
          return (
            <div key={pi.id} className="port" style={{ color: col }}>
              <span className={'dot' + (c ? ' used' : '')} />
              <span style={{ color: 'var(--text)' }}>
                {pi.group.dir === 'in' ? '⇥ ' : pi.group.dir === 'out' ? '↦ ' : '⇄ '}
                {portLabel(pi, lang)}
                <span style={{ color: 'var(--faint)', fontSize: 10.5 }}> · {CONNECTORS[pi.group.conn].short}{pi.phase ? ` · ${pi.phase}` : ''}</span>
              </span>
              {c && other ? (
                <span className="to link" onClick={() => st().select({ cables: [c.id] })} title={c.label}>
                  {c.label} → {other.it?.label}
                  {other.port ? ` · ${portLabel(other.port, lang)}` : ''}
                </span>
              ) : !installer ? (
                <button className="btn sm ghost" style={{ height: 20, padding: '0 6px', fontSize: 11 }} onClick={() => st().set({ tool: 'cable', cableDraft: { item: it.id, port: pi.id }, view: st().view === 'plan' || st().view === '3d' || st().view === 'schema' ? st().view : 'plan' })}>
                  {t('insp.connect')}
                </button>
              ) : (
                <span className="to">—</span>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ————————————————— Çoklu seçim —————————————————
function MultiInspector({ ids }: { ids: string[] }) {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const items = p.items.filter((i) => ids.includes(i.id));
  const w = items.reduce((s, i) => s + ownWatt(p, i), 0);
  const kg = items.reduce((s, i) => s + (getDef(p, i.defId).kg || 0), 0);
  const groups = new Map<string, number>();
  for (const i of items) {
    const d = getDef(p, i.defId);
    const k = [d.brand, d.model].filter(Boolean).join(' ') || L(d.name, lang);
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  return (
    <div>
      <div className="insp-head">
        <div className="thumb" style={{ background: 'var(--accent-soft)' }}>
          <Icon name="layers" size={26} color="var(--accent)" />
        </div>
        <div>
          <h3>{t('multi.title', { n: items.length })}</h3>
          <div className="meta">
            {Math.round(w)} W · {fmt(kg, 0, lang)} kg
          </div>
        </div>
      </div>
      <Section title={t('multi.actions')} id="m-act">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => duplicateSelection()}>
            <Icon name="copy" size={13} /> {t('act.duplicate')}
          </button>
          <button className="btn sm" onClick={() => duplicateSelection(0, 0, true)}>
            <Icon name="mirror" size={13} /> {t('act.mirror')}
          </button>
          <button className="btn sm" onClick={() => rotateSelection(90)}>
            <Icon name="rotate" size={13} /> 90°
          </button>
          <button className="btn sm" onClick={toggleLock}>
            <Icon name="lock" size={13} /> {t('act.lock')}
          </button>
          <button className="btn sm" onClick={() => toggleHidden(ids)}>
            <Icon name="eyeoff" size={13} /> {t('act.hide')}
          </button>
          <button
            className="btn sm"
            onClick={() => {
              const n = autoWire('power', true);
              st().notify(n ? t('toast.autoPower', { n }) : t('toast.noSource'), n ? 'ok' : 'warn');
            }}
          >
            <Icon name="bolt" size={13} /> {t('insp.autoPowerSel')}
          </button>
          <button className="btn sm danger" onClick={deleteSelection}>
            <Icon name="trash" size={13} /> {t('act.delete')}
          </button>
        </div>
      </Section>
      <Section title={t('multi.common')} id="m-common">
        <Row label={t('insp.mount')}>
          <select className="inp" value="" onChange={(e) => e.target.value && updateItems(ids, (i) => void (i.mount = e.target.value as MountType))}>
            <option value="">—</option>
            {(['floor', 'stand', 'pole', 'table', 'flown', 'wall'] as MountType[]).map((m) => (
              <option key={m} value={m}>
                {t(('mount.' + m) as 'mount.floor')}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('insp.height')}>
          <Num value={undefined} onChange={(v) => updateItems(ids, (i) => void (i.z = v))} unit="m" />
        </Row>
        <Row label={t('insp.rotation')}>
          <Num value={undefined} onChange={(v) => updateItems(ids, (i) => void (i.rot = ((v % 360) + 360) % 360))} unit="°" />
        </Row>
        <Row label={t('insp.dept')}>
          <select className="inp" value="" onChange={(e) => e.target.value && updateItems(ids, (i) => void (i.dept = e.target.value as Item['dept']))}>
            <option value="">—</option>
            {DEPTS.map((d) => (
              <option key={d.id} value={d.id}>
                {L(d.name, lang)}
              </option>
            ))}
          </select>
        </Row>
      </Section>
      <Section title={t('multi.contents')} id="m-cont">
        {[...groups].map(([k, n]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>{k}</span>
            <b>{n}×</b>
          </div>
        ))}
      </Section>
    </div>
  );
}

// ————————————————— Kablo —————————————————
function CableInspector({ c }: { c: Cable }) {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const installer = useStore((s) => s.installer);
  const inf = analyzeCables(p).get(c.id)!;
  const col = c.color || DOMAINS[inf.type.domain].color;
  const up = (patch: Partial<Cable>) => updateCable(c.id, patch);
  const types = useMemo(() => {
    if (!inf.portA || !inf.portB) return CABLE_TYPES;
    const sug = suggestCableTypes(inf.portA, inf.portB);
    const rest = CABLE_TYPES.filter((x) => !sug.includes(x));
    return [...sug, ...rest];
  }, [inf.portA, inf.portB]);
  const fits = inf.portA && inf.portB ? cableFits(inf.type, inf.portA.group.conn, inf.portB.group.conn) : true;
  const portSel = (side: 'a' | 'b') => {
    const ref = c[side];
    const item = p.items.find((i) => i.id === ref.item);
    if (!item) return null;
    const def = getDef(p, item.defId);
    return (
      <select className="inp" value={ref.port} onChange={(e) => up({ [side]: { item: ref.item, port: e.target.value } } as Partial<Cable>)} disabled={installer}>
        {portsOf(def).map((pi) => (
          <option key={pi.id} value={pi.id}>
            {portLabel(pi, lang)} ({CONNECTORS[pi.group.conn].short})
          </option>
        ))}
      </select>
    );
  };
  const a = p.items.find((i) => i.id === c.a.item);
  const b = p.items.find((i) => i.id === c.b.item);
  return (
    <div data-testid="cable-inspector">
      <div className="insp-head">
        <div className="thumb" style={{ background: col + '1a' }}>
          <Icon name="cable" size={28} color={col} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <input className="inp" value={c.label} onChange={(e) => up({ label: e.target.value })} style={{ fontWeight: 700, height: 28, fontFamily: 'var(--mono)' }} disabled={installer} />
          <div className="meta" style={{ marginTop: 3 }}>
            {L(inf.type.name, lang)}
          </div>
        </div>
      </div>
      <Section title={t('cab.route')} id="c-route">
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="lbl hint small">{t('cab.from')}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn sm" onClick={() => a && st().select({ items: [a.id] })} style={{ flex: 'none' }}>
              {a?.label || '?'}
            </button>
            {portSel('a')}
          </div>
          <div className="lbl hint small">{t('cab.to')}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn sm" onClick={() => b && st().select({ items: [b.id] })} style={{ flex: 'none' }}>
              {b?.label || '?'}
            </button>
            {portSel('b')}
          </div>
          {!installer ? (
            <button className="btn sm ghost" onClick={() => up({ a: c.b, b: c.a })}>
              ⇄ {t('cab.swap')}
            </button>
          ) : null}
        </div>
      </Section>
      <Section title={t('cab.type')} id="c-type">
        <select className="inp" value={c.type} onChange={(e) => up({ type: e.target.value })} disabled={installer} data-testid="cable-type">
          {types.map((x, i) => (
            <option key={x.id} value={x.id}>
              {i === 0 && x.id !== 'generic' ? '★ ' : ''}
              {L(x.name, lang)}
            </option>
          ))}
        </select>
        {!fits ? <div className="chip warn" style={{ marginTop: 6 }}>{t('cab.adapter')}</div> : null}
        {inf.type.desc ? <p className="hint small">{L(inf.type.desc, lang)}</p> : null}
        <Row label={t('cab.channel')}>
          <Text value={c.channel} onChange={(v) => up({ channel: v })} placeholder={t('cab.channelPh')} />
        </Row>
        <Row label={t('cab.color')}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="color" value={col} onChange={(e) => up({ color: e.target.value })} style={{ width: 40, height: 28, border: 0, background: 'none' }} disabled={installer} />
            {c.color ? (
              <button className="btn sm ghost" onClick={() => up({ color: undefined })}>
                {t('cab.colorReset')}
              </button>
            ) : null}
          </div>
        </Row>
      </Section>
      {!inf.type.wireless ? (
        <Section title={t('cab.length')} id="c-len">
          <dl className="kv">
            <dt>{t('cab.measured')}</dt>
            <dd>{inf.len3d ? fmt(inf.len3d, 1, lang) + ' m' : '—'}</dd>
            <dt>{t('cab.withSlack')}</dt>
            <dd>{inf.need ? fmt(inf.need, 1, lang) + ' m' : '—'}</dd>
            <dt>{t('cab.stock')}</dt>
            <dd>
              <b>{inf.stock ? fmt(inf.stock, inf.stock % 1 ? 1 : 0, lang) + ' m' : '—'}</b>
            </dd>
          </dl>
          <Row label={t('cab.manual')}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Num value={c.len} onChange={(v) => up({ len: v > 0 ? v : undefined })} unit="m" step={1} digits={1} min={0} disabled={installer} />
              {c.len != null ? (
                <button className="btn sm ghost" onClick={() => up({ len: undefined })}>
                  {t('cab.auto')}
                </button>
              ) : null}
            </div>
          </Row>
          {!installer ? (
            <>
              <div style={{ marginTop: 6 }}>
                <Seg
                  value={c.route === 'manual' ? 'straight' : c.route}
                  options={[
                    { v: 'ortho', l: t('cab.ortho') },
                    { v: 'straight', l: t('cab.straight') },
                  ]}
                  onChange={(v) => up({ route: v })}
                />
              </div>
              <div className="hint small" style={{ marginTop: 6 }}>
                {t('cab.ptsHint', { n: c.pts.length })}
              </div>
              {c.pts.length ? (
                <button className="btn sm ghost" onClick={() => up({ pts: [] })}>
                  {t('cab.clearPts')}
                </button>
              ) : null}
            </>
          ) : null}
          {inf.lossDb != null ? (
            <div className={'chip ' + (inf.lossDb < -0.8 ? 'warn' : 'ok')} style={{ marginTop: 6 }}>
              {t('cab.loss', { db: fmt(inf.lossDb, 2, lang) })}
            </div>
          ) : null}
          {inf.amps != null ? (
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className={'chip ' + (inf.type.ampMax && inf.amps > inf.type.ampMax ? 'err' : 'ok')}>{fmt(inf.amps, 1, lang)} A</span>
              {inf.dropPct != null ? <span className={'chip ' + (inf.dropPct > 3 ? 'warn' : 'ok')}>ΔU {fmt(inf.dropPct, 1, lang)} %</span> : null}
            </div>
          ) : null}
        </Section>
      ) : null}
      {inf.issues.length ? (
        <Section title={t('cab.issues')} id="c-iss">
          {inf.issues.map((code) => (
            <div key={code} className="chip warn" style={{ margin: '2px 0', whiteSpace: 'normal' }}>
              {t(code as 'chk.cableConn', { c: c.label, len: inf.len, max: inf.type.maxLen || 0, loss: inf.lossDb?.toFixed(1) || '', drop: inf.dropPct?.toFixed(1) || '' })}
            </div>
          ))}
        </Section>
      ) : null}
      <Section title={t('insp.notes')} id="c-notes">
        <Text value={c.notes} onChange={(v) => up({ notes: v })} multiline placeholder={t('cab.notesPh')} />
      </Section>
      {!installer ? (
        <div style={{ padding: 12 }}>
          <button className="btn sm danger" onClick={deleteSelection}>
            <Icon name="trash" size={13} /> {t('cab.delete')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ————————————————— Bölge —————————————————
function ZoneInspector({ z }: { z: Zone }) {
  const t = useT();
  const up = (patch: Partial<Zone>) => updateZone(z.id, patch);
  return (
    <div>
      <div className="insp-head">
        <div className="thumb" style={{ background: 'var(--panel2)' }}>
          <Icon name="zone" size={28} />
        </div>
        <div style={{ flex: 1 }}>
          <input className="inp" value={z.name} onChange={(e) => up({ name: e.target.value })} style={{ fontWeight: 700, height: 28 }} />
        </div>
      </div>
      <Section title={t('zone.props')} id="z-p">
        <Row label={t('zone.kind')}>
          <select className="inp" value={z.kind} onChange={(e) => up({ kind: e.target.value as ZoneKind })}>
            {ZONE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(('zone.' + k) as 'zone.stage')}
              </option>
            ))}
          </select>
        </Row>
        <div className="row2">
          <Num label="X" value={z.x} onChange={(v) => up({ x: v })} unit="m" />
          <Num label="Y" value={z.y} onChange={(v) => up({ y: v })} unit="m" />
          <Num label={t('zone.w')} value={z.w} onChange={(v) => up({ w: Math.max(0.1, v) })} unit="m" />
          <Num label={t('zone.d')} value={z.d} onChange={(v) => up({ d: Math.max(0.1, v) })} unit="m" />
        </div>
        <Row label={t('zone.elev')}>
          <Num value={z.elev} onChange={(v) => up({ elev: Math.max(0, v) })} unit="m" step={0.1} />
        </Row>
        <div className="hint small">{t(('zone.hint.' + z.kind) as 'zone.hint.stage')}</div>
        <dl className="kv" style={{ marginTop: 8 }}>
          <dt>{t('zone.area')}</dt>
          <dd>{(z.w * z.d).toFixed(1)} m²</dd>
        </dl>
      </Section>
      <div style={{ padding: 12 }}>
        <button className="btn sm danger" onClick={deleteSelection}>
          <Icon name="trash" size={13} /> {t('act.delete')}
        </button>
      </div>
    </div>
  );
}

function NoteInspector({ n }: { n: Note }) {
  const t = useT();
  return (
    <div>
      <div className="insp-head">
        <div className="thumb" style={{ background: 'var(--panel2)' }}>
          <Icon name={n.kind === 'text' ? 'text' : n.kind === 'dim' ? 'dims' : 'link'} size={26} />
        </div>
        <h3>{t(('note.' + n.kind) as 'note.text')}</h3>
      </div>
      <Section title={t('note.content')} id="n-c">
        <Text value={n.text} onChange={(v) => updateNote(n.id, { text: v })} multiline />
        <Row label={t('cab.color')}>
          <input type="color" value={n.color || '#1c2430'} onChange={(e) => updateNote(n.id, { color: e.target.value })} style={{ width: 40, height: 28, border: 0, background: 'none' }} />
        </Row>
      </Section>
      <div style={{ padding: 12 }}>
        <button className="btn sm danger" onClick={deleteSelection}>
          <Icon name="trash" size={13} /> {t('act.delete')}
        </button>
      </div>
    </div>
  );
}

// ————————————————— Bölüm (seçim yok) —————————————————
function AreaInspector() {
  const t = useT();
  const p = useStore((s) => s.project);
  const areaId = useStore((s) => s.areaId);
  const installer = useStore((s) => s.installer);
  const area = p.areas.find((a) => a.id === areaId) || p.areas[0];
  return (
    <div>
      <div className="insp-head">
        <div className="thumb" style={{ background: 'var(--accent-soft)' }}>
          <Icon name={area.indoor ? 'house' : 'tree'} size={26} color="var(--accent)" />
        </div>
        <div>
          <h3>{area.name}</h3>
          <div className="meta">{t('insp.areaHint')}</div>
        </div>
      </div>
      {!installer ? (
        <Section title={t('insp.quick')} id="a-q">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className="btn sm"
              onClick={() => {
                const n = autoWire('signal');
                st().notify(n ? t('toast.autoSignal', { n }) : t('toast.nothing'), n ? 'ok' : 'warn');
              }}
              data-testid="auto-signal"
            >
              <Icon name="cable" size={13} /> {t('insp.autoSignal')}
            </button>
            <button
              className="btn sm"
              onClick={() => {
                const n = autoWire('power');
                st().notify(n ? t('toast.autoPower', { n }) : t('toast.nothing'), n ? 'ok' : 'warn');
              }}
              data-testid="auto-power"
            >
              <Icon name="bolt" size={13} /> {t('insp.autoPower')}
            </button>
          </div>
          <div className="hint small" style={{ marginTop: 6 }}>
            {t('insp.autoHint')}
          </div>
        </Section>
      ) : null}
      <AreaForm area={area} />
    </div>
  );
}

export function AreaForm({ area }: { area: Area }) {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const installer = useStore((s) => s.installer);
  const up = (patch: Partial<Area>) => updateArea(area.id, patch);
  const bgAsset = area.bg ? p.assets[area.bg.assetId] : undefined;
  const mats = Object.keys(MATERIALS) as MaterialId[];
  return (
    <>
      <Section title={t('area.dims')} id="a-dims">
        <Row label={t('area.name')}>
          <Text value={area.name} onChange={(v) => up({ name: v })} />
        </Row>
        <div className="row3">
          <Num label={t('zone.w')} value={area.w} onChange={(v) => up({ w: Math.max(2, v) })} unit="m" step={0.5} disabled={installer} />
          <Num label={t('zone.d')} value={area.d} onChange={(v) => up({ d: Math.max(2, v) })} unit="m" step={0.5} disabled={installer} />
          <Num label="H" value={area.h} onChange={(v) => up({ h: Math.max(2, v) })} unit="m" step={0.5} disabled={installer} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Seg
            value={area.indoor ? 'in' : 'out'}
            options={[
              { v: 'in', l: t('area.indoor') },
              { v: 'out', l: t('area.outdoor') },
            ]}
            onChange={(v) => up(v === 'in' ? { indoor: true, floor: area.floor === 'acik' ? 'parke' : area.floor, walls: area.walls === 'acik' ? 'siva' : area.walls, ceiling: area.ceiling === 'acik' ? 'siva' : area.ceiling } : { indoor: false })}
          />
        </div>
        <Row label={t('area.guests')}>
          <Num value={area.guests} onChange={(v) => up({ guests: Math.max(0, Math.round(v)) })} step={10} digits={0} unit={t('area.people')} />
        </Row>
      </Section>
      {area.indoor ? (
        <Section title={t('area.materials')} id="a-mat" defaultOpen={false}>
          {(['floor', 'walls', 'ceiling'] as const).map((k) => (
            <Row key={k} label={t(('area.' + k) as 'area.floor')}>
              <select className="inp" value={area[k]} onChange={(e) => up({ [k]: e.target.value as MaterialId })}>
                {mats.map((m) => (
                  <option key={m} value={m}>
                    {L(MATERIALS[m].name, lang)}
                  </option>
                ))}
              </select>
            </Row>
          ))}
          <div className="row2">
            <Num label={t('area.glass')} value={area.glassPct} onChange={(v) => up({ glassPct: Math.max(0, Math.min(100, v)) })} unit="%" step={5} digits={0} />
            <Num label={t('area.curtain')} value={area.curtainPct} onChange={(v) => up({ curtainPct: Math.max(0, Math.min(100, v)) })} unit="%" step={5} digits={0} />
          </div>
        </Section>
      ) : null}
      <Section title={t('area.bg')} id="a-bg" defaultOpen={false}>
        <div className="hint small" style={{ marginBottom: 6 }}>
          {t('area.bgHint')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            className="btn sm"
            onClick={async () => {
              const f = await pickFile('image/*');
              if (!f) return;
              const a = await uploadImage(f);
              up({ bg: { assetId: a.id, x: 0, y: 0, w: area.w, opacity: 0.5 } });
            }}
          >
            <Icon name="upload" size={13} /> {t('area.bgUpload')}
          </button>
          {area.bg ? (
            <button className="btn sm ghost" onClick={() => up({ bg: undefined })}>
              {t('img.remove')}
            </button>
          ) : null}
        </div>
        {area.bg && bgAsset ? (
          <>
            <div className="row3" style={{ marginTop: 8 }}>
              <Num label="X" value={area.bg.x} onChange={(v) => up({ bg: { ...area.bg!, x: v } })} unit="m" />
              <Num label="Y" value={area.bg.y} onChange={(v) => up({ bg: { ...area.bg!, y: v } })} unit="m" />
              <Num label={t('zone.w')} value={area.bg.w} onChange={(v) => up({ bg: { ...area.bg!, w: Math.max(0.5, v) } })} unit="m" />
            </div>
            <Row label={t('area.opacity')}>
              <input type="range" min={0.1} max={1} step={0.05} value={area.bg.opacity} onChange={(e) => up({ bg: { ...area.bg!, opacity: Number(e.target.value) } })} style={{ width: '100%' }} />
            </Row>
          </>
        ) : null}
      </Section>
      <Section title={t('insp.notes')} id="a-notes" defaultOpen={false}>
        <Text value={area.notes} onChange={(v) => up({ notes: v })} multiline />
      </Section>
    </>
  );
}

export { findPort };
