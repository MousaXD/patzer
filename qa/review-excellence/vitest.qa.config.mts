// Agent D-only independent consumer tests. Does not alter Patzer's own
// Vitest configuration, browser bundle, deployment or test selection.
import {defineConfig} from 'vitest/config';
export default defineConfig({
 esbuild:{jsx:'automatic'},
 test:{
  include:['scripts/review-benchmark-client-stale-profile.test.tsx'],
  clearMocks:true,
 },
});
