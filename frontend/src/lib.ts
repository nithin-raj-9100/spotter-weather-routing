import type { Plan } from "./types";
export const RISK_LABELS = ["Low", "Moderate", "High", "Severe", "No Travel"];
export const RISK_COLORS = [
  "#267e60",
  "#bb952c",
  "#e38838",
  "#d25146",
  "#8e365e",
];
export const ROUTE_COLORS = ["#1b7762", "#6378b4", "#b27c42"];
export const duration = (seconds: number) =>
  `${Math.floor(Math.round(seconds / 60) / 60)}h ${Math.round(seconds / 60) % 60}m`;
export const number = (value: number, digits = 0) =>
  value.toLocaleString(undefined, { maximumFractionDigits: digits });
export const dateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
export const localInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error?.message ||
        `Request failed (${response.status}). Please try again.`,
    );
  if (!data)
    throw new Error("The server returned an invalid response. Please retry.");
  return data as T;
}

export function recommendationText(plan: Plan): string {
  const best = plan.routes.find((r) => r.id === plan.recommended_id);
  if (!best) return "Every route contains No Travel conditions for this load.";
  const fastest = [...plan.routes].sort(
    (a, b) => a.duration_seconds - b.duration_seconds,
  )[0];
  const severe = best.summary.miles_by_risk.Severe;
  const high = best.summary.miles_by_risk.High;
  if (fastest.id === best.id)
    return `Also the fastest route. Exposure: ${number(severe, 1)} severe miles and ${number(high, 1)} high miles; average risk ${number(best.summary.average_risk, 2)} / 4.`;
  if (fastest.summary.blocked)
    return `${fastest.name}, the fastest option, contains No Travel conditions. This eligible option has ${number(severe, 1)} severe miles and ${number(high, 1)} high miles.`;
  const comparison = (label: string, delta: number) =>
    Math.abs(delta) < 0.001
      ? `the same ${label} mileage`
      : `${number(Math.abs(delta), 1)} ${delta > 0 ? "fewer" : "more"} ${label} miles`;
  const saved = fastest.duration_seconds - best.duration_seconds;
  return `Compared with ${fastest.name}: ${comparison("severe", fastest.summary.miles_by_risk.Severe - severe)}, ${comparison("high", fastest.summary.miles_by_risk.High - high)}, average risk ${number(best.summary.average_risk, 2)} vs ${number(fastest.summary.average_risk, 2)}; ${number(Math.abs(saved) / 60)} min ${saved > 0 ? "faster" : "longer"}.`;
}
