const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*/
const ERROR_TYPE_PREFIX = /^(?:[A-Za-z][A-Za-z0-9_.]*Error|Error):\s*/

export function readableErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error)
  message = message.replace(IPC_ERROR_PREFIX, '')
  message = message.replace(ERROR_TYPE_PREFIX, '')
  return message.trim()
}
