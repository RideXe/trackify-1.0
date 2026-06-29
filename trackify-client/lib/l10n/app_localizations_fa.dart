// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Persian (`fa`).
class AppLocalizationsFa extends AppLocalizations {
  AppLocalizationsFa([String locale = 'fa']) : super(locale);

  @override
  String get trackingTitle => 'ردیابی';

  @override
  String get settingsTitle => 'تنظیمات';

  @override
  String get statusTitle => 'ریز عملکردها';

  @override
  String get saveButton => 'ذخيره';

  @override
  String get cancelButton => 'انصراف';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'ارسال موقعیت';

  @override
  String get statusButton => 'نمایش وضعیت';

  @override
  String get settingsButton => 'تغییر تنظیمات';

  @override
  String get invalidValue => 'مقدار نامعتبر';

  @override
  String get disabledValue => 'Disabled';

  @override
  String get idLabel => 'شناسه دستگاه';

  @override
  String get urlLabel => 'آدرس اینترنتی سرور';

  @override
  String get accuracyLabel => 'دقت مکان';

  @override
  String get highestAccuracyLabel => 'Highest';

  @override
  String get highAccuracyLabel => 'زیاد';

  @override
  String get mediumAccuracyLabel => 'متوسط';

  @override
  String get lowAccuracyLabel => 'کم';

  @override
  String get intervalLabel => 'فاصله زمانی (ثانیه)';

  @override
  String get fastestIntervalLabel => 'Fastest interval (seconds)';

  @override
  String get distanceLabel => 'مسافت (متر)';

  @override
  String get angleLabel => 'Angle (degrees)';

  @override
  String get heartbeatLabel => 'Stationary heartbeat (seconds)';

  @override
  String get bufferLabel => 'حافظه آفلاین';

  @override
  String get wakelockLabel => 'Wake lock';

  @override
  String get stopDetectionLabel => 'Stop detection';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'مسیر ادامه دار';

  @override
  String get advancedLabel => 'Advanced settings';

  @override
  String get passwordLabel => 'Password';

  @override
  String get optimizationMessage =>
      'To ensure reliable tracking, please disable battery optimization for this app.';

  @override
  String get passwordError => 'Wrong password';

  @override
  String get startAction => 'شروع کار';

  @override
  String get stopAction => 'توقف کار';

  @override
  String get sosAction => 'ارسال پیام اضطراری';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
