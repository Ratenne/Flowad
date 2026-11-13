import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
export default defineConfig({
  plugins: [cloudflareTest(async()=>({
    wrangler:{configPath:'./wrangler.local.jsonc'},
    miniflare:{bindings:{TEST_MIGRATIONS:await readD1Migrations('./migrations')},d1Databases:['ADDRESS_DB']}
  }))],
  test:{include:['test/**/*.test.ts'],setupFiles:['./test/setup.ts'],fileParallelism:false,testTimeout:20000}
});
