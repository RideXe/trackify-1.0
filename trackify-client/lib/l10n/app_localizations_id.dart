// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Indonesian (`id`).
class AppLocalizationsId extends AppLocalizations {
  AppLocalizationsId([String locale = 'id']) : super(locale);

  @override
  String get trackingTitle => 'Pelacakan';

  @override
  String get settingsTitle => 'Pengaturan';

  @override
  String get statusTitle => 'Log';

  @override
  String get saveButton => 'Simpan';

  @override
  String get cancelButton => 'Batal';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Kirim lokasi';

  @override
  String get statusButton => 'Tampilkan status';

  @override
  String get settingsButton => 'Ubah pengaturan';

  @override
  String get invalidValue => 'Nilai tidak valid';

  @override
  String get disabledValue => 'Dinonaktifkan';

  @override
  String get idLabel => 'Pengenal perangkat';

  @override
  String get urlLabel => 'URL server';

  @override
  String get accuracyLabel => 'Akurasi lokasi';

  @override
  String get highestAccuracyLabel => 'Tertinggi';

  @override
  String get highAccuracyLabel => 'Tinggi';

  @override
  String get mediumAccuracyLabel => 'Sedang';

  @override
  String get lowAccuracyLabel => 'Rendah';

  @override
  String get intervalLabel => 'Interval (detik)';

  @override
  String get fastestIntervalLabel => 'Interval tercepat (detik)';

  @override
  String get distanceLabel => 'Jarak (meter)';

  @override
  String get angleLabel => 'Sudut (derajat)';

  @override
  String get heartbeatLabel => 'Heartbeat saat diam (detik)';

  @override
  String get bufferLabel => 'Buffering offline';

  @override
  String get wakelockLabel => 'Wake lock';

  @override
  String get stopDetectionLabel => 'Deteksi berhenti';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Pelacakan berkelanjutan';

  @override
  String get advancedLabel => 'Pengaturan lanjutan';

  @override
  String get passwordLabel => 'Password';

  @override
  String get optimizationMessage =>
      'Untuk memastikan pelacakan yang andal, nonaktifkan optimasi baterai untuk aplikasi ini.';

  @override
  String get passwordError => 'Wrong password';

  @override
  String get startAction => 'Mulai layanan';

  @override
  String get stopAction => 'Hentikan layanan';

  @override
  String get sosAction => 'Kirim SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
