'use client';

import { Avatar, Box, ButtonBase, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';

/** A number that also filters what is shown when clicked (Overview, Drivers). */
export function StatTile({
  icon: Icon,
  label,
  value,
  tone,
  selected,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      aria-pressed={selected}
      onClick={onClick}
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        alignItems: { xs: 'center', md: 'center' },
        justifyContent: { xs: 'center', md: 'flex-start' },
        gap: { xs: 0.25, md: 1.5 },
        p: { xs: 0.9, md: 1.5 },
        minWidth: 0,
        textAlign: { xs: 'center', md: 'left' },
        borderRadius: { xs: '10px', md: '14px' },
        border: '1px solid',
        borderColor: selected ? tone : 'divider',
        bgcolor: selected ? `${tone}0F` : 'background.paper',
        boxShadow: selected ? `0 0 0 1px ${tone}` : '0 1px 2px rgba(23,32,51,.04)',
        transition: 'border-color .15s, background-color .15s',
        '&:hover': { borderColor: tone },
      }}
    >
      <Avatar
        variant="rounded"
        sx={{
          display: { xs: 'none', md: 'flex' },
          width: 38,
          height: 38,
          bgcolor: `${tone}14`,
          color: tone,
        }}
      >
        <Icon size={19} />
      </Avatar>
      <Box sx={{ minWidth: 0, maxWidth: '100%' }}>
        <Typography
          noWrap
          color="text.secondary"
          sx={{ fontSize: { xs: 10, md: 12 }, fontWeight: 600 }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            fontSize: { xs: 18, md: 22 },
            fontWeight: 800,
            lineHeight: 1.15,
            // On phones the number carries the tile's colour, since the icon is hidden.
            color: { xs: value ? tone : 'text.primary', md: 'text.primary' },
          }}
        >
          {value}
        </Typography>
      </Box>
    </ButtonBase>
  );
}
