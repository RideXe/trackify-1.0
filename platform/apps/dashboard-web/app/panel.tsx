'use client';

import { Box, Paper, Stack, Typography, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';

export const panelBorder = '#E7EBF2';
export const rowDivider = '#F0F2F6';

/** The card used across the vehicle page: thin border, soft shadow, rounded corners. */
export function Panel({
  children,
  id,
  sx,
}: {
  children: ReactNode;
  id?: string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Paper
      elevation={0}
      id={id}
      sx={[
        {
          border: `1px solid ${panelBorder}`,
          borderRadius: { xs: '14px', sm: '16px' },
          boxShadow: '0 2px 8px rgba(23,32,51,.035), 0 1px 2px rgba(23,32,51,.035)',
          overflow: 'hidden',
          minWidth: 0,
        },
        ...((Array.isArray(sx) ? sx : [sx]) as Array<Exclude<SxProps<Theme>, readonly unknown[]>>),
      ]}
    >
      {children}
    </Paper>
  );
}

/**
 * Title, optional caption and an action on the right. `section` is the larger heading; `icon`
 * sits in front of the title, as on every card of the vehicle page.
 */
export function PanelHead({
  title,
  caption,
  action,
  icon,
  section = false,
}: {
  title: ReactNode;
  caption?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  section?: boolean;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        p: { xs: 1.75, sm: 2 },
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        rowGap: 1,
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ minWidth: 0, alignItems: 'flex-start' }}>
        {icon && (
          <Box
            sx={{ color: 'primary.main', display: 'flex', mt: section ? 0.15 : 0, flexShrink: 0 }}
          >
            {icon}
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="h2"
            sx={{
              fontSize: section ? { xs: 15, sm: 16 } : 14,
              fontWeight: 800,
              letterSpacing: section ? '-0.3px' : 0,
            }}
          >
            {title}
          </Typography>
          {caption && (
            <Typography color="text.secondary" sx={{ fontSize: section ? 12 : 11, mt: 0.4 }}>
              {caption}
            </Typography>
          )}
        </Box>
      </Stack>
      {action}
    </Stack>
  );
}

/** Small rounded status label. */
export function Pill({
  children,
  color,
  background,
}: {
  children: ReactNode;
  color: string;
  background: string;
}) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.6,
        borderRadius: '20px',
        px: { xs: 0.9, sm: 1.1 },
        py: 0.5,
        fontSize: { xs: 10, sm: 11 },
        fontWeight: 700,
        lineHeight: 1.3,
        whiteSpace: 'nowrap',
        color,
        bgcolor: background,
      }}
    >
      {children}
    </Box>
  );
}

/** Text-only button for panel headers ("Edit", "Change", "View all"). */
export const textButtonSx = {
  minHeight: 0,
  px: 0.75,
  py: 0.5,
  fontSize: 12,
  fontWeight: 700,
} as const;
