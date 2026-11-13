export interface Env {
  ASSETS?: Fetcher;
  SAFE_UPSTREAM_DIAGNOSTICS?: string;
  FREE_PLAN_MODE?: string;
  DB: D1Database;
  ADDRESS_DB?: D1Database;
  TOKEN_ENCRYPTION_KEY: string;
  NAVIGATION_TICKET_SECRET: string;
  TESLA_CLIENT_ID?: string;
  TESLA_CLIENT_SECRET?: string;
  TESLA_REDIRECT_URI?: string;
  TESLA_COMMAND_PROXY_URL?: string;
  ROAD_ROUTING_URL?: string;
  // Optional experiment only. No production config enables this adapter.
  OSRM_BATCH_URL?: string;
  OSRM_BATCH_TOKEN?: string;
  JUSO_MAP_API_KEY?: string;
  ALLOWED_ORIGINS: string;
  FRONTEND_URL: string;
  API_PREFIX?: string;
}
export type Bindings = { Bindings: Env };
export interface Coordinate { latitude: number; longitude: number }
export interface Point extends Coordinate {
  order: number; type: string; name: string; source: string;
  verification: string; originalSnapDistanceMeters: number | null;
}
export interface Leg { fromOrder: number; toOrder: number; distanceKm: number; durationSeconds: number; geometry: Coordinate[] | null }
export interface Route {
  points: Point[]; legs: Leg[]; distanceKm: number; drivingSeconds: number; stopSeconds: number;
  totalSeconds: number; status: string; provider: string; generatedAt: string;
  geometryStatus: string; terrainStatus: string; warnings: string[];
}
export interface Stop extends Coordinate { order: number; kind: string; name: string; navigationText: string }
export interface Plan {
  roadVerified?: boolean;
  id: string; vehicle: string; expires: number; stops: Stop[]; attempted: number;
  status: 'NOT_SENT' | 'SENDING' | 'API_ACCEPTED' | 'API_FAILED';
  vehicleStatus: 'VEHICLE_NOT_CONFIRMED' | 'VEHICLE_CONFIRMED'; pending: boolean; error?: string;
}
export interface Session {
  csrf: string; tokens?: { access: string; refresh: string; expires: number };
  state?: string; requestedLocation?: boolean; requestedCommands?: boolean;
  locationGranted?: boolean; commands?: boolean; returnTo?: string;
  vehicles: Record<string, string>; selected?: string; plan?: Plan;
}
