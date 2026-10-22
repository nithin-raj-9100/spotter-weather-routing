export type Coordinate = [number, number];
export interface Place {
  name: string;
  latitude: number;
  longitude: number;
}
export interface Weather {
  wind_mph: number;
  rain_in_hr: number;
  snow_in_hr: number;
  temperature_f: number;
  forecast_time: string;
  wind_window_start: string;
  wind_window_end: string;
}
export interface Checkpoint {
  coordinate: Coordinate;
  mile: number;
  elapsed_seconds: number;
  eta: string;
  weather: Weather;
  risk: {
    level: number;
    label: string;
    reasons: string[];
    components: Record<string, number>;
  };
}
export interface Route {
  id: string;
  name: string;
  rank: number;
  via_detour: boolean;
  geometry: { type: "LineString"; coordinates: Coordinate[] };
  distance_miles: number;
  duration_seconds: number;
  arrival: string;
  checkpoints: Checkpoint[];
  summary: {
    miles_by_risk: Record<string, number>;
    average_risk: number;
    max_risk: number;
    blocked: boolean;
    segments: { from_mile: number; to_mile: number; level: number }[];
  };
}
export interface FrameValue {
  level: number;
  wind_mph: number;
  rain_in_hr: number;
  snow_in_hr: number;
}
export interface Plan {
  mode: "demo" | "live";
  origin: Place;
  destination: Place;
  departure: string;
  load_lb: number;
  spacing_miles: number;
  routes: Route[];
  recommended_id: string | null;
  warnings: string[];
  corridor: {
    coordinates: Coordinate[];
    frames: { hour: number; time: string; values: FrameValue[] }[];
  };
  sources: Record<string, string>;
}
