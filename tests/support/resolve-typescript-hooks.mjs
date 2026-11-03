const EXTENSIONLESS_RELATIVE = /^\.{1,2}\/(?:.*\/)?[^./]+$/

export async function resolve(specifier, context, nextResolve) {
  if (EXTENSIONLESS_RELATIVE.test(specifier) && context.parentURL?.endsWith('.ts')) {
    try {
      return await nextResolve(`${specifier}.ts`, context)
    } catch {
      // Fall through to the default resolution and its error.
    }
  }
  return nextResolve(specifier, context)
}
