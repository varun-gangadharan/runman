/**
 * Shared UI for showing *why* a number is what it is.
 *
 * Every calculation in `@runman/core` returns a method, a confidence and an
 * explanation alongside its value. Surfacing those consistently is the whole
 * difference between an app that reports metrics and one a runner can actually
 * trust: a marathon prediction with "derived from your 10K on 3 June" attached
 * can be argued with, and a bare number cannot.
 */

import { Alert, Box, Chip, Tooltip, Typography } from '@mui/material';
import { InfoOutlined } from '@mui/icons-material';

const CONFIDENCE_COLOR = {
  high: 'success',
  medium: 'info',
  low: 'warning',
  none: 'default',
};

export function ConfidenceChip({ confidence, explanation }) {
  const chip = (
    <Chip
      size="small"
      variant="outlined"
      color={CONFIDENCE_COLOR[confidence] ?? 'default'}
      label={`${confidence} confidence`}
      icon={<InfoOutlined />}
    />
  );
  return explanation ? <Tooltip title={explanation}>{chip}</Tooltip> : chip;
}

export function Explanation({ children }) {
  if (!children) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, lineHeight: 1.5 }}>
      {children}
    </Typography>
  );
}

export function Caveats({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <Alert severity="warning" sx={{ mt: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        What limits these numbers
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2 }}>
        {items.map((item) => (
          <Typography key={item} component="li" variant="body2">
            {item}
          </Typography>
        ))}
      </Box>
    </Alert>
  );
}
