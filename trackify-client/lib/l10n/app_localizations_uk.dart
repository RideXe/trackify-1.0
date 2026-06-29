// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Ukrainian (`uk`).
class AppLocalizationsUk extends AppLocalizations {
  AppLocalizationsUk([String locale = 'uk']) : super(locale);

  @override
  String get trackingTitle => 'Відстеження';

  @override
  String get settingsTitle => 'Налаштування';

  @override
  String get statusTitle => 'Журнали';

  @override
  String get saveButton => 'Зберегти';

  @override
  String get cancelButton => 'Скасувати';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Відправити місцезнаходження';

  @override
  String get statusButton => 'Показати статус';

  @override
  String get settingsButton => 'Змінити налаштування';

  @override
  String get invalidValue => 'Некоректне значення';

  @override
  String get disabledValue => 'Disabled';

  @override
  String get idLabel => 'Ідентифікатор пристрою';

  @override
  String get urlLabel => 'URL сервера';

  @override
  String get accuracyLabel => 'Точність місцезнаходження';

  @override
  String get highestAccuracyLabel => 'Highest';

  @override
  String get highAccuracyLabel => 'Висока';

  @override
  String get mediumAccuracyLabel => 'Середня';

  @override
  String get lowAccuracyLabel => 'Низька';

  @override
  String get intervalLabel => 'Інтервал (секунд)';

  @override
  String get fastestIntervalLabel => 'Fastest interval (seconds)';

  @override
  String get distanceLabel => 'Відстань (метрів)';

  @override
  String get angleLabel => 'Angle (degrees)';

  @override
  String get heartbeatLabel => 'Stationary heartbeat (seconds)';

  @override
  String get bufferLabel => 'Офлайн-буферизація';

  @override
  String get wakelockLabel => 'Wake lock';

  @override
  String get stopDetectionLabel => 'Stop detection';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Безперервне відстеження';

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
  String get startAction => 'Запустити сервіс';

  @override
  String get stopAction => 'Зупинити сервіс';

  @override
  String get sosAction => 'Відправити SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
