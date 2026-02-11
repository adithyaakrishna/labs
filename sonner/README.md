# Toast Deduplication with Nudge Animation for Sonner

Ever double-clicked a button and gotten three identical toasts? Yeah, me too. This fixes that.

Instead of letting duplicates pile up, I built a thin wrapper around [sonner](https://sonner.emilkowal.dev/) that **deduplicates by message content** and **nudges the existing toast** with a shake animation when a duplicate is attempted.

_(Shoutout to Claude for turning my ramblings into actual working code)_

## The two files

The entire implementation lives in two files: a TypeScript wrapper (`sonner.tsx`) and a CSS addition (`globals.css`).

### `sonner.tsx` — the dedup wrapper

```tsx
"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  toast as sonnerToast,
  Toaster as Sonner,
  type ExternalToast,
  type ToasterProps,
} from "sonner";

// Tracks active toasts by a content-based key (type:message) → toast id
const activeToasts = new Map<string, string | number>();
// Tracks nudge count per key to toggle between two animation classes
const nudgeCounts = new Map<string, number>();

// Derives a stable key from the toast message and type for deduplication.
// Only string messages are keyed — React node messages pass through without dedup.
function getToastKey(message: unknown, type: string): string | null {
  if (typeof message === "string") return `${type}:${message}`;
  return null;
}

// Removes the key from both maps on dismiss/auto-close so the same
// message can appear fresh again after the previous one is gone.
function cleanupHandlers(
  key: string | null,
  data?: ExternalToast,
): Pick<ExternalToast, "onDismiss" | "onAutoClose"> {
  return {
    onDismiss: (t) => {
      if (key) {
        activeToasts.delete(key);
        nudgeCounts.delete(key);
      }
      data?.onDismiss?.(t);
    },
    onAutoClose: (t) => {
      if (key) {
        activeToasts.delete(key);
        nudgeCounts.delete(key);
      }
      data?.onAutoClose?.(t);
    },
  };
}

type ToastMethod =
  | "success"
  | "error"
  | "info"
  | "warning"
  | "loading"
  | "message"
  | "default";

// Returns the right sonner function for the given method
function getSonnerFn(method: ToastMethod) {
  if (method === "default") return sonnerToast;
  return sonnerToast[method] as typeof sonnerToast;
}

// Core deduplication logic shared by all typed toast methods.
//
// When a toast with the same type+message is already on screen, instead of
// creating a new one, we call sonner with the existing toast's `id`. Sonner
// recognises the ID and updates the toast in place. We toggle a CSS class
// on each update to restart the nudge animation.
function deduplicatedToast(
  method: ToastMethod,
  message: Parameters<typeof sonnerToast>[0],
  data?: ExternalToast,
): string | number {
  const key = getToastKey(message, method);

  if (key) {
    const existingId = activeToasts.get(key);
    if (existingId !== undefined) {
      // Verify it's still on screen
      const isActive = sonnerToast
        .getToasts()
        .some(
          (t) =>
            "id" in t &&
            t.id === existingId &&
            !("dismiss" in t && (t as { dismiss?: boolean }).dismiss),
        );

      if (isActive) {
        // Toggle between two animation class names so the browser
        // restarts the animation each time
        const count = (nudgeCounts.get(key) || 0) + 1;
        nudgeCounts.set(key, count);
        const nudgeClass =
          count % 2 === 0 ? "toast-nudge-a" : "toast-nudge-b";

        // Update the existing toast in place (sonner matches by id)
        getSonnerFn(method)(message, {
          ...data,
          ...cleanupHandlers(key, data),
          id: existingId,
          className: [data?.className, nudgeClass]
            .filter(Boolean)
            .join(" "),
        });

        return existingId;
      }
      activeToasts.delete(key);
      nudgeCounts.delete(key);
    }
  }

  // No duplicate — create the toast normally
  const id = getSonnerFn(method)(message, {
    ...data,
    ...cleanupHandlers(key, data),
  });

  if (key) activeToasts.set(key, id);
  return id;
}

// Public API — drop-in replacement for sonner's toast.
// Methods that don't benefit from deduplication (promise, custom, dismiss)
// are passed through directly.
const toast = Object.assign(
  (message: Parameters<typeof sonnerToast>[0], data?: ExternalToast) =>
    deduplicatedToast("default", message, data),
  {
    success: (
      message: Parameters<typeof sonnerToast>[0],
      data?: ExternalToast,
    ) => deduplicatedToast("success", message, data),
    error: (
      message: Parameters<typeof sonnerToast>[0],
      data?: ExternalToast,
    ) => deduplicatedToast("error", message, data),
    info: (
      message: Parameters<typeof sonnerToast>[0],
      data?: ExternalToast,
    ) => deduplicatedToast("info", message, data),
    warning: (
      message: Parameters<typeof sonnerToast>[0],
      data?: ExternalToast,
    ) => deduplicatedToast("warning", message, data),
    loading: (
      message: Parameters<typeof sonnerToast>[0],
      data?: ExternalToast,
    ) => deduplicatedToast("loading", message, data),
    message: (
      message: Parameters<typeof sonnerToast>[0],
      data?: ExternalToast,
    ) => deduplicatedToast("message", message, data),
    promise: sonnerToast.promise,
    custom: sonnerToast.custom,
    dismiss: sonnerToast.dismiss,
    getHistory: sonnerToast.getHistory,
    getToasts: sonnerToast.getToasts,
  },
);

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { toast, Toaster };
```

### `globals.css` — the nudge keyframes

```css
[data-sonner-toast].toast-nudge-a {
  animation: toast-nudge-a 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
}
[data-sonner-toast].toast-nudge-b {
  animation: toast-nudge-b 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
}

@keyframes toast-nudge-a {
  0%,
  100% {
    translate: 0;
  }
  10% {
    translate: -4px;
  }
  25% {
    translate: 3px;
  }
  40% {
    translate: -2px;
  }
  55% {
    translate: 1.5px;
  }
  70% {
    translate: -0.75px;
  }
  85% {
    translate: 0.25px;
  }
}
@keyframes toast-nudge-b {
  0%,
  100% {
    translate: 0;
  }
  10% {
    translate: -4px;
  }
  25% {
    translate: 3px;
  }
  40% {
    translate: -2px;
  }
  55% {
    translate: 1.5px;
  }
  70% {
    translate: -0.75px;
  }
  85% {
    translate: 0.25px;
  }
}
```

## How it works

### Deduplication flow

```
toast.error("Failed to connect")
  │
  ├─ getToastKey() → "error:Failed to connect"
  ├─ activeToasts.has(key)? NO
  ├─ sonnerToast.error("Failed to connect") → id: 42
  └─ activeToasts.set(key, 42)

toast.error("Failed to connect")    ← duplicate
  │
  ├─ getToastKey() → "error:Failed to connect"
  ├─ activeToasts.has(key)? YES → id: 42
  ├─ sonnerToast.getToasts() confirms id 42 still active
  ├─ nudgeCounts: 0 → 1, pick "toast-nudge-b"
  └─ sonnerToast.error("Failed to connect", { id: 42, className: "toast-nudge-b" })
       └─ sonner updates toast 42 in place, CSS animation plays

toast.error("Failed to connect")    ← another duplicate
  │
  ├─ nudgeCounts: 1 → 2, pick "toast-nudge-a"
  └─ sonnerToast.error("Failed to connect", { id: 42, className: "toast-nudge-a" })
       └─ different animation-name → browser restarts animation
```

### Why sonner's update-by-id mechanism

The first approach we tried was direct DOM manipulation — querying for `[data-sonner-toast][data-id="42"]` and toggling a `data-nudge` attribute. This didn't work because **sonner does not render a `data-id` attribute** on toast elements. The `<li>` elements have `data-sonner-toast`, `data-type`, `data-index`, etc., but no toast ID selector.

Instead, we lean on a sonner built-in: when you call `sonnerToast("message", { id: existingId })`, sonner recognises the existing ID and **updates the toast in place** rather than creating a new element. This is the same mechanism sonner uses for `toast.loading` → `toast.success` transitions. We piggyback on it to inject our nudge `className`.

### Why two animation names

CSS animations don't restart when you re-apply the same class. If we always set `className: "toast-nudge"`, only the first duplicate would animate. By toggling between `toast-nudge-a` and `toast-nudge-b` — which have identical keyframes but different `animation-name` values — the browser sees a new animation each time and restarts it.

### Why `translate` instead of `transform`

Sonner positions toasts using `transform: var(--y)` for stacking, enter/exit transitions, and swipe gestures. If our shake animation overrode `transform`, it would break sonner's layout.

The CSS [`translate`](https://developer.mozilla.org/en-US/docs/Web/CSS/translate) property is **independent of `transform`**. The browser composites them together:

```
sonner:   transform: translateY(0)    ← positioning (untouched)
nudge:    translate: -4px             ← horizontal shake (additive)
```

This lets us shake horizontally without interfering with sonner's vertical positioning, swipe handling, or stacking animations.

### Cleanup

When a toast is dismissed (manually or via auto-close timer), `onDismiss` / `onAutoClose` callbacks remove the key from both `activeToasts` and `nudgeCounts`. This means the same message can appear as a fresh toast again after the previous one is gone.

## Usage

Import `toast` from the wrapper instead of directly from sonner. No call-site changes needed:

```ts
import { toast } from "@/components/ui/sonner";

toast.success("Saved!");
toast.error("Failed to connect");
toast.promise(asyncFn, { loading: "...", success: "Done", error: "Failed" });
```

## Limitations

- Only deduplicates **string** messages. React node messages always create a new toast.
- Dedup key is `type + message` — two toasts with the same message but different `description` are still treated as duplicates.
- `promise`, `custom`, `dismiss`, `getHistory`, `getToasts` pass through directly without deduplication.
