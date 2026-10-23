'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import type { DriverAppLink, TrackifyClient } from '@trackify/api-client';
import { Copy, Download, MessageCircle, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { clockTime } from './fleet-map-data';

/**
 * How a driver gets the Android app: a fresh link that works for 24 hours, as a QR code to scan
 * with the driver's phone, a download button, and ways to send it.
 */
export function DriverAppDialog({
  open,
  client,
  onClose,
}: {
  open: boolean;
  client: TrackifyClient;
  onClose: () => void;
}) {
  const [link, setLink] = useState<DriverAppLink>();
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLink(undefined);
    setQr('');
    setError('');
    setCopied(false);
    client
      .createDriverAppLink()
      .then(async (value) => {
        if (!active) return;
        setLink(value);
        setQr(await QRCode.toDataURL(value.url, { width: 220, margin: 1 }));
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'The download link is unavailable.');
      });
    return () => {
      active = false;
    };
  }, [open, client]);

  const message = link
    ? `Install the Trackify driver app: ${link.url} (link works for 24 hours)`
    : '';
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle component="div" sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <Box sx={{ color: 'primary.main', display: 'flex' }}>
            <Smartphone size={20} />
          </Box>
          <Typography component="h2" sx={{ fontSize: 18, fontWeight: 800 }}>
            Get the Trackify driver app
          </Typography>
        </Stack>
        <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
          For Android phones.
          {link?.version && ` Version ${link.version}`}
          {link?.updatedAt && ` · updated ${clockTime(link.updatedAt)}`}
          {link?.sizeBytes && ` · ${Math.round(link.sizeBytes / 1_000_000)} MB`}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="info">
            {error} An administrator publishes the app; once that is done, this button gives you a
            download link.
          </Alert>
        ) : !link ? (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress size={26} />
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
            {qr && (
              <Box
                component="img"
                src={qr}
                alt="QR code to download the Trackify driver app"
                sx={{ width: 200, height: 200 }}
              />
            )}
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              Scan this with the driver&apos;s phone camera, or send them the link.
            </Typography>
            <Button
              component="a"
              fullWidth
              href={link.url}
              size="large"
              startIcon={<Download size={18} />}
              variant="contained"
            >
              Download for Android
            </Button>
            <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
              <Button
                fullWidth
                onClick={() =>
                  void navigator.clipboard.writeText(link.url).then(() => setCopied(true))
                }
                startIcon={<Copy size={16} />}
                variant="outlined"
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button
                color="success"
                component="a"
                fullWidth
                href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                rel="noreferrer"
                startIcon={<MessageCircle size={16} />}
                target="_blank"
                variant="outlined"
              >
                WhatsApp
              </Button>
            </Stack>
            <Box
              component="ol"
              sx={{ textAlign: 'left', pl: 2.5, m: 0, fontSize: 13, color: 'text.secondary' }}
            >
              <li>Open the link on the driver&apos;s phone and tap Download.</li>
              <li>
                If Android asks, allow &ldquo;Install unknown apps&rdquo; for the browser, then tap
                Install.
              </li>
              <li>
                Open Trackify and enter the setup code from the vehicle&apos;s Connection button.
              </li>
            </Box>
            <Typography color="text.secondary" sx={{ fontSize: 11 }}>
              This link works until {clockTime(link.expiresAt)}. Open this again for a new one.
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
