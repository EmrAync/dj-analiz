// Kurulumun proje yönetimi görünümü: ekip şeritli aktivite (akış) diyagramı ve zaman çizelgesi (Gantt).
import { iconMarkup } from '../../catalog/icons';
import { clock, TEAM_COLOR, TEAMS, type Activity, type ActKey, type Plan } from '../../engine/activities';
import type { TFn } from '../../i18n';

export function actTitle(a: Activity, t: TFn): string {
  if (a.id === 'dmx') return t('act.dmx');
  if (a.id === 'video') return t('act.video');
  if (a.id === 'signal') return t('act.signal');
  return t(('phase.' + a.phase) as 'phase.prep');
}

export function durText(min: number, t: TFn): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? t('act.hm', { h, m: String(m).padStart(2, '0') }) : t('act.m', { m });
}

function when(plan: Plan, min: number, t: TFn): string {
  return plan.start != null ? clock(plan.start + min) : '+' + durText(min, t);
}

const NW = 196;
const NH = 74;
const CW = 236;
const LANE_PAD = 14;

// —— Akış diyagramı ——
export function FlowDiagram({ plan, t, onOpen }: { plan: Plan; t: TFn; onOpen: (phase: string) => void }) {
  const acts = plan.acts;
  if (!acts.length) return null;
  const lanes = TEAMS.filter((tm) => acts.some((a) => a.team === tm));
  const maxLevel = Math.max(...acts.map((a) => a.level));
  // şerit içinde aynı sütundaki aktiviteler alt alta
  const slot = new Map<ActKey, number>();
  const laneRows = new Map<string, number>();
  for (const ln of lanes) {
    let rows = 1;
    for (let lv = 0; lv <= maxLevel; lv++) {
      const here = acts.filter((a) => a.team === ln && a.level === lv);
      here.forEach((a, i) => slot.set(a.id, i));
      rows = Math.max(rows, here.length);
    }
    laneRows.set(ln, rows);
  }
  const laneY = new Map<string, number>();
  let y = 0;
  for (const ln of lanes) {
    laneY.set(ln, y);
    y += laneRows.get(ln)! * (NH + 12) + LANE_PAD * 2 - 12;
  }
  const H = y;
  const X0 = 150;
  const W = X0 + (maxLevel + 1) * CW + 90;
  const pos = (a: Activity) => ({ x: X0 + a.level * CW + (CW - NW) / 2, y: laneY.get(a.team)! + LANE_PAD + slot.get(a.id)! * (NH + 12) });
  const startY = H / 2;
  const endX = W - 50;
  const edge = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.max(30, (x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };
  const leaves = acts.filter((a) => !acts.some((b) => b.deps.includes(a.id)));
  return (
    <div className="flow-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="flow" style={{ minWidth: Math.min(W, 1100) }} data-testid="flow-diagram">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--faint)" />
          </marker>
          <marker id="arr-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626" />
          </marker>
        </defs>
        {/* şeritler */}
        {lanes.map((ln, i) => {
          const ly = laneY.get(ln)!;
          const lh = laneRows.get(ln)! * (NH + 12) + LANE_PAD * 2 - 12;
          return (
            <g key={ln}>
              <rect x={0} y={ly} width={W} height={lh} fill={i % 2 ? 'var(--panel)' : 'var(--panel2)'} />
              <rect x={0} y={ly} width={6} height={lh} fill={TEAM_COLOR[ln]} />
              <text x={16} y={ly + lh / 2 + 4} fontSize={13} fontWeight={800} fill={TEAM_COLOR[ln]}>
                {t(('team.' + ln) as 'team.sound')}
              </text>
            </g>
          );
        })}
        {/* başlangıç ve bitiş */}
        <circle cx={X0 - 40} cy={startY} r={11} fill="var(--text)" />
        <text x={X0 - 40} y={startY + 26} fontSize={10.5} textAnchor="middle" fill="var(--muted)">
          {plan.start != null ? clock(plan.start) : t('act.start')}
        </text>
        <circle cx={endX} cy={startY} r={14} fill="none" stroke="var(--text)" strokeWidth={2.5} />
        <circle cx={endX} cy={startY} r={8} fill="var(--ok)" />
        <text x={endX} y={startY + 30} fontSize={10.5} textAnchor="middle" fill="var(--muted)">
          {t('act.ready')} {plan.start != null ? clock(plan.start + plan.total) : '+' + durText(plan.total, t)}
        </text>
        {/* bağlantılar */}
        {acts
          .filter((a) => !a.deps.length)
          .map((a) => {
            const q = pos(a);
            return <path key={'s' + a.id} d={edge(X0 - 29, startY, q.x - 2, q.y + NH / 2)} fill="none" stroke={a.critical ? '#dc2626' : 'var(--faint)'} strokeWidth={a.critical ? 2.4 : 1.5} markerEnd={a.critical ? 'url(#arr-c)' : 'url(#arr)'} />;
          })}
        {acts.flatMap((a) =>
          a.deps.map((d) => {
            const b = acts.find((x) => x.id === d)!;
            const p1 = pos(b);
            const p2 = pos(a);
            const crit = a.critical && b.critical && Math.abs(b.ef - a.es) < 0.5;
            return <path key={d + '>' + a.id} d={edge(p1.x + NW, p1.y + NH / 2, p2.x - 2, p2.y + NH / 2)} fill="none" stroke={crit ? '#dc2626' : 'var(--faint)'} strokeWidth={crit ? 2.4 : 1.5} markerEnd={crit ? 'url(#arr-c)' : 'url(#arr)'} />;
          }),
        )}
        {leaves.map((a) => {
          const q = pos(a);
          return <path key={'e' + a.id} d={edge(q.x + NW, q.y + NH / 2, endX - 16, startY)} fill="none" stroke={a.critical ? '#dc2626' : 'var(--faint)'} strokeWidth={a.critical ? 2.4 : 1.5} markerEnd={a.critical ? 'url(#arr-c)' : 'url(#arr)'} />;
        })}
        {/* düğümler */}
        {acts.map((a) => {
          const q = pos(a);
          const col = TEAM_COLOR[a.team];
          const pr = a.n ? a.done / a.n : 0;
          return (
            <g key={a.id} transform={`translate(${q.x} ${q.y})`} className="flow-node" onClick={() => onOpen(a.phase)} data-testid={'act-' + a.id}>
              <rect width={NW} height={NH} rx={10} fill="var(--panel)" stroke={a.critical ? '#dc2626' : 'var(--line2)'} strokeWidth={a.critical ? 2 : 1} />
              <rect width={6} height={NH} rx={3} fill={col} />
              <g transform="translate(14 10) scale(0.8)" fill="none" stroke={col} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: iconMarkup(a.icon) }} />
              <text x={46} y={22} fontSize={12.5} fontWeight={800} fill="var(--text)">
                {clip(actTitle(a, t), 21)}
              </text>
              <text x={46} y={39} fontSize={11} fill="var(--muted)">
                {t('act.jobs', { n: a.n })} · {durText(a.min, t)}
              </text>
              <text x={14} y={57} fontSize={10.5} fill="var(--muted)">
                {when(plan, a.es, t)} → {when(plan, a.ef, t)}
                {a.slack >= 5 ? ` · ${t('act.slack', { d: durText(a.slack, t) })}` : ''}
              </text>
              <rect x={14} y={NH - 10} width={NW - 28} height={4} rx={2} fill="var(--panel2)" />
              <rect x={14} y={NH - 10} width={(NW - 28) * pr} height={4} rx={2} fill="var(--ok)" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// —— Zaman çizelgesi (Gantt) ——
export function GanttChart({ plan, t, onOpen }: { plan: Plan; t: TFn; onOpen: (phase: string) => void }) {
  const acts = [...plan.acts].sort((a, b) => a.es - b.es || a.ef - b.ef);
  if (!acts.length) return null;
  const LW = 230;
  const RH = 30;
  const W = 1000;
  const top = 34;
  const end = plan.total + (plan.event != null ? plan.buffer : 0);
  const span = Math.max(30, end);
  const X = (m: number) => LW + (m / span) * (W - LW - 20);
  const H = top + acts.length * RH + 30;
  const step = span > 600 ? 120 : span > 240 ? 60 : span > 90 ? 30 : 15;
  const ticks: number[] = [];
  for (let m = 0; m <= span + 0.1; m += step) ticks.push(m);
  return (
    <div className="flow-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="flow" style={{ minWidth: 760 }} data-testid="gantt">
        {ticks.map((m) => (
          <g key={m}>
            <line x1={X(m)} x2={X(m)} y1={top - 6} y2={H - 24} stroke="var(--line)" />
            <text x={X(m)} y={top - 12} fontSize={10.5} textAnchor="middle" fill="var(--muted)">
              {when(plan, m, t)}
            </text>
          </g>
        ))}
        {acts.map((a, i) => {
          const y = top + i * RH;
          const col = TEAM_COLOR[a.team];
          const pr = a.n ? a.done / a.n : 0;
          return (
            <g key={a.id} onClick={() => onOpen(a.phase)} className="flow-node">
              {i % 2 ? <rect x={0} y={y} width={W} height={RH} fill="var(--panel2)" opacity={0.6} /> : null}
              <rect x={6} y={y + 9} width={10} height={10} rx={2} fill={col} />
              <text x={22} y={y + 18} fontSize={11.5} fontWeight={a.critical ? 800 : 600} fill="var(--text)">
                {clip(actTitle(a, t), 26)}
              </text>
              <text x={LW - 8} y={y + 18} fontSize={10.5} textAnchor="end" fill="var(--muted)">
                {durText(a.min, t)}
              </text>
              {a.slack >= 1 ? <rect x={X(a.ef)} y={y + 12} width={X(a.lf) - X(a.ef)} height={6} rx={3} fill={col} opacity={0.18} /> : null}
              <rect x={X(a.es)} y={y + 6} width={Math.max(3, X(a.ef) - X(a.es))} height={RH - 12} rx={4} fill={col} opacity={0.35} stroke={a.critical ? '#dc2626' : col} strokeWidth={a.critical ? 2 : 1} />
              <rect x={X(a.es)} y={y + 6} width={Math.max(0, (X(a.ef) - X(a.es)) * pr)} height={RH - 12} rx={4} fill={col} />
            </g>
          );
        })}
        <line x1={X(plan.total)} x2={X(plan.total)} y1={top - 4} y2={H - 22} stroke="var(--ok)" strokeWidth={2} />
        <text x={X(plan.total)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--ok)" fontWeight={700}>
          {t('act.ready')}
        </text>
        {plan.event != null ? (
          <>
            <line x1={X(end)} x2={X(end)} y1={top - 4} y2={H - 22} stroke="#db2777" strokeWidth={2} strokeDasharray="5 4" />
            <text x={X(end)} y={H - 8} fontSize={11} textAnchor="end" fill="#db2777" fontWeight={700}>
              {t('act.event')} {clock(plan.event)}
            </text>
          </>
        ) : null}
      </svg>
    </div>
  );
}
