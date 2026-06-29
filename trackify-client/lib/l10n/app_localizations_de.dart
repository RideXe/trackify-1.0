// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for German (`de`).
class AppLocalizationsDe extends AppLocalizations {
  AppLocalizationsDe([String locale = 'de']) : super(locale);

  @override
  String get trackingTitle => 'Verfolgung';

  @override
  String get settingsTitle => 'Einstellungen';

  @override
  String get statusTitle => 'Protokolle';

  @override
  String get saveButton => 'Speichern';

  @override
  String get cancelButton => 'Abbrechen';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Standort senden';

  @override
  String get statusButton => 'Status anzeigen';

  @override
  String get settingsButton => 'Einstellungen ändern';

  @override
  String get invalidValue => 'Ungültiger Wert';

  @override
  String get disabledValue => 'Deaktiviert';

  @override
  String get idLabel => 'Gerätekennung';

  @override
  String get urlLabel => 'Server-URL';

  @override
  String get accuracyLabel => 'Positionsgenauigkeit';

  @override
  String get highestAccuracyLabel => 'Höchste';

  @override
  String get highAccuracyLabel => 'Hoch';

  @override
  String get mediumAccuracyLabel => 'Mittel';

  @override
  String get lowAccuracyLabel => 'Niedrig';

  @override
  String get intervalLabel => 'Intervall (Sekunden)';

  @override
  String get fastestIntervalLabel => 'Schnellstes Intervall (Sekunden)';

  @override
  String get distanceLabel => 'Distanz (Meter)';

  @override
  String get angleLabel => 'Winkel (Grad)';

  @override
  String get heartbeatLabel => 'Stillstand-Herzschlag (Sekunden)';

  @override
  String get bufferLabel => 'Offline-Pufferung';

  @override
  String get wakelockLabel => 'Wakelock';

  @override
  String get stopDetectionLabel => 'Stopp-Erkennung';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Kontinuierliches Tracking';

  @override
  String get advancedLabel => 'Erweiterte Einstellungen';

  @override
  String get passwordLabel => 'Password';

  @override
  String get optimizationMessage =>
      'Um zuverlässiges Tracking zu gewährleisten, bitte die Akkuoptimierung für diese App deaktivieren.';

  @override
  String get passwordError => 'Wrong password';

  @override
  String get startAction => 'Dienst starten';

  @override
  String get stopAction => 'Dienst stoppen';

  @override
  String get sosAction => 'SOS senden';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
