import { ensureArtifactsDir } from './src/utils/files';
import { buildImagesIfNeeded } from './src/utils/docker';

export default async function globalSetup(): Promise<void> {
  console.log('[global-setup] Preparing Docker images...');
  const artifactsDir = await ensureArtifactsDir();
  console.log(`[global-setup] Ensured artifacts directory at ${artifactsDir}`);
  buildImagesIfNeeded(console);
  console.log('[global-setup] Docker images ready for test suites');
}
