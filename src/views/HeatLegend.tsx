import { splColor } from '../engine/acoustics';
import { st, useStore, useT } from '../store/store';
import { Seg } from '../ui/kit';

export function HeatLegend() {
  const t = useT();
  const heat = useStore((s) => s.heat);
  const target = useStore((s) => s.project.settings.targetSpl);
  const dev = heat.mode === 'dev' && heat.band === 'mid';
  const stops = Array.from({ length: 9 }, (_, i) => {
    const L = target - 18 + (24 * i) / 8;
    const [r, g, b] = splColor(L, target);
    return `rgb(${r},${g},${b}) ${(i / 8) * 100}%`;
  });
  const devStops = ['#1e40af', '#3898ec', '#7dd3fc', '#22c55e', '#facc15', '#f97316', '#dc2626'];
  return (
    <div className="legend" data-testid="heat-legend">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <b style={{ fontSize: 11 }}>{t('heat.title')}</b>
        <span className="hint small">{heat.band === 'mid' ? t('heat.midNote') : `${heat.freq} Hz${heat.coherent ? ' · ' + t('heat.phase') : ''}`}</span>
      </div>
      <Seg
        value={heat.band === 'mid' ? 'mid' : String(heat.freq)}
        options={[
          { v: 'mid', l: t('heat.mid') },
          { v: '40', l: '40 Hz' },
          { v: '63', l: '63 Hz' },
          { v: '100', l: '100 Hz' },
        ]}
        onChange={(v) => st().set({ heat: v === 'mid' ? { ...heat, band: 'mid' } : { ...heat, band: 'low', freq: Number(v) } })}
      />
      {heat.band === 'mid' ? (
        <div style={{ marginTop: 5 }}>
          <Seg
            value={heat.mode || 'abs'}
            options={[
              { v: 'abs', l: t('heat.abs') },
              { v: 'dev', l: t('heat.dev'), title: t('heat.devHint') },
            ]}
            onChange={(v) => st().set({ heat: { ...heat, mode: v } })}
          />
        </div>
      ) : null}
      {dev ? (
        <>
          <div className="bar" style={{ background: `linear-gradient(90deg, ${devStops.join(',')})` }} />
          <div className="scale">
            <span>−12</span>
            <span>−6</span>
            <span>
              <b>{t('cov.onTarget')}</b>
            </span>
            <span>+6</span>
            <span>+12 dB</span>
          </div>
        </>
      ) : (
        <>
          <div className="bar" style={{ background: `linear-gradient(90deg, ${stops.join(',')})` }} />
          <div className="scale">
            <span>{target - 18}</span>
            <span>{target - 12}</span>
            <span>{target - 6}</span>
            <span>
              <b>{target}</b>
            </span>
            <span>{target + 6} dB</span>
          </div>
        </>
      )}
    </div>
  );
}
