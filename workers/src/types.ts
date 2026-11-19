export interface Env {
  ASSETS?: Fetcher;
  SAFE_UPSTREAM_DIAGNOSTICS?: string;
  FREE_PLAN_MODE?: string;
  DB: D1Database;
  TOKEN_ENCRYPTION_KEY: string;
  NAVIGATION_TICKET_SECRET: string;
  TESLA_CLIENT_ID?: string;
  TESLA_CLIENT_SECRET?: string;
  TESLA_REDIRECT_URI?: string;
  TESLA_COMMAND_PROXY_URL?: string;
  TESLA_MULTI_STOP_MODE?: string; // absent/off, dry-run, enabled (explicit consent still required)
  TESLA_MULTI_STOP_SEND_ENABLED?: string;
  GOOGLE_PLACES_API_KEY?: string;
  GOOGLE_PLACE_MAPPING_ENABLED?: string;
  GOOGLE_PLACES_SEARCH_DAILY_LIMIT?: string;
  GOOGLE_PLACES_DETAILS_DAILY_LIMIT?: string;
  ROAD_ROUTING_URL?: string;
  // Optional experiment only. No production config enables this adapter.
  OSRM_BATCH_URL?: string;
  OSRM_BATCH_TOKEN?: string;
  JUSO_MAP_API_KEY?: string;
  NAVER_MAP_KEY_ID?: string;
  NAVER_MAP_KEY_PARAMETER?: string;
  ALLOWED_ORIGINS: string;
  FRONTEND_URL: string;
  API_PREFIX?: string;
}
export type Bindings = { Bindings: Env };
export interface Coordinate { latitude: number; longitude: number }
export interface GooglePlaceReference {
 id:string;source:'GOOGLE_PLACES';verifiedAt:string;identityConfirmed:true;
 location:Coordinate;matchedPoint:Coordinate&{name:string};
 verificationMethod?:'MANUAL_REVIEW'|'TEXT_QUERY_UNIQUE_LOCATION';nameVerified?:boolean;
}
export interface Point extends Coordinate {
  googlePlace?:GooglePlaceReference;
  googlePlaceMappingIssue?:'GOOGLE_PLACE_IDENTITY_UNVERIFIED';
  poiId?:string;region?:string;poiLocation?:Coordinate;
  order: number; type: string; name: string; source: string;
  verification: string; originalSnapDistanceMeters: number | null;
}
export interface Leg { fromOrder: number; toOrder: number; distanceKm: number; durationSeconds: number; geometry: Coordinate[] | null }
export interface Route {
  points: Point[]; legs: Leg[]; distanceKm: number; drivingSeconds: number; stopSeconds: number;
  totalSeconds: number; status: string; provider: string; generatedAt: string;
  geometryStatus: string; terrainStatus: string; warnings: string[];
}
export interface Stop extends Coordinate { order: number; kind: string; name: string; navigationText: string;googlePlace?:GooglePlaceReference;googlePlaceMappingIssue?:'GOOGLE_PLACE_IDENTITY_UNVERIFIED' }
export interface Plan {
  mode?: 'MULTI_STOP';
  multi?: {
    strategy: 'WAYPOINTS' | 'GPS_ORDERED'; ticket: string; itineraryHash: string;
    dryRunValidated: boolean; attemptedCommands: number; acceptedCommands: number;
    totalCommands: number | null;
  };
  roadVerified?: boolean;
  id: string; vehicle: string; expires: number; stops: Stop[]; attempted: number;
  status: 'NOT_SENT' | 'SENDING' | 'API_ACCEPTED' | 'API_FAILED';
  vehicleStatus: 'VEHICLE_NOT_CONFIRMED' | 'VEHICLE_CONFIRMED'; pending: boolean; error?: string;
}
export interface Session {
  csrf: string; tokens?: { access: string; refresh: string; expires: number };
  state?: string; requestedLocation?: boolean; requestedCommands?: boolean;
  locationGranted?: boolean; commands?: boolean; returnTo?: string;
  vehicles: Record<string, string>; selected?: string; lastVehicle?: string; plan?: Plan;
}
