// Lets tests load source modules that import each other without file extensions, as the bundler does.
import { register } from 'node:module'

register('./resolve-typescript-hooks.mjs', import.meta.url)
