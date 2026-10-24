// Kayıtlı salonlar: kaydet, projeye ekle, sil
import { useState } from 'react';
import { fmt } from '../i18n';
import { addVenue, deleteVenue, saveVenue } from '../store/venueActions';
import { st, useStore, useT } from '../store/store';
import { Check, Icon, Section } from './kit';

export function SaveVenueForm({ areaId, onDone }: { areaId: string; onDone: () => void }) {
  const t = useT();
  const area = useStore((s) => s.project.areas.find((a) => a.id === areaId));
  const venue = useStore((s) => s.project.meta.venue);
  const [name, setName] = useState(venue || area?.name || '');
  const [gear, setGear] = useState(false);
  if (!area) return null;
  return (
    <div className="venue-form" data-testid="venue-form">
      <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('venue.namePh')} autoFocus />
      <Check checked={gear} onChange={setGear}>
        {t('venue.withGear')}
      </Check>
      <div className="hint small">{gear ? t('venue.gearHint') : t('venue.onlyHint')}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="btn sm primary"
          disabled={!name.trim()}
          onClick={async () => {
            const v = await saveVenue(areaId, name.trim(), gear);
            if (v) st().notify(t('venue.saved', { n: v.name }));
            onDone();
          }}
          data-testid="venue-save"
        >
          <Icon name="save" size={13} /> {t('venue.save')}
        </button>
        <button className="btn sm ghost" onClick={onDone}>
          {t('btn.cancel')}
        </button>
      </div>
    </div>
  );
}

export function VenueList() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const venues = useStore((s) => s.library.venues);
  const installer = useStore((s) => s.installer);
  return (
    <Section title={`${t('venue.title')} (${venues.length})`} id="l-venues">
      {!venues.length ? <div className="hint small">{t('venue.empty')}</div> : null}
      {venues.map((v) => (
        <div key={v.id} className="venue-row" data-testid="venue-row">
          <Icon name="venue" size={20} color="var(--accent)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{v.name}</b>
            <div className="hint small">
              {fmt(v.area.w, 1, lang)} × {fmt(v.area.d, 1, lang)} m · {v.zones.length} {t('venue.zones')}
              {v.variants.length ? ` · ⚡ ${v.variants.map((g) => g.variants.map((x) => x.label).join('/')).join(', ')}` : ''}
              {v.gear ? ` · ${v.items.length} ${t('area.items')}` : ''}
            </div>
          </div>
          {!installer ? (
            <>
              <button className="btn sm" onClick={() => addVenue(v)} data-testid="venue-add">
                <Icon name="plus" size={13} /> {t('venue.add')}
              </button>
              <button className="ibtn sm danger" title={t('act.delete')} onClick={() => confirm(t('venue.deleteQ', { n: v.name })) && deleteVenue(v.id)}>
                <Icon name="trash" size={13} />
              </button>
            </>
          ) : null}
        </div>
      ))}
    </Section>
  );
}
