"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { MarketSeries } from "@earnd/contracts";

// Step lines model the auction truthfully: a clearing price holds until the next
// clear. uPlot is ~40KB canvas, dynamically imported client-only by MarketBoard.
const COLORS = ["#FF7A1A", "#E9E6DA", "#8A8F82", "#A77B4E", "#6FA0C0", "#C06F9C", "#9CC06F", "#C0B06F"];
const GRID = "#1E241B";
const AXIS = "#565B50";

function buildData(series: MarketSeries[]): { data: uPlot.AlignedData; labels: string[] } {
  const tset = new Set<number>();
  for (const s of series) for (const p of s.points) tset.add(Math.floor(p.t / 1000));
  const xs = [...tset].sort((a, b) => a - b);
  const idx = new Map(xs.map((t, i) => [t, i]));
  const ys = series.map((s) => {
    const arr: (number | null)[] = new Array(xs.length).fill(null);
    for (const p of s.points) {
      const i = idx.get(Math.floor(p.t / 1000));
      if (i != null) arr[i] = p.cpmMillicents / 100_000; // millicents → dollars
    }
    return arr;
  });
  return { data: [xs, ...ys] as unknown as uPlot.AlignedData, labels: series.map((s) => s.advertiser) };
}

export default function BidChart({ series }: { series: MarketSeries[] }) {
  const elRef = useRef<HTMLDivElement>(null);
  const uRef = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const { data, labels } = buildData(series);
    const width = el.clientWidth || 720;

    const opts: uPlot.Options = {
      width,
      height: 320,
      padding: [16, 8, 0, 8],
      legend: { show: true },
      cursor: { y: false, points: { size: 7 } },
      scales: { x: { time: true } },
      axes: [
        {
          stroke: AXIS,
          grid: { stroke: GRID, width: 1 },
          ticks: { stroke: GRID },
          font: "11px var(--font-jetbrains-mono, monospace)",
        },
        {
          stroke: AXIS,
          grid: { stroke: GRID, width: 1 },
          ticks: { stroke: GRID },
          font: "11px var(--font-jetbrains-mono, monospace)",
          size: 56,
          values: (_u, vals) => vals.map((v) => `$${v.toFixed(2)}`),
        },
      ],
      series: [
        {},
        ...labels.map((label, i) => ({
          label,
          stroke: COLORS[i % COLORS.length],
          width: 2,
          paths: uPlot.paths.stepped!({ align: 1 }),
          points: { show: false },
          value: (_u: uPlot, v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`),
        })),
      ],
    };

    uRef.current?.destroy();
    uRef.current = new uPlot(opts, data, el);

    const ro = new ResizeObserver(() => {
      if (uRef.current && el.clientWidth) uRef.current.setSize({ width: el.clientWidth, height: 320 });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      uRef.current?.destroy();
      uRef.current = null;
    };
  }, [series]);

  return <div ref={elRef} className="uplot-earnd w-full" />;
}
