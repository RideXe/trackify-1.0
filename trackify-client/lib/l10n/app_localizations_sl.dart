// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Slovenian (`sl`).
class AppLocalizationsSl extends AppLocalizations {
  AppLocalizationsSl([String locale = 'sl']) : super(locale);

  @override
  String get trackingTitle => 'Sledenje';

  @override
  String get settingsTitle => 'Nastavitve';

  @override
  String get statusTitle => 'Dnevniki';

  @override
  String get saveButton => 'Shrani';

  @override
  String get cancelButton => 'Prekliči';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Pošlji lokacijo';

  @override
  String get statusButton => 'Pokaži stanje';

  @override
  String get settingsButton => 'Spremeni nastavitve';

  @override
  String get invalidValue => 'Neveljavna vrednost';

  @override
  String get disabledValue => 'Disabled';

  @override
  String get idLabel => 'Identifikator naprave';

  @override
  String get urlLabel => 'URL strežnika';

  @override
  String get accuracyLabel => 'Natančnost lokacije';

  @override
  String get highestAccuracyLabel => 'Highest';

  @override
  String get highAccuracyLabel => 'Visoka';

  @override
  String get mediumAccuracyLabel => 'Srednja';

  @override
  String get lowAccuracyLabel => 'Nizka';

  @override
  String get intervalLabel => 'Interval (sekunde)';

  @override
  String get fastestIntervalLabel => 'Fastest interval (seconds)';

  @override
  String get distanceLabel => 'Razdalja (metri)';

  @override
  String get angleLabel => 'Angle (degrees)';

  @override
  String get heartbeatLabel => 'Stationary heartbeat (seconds)';

  @override
  String get bufferLabel => 'Predpomnjenje brez povezave';

  @override
  String get wakelockLabel => 'Wake lock';

  @override
  String get stopDetectionLabel => 'Stop detection';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Neprekinjeno sledenje';

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
  String get startAction => 'Zaženi storitev';

  @override
  String get stopAction => 'Ustavi storitev';

  @override
  String get sosAction => 'Pošlji SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
