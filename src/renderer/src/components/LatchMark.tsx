import { Box } from '@mui/material'

interface LatchMarkProps {
  size?: number
}

export function LatchMark({ size = 20 }: LatchMarkProps) {
  const strokeWidth = Math.max(1, size * 0.08)

  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        position: 'relative',
        flex: '0 0 auto',
        color: 'primary.main',
        transform: 'rotate(-4deg)'
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          border: `${strokeWidth}px solid currentColor`,
          borderRadius: '20%'
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          inset: '30%',
          borderRadius: '19%',
          bgcolor: 'currentColor'
        }}
      />
    </Box>
  )
}
