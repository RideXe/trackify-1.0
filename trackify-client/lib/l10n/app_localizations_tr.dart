// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Turkish (`tr`).
class AppLocalizationsTr extends AppLocalizations {
  AppLocalizationsTr([String locale = 'tr']) : super(locale);

  @override
  String get trackingTitle => 'İzleme';

  @override
  String get settingsTitle => 'Ayarlar';

  @override
  String get statusTitle => 'Kayıtlar';

  @override
  String get saveButton => 'Kaydet';

  @override
  String get cancelButton => 'İptal';

  @override
  String get okButton => 'Tamam';

  @override
  String get locationButton => 'Konum gönder';

  @override
  String get statusButton => 'Durumu göster';

  @override
  String get settingsButton => 'Ayarları değiştir';

  @override
  String get invalidValue => 'Geçersiz değer';

  @override
  String get disabledValue => 'Devre dışı';

  @override
  String get idLabel => 'Cihaz kimliği';

  @override
  String get urlLabel => 'Sunucu URL\'si';

  @override
  String get accuracyLabel => 'Konum doğruluğu';

  @override
  String get highestAccuracyLabel => 'En yüksek';

  @override
  String get highAccuracyLabel => 'Yüksek';

  @override
  String get mediumAccuracyLabel => 'Orta';

  @override
  String get lowAccuracyLabel => 'Düşük';

  @override
  String get intervalLabel => 'Aralık (saniye)';

  @override
  String get fastestIntervalLabel => 'En hızlı aralık (saniye)';

  @override
  String get distanceLabel => 'Mesafe (metre)';

  @override
  String get angleLabel => 'Açı (derece)';

  @override
  String get heartbeatLabel => 'Hareketsiz kalp atışı (saniye)';

  @override
  String get bufferLabel => 'Çevrimdışı önbellekleme';

  @override
  String get wakelockLabel => 'Uyanık kilidi';

  @override
  String get stopDetectionLabel => 'Durma algılama';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Sürekli izleme';

  @override
  String get advancedLabel => 'Gelişmiş ayarlar';

  @override
  String get passwordLabel => 'Password';

  @override
  String get optimizationMessage =>
      'Güvenilir izleme için lütfen bu uygulama için pil optimizasyonunu devre dışı bırakın.';

  @override
  String get passwordError => 'Wrong password';

  @override
  String get startAction => 'Servisi başlat';

  @override
  String get stopAction => 'Servisi durdur';

  @override
  String get sosAction => 'SOS gönder';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
