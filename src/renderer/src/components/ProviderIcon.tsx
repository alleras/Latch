import CloudQueueRounded from '@mui/icons-material/CloudQueueRounded'
import DnsRounded from '@mui/icons-material/DnsRounded'
import StorageRounded from '@mui/icons-material/StorageRounded'
import type { SvgIconProps } from '@mui/material/SvgIcon'
import type { ProviderId } from '../../../shared/types'

export function ProviderIcon({ provider, ...props }: SvgIconProps & { provider: ProviderId }) {
  if (provider === 'azuresql') return <CloudQueueRounded {...props} />
  if (provider === 'sqlite') return <StorageRounded {...props} />
  return <DnsRounded {...props} />
}

export const providerColor: Record<ProviderId, string> = {
  postgresql: '#83b7ef',
  mysql: '#55c4d7',
  sqlserver: '#ef7c83',
  azuresql: '#65b8f1',
  sqlite: '#e4cf68'
}
