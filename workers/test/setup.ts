import { beforeEach, afterEach, vi } from 'vitest';
import { env as bindings } from 'cloudflare:workers';
import { applyD1Migrations, reset } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-plugin';
import type { Env } from '../src/types';
interface TestBindings extends Env { TEST_MIGRATIONS: D1Migration[] }
const env=bindings as unknown as TestBindings;
beforeEach(async()=>{
  await applyD1Migrations(env.DB,env.TEST_MIGRATIONS);
  // Hard fail every unmocked outbound request. Tests cannot reach Tesla/OSRM.
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unmocked external request forbidden');}));
});
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();await reset();});
