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
