import { registerPlugin } from '@capacitor/core';

export interface VerifiedStop {
  order: number;
  latitude: number;
  longitude: number;
  type: string;
  name: string;
}
export interface FlowadNavigationPlugin {
  /** Never pass an ESTIMATED_NOT_ROAD_ROUTED ticket. Android revalidates with server. */
  prepareVerifiedRoute(input: { ticket: string }): Promise<{
    status: 'READY_FOR_PLEOS_STAGE4';
    courseId: string;
    points: VerifiedStop[];
  }>;
}
export const FlowadNavigation = registerPlugin<FlowadNavigationPlugin>('FlowadNavigation');
