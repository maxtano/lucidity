/** Run `node --import tsx scripts/immersive-example.ts > public/examples/immersive-study.lucid.json`. */
import { projectBundle } from '../src/core/export';
import { createImmersiveStudy } from '../src/core/immersive-study';

// Stdout only: calling this script never replaces the editor's saved project.
process.stdout.write(JSON.stringify(projectBundle(createImmersiveStudy(), null)) + '\n');
