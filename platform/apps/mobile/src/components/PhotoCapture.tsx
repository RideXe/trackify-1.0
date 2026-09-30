import { useRef, useState } from 'react';
import { Image, Modal, PermissionsAndroid, SafeAreaView, StyleSheet, View } from 'react-native';
import { Camera, type CameraApi } from 'react-native-camera-kit';
import { useStrings } from '../i18n';
import { Button, s as ui } from './ui';

/** "Add photo" for a report: opens the camera, shows the result, allows a retake. */
export function PhotoField({
  label,
  uri,
  onChange,
  disabled,
}: {
  label: string;
  uri?: string;
  onChange: (uri: string | undefined) => void;
  disabled?: boolean;
}) {
  const { t } = useStrings();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const camera = useRef<CameraApi>(null);

  async function openCamera() {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (result === PermissionsAndroid.RESULTS.GRANTED) setOpen(true);
  }

  async function capture() {
    if (!camera.current) return;
    setBusy(true);
    try {
      const photo = await camera.current.capture();
      onChange(photo.uri);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      {uri && <Image source={{ uri }} style={st.preview} resizeMode="cover" />}
      <Button
        disabled={disabled}
        kind="secondary"
        onPress={() => void openCamera()}
        title={uri ? t('retakePhoto') : `${t('addPhoto')} · ${label}`}
      />
      <Modal visible={open} onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={st.camera}>
          <Camera ref={camera} style={{ flex: 1 }} />
          <View style={[ui.row, { padding: 16 }]}>
            <Button
              kind="secondary"
              onPress={() => setOpen(false)}
              style={{ flex: 1 }}
              title={t('cancel')}
            />
            <Button
              busy={busy}
              onPress={() => void capture()}
              style={{ flex: 1 }}
              title={t('takePhoto')}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  preview: { width: '100%', height: 200, borderRadius: 14, backgroundColor: '#EEF2F6' },
  camera: { flex: 1, backgroundColor: '#07111A' },
});
