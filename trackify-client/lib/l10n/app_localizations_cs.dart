// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Czech (`cs`).
class AppLocalizationsCs extends AppLocalizations {
  AppLocalizationsCs([String locale = 'cs']) : super(locale);

  @override
  String get trackingTitle => 'Sledování';

  @override
  String get settingsTitle => 'Nastavení';

  @override
  String get statusTitle => 'Protokol';

  @override
  String get saveButton => 'Uložit';

  @override
  String get cancelButton => 'Zrušit';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Odeslat polohu';

  @override
  String get statusButton => 'Zobrazit stav';

  @override
  String get settingsButton => 'Změnit nastavení';

  @override
  String get invalidValue => 'Chybná hodnota';

  @override
  String get disabledValue => 'Disabled';

  @override
  String get idLabel => 'Identifikátor zařízení';

  @override
  String get urlLabel => 'URL serveru';

  @override
  String get accuracyLabel => 'Přesnost polohy';

  @override
  String get highestAccuracyLabel => 'Highest';

  @override
  String get highAccuracyLabel => 'Vysoký';

  @override
  String get mediumAccuracyLabel => 'Střední';

  @override
  String get lowAccuracyLabel => 'Nízký';

  @override
  String get intervalLabel => 'Interval (vteřiny)';

  @override
  String get fastestIntervalLabel => 'Fastest interval (seconds)';

  @override
  String get distanceLabel => 'Vzdálenost (metry)';

  @override
  String get angleLabel => 'Angle (degrees)';

  @override
  String get heartbeatLabel => 'Stationary heartbeat (seconds)';

  @override
  String get bufferLabel => 'Ukládání do vyrovnávací paměti';

  @override
  String get wakelockLabel => 'Wake lock';

  @override
  String get stopDetectionLabel => 'Stop detection';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Nepřetržité sledování';

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
  String get startAction => 'Spustit službu';

  @override
  String get stopAction => 'Zastavit službu';

  @override
  String get sosAction => 'Odeslat SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
