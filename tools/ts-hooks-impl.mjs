/**
 * resolve hook: when a relative `.js` specifier cannot be resolved on disk,
 * fall back to the sibling `.ts` file (type-stripping at runtime).
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    if (isRelative && specifier.endsWith('.js')) {
      try {
        return await nextResolve(specifier.slice(0, -3) + '.ts', context);
      } catch {
        // fall through and throw the original error
      }
    }
    throw error;
  }
}
