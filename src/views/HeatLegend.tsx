import { splColor } from '../engine/acoustics';
import { st, useStore, useT } from '../store/store';
import { Seg } from '../ui/kit';

export function HeatLegend() {
  const t = useT();
  const heat = useStore((s) => s.heat);
  const target = useStore((s) => s.project.settings.targetSpl);
  const stops = Array.from({ length: 9 }, (_, i) => {
    const L = target - 18 + (24 * i) / 8;
    const [r, g, b] = splColor(L, target);
    return `rgb(${r},${g},${b}) ${(i / 8) * 100}%`;
  });
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
    </div>
  );
}
