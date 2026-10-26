/**
 * Dev-time module hooks so tests & demo can run TypeScript sources directly
 * with `node --experimental-strip-types` while source files keep the standard
 * `.js` import specifiers required by the compiled dist build.
 *
 * Usage: node --import ./tools/ts-hooks.mjs --experimental-strip-types ...
 */
import { register } from 'node:module';

register('./ts-hooks-impl.mjs', import.meta.url);
