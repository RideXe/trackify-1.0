// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Lithuanian (`lt`).
class AppLocalizationsLt extends AppLocalizations {
  AppLocalizationsLt([String locale = 'lt']) : super(locale);

  @override
  String get trackingTitle => 'Stebėjimas';

  @override
  String get settingsTitle => 'Nustatymai';

  @override
  String get statusTitle => 'Žurnalai';

  @override
  String get saveButton => 'Išsaugoti';

  @override
  String get cancelButton => 'Atšaukti';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Siųsti poziciją';

  @override
  String get statusButton => 'Rodyti būklę';

  @override
  String get settingsButton => 'Keisti nustatymus';

  @override
  String get invalidValue => 'Neteisinga reikšmė';

  @override
  String get disabledValue => 'Išjungta';

  @override
  String get idLabel => 'Įrenginio identifikatorius';

  @override
  String get urlLabel => 'Serverio URL';

  @override
  String get accuracyLabel => 'Pozicijos tikslumas';

  @override
  String get highestAccuracyLabel => 'Didžiausias';

  @override
  String get highAccuracyLabel => 'Aukštas';

  @override
  String get mediumAccuracyLabel => 'Vidutinis';

  @override
  String get lowAccuracyLabel => 'Žemas';

  @override
  String get intervalLabel => 'Intervalas (sekundėmis)';

  @override
  String get fastestIntervalLabel => 'Trumpiausias intervalas (sekundėmis)';

  @override
  String get distanceLabel => 'Atstumas (metrais)';

  @override
  String get angleLabel => 'Kampas (laipsniais)';

  @override
  String get heartbeatLabel => 'Stationary heartbeat (seconds)';

  @override
  String get bufferLabel => 'Kaupti duomenis neprisijungus';

  @override
  String get wakelockLabel => 'Pažadinimo užraktas';

  @override
  String get stopDetectionLabel => 'Stabdyti aptikimą';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Nuolatinis stebėjimas';

  @override
  String get advancedLabel => 'Papildomi nustatymai';

  @override
  String get passwordLabel => 'Slaptažodis';

  @override
  String get optimizationMessage =>
      'Norėdami užtikrinti patikimą sekimą, išjunkite šios programėlės akumuliatoriaus optimizavimą.';

  @override
  String get passwordError => 'Neteisingas slaptažodis';

  @override
  String get startAction => 'Įjungti servisą';

  @override
  String get stopAction => 'Sustabdyti servisą';

  @override
  String get sosAction => 'Siųsti SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
