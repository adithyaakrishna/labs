# Building a Silky-Smooth Trading Chart with PixiJS and React

*How I ditched canvas 2D and SVG libraries for a GPU-powered chart that feels native.*

---

## Why Another Chart Component?

Every crypto/finance app needs a price chart. I tried the usual suspects — Chart.js, Recharts, Lightweight Charts — but none of them gave me what I wanted:

- **Buttery 60 fps animations** when the data updates
- **Touch-friendly crosshairs** with haptic feedback on mobile
- **Total visual control** — custom gradients, markers, tooltips, all pixel-perfect
- **Tiny footprint** — no massive charting library, just what I need

So I built my own on top of **PixiJS**, a 2D rendering engine that uses WebGL (your GPU) under the hood. The result is a `<TradingChart />` React component that renders thousands of data points without breaking a sweat.

This post walks through the whole thing step by step. No deep graphics programming knowledge required — if you can write React, you can follow along.

---

## The Big Picture

Here's the mental model. Our chart has **layers**, like transparent sheets stacked on top of each other:

```
┌──────────────────────────────┐
│  7. Tooltip (price info box) │  ← topmost
│  6. Overlay (crosshair lines)│
│  5. Labels (Y-axis prices)   │
│  4. Chart line               │
│  3. Gradient fill under line │
│  2. Gradient mask            │
│  1. Grid lines               │  ← bottommost
└──────────────────────────────┘
```

PixiJS gives us a `stage` — think of it as the root "scene". We add each layer to the stage in order, so things drawn later appear on top.

---

## Step 1: Setting Up PixiJS Inside React

PixiJS is an imperative library — it doesn't use JSX. We bridge the gap with a `useEffect` that creates the PixiJS `Application` and attaches it to a `<div>`.

```tsx
const containerRef = useRef<HTMLDivElement>(null);
const appRef = useRef<Application | null>(null);

useEffect(() => {
  const app = new Application();

  await app.init({
    width: 800,
    height: 400,
    background: "#ffffff",
    antialias: true,
    resolution: window.devicePixelRatio || 1, // retina support
    autoDensity: true,
  });

  containerRef.current.appendChild(app.canvas);
  appRef.current = app;

  return () => {
    app.destroy(true, { children: true }); // clean up everything
  };
}, []);
```

**What's happening:**
1. We create a PixiJS `Application` — this manages the WebGL context and the render loop.
2. `resolution: window.devicePixelRatio` makes the chart crisp on Retina/HiDPI screens.
3. `autoDensity: true` automatically scales the canvas CSS size to match.
4. The canvas element is appended to our `<div>` ref.
5. On unmount, we destroy everything to prevent memory leaks.

> **Tip:** PixiJS v8's `app.init()` is async, so you need to `await` it or use a `.then()`.

---

## Step 2: Creating the Layer Stack

Once the app is ready, we create our drawing layers:

```tsx
const gridLayer = new Graphics();       // grid lines
const gradientSprite = new Sprite();    // gradient fill (image-based)
const gradientMask = new Graphics();    // shape that clips the gradient
const chartLayer = new Graphics();      // the price line
const overlayLayer = new Graphics();    // crosshair + selection
const labelsContainer = new Container();   // Y-axis text
const tooltipContainer = new Container();  // tooltip text

// The gradient only shows through the mask shape
gradientSprite.mask = gradientMask;

// Add in order — first added = drawn first (behind)
app.stage.addChild(gridLayer);
app.stage.addChild(gradientSprite);
app.stage.addChild(gradientMask);
app.stage.addChild(chartLayer);
app.stage.addChild(labelsContainer);
app.stage.addChild(overlayLayer);
app.stage.addChild(tooltipContainer);
```

**Key concepts:**
- `Graphics` is like a pen — you can draw lines, circles, rectangles, etc.
- `Container` is a group that holds child objects (like `Text` elements).
- `Sprite` displays an image texture.
- **Masking** — the gradient image covers the whole chart area, but we use `gradientMask` to clip it to the area under the price line.

---

## Step 3: Mapping Data to Pixels

Every chart needs two functions: one to convert a price to a Y pixel, and one to convert a data index to an X pixel.

```tsx
// How much space we have for the chart (minus padding)
const chartWidth = width - padding.left - padding.right;
const chartHeight = height - padding.top - padding.bottom;

// Spread data points evenly across the width
const pointSpacing = data.length > 1
  ? chartWidth / (data.length - 1)
  : 0;

// Scale prices to fit the height
const yRange = yMax - yMin;
const yScale = chartHeight / yRange;

// Convert a price value → Y pixel position
const priceToY = (price) =>
  padding.top + chartHeight - (price - yMin) * yScale;

// Convert a data index → X pixel position
const indexToX = (index) =>
  padding.left + index * pointSpacing;
```

**Why `chartHeight - ...`?** In screen coordinates, Y=0 is the **top**. But in a price chart, higher prices should be higher on screen (lower Y). So we flip it.

---

## Step 4: Drawing the Grid

The grid is just horizontal lines at evenly spaced intervals:

```tsx
const Y_STEPS = 5;

gridLayer.setStrokeStyle({ width: 1, color: 0xf4f4f5 });

const yStepHeight = chartHeight / Y_STEPS;
for (let i = 0; i <= Y_STEPS; i++) {
  const y = padding.top + yStepHeight * i;
  gridLayer.moveTo(padding.left, y);
  gridLayer.lineTo(width - padding.right, y);
}

gridLayer.stroke();
```

This gives us 6 light horizontal lines across the chart. Simple!

---

## Step 5: Drawing the Price Line

The star of the show — a smooth line connecting all price points:

```tsx
chartLayer.setStrokeStyle({
  width: 2,
  color: 0x09090b,    // near-black
  cap: "round",
  join: "round",
});

// Start at the first point
chartLayer.moveTo(indexToX(0), priceToY(data[0].price));

// Draw a line to each subsequent point
for (let i = 1; i < data.length; i++) {
  chartLayer.lineTo(indexToX(i), priceToY(data[i].price));
}

chartLayer.stroke();
```

We also draw a small filled circle at the last data point so users can see "where we are now":

```tsx
const lastIndex = data.length - 1;
chartLayer.circle(indexToX(lastIndex), priceToY(data[lastIndex].price), 5);
chartLayer.fill(0x09090b);
```

---

## Step 6: The Gradient Fill

That soft gradient under the line? It's a two-part trick:

### Part A: Create a gradient texture

We draw a gradient onto an offscreen `<canvas>` element, then turn it into a PixiJS texture:

```tsx
const canvas = document.createElement("canvas");
canvas.width = width;
canvas.height = chartHeight;
const ctx = canvas.getContext("2d");

const gradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
gradient.addColorStop(0, "#09090b40");   // 25% opacity at top
gradient.addColorStop(0.4, "#09090b20"); // fading...
gradient.addColorStop(1, "#09090b00");   // fully transparent at bottom

ctx.fillStyle = gradient;
ctx.fillRect(0, 0, width, chartHeight);

const texture = Texture.from(canvas);
```

### Part B: Mask it to the area under the line

The gradient image covers the full chart area. We use a **mask** — a shape that defines which parts are visible:

```tsx
// Start at first data point
gradientMask.moveTo(indexToX(0), priceToY(data[0].price));

// Trace along the price line
for (let i = 0; i < data.length; i++) {
  gradientMask.lineTo(indexToX(i), priceToY(data[i].price));
}

// Go down to the bottom-right, then bottom-left, then close
gradientMask.lineTo(indexToX(data.length - 1), chartBottom);
gradientMask.lineTo(indexToX(0), chartBottom);
gradientMask.closePath();
gradientMask.fill(0xffffff);
```

The result: the gradient only appears in the area between the price line and the bottom of the chart. It creates that polished "area chart" look.

---

## Step 7: Smooth Y-Axis Animations

When new data arrives, the price range might change. Instead of jumping instantly to the new range, we **lerp** (linearly interpolate) toward it:

```tsx
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Each frame, move 15% closer to the target
yAxis.min = lerp(yAxis.min, yAxis.targetMin, 0.15);
yAxis.max = lerp(yAxis.max, yAxis.targetMax, 0.15);
```

This runs inside our `render()` function. If the Y-axis hasn't reached its target yet, we request another animation frame:

```tsx
const needsAnimation =
  Math.abs(yAxis.min - yAxis.targetMin) > 0.0001 ||
  Math.abs(yAxis.max - yAxis.targetMax) > 0.0001;

if (needsAnimation) {
  requestAnimationFrame(render);
}
```

The chart gently "breathes" as it adjusts to new data — instead of snapping around jarringly.

---

## Step 8: Touch-Friendly Crosshair

When a user touches (or hovers) on the chart, we show crosshair lines and a tooltip. Here's the flow:

1. **Pointer move** → calculate which data point is closest to the finger/cursor
2. **Draw dashed crosshair lines** at that point
3. **Show a tooltip** with the price and timestamp

### Finding the closest point

```tsx
const handlePointerMove = (e) => {
  const x = e.clientX - rect.left;

  const pointSpacing = chartWidth / (data.length - 1);
  const rawIndex = Math.round((x - padding.left) / pointSpacing);
  const index = clamp(rawIndex, 0, data.length - 1);

  // Store for the render function to use
  interaction.selectedIndex = index;
  interaction.crosshairX = x;
};
```

### Drawing dashed lines

PixiJS doesn't have a built-in "dashed line" API, so we draw lots of small segments:

```tsx
const DASH = 4;
const GAP = 4;

// Vertical dashed line
for (let py = top; py < bottom; py += DASH + GAP) {
  overlayLayer.moveTo(x, py);
  overlayLayer.lineTo(x, Math.min(py + DASH, bottom));
}
overlayLayer.stroke();
```

### Long-press indicator

On mobile, we add a "long press" detection. After 300ms of holding, a pulsing dot appears at the crosshair intersection, and we trigger a haptic vibration:

```tsx
if (interaction.isLongPress) {
  // Outer glow
  overlayLayer.circle(x, y, 8);
  overlayLayer.fill({ color: lineColor, alpha: 0.25 });
  // Inner dot
  overlayLayer.circle(x, y, 4);
  overlayLayer.fill(lineColor);
}
```

```tsx
// Trigger phone vibration
if ("vibrate" in navigator) {
  navigator.vibrate(20);
}
```

---

## Step 9: Markers (Buy/Sell Indicators)

Markers are small triangles placed on the chart at specific timestamps:

```tsx
for (const marker of markers) {
  const index = data.findIndex(d => d.timestamp === marker.timestamp);
  const x = indexToX(index);
  const y = priceToY(marker.price);

  if (marker.type === "buy") {
    // Triangle pointing UP (▲)
    chartLayer.moveTo(x, y - 12);
    chartLayer.lineTo(x - 8, y + 4);
    chartLayer.lineTo(x + 8, y + 4);
  } else {
    // Triangle pointing DOWN (▼)
    chartLayer.moveTo(x, y + 12);
    chartLayer.lineTo(x - 8, y - 4);
    chartLayer.lineTo(x + 8, y - 4);
  }

  chartLayer.closePath();
  chartLayer.fill(marker.type === "buy" ? 0x22c55e : 0xef4444);
}
```

Green triangles for buys, red for sells. They sit right on the price line at the exact point the trade happened.

---

## Step 10: The Tooltip

The tooltip is a rounded rectangle with text inside:

```tsx
// Draw background
overlayLayer.roundRect(tooltipX, tooltipY, 130, 65, 6);
overlayLayer.fill({ color: 0xffffff, alpha: 0.97 });
overlayLayer.setStrokeStyle({ width: 1, color: 0xe5e5e5 });
overlayLayer.stroke();

// Add text
const timestampText = new Text({
  text: "Feb 17, 12:30 PM",
  style: new TextStyle({ fontFamily: "monospace", fontSize: 10, fill: "#71717a" }),
});
timestampText.position.set(tooltipX + 8, tooltipY + 6);
tooltipContainer.addChild(timestampText);

const priceText = new Text({
  text: "$0.00042",
  style: new TextStyle({ fontFamily: "monospace", fontSize: 12, fill: "#09090b" }),
});
priceText.position.set(tooltipX + 8, tooltipY + 26);
tooltipContainer.addChild(priceText);
```

The tooltip automatically flips to the other side when it would overflow the chart edge:

```tsx
const flipTooltip = x > width - tooltipWidth - 30;
const tooltipX = flipTooltip
  ? Math.max(10, x - tooltipWidth - 15)   // show on the LEFT of crosshair
  : Math.min(x + 15, width - tooltipWidth - 10); // show on the RIGHT
```

---

## Performance Tricks

A few things that keep this chart fast:

1. **No React re-renders for drawing.** All drawing happens in imperative PixiJS code triggered by `requestAnimationFrame`. React only handles the outer container and event listeners.

2. **Texture caching.** The gradient texture is expensive to create, so we cache it and only regenerate when the size or color changes.

3. **TextStyle reuse.** We create `TextStyle` objects once and reuse them across frames instead of creating new ones every render.

4. **Animation only when needed.** We only run `requestAnimationFrame` while the Y-axis is transitioning. Once it settles, we stop — no wasted CPU.

5. **Proper cleanup.** On unmount, we destroy the PixiJS app, textures, and all children. No memory leaks.

---

## The React Wrapper

All of the PixiJS drawing is wrapped in a clean React component:

```tsx
<TradingChart
  data={priceHistory}          // array of { timestamp, price }
  markers={trades}             // optional buy/sell markers
  lineColor="#09090b"          // line + gradient color
  showAxisLabels={true}        // Y-axis price labels
  showGrid={true}              // horizontal grid lines
  onPriceSelect={(point) => {  // callback when user hovers/touches
    setSelectedPrice(point?.price);
  }}
  currentMcap={1000000}        // for MCAP calculation in tooltip
  currentPrice={0.001}         // current price for MCAP ratio
  isLoading={false}            // show loading overlay
/>
```

The component handles:
- **Responsive sizing** via `ResizeObserver`
- **Retina displays** via `devicePixelRatio`
- **Touch and mouse** via Pointer Events
- **Loading states** with a blurred overlay
- **Empty states** with a placeholder message

---

## Wrapping Up

Building a chart from scratch sounds intimidating, but PixiJS makes the drawing part surprisingly straightforward. The hardest parts were:

- Getting the Y-axis math right (flipped coordinates always trip me up)
- Making the gradient mask line up perfectly with the price line
- Handling the imperative PixiJS world inside React's declarative world

The payoff? A chart that renders at 60fps, looks exactly how I want, weighs almost nothing (PixiJS is the only dependency), and works great on both desktop and mobile.

If you're building something where stock charting libraries feel too rigid, give PixiJS a shot. You might be surprised how far `moveTo` and `lineTo` can take you.

---

*The full component code is in `trading-chart.tsx` in this directory. An example showing how to use it is in `example.tsx`.*
