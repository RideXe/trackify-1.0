// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Dutch Flemish (`nl`).
class AppLocalizationsNl extends AppLocalizations {
  AppLocalizationsNl([String locale = 'nl']) : super(locale);

  @override
  String get trackingTitle => 'Tracking';

  @override
  String get settingsTitle => 'Instellingen';

  @override
  String get statusTitle => 'Logboeken';

  @override
  String get saveButton => 'Opslaan';

  @override
  String get cancelButton => 'Annuleren';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Locatie verzenden';

  @override
  String get statusButton => 'Status tonen';

  @override
  String get settingsButton => 'Instellingen wijzigen';

  @override
  String get invalidValue => 'Ongeldige waarde';

  @override
  String get disabledValue => 'Uitgeschakeld';

  @override
  String get idLabel => 'Apparaat-ID';

  @override
  String get urlLabel => 'Server-URL';

  @override
  String get accuracyLabel => 'Locatienauwkeurigheid';

  @override
  String get highestAccuracyLabel => 'Hoogste';

  @override
  String get highAccuracyLabel => 'Hoog';

  @override
  String get mediumAccuracyLabel => 'Gemiddeld';

  @override
  String get lowAccuracyLabel => 'Laag';

  @override
  String get intervalLabel => 'Interval (seconden)';

  @override
  String get fastestIntervalLabel => 'Snelste interval (seconden)';

  @override
  String get distanceLabel => 'Afstand (meters)';

  @override
  String get angleLabel => 'Hoek (graden)';

  @override
  String get heartbeatLabel => 'Stationaire heartbeat (seconden)';

  @override
  String get bufferLabel => 'Offline buffering';

  @override
  String get wakelockLabel => 'Wakelock';

  @override
  String get stopDetectionLabel => 'Stopdetectie';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Continu volgen';

  @override
  String get advancedLabel => 'Geavanceerde instellingen';

  @override
  String get passwordLabel => 'Password';

  @override
  String get optimizationMessage =>
      'Schakel batterijoptimalisatie voor deze app uit om betrouwbare tracking te garanderen.';

  @override
  String get passwordError => 'Wrong password';

  @override
  String get startAction => 'Service starten';

  @override
  String get stopAction => 'Service stoppen';

  @override
  String get sosAction => 'SOS verzenden';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
