import { cleanContainers } from './src/utils/docker';

export default async function globalTeardown(): Promise<void> {
  console.log('[global-teardown] Cleaning Docker resources...');
  try {
    cleanContainers();
    console.log('[global-teardown] Cleanup complete');
  } catch (error) {
    console.error('[global-teardown] Cleanup encountered an issue:', error);
  }
}
