"use client";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, BarChart, Bar,
} from "recharts";

const NAVY = "#0F172A";
const LAVENDER = "#7C6CFC";
const LILAC = "#B89CFF";
const PEACH = "#FFB997";
const GRID = "#E7E3EF";
const tick = { fill: "#5B6478", fontSize: 12 };

export function FiveDRadar({ data }: { data: { name: string; now: number | null; before: number | null }[] }) {
  const hasBefore = data.some((d) => d.before !== null);
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data.map((d) => ({ ...d, now: d.now ?? 0, before: d.before ?? 0 }))} outerRadius="66%" margin={{ left: 24, right: 24 }}>
        <PolarGrid stroke={GRID} />
        <PolarAngleAxis dataKey="name" tick={{ ...tick, fill: NAVY, fontWeight: 600 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        {hasBefore && <Radar name="Прошлая диагностика" dataKey="before" stroke={LILAC} fill={LILAC} fillOpacity={0.12} strokeDasharray="4 4" />}
        <Radar name="Текущая" dataKey="now" stroke={LAVENDER} fill={LAVENDER} fillOpacity={0.3} strokeWidth={2} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Tooltip formatter={(v) => (v === 0 ? "нет данных" : v)} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

const DIM_COLORS: Record<string, string> = {
  CUSTOMER: LAVENDER, TEAM: PEACH, LEADERSHIP: "#4F8EF7", STANDARDS: "#49A87C", BUSINESS_RESULTS: NAVY,
};

export function SsiHistory({ data, dimNames }: { data: { label: string; ssi: number | null; [k: string]: number | null | string }[]; dimNames: Record<string, string> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={tick} />
        <YAxis domain={[0, 100]} tick={tick} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="ssi" name="SSI" stroke={NAVY} strokeWidth={3} dot={{ r: 4 }} connectNulls={false} />
        {Object.entries(dimNames).map(([k, n]) => (
          <Line key={k} type="monotone" dataKey={k} name={n} stroke={DIM_COLORS[k]} strokeWidth={1.5} dot={{ r: 2 }} strokeOpacity={0.8} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RevenueChart({ data }: { data: { label: string; fact: number | null; forecast: number | null }[] }) {
  const fmt = (v: number) => `${Math.round(v / 1000).toLocaleString("ru-RU")} тыс.`;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={tick} />
        <YAxis tickFormatter={fmt} tick={tick} width={72} />
        <Tooltip formatter={(v) => (typeof v === "number" ? `${v.toLocaleString("ru-RU")} ₽` : v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="fact" name="Факт" fill={LAVENDER} radius={[6, 6, 0, 0]} />
        <Bar dataKey="forecast" name="Прогноз" fill={PEACH} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBars({ data, max = 5 }: { data: { name: string; value: number }[]; max?: number }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" domain={[0, max]} tick={tick} />
        <YAxis type="category" dataKey="name" width={170} tick={{ ...tick, fill: NAVY }} />
        <Tooltip />
        <Bar dataKey="value" name="Средняя оценка" fill={LAVENDER} radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
