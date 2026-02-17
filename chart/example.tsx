"use client";

import { useState } from "react";
import { TradingChart, type PricePoint, type ChartMarker } from "./trading-chart";

function generateSampleData(points = 200): PricePoint[] {
	const now = Math.floor(Date.now() / 1000);
	const data: PricePoint[] = [];
	let price = 0.00015;

	for (let i = 0; i < points; i++) {
		const change = (Math.random() - 0.48) * price * 0.06;
		price = Math.max(price + change, 0.0000001);

		data.push({
			timestamp: now - (points - i) * 60,
			price,
		});
	}

	return data;
}

function generateSampleMarkers(data: PricePoint[]): ChartMarker[] {
	const markers: ChartMarker[] = [];
	const markerIndices = [30, 75, 120, 160];

	for (const i of markerIndices) {
		if (i < data.length) {
			markers.push({
				timestamp: data[i].timestamp,
				price: data[i].price,
				type: Math.random() > 0.5 ? "buy" : "sell",
			});
		}
	}

	return markers;
}

export default function TradingChartExample() {
	const [sampleData] = useState(() => generateSampleData(200));
	const [markers] = useState(() => generateSampleMarkers(sampleData));
	const [selectedPrice, setSelectedPrice] = useState<PricePoint | null>(null);

	const currentPrice = sampleData[sampleData.length - 1]?.price ?? 0;
	const currentMcap = currentPrice * 1_000_000_000;

	return (
		<div className="min-h-screen bg-neutral-50 p-8">
			<div className="max-w-4xl mx-auto space-y-6">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">
						TradingChart Demo
					</h1>
					<p className="text-neutral-500 mt-1">
						A GPU-accelerated price chart built with PixiJS and React.
					</p>
				</div>

				<div className="flex items-baseline gap-3">
					<span className="text-3xl font-mono font-bold">
						${selectedPrice ? selectedPrice.price.toPrecision(4) : currentPrice.toPrecision(4)}
					</span>
					{selectedPrice && (
						<span className="text-sm text-neutral-400 font-mono">
							{new Date(selectedPrice.timestamp * 1000).toLocaleString()}
						</span>
					)}
				</div>

				<div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
					<div className="h-[400px]">
						<TradingChart
							data={sampleData}
							markers={markers}
							onPriceSelect={setSelectedPrice}
							currentMcap={currentMcap}
							currentPrice={currentPrice}
						/>
					</div>
				</div>

				<div>
					<h2 className="text-lg font-semibold mb-2">Minimal (no labels, no grid)</h2>
					<div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
						<div className="h-[200px]">
							<TradingChart
								data={sampleData}
								showAxisLabels={false}
								showGrid={false}
								lineColor="#6366f1"
							/>
						</div>
					</div>
				</div>

				<div>
					<h2 className="text-lg font-semibold mb-2">Custom colors</h2>
					<div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
						<div className="h-[250px]">
							<TradingChart
								data={sampleData}
								lineColor="#22c55e"
								gridColor="#f0fdf4"
								crosshairColor="#86efac"
							/>
						</div>
					</div>
				</div>

				<div>
					<h2 className="text-lg font-semibold mb-2">Loading state</h2>
					<div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
						<div className="h-[200px]">
							<TradingChart
								data={sampleData}
								isLoading={true}
							/>
						</div>
					</div>
				</div>

				<div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-4">
					<h2 className="text-lg font-semibold">Props Reference</h2>
					<div className="font-mono text-sm space-y-2 text-neutral-700">
						<div><span className="text-blue-600">data</span>: PricePoint[] — <span className="text-neutral-400">array of {"{ timestamp, price }"}</span></div>
						<div><span className="text-blue-600">markers?</span>: ChartMarker[] — <span className="text-neutral-400">buy/sell indicators</span></div>
						<div><span className="text-blue-600">lineColor?</span>: string — <span className="text-neutral-400">hex color for the line (default: "#09090b")</span></div>
						<div><span className="text-blue-600">gridColor?</span>: string — <span className="text-neutral-400">hex color for grid lines (default: "#f4f4f5")</span></div>
						<div><span className="text-blue-600">crosshairColor?</span>: string — <span className="text-neutral-400">hex color for crosshair (default: "#a1a1aa")</span></div>
						<div><span className="text-blue-600">className?</span>: string — <span className="text-neutral-400">extra CSS classes on the wrapper</span></div>
						<div><span className="text-blue-600">showAxisLabels?</span>: boolean — <span className="text-neutral-400">show Y-axis price labels (default: true)</span></div>
						<div><span className="text-blue-600">showGrid?</span>: boolean — <span className="text-neutral-400">show horizontal grid lines (default: true)</span></div>
						<div><span className="text-blue-600">onPriceSelect?</span>: (point | null) =&gt; void — <span className="text-neutral-400">called when user hovers/touches a point</span></div>
						<div><span className="text-blue-600">currentMcap?</span>: number — <span className="text-neutral-400">current market cap (for tooltip MCAP calc)</span></div>
						<div><span className="text-blue-600">currentPrice?</span>: number — <span className="text-neutral-400">current price (for tooltip MCAP ratio)</span></div>
						<div><span className="text-blue-600">isLoading?</span>: boolean — <span className="text-neutral-400">show loading overlay (default: false)</span></div>
					</div>
				</div>
			</div>
		</div>
	);
}
