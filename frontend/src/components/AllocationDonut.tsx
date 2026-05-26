import { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, Sector } from 'recharts';
import { formatMoney } from '../utils/format';

interface Props {
  title: string;
  data: Record<string, number>;
  /** When more than `maxSlices` non-zero entries are present, collapse the tail into "Others". */
  maxSlices?: number;
  /** Show inline percentage labels on each slice. */
  showLabels?: boolean;
  /** Hide the legend below the chart (useful when many slices). */
  hideLegend?: boolean;
}

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#ec4899', '#0ea5e9', '#d946ef', '#14b8a6', '#f97316', '#64748b'];

// Slightly enlarged sector when hovered, with the security name + percentage rendered
// in the donut hole so it stays legible regardless of how thin the slice is.
const renderActiveShape = (props: unknown) => {
  const p = props as {
    cx: number; cy: number; innerRadius: number; outerRadius: number;
    startAngle: number; endAngle: number; fill: string;
    payload: { name: string }; percent: number; value: number;
  };
  return (
    <g>
      <text x={p.cx} y={p.cy - 8} dy={0} textAnchor="middle" fill="#0f172a" fontSize={12} fontWeight={600}>
        {p.payload.name.length > 28 ? p.payload.name.slice(0, 26) + '…' : p.payload.name}
      </text>
      <text x={p.cx} y={p.cy + 10} textAnchor="middle" fill="#475569" fontSize={11}>
        {formatMoney(p.value)} · {(p.percent * 100).toFixed(1)}%
      </text>
      <Sector
        cx={p.cx} cy={p.cy}
        innerRadius={p.innerRadius} outerRadius={p.outerRadius + 6}
        startAngle={p.startAngle} endAngle={p.endAngle}
        fill={p.fill}
      />
    </g>
  );
};

export default function AllocationDonut({ title, data, maxSlices = 0, showLabels = true, hideLegend = false }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  const entries = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  let items: { name: string; value: number }[] = entries;
  if (maxSlices > 0 && entries.length > maxSlices) {
    const head = entries.slice(0, maxSlices - 1);
    const tail = entries.slice(maxSlices - 1);
    const tailSum = tail.reduce((s, e) => s + e.value, 0);
    items = [...head, { name: `Others (${tail.length})`, value: tailSum }];
  }
  items = items.map((i) => ({ name: i.name, value: Math.round(i.value) }));

  if (items.length === 0) {
    return (
      <div className="card">
        <h2 className="font-semibold mb-2">{title}</h2>
        <p className="text-sm text-slate-500">No data yet.</p>
      </div>
    );
  }
  const total = items.reduce((s, i) => s + i.value, 0);

  const renderLabel = ({
    cx, cy, midAngle, innerRadius, outerRadius, percent,
  }: { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number }) => {
    if (!showLabels || percent < 0.05) return null;
    const RAD = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) * 0.55;
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    return (
      <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
        {(percent * 100).toFixed(1)}%
      </text>
    );
  };

  return (
    <div className="card h-full">
      <h2 className="font-semibold mb-2">{title}</h2>
      <div className={hideLegend ? 'h-72' : 'h-64'}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              dataKey="value"
              nameKey="name"
              innerRadius={hideLegend ? 65 : 55}
              outerRadius={hideLegend ? 100 : 90}
              paddingAngle={1}
              label={activeIndex === undefined ? renderLabel : false}
              labelLine={false}
              isAnimationActive={false}
              activeIndex={activeIndex}
              activeShape={renderActiveShape}
              onMouseEnter={(_, idx) => setActiveIndex(idx)}
              onMouseLeave={() => setActiveIndex(undefined)}
            >
              {items.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip
              formatter={(v: number, name) => [`${formatMoney(v)} (${total ? ((v / total) * 100).toFixed(1) : '0'}%)`, name]}
              wrapperStyle={{ outline: 'none' }}
            />
            {!hideLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
