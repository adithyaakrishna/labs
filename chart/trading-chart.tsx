"use client";

import {
	Application,
	Container,
	Graphics,
	Sprite,
	Text,
	TextStyle,
	Texture,
} from "pixi.js";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

export interface PricePoint {
	timestamp: number;
	price: number;
}

export interface ChartMarker {
	timestamp: number;
	price: number;
	type: "buy" | "sell";
	label?: string;
}

interface TradingChartProps {
	data: PricePoint[];
	markers?: ChartMarker[];
	lineColor?: string;
	gridColor?: string;
	crosshairColor?: string;
	className?: string;
	showAxisLabels?: boolean;
	showGrid?: boolean;
	onPriceSelect?: (point: PricePoint | null) => void;
	currentMcap?: number;
	currentPrice?: number;
	isLoading?: boolean;
}

const Y_STEPS = 5;
const Y_SMOOTHING = 0.15;
const LONG_PRESS_DELAY = 300;
const DASH_LENGTH = 4;
const GAP_LENGTH = 4;

const MARKER_UP_COLOR = 0x22c55e;
const MARKER_DOWN_COLOR = 0xef4444;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function triggerHaptic(style: "light" | "medium" | "heavy" = "light") {
	if (typeof navigator !== "undefined" && "vibrate" in navigator) {
		const duration = style === "light" ? 10 : style === "medium" ? 20 : 30;
		navigator.vibrate(duration);
	}
}

function formatPrice(price: number): string {
	if (price === 0) return "0";
	if (price >= 10000)
		return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
	if (price >= 100) return price.toFixed(2);
	if (price >= 1) return price.toFixed(4);
	const str = price.toFixed(20);
	const match = str.match(/^0\.(0+)(\d{4})/);
	if (match) {
		return `0.0(${match[1].length})${match[2]}`;
	}
	return price.toPrecision(4);
}

function formatCurrencyCompact(value: number): string {
	if (value === 0) return "$0";
	if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
	if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
	if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
	return `$${value.toFixed(2)}`;
}

function formatTimestamp(timestamp: number): string {
	return new Date(timestamp * 1000).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

const hexColorCache = new Map<string, number>();
function hexToNumber(hex: string): number {
	let result = hexColorCache.get(hex);
	if (result === undefined) {
		result = Number.parseInt(hex.replace("#", ""), 16);
		hexColorCache.set(hex, result);
	}
	return result;
}

interface Padding {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

const PADDING_WITH_LABELS: Padding = {
	top: 20,
	right: 60,
	bottom: 30,
	left: 10,
};
const PADDING_WITHOUT_LABELS: Padding = {
	top: 10,
	right: 10,
	bottom: 10,
	left: 10,
};

export function TradingChart({
	data: rawData,
	markers = [],
	lineColor = "#09090b",
	gridColor = "#f4f4f5",
	crosshairColor = "#a1a1aa",
	className = "",
	showAxisLabels = true,
	showGrid = true,
	onPriceSelect,
	currentMcap,
	currentPrice,
	isLoading = false,
}: TradingChartProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const pixiContainerRef = useRef<HTMLDivElement>(null);
	const appRef = useRef<Application | null>(null);
	const animationRef = useRef<number>(0);
	const isInitializedRef = useRef(false);
	const [isPixiReady, setIsPixiReady] = useState(false);

	const graphicsRef = useRef<{
		chartLayer: Graphics | null;
		overlayLayer: Graphics | null;
		gridLayer: Graphics | null;
		labelsContainer: Container | null;
		tooltipContainer: Container | null;
		gradientSprite: Sprite | null;
		gradientMask: Graphics | null;
	}>({
		chartLayer: null,
		overlayLayer: null,
		gridLayer: null,
		labelsContainer: null,
		tooltipContainer: null,
		gradientSprite: null,
		gradientMask: null,
	});

	const gradientCacheRef = useRef<{
		texture: Texture | null;
		width: number;
		height: number;
		color: string;
	}>({
		texture: null,
		width: 0,
		height: 0,
		color: "",
	});

	const textStylesRef = useRef<{
		label: TextStyle | null;
		timestamp: TextStyle | null;
		value: TextStyle | null;
		mcap: TextStyle | null;
	}>({
		label: null,
		timestamp: null,
		value: null,
		mcap: null,
	});

	const getTextStyles = useCallback(() => {
		if (!textStylesRef.current.label) {
			textStylesRef.current = {
				label: new TextStyle({
					fontFamily: "monospace",
					fontSize: 11,
					fill: "#71717a",
				}),
				timestamp: new TextStyle({
					fontFamily: "monospace",
					fontSize: 10,
					fill: "#71717a",
				}),
				value: new TextStyle({
					fontFamily: "monospace",
					fontSize: 12,
					fill: "#09090b",
				}),
				mcap: new TextStyle({
					fontFamily: "monospace",
					fontSize: 12,
					fill: "#71717a",
				}),
			};
		}
		return textStylesRef.current as {
			label: TextStyle;
			timestamp: TextStyle;
			value: TextStyle;
			mcap: TextStyle;
		};
	}, []);

	const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

	const yAxisRef = useRef({
		min: 0,
		max: 1,
		targetMin: 0,
		targetMax: 1,
	});

	const interactionRef = useRef({
		isLongPress: false,
		longPressTimer: null as ReturnType<typeof setTimeout> | null,
		crosshairX: -1,
		crosshairY: -1,
		selectedIndex: -1,
	});

	const data = useMemo(() => {
		if (!rawData || rawData.length === 0) return [];
		return rawData.map((p) => ({
			timestamp: p.timestamp,
			price: p.price,
		}));
	}, [rawData]);

	const padding = useMemo<Padding>(
		() => (showAxisLabels ? PADDING_WITH_LABELS : PADDING_WITHOUT_LABELS),
		[showAxisLabels],
	);

	const colors = useMemo(
		() => ({
			line: hexToNumber(lineColor),
			grid: hexToNumber(gridColor),
			crosshair: hexToNumber(crosshairColor),
		}),
		[lineColor, gridColor, crosshairColor],
	);

	useLayoutEffect(() => {
		if (!containerRef.current) return;

		const updateDimensions = () => {
			if (!containerRef.current) return;
			const rect = containerRef.current.getBoundingClientRect();
			setDimensions({ width: rect.width, height: rect.height });
		};

		updateDimensions();

		const observer = new ResizeObserver(updateDimensions);
		observer.observe(containerRef.current);

		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (
			!pixiContainerRef.current ||
			dimensions.width === 0 ||
			dimensions.height === 0
		)
			return;
		if (isInitializedRef.current) return;

		let mounted = true;

		const initPixi = async () => {
			const app = new Application();

			await app.init({
				width: dimensions.width,
				height: dimensions.height,
				background: "#ffffff",
				antialias: true,
				resolution: window.devicePixelRatio || 1,
				autoDensity: true,
			});

			if (!mounted || !pixiContainerRef.current || isInitializedRef.current) {
				app.destroy(true);
				return;
			}

			pixiContainerRef.current.appendChild(app.canvas);
			appRef.current = app;
			isInitializedRef.current = true;

			const gridLayer = new Graphics();
			const gradientSprite = new Sprite();
			const gradientMask = new Graphics();
			const chartLayer = new Graphics();
			const overlayLayer = new Graphics();
			const labelsContainer = new Container();
			const tooltipContainer = new Container();

			gradientSprite.mask = gradientMask;

			app.stage.addChild(gridLayer);
			app.stage.addChild(gradientSprite);
			app.stage.addChild(gradientMask);
			app.stage.addChild(chartLayer);
			app.stage.addChild(labelsContainer);
			app.stage.addChild(overlayLayer);
			app.stage.addChild(tooltipContainer);

			graphicsRef.current = {
				gridLayer,
				chartLayer,
				overlayLayer,
				labelsContainer,
				tooltipContainer,
				gradientSprite,
				gradientMask,
			};

			setIsPixiReady(true);
		};

		initPixi();

		return () => {
			mounted = false;
			if (appRef.current) {
				appRef.current.destroy(true, { children: true });
				appRef.current = null;
				isInitializedRef.current = false;
				setIsPixiReady(false);
			}
			if (gradientCacheRef.current.texture) {
				gradientCacheRef.current.texture.destroy(true);
				gradientCacheRef.current = {
					texture: null,
					width: 0,
					height: 0,
					color: "",
				};
			}
		};
	}, [dimensions.width, dimensions.height]);

	useEffect(() => {
		if (!appRef.current || dimensions.width === 0 || dimensions.height === 0)
			return;
		appRef.current.renderer.resize(dimensions.width, dimensions.height);
	}, [dimensions]);

	const calculateYBounds = useCallback((chartData: PricePoint[]) => {
		if (chartData.length === 0) return { min: 0, max: 1 };

		let min = Infinity;
		let max = -Infinity;

		for (let i = 0; i < chartData.length; i++) {
			const point = chartData[i];
			if (point.price < min) min = point.price;
			if (point.price > max) max = point.price;
		}

		if (min === max || Math.abs(max - min) < Number.EPSILON) {
			const value = min;
			const p = value > 0 ? value * 0.1 : 0.0000001;
			return { min: value - p, max: value + p };
		}

		const range = max - min;
		const rangePadding = range * 0.1;

		return {
			min: min - rangePadding,
			max: max + rangePadding,
		};
	}, []);

	const getGradientTexture = useCallback(
		(w: number, h: number, color: string): Texture | null => {
			const cache = gradientCacheRef.current;

			if (
				cache.texture &&
				cache.width === w &&
				cache.height === h &&
				cache.color === color
			) {
				return cache.texture;
			}

			if (cache.texture) {
				cache.texture.destroy(true);
			}

			const canvas = document.createElement("canvas");
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext("2d");
			if (!ctx) return null;

			const gradient = ctx.createLinearGradient(0, 0, 0, h);
			gradient.addColorStop(0, `${color}40`);
			gradient.addColorStop(0.2, `${color}30`);
			gradient.addColorStop(0.4, `${color}20`);
			gradient.addColorStop(0.6, `${color}10`);
			gradient.addColorStop(0.8, `${color}08`);
			gradient.addColorStop(1, `${color}00`);

			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, w, h);

			const texture = Texture.from(canvas);

			gradientCacheRef.current = { texture, width: w, height: h, color };

			return texture;
		},
		[],
	);

	const render = useCallback(() => {
		const app = appRef.current;
		const {
			chartLayer,
			overlayLayer,
			gridLayer,
			labelsContainer,
			tooltipContainer,
			gradientSprite,
			gradientMask,
		} = graphicsRef.current;

		if (
			!app ||
			!chartLayer ||
			!overlayLayer ||
			!gridLayer ||
			!labelsContainer ||
			!tooltipContainer ||
			!gradientSprite ||
			!gradientMask
		)
			return;

		const { width, height } = dimensions;
		if (width === 0 || height === 0) return;

		chartLayer.clear();
		overlayLayer.clear();
		gridLayer.clear();
		gradientMask.clear();
		labelsContainer.removeChildren();
		tooltipContainer.removeChildren();

		if (data.length === 0) return;

		const yAxis = yAxisRef.current;
		const interaction = interactionRef.current;

		const chartWidth = width - padding.left - padding.right;
		const chartHeight = height - padding.top - padding.bottom;

		yAxis.min = lerp(yAxis.min, yAxis.targetMin, Y_SMOOTHING);
		yAxis.max = lerp(yAxis.max, yAxis.targetMax, Y_SMOOTHING);

		const pointSpacing = data.length > 1 ? chartWidth / (data.length - 1) : 0;

		const yRange = yAxis.max - yAxis.min || 1;
		const yScale = chartHeight / yRange;

		const priceToY = (price: number) =>
			padding.top + chartHeight - (price - yAxis.min) * yScale;

		const indexToX = (index: number) => padding.left + index * pointSpacing;

		if (showGrid) {
			gridLayer.setStrokeStyle({ width: 1, color: colors.grid });
			const yStepHeight = chartHeight / Y_STEPS;
			for (let i = 0; i <= Y_STEPS; i++) {
				const y = padding.top + yStepHeight * i;
				gridLayer.moveTo(padding.left, y);
				gridLayer.lineTo(width - padding.right, y);
			}
			gridLayer.stroke();
		}

		const gradientTexture = getGradientTexture(width, chartHeight, lineColor);
		if (gradientTexture) {
			gradientSprite.texture = gradientTexture;
			gradientSprite.position.set(0, padding.top);
			gradientSprite.width = width;
			gradientSprite.height = chartHeight;
		}

		const firstX = indexToX(0);
		const firstY = priceToY(data[0].price);
		gradientMask.moveTo(firstX, firstY);

		for (let i = 0; i < data.length; i++) {
			gradientMask.lineTo(indexToX(i), priceToY(data[i].price));
		}

		const lastX = indexToX(data.length - 1);
		gradientMask.lineTo(lastX, height - padding.bottom);
		gradientMask.lineTo(firstX, height - padding.bottom);
		gradientMask.closePath();
		gradientMask.fill(0xffffff);

		chartLayer.setStrokeStyle({
			width: 2,
			color: colors.line,
			cap: "round",
			join: "round",
		});
		chartLayer.moveTo(firstX, firstY);

		for (let i = 1; i < data.length; i++) {
			chartLayer.lineTo(indexToX(i), priceToY(data[i].price));
		}
		chartLayer.stroke();

		if (data.length > 0) {
			const lastPoint = data[data.length - 1];
			const dotX = indexToX(data.length - 1);
			const dotY = priceToY(lastPoint.price);
			chartLayer.circle(dotX, dotY, 5);
			chartLayer.fill(colors.line);
		}

		if (markers.length > 0) {
			for (const marker of markers) {
				const index = data.findIndex((d) => d.timestamp === marker.timestamp);
				if (index < 0) continue;

				const x = indexToX(index);
				const y = priceToY(marker.price);
				const markerColor =
					marker.type === "buy" ? MARKER_UP_COLOR : MARKER_DOWN_COLOR;

				if (marker.type === "buy") {
					chartLayer.moveTo(x, y - 12);
					chartLayer.lineTo(x - 8, y + 4);
					chartLayer.lineTo(x + 8, y + 4);
				} else {
					chartLayer.moveTo(x, y + 12);
					chartLayer.lineTo(x - 8, y - 4);
					chartLayer.lineTo(x + 8, y - 4);
				}
				chartLayer.closePath();
				chartLayer.fill(markerColor);
			}
		}

		if (showAxisLabels) {
			const styles = getTextStyles();
			const yStepHeight = chartHeight / Y_STEPS;
			const priceStep = (yAxis.max - yAxis.min) / Y_STEPS;

			for (let i = 0; i <= Y_STEPS; i++) {
				const price = yAxis.max - priceStep * i;
				const y = padding.top + yStepHeight * i;

				const label = new Text({
					text: formatPrice(price),
					style: styles.label,
				});
				label.anchor.set(1, 0.5);
				label.position.set(width - 8, y);
				labelsContainer.addChild(label);
			}
		}

		if (interaction.crosshairX >= 0 && interaction.selectedIndex >= 0) {
			const selectedPoint = data[interaction.selectedIndex];
			if (selectedPoint) {
				const x = indexToX(interaction.selectedIndex);
				const y = priceToY(selectedPoint.price);
				const chartBottom = height - padding.bottom;
				const chartRight = width - padding.right;

				overlayLayer.setStrokeStyle({
					width: 1,
					color: colors.crosshair,
				});

				for (
					let py = padding.top;
					py < chartBottom;
					py += DASH_LENGTH + GAP_LENGTH
				) {
					overlayLayer.moveTo(x, py);
					overlayLayer.lineTo(x, Math.min(py + DASH_LENGTH, chartBottom));
				}
				overlayLayer.stroke();

				for (
					let px = padding.left;
					px < chartRight;
					px += DASH_LENGTH + GAP_LENGTH
				) {
					overlayLayer.moveTo(px, y);
					overlayLayer.lineTo(Math.min(px + DASH_LENGTH, chartRight), y);
				}
				overlayLayer.stroke();

				if (interaction.isLongPress) {
					overlayLayer.circle(x, y, 8);
					overlayLayer.fill({ color: colors.line, alpha: 0.25 });
					overlayLayer.circle(x, y, 4);
					overlayLayer.fill(colors.line);
				}

				let mcap: number | undefined;
				if (currentMcap && currentPrice && currentPrice > 0) {
					mcap = currentMcap * (selectedPoint.price / currentPrice);
				}

				const tooltipWidth = 130;
				const tooltipHeight = mcap ? 65 : 50;

				const flipTooltip = x > width - tooltipWidth - 30;
				const tooltipX = flipTooltip
					? Math.max(10, x - tooltipWidth - 15)
					: Math.min(x + 15, width - tooltipWidth - 10);
				const tooltipY = clamp(
					y - tooltipHeight / 2,
					10,
					height - tooltipHeight - 10,
				);

				overlayLayer.roundRect(
					tooltipX,
					tooltipY,
					tooltipWidth,
					tooltipHeight,
					6,
				);
				overlayLayer.fill({ color: 0xffffff, alpha: 0.97 });
				overlayLayer.setStrokeStyle({ width: 1, color: 0xe5e5e5 });
				overlayLayer.stroke();

				const styles = getTextStyles();

				const timestampText = new Text({
					text: formatTimestamp(selectedPoint.timestamp),
					style: styles.timestamp,
				});
				timestampText.position.set(tooltipX + 8, tooltipY + 6);
				tooltipContainer.addChild(timestampText);

				const priceText = new Text({
					text: `$${formatPrice(selectedPoint.price)}`,
					style: styles.value,
				});
				priceText.position.set(tooltipX + 8, tooltipY + 26);
				tooltipContainer.addChild(priceText);

				if (mcap) {
					const mcapText = new Text({
						text: `MCAP: ${formatCurrencyCompact(mcap)}`,
						style: styles.mcap,
					});
					mcapText.position.set(tooltipX + 8, tooltipY + 42);
					tooltipContainer.addChild(mcapText);
				}
			}
		}

		app.render();

		const needsAnimation =
			Math.abs(yAxis.min - yAxis.targetMin) > 0.0001 ||
			Math.abs(yAxis.max - yAxis.targetMax) > 0.0001;

		if (needsAnimation) {
			animationRef.current = requestAnimationFrame(render);
		}
	}, [
		data,
		dimensions,
		markers,
		lineColor,
		colors,
		padding,
		showAxisLabels,
		showGrid,
		currentMcap,
		currentPrice,
		getGradientTexture,
		getTextStyles,
		calculateYBounds,
	]);

	useEffect(() => {
		if (!isPixiReady || dimensions.width === 0 || dimensions.height === 0)
			return;

		const interaction = interactionRef.current;
		interaction.crosshairX = -1;
		interaction.crosshairY = -1;
		interaction.selectedIndex = -1;

		const bounds = calculateYBounds(data);
		const yAxis = yAxisRef.current;
		yAxis.min = bounds.min;
		yAxis.max = bounds.max;
		yAxis.targetMin = bounds.min;
		yAxis.targetMax = bounds.max;

		render();
	}, [data, dimensions, render, calculateYBounds, isPixiReady]);

	useEffect(() => {
		if (isPixiReady) {
			render();
		}
	}, [render, isPixiReady]);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent) => {
			const interaction = interactionRef.current;

			interaction.longPressTimer = setTimeout(() => {
				interaction.isLongPress = true;
				triggerHaptic("medium");
				render();
			}, LONG_PRESS_DELAY);

			(e.target as HTMLElement).setPointerCapture(e.pointerId);
		},
		[render],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent) => {
			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return;

			const interaction = interactionRef.current;
			const { width } = dimensions;

			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;

			const chartWidth = width - padding.left - padding.right;

			const pointSpacing =
				data.length > 1 ? chartWidth / (data.length - 1) : 0;
			const rawIndex = Math.round((x - padding.left) / pointSpacing);
			const index = clamp(rawIndex, 0, data.length - 1);

			interaction.crosshairX = x;
			interaction.crosshairY = y;
			interaction.selectedIndex = index;

			if (data[index]) {
				onPriceSelect?.(data[index]);
			}

			render();
		},
		[data, dimensions, padding, render, onPriceSelect],
	);

	const handlePointerUp = useCallback(
		(e: React.PointerEvent) => {
			const interaction = interactionRef.current;

			if (interaction.longPressTimer) {
				clearTimeout(interaction.longPressTimer);
				interaction.longPressTimer = null;
			}

			interaction.isLongPress = false;

			(e.target as HTMLElement).releasePointerCapture(e.pointerId);
			render();
		},
		[render],
	);

	const handlePointerLeave = useCallback(() => {
		const interaction = interactionRef.current;
		interaction.crosshairX = -1;
		interaction.crosshairY = -1;
		interaction.selectedIndex = -1;
		onPriceSelect?.(null);
		render();
	}, [render, onPriceSelect]);

	if (!rawData || rawData.length === 0) {
		return (
			<div
				className={`w-full h-full flex items-center justify-center ${className}`}
			>
				<p className="font-mono text-sm text-neutral-400">
					No chart data available
				</p>
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className={`relative w-full h-full touch-none select-none bg-white ${className}`}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerLeave={handlePointerLeave}
		>
			<div
				ref={pixiContainerRef}
				className="absolute inset-0 w-full h-full bg-white"
			/>

			{isLoading && (
				<div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center z-10 transition-opacity duration-200">
					<div className="flex items-center gap-2 bg-white/90 rounded-lg px-3 py-2 shadow-sm border border-neutral-200">
						<div className="w-3 h-3 border-2 border-neutral-300 border-t-neutral-600 rounded-full animate-spin" />
						<span className="font-mono text-xs text-neutral-600">
							Loading...
						</span>
					</div>
				</div>
			)}
		</div>
	);
}
