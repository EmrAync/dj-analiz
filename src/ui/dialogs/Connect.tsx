import { useMemo, useState } from 'react';
import { CONNECTORS, DOMAINS, cableFits } from '../../catalog/connectors';
import { bestPortPair, portUse, suggestCableTypes } from '../../engine/cables';
import { L } from '../../i18n';
import { getDef, portLabel, portsOf } from '../../model/project';
import type { PortInst } from '../../model/types';
import { connect, updateCable } from '../../store/actions';
import { st, useStore, useT } from '../../store/store';
import { Icon, Modal } from '../kit';

export function ConnectDialog({ a, ap, b }: { a: string; ap?: string; b: string }) {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const A = p.items.find((i) => i.id === a);
  const B = p.items.find((i) => i.id === b);
  const used = portUse(p);
  const defA = A ? getDef(p, A.defId) : undefined;
  const defB = B ? getDef(p, B.defId) : undefined;
  const initial = useMemo(() => {
    if (!A || !B || !defA || !defB) return { pa: '', pb: '' };
    if (ap) {
      const pa = portsOf(defA).find((x) => x.id === ap)!;
      const cand = portsOf(defB).filter((x) => !used.has(B.id + '#' + x.id) && suggestCableTypes(pa, x)[0].id !== 'generic' && (x.group.domain === pa.group.domain || pa.group.domain === 'digital' || pa.group.domain === 'network'));
      const pb = cand.find((x) => x.group.dir !== pa.group.dir || x.group.dir === 'io') || cand[0];
      return { pa: ap, pb: pb?.id || '' };
    }
    const best = bestPortPair(p, A, B) || (() => {
      const r = bestPortPair(p, B, A);
      return r ? { pa: r.pb, pb: r.pa } : null;
    })();
    return { pa: best?.pa.id || '', pb: best?.pb.id || '' };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [pa, setPa] = useState(initial.pa);
  const [pb, setPb] = useState(initial.pb);
  const [channel, setChannel] = useState('');
  const PA = defA ? portsOf(defA).find((x) => x.id === pa) : undefined;
  const PB = defB ? portsOf(defB).find((x) => x.id === pb) : undefined;
  const types = PA && PB ? suggestCableTypes(PA, PB) : [];
  const [type, setType] = useState<string>('');
  const typeId = type && types.some((x) => x.id === type) ? type : types[0]?.id || 'generic';
  const close = () => st().set({ dialog: null });
  if (!A || !B || !defA || !defB) return null;
  const doConnect = () => {
    if (!PA || !PB) return;
    const id = connect(A.id, PA.id, B.id, PB.id, typeId);
    if (id && channel) updateCable(id, { channel });
    st().set({ dialog: null, tool: 'cable' });
    if (id) st().notify(t('toast.connected', { c: st().project.cables.find((c) => c.id === id)?.label || '' }));
  };
  // uyumsuz portları soluk göster
  const col = (x: PortInst, other?: PortInst) => (!other ? 1 : suggestCableTypes(other, x)[0].id === 'generic' ? 0.35 : 1);
  return (
    <Modal
      title={t('con.title')}
      icon="cable"
      onClose={close}
      wide
      foot={
        <>
          <button className="btn" onClick={close}>
            {t('btn.cancel')}
          </button>
          <button className="btn primary" disabled={!PA || !PB} onClick={doConnect} data-testid="con-ok">
            <Icon name="cable" size={15} /> {t('con.connect')}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <PortPicker title={`${A.label} · ${[defA.brand, defA.model].filter(Boolean).join(' ') || L(defA.name, lang)}`} ports={portsOf(defA)} value={pa} onChange={setPa} usedFn={(x) => used.has(A.id + '#' + x.id)} lang={lang} dim={(x) => col(x, PB)} />
        <PortPicker title={`${B.label} · ${[defB.brand, defB.model].filter(Boolean).join(' ') || L(defB.name, lang)}`} ports={portsOf(defB)} value={pb} onChange={setPb} usedFn={(x) => used.has(B.id + '#' + x.id)} lang={lang} dim={(x) => col(x, PA)} />
      </div>
      <div className="form-grid" style={{ marginTop: 14 }}>
        <label className="field-l">
          <span>{t('cab.type')}</span>
          <select className="inp" value={typeId} onChange={(e) => setType(e.target.value)}>
            {types.map((x, i) => (
              <option key={x.id} value={x.id}>
                {i === 0 ? '★ ' : ''}
                {L(x.name, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className="field-l">
          <span>{t('cab.channel')}</span>
          <input className="inp" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder={t('cab.channelPh')} />
        </label>
      </div>
      {PA && PB ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="chip" style={{ color: DOMAINS[PA.group.domain].color }}>
            {L(DOMAINS[PA.group.domain].name, lang)}
          </span>
          <span>
            {portLabel(PA, lang)} ({CONNECTORS[PA.group.conn].short}) → {portLabel(PB, lang)} ({CONNECTORS[PB.group.conn].short})
          </span>
          {PA.group.domain !== PB.group.domain && !(['digital', 'network'].includes(PA.group.domain) && ['digital', 'network'].includes(PB.group.domain)) ? <span className="chip err">{t('con.domainMismatch')}</span> : null}
          {PA.group.dir === PB.group.dir && PA.group.dir !== 'io' ? <span className="chip warn">{t('con.sameDir')}</span> : null}
          {types[0] && !cableFits(types.find((x) => x.id === typeId) || types[0], PA.group.conn, PB.group.conn) ? <span className="chip warn">{t('cab.adapter')}</span> : null}
        </div>
      ) : (
        <p className="hint">{t('con.pick')}</p>
      )}
    </Modal>
  );
}

function PortPicker({ title, ports, value, onChange, usedFn, lang, dim }: { title: string; ports: PortInst[]; value: string; onChange: (v: string) => void; usedFn: (p: PortInst) => boolean; lang: 'tr' | 'de' | 'en'; dim: (p: PortInst) => number }) {
  return (
    <div className="panel">
      <div className="panel-h" style={{ fontSize: 13 }}>
        {title}
      </div>
      <div style={{ maxHeight: 320, overflow: 'auto', padding: 4 }}>
        {ports.map((x) => {
          const u = usedFn(x);
          const col = DOMAINS[x.group.domain].color;
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => onChange(x.id)}
              className="port"
              style={{ width: '100%', border: value === x.id ? '1.5px solid var(--accent)' : '1.5px solid transparent', background: value === x.id ? 'var(--accent-soft)' : 'transparent', color: col, opacity: dim(x), cursor: 'pointer', textAlign: 'left' }}
            >
              <span className={'dot' + (u ? ' used' : '')} />
              <span style={{ color: 'var(--text)' }}>
                {x.group.dir === 'in' ? '⇥ ' : x.group.dir === 'out' ? '↦ ' : '⇄ '}
                {portLabel(x, lang)}
              </span>
              <span className="to">
                {CONNECTORS[x.group.conn].short}
                {u ? ' · ●' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
