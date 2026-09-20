'use client';

import { Box, Button, Container, Paper, Stack, Typography } from '@mui/material';
import { Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function DriverOnboardingPage() {
  const [code, setCode] = useState('');
  useEffect(() => {
    setCode(
      location.hash
        .slice(1)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, ''),
    );
  }, []);
  const appLink = code ? `trackify://onboard/${code}` : 'trackify://';
  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'grid',
        placeItems: 'center',
        p: 2,
      }}
    >
      <Container maxWidth="sm">
        <Paper
          elevation={0}
          sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 4, p: { xs: 3, sm: 5 } }}
        >
          <Stack spacing={2.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Box
              sx={{
                width: 64,
                height: 64,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 3,
                bgcolor: 'primary.main',
                color: 'white',
              }}
            >
              <Smartphone size={30} />
            </Box>
            <Typography variant="overline" color="primary.main" sx={{ fontWeight: 800 }}>
              Trackify vehicle setup
            </Typography>
            <Typography variant="h3">Connect this phone</Typography>
            <Typography color="text.secondary">
              Open the Trackify app to review the vehicle and start sharing its location. No fleet
              login is required.
            </Typography>
            {code && (
              <Typography component="div" sx={{ fontSize: 30, fontWeight: 900, letterSpacing: 5 }}>
                {code}
              </Typography>
            )}
            <Button component="a" fullWidth href={appLink} size="large" variant="contained">
              Open Trackify app
            </Button>
            <Typography variant="caption" color="text.secondary">
              If the app does not open, launch Trackify and enter the setup code shown above.
            </Typography>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
