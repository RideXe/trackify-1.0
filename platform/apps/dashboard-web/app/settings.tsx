'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { Organisation, TrackifyClient } from '@trackify/api-client';
import { useEffect, useState } from 'react';

/** What drivers see in their app: the organisation's name and who "Call dispatcher" rings. */
export function SettingsPage({ admin, client }: { admin: boolean; client: TrackifyClient }) {
  const [organisation, setOrganisation] = useState<Organisation>();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string }>();

  useEffect(() => {
    client
      .organisation()
      .then((value) => {
        setOrganisation(value);
        setName(value.name);
        setPhone(value.dispatcherPhone ?? '');
      })
      .catch((reason: unknown) =>
        setLoadError(reason instanceof Error ? reason.message : 'Settings unavailable'),
      );
  }, [client]);

  async function save() {
    if (!organisation) return;
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName) return setResult({ ok: false, message: 'Enter the organisation name' });
    if (trimmedPhone && (trimmedPhone.length < 3 || trimmedPhone.length > 20))
      return setResult({ ok: false, message: 'Phone number should be 3 to 20 characters' });
    const changes: { name?: string; dispatcherPhone?: string | null } = {};
    if (trimmedName !== organisation.name) changes.name = trimmedName;
    if (trimmedPhone !== (organisation.dispatcherPhone ?? ''))
      changes.dispatcherPhone = trimmedPhone || null;
    if (!Object.keys(changes).length) return setResult({ ok: true, message: 'Nothing to save' });
    setBusy(true);
    setResult(undefined);
    try {
      setOrganisation(await client.updateOrganisation(changes));
      setResult({ ok: true, message: 'Saved. Drivers see it the next time their app checks in.' });
    } catch (reason) {
      setResult({ ok: false, message: reason instanceof Error ? reason.message : 'Not saved' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Box>
        <Typography variant="h4">Settings</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Shown to drivers in the Trackify app.
        </Typography>
      </Box>
      {loadError && <Alert severity="error">Settings could not be loaded: {loadError}</Alert>}
      {!organisation && !loadError ? (
        <CircularProgress size={28} />
      ) : organisation ? (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2.5}>
            <TextField
              disabled={!admin || busy}
              helperText="Drivers see “Connected to …” with this name."
              label="Organisation name"
              onChange={(event) => setName(event.target.value)}
              value={name}
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
            <TextField
              disabled={!admin || busy}
              helperText="The number the driver app's “Call dispatcher” button rings. Leave blank to hide it."
              label="Dispatcher phone"
              onChange={(event) => setPhone(event.target.value)}
              type="tel"
              value={phone}
              slotProps={{ htmlInput: { maxLength: 20 } }}
            />
            {result && <Alert severity={result.ok ? 'success' : 'error'}>{result.message}</Alert>}
            {admin ? (
              <Box>
                <Button disabled={busy} onClick={() => void save()} variant="contained">
                  {busy ? 'Saving…' : 'Save settings'}
                </Button>
              </Box>
            ) : (
              <Typography color="text.secondary" variant="body2">
                Only administrators can change these.
              </Typography>
            )}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}
