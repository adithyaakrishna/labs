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
	type ExternalToast,
	Toaster as Sonner,
	toast as sonnerToast,
	type ToasterProps,
} from "sonner";

import "./sonner.styles.css";

const activeToasts = new Map<string, string | number>();
const nudgeCounts = new Map<string, number>();

function getToastKey(message: unknown, type: string): string | null {
	if (typeof message === "string") return `${type}:${message}`;
	return null;
}

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

function getSonnerFn(method: ToastMethod) {
	if (method === "default") return sonnerToast;
	return sonnerToast[method] as typeof sonnerToast;
}

function deduplicatedToast(
	method: ToastMethod,
	message: Parameters<typeof sonnerToast>[0],
	data?: ExternalToast,
): string | number {
	const key = getToastKey(message, method);

	if (key) {
		const existingId = activeToasts.get(key);
		if (existingId !== undefined) {
			const isActive = sonnerToast
				.getToasts()
				.some(
					(t) =>
						"id" in t &&
						t.id === existingId &&
						!("dismiss" in t && (t as { dismiss?: boolean }).dismiss),
				);

			if (isActive) {
				const count = (nudgeCounts.get(key) || 0) + 1;
				nudgeCounts.set(key, count);
				const nudgeClass = count % 2 === 0 ? "toast-nudge-a" : "toast-nudge-b";

				getSonnerFn(method)(message, {
					...data,
					...cleanupHandlers(key, data),
					id: existingId,
					className: [data?.className, nudgeClass].filter(Boolean).join(" "),
				});

				return existingId;
			}
			activeToasts.delete(key);
			nudgeCounts.delete(key);
		}
	}

	const id = getSonnerFn(method)(message, {
		...data,
		...cleanupHandlers(key, data),
	});

	if (key) activeToasts.set(key, id);
	return id;
}

const toast = Object.assign(
	(message: Parameters<typeof sonnerToast>[0], data?: ExternalToast) =>
		deduplicatedToast("default", message, data),
	{
		success: (
			message: Parameters<typeof sonnerToast>[0],
			data?: ExternalToast,
		) => deduplicatedToast("success", message, data),
		error: (message: Parameters<typeof sonnerToast>[0], data?: ExternalToast) =>
			deduplicatedToast("error", message, data),
		info: (message: Parameters<typeof sonnerToast>[0], data?: ExternalToast) =>
			deduplicatedToast("info", message, data),
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
