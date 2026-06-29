// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Latvian (`lv`).
class AppLocalizationsLv extends AppLocalizations {
  AppLocalizationsLv([String locale = 'lv']) : super(locale);

  @override
  String get trackingTitle => 'Izsekošana';

  @override
  String get settingsTitle => 'Iestatījumi';

  @override
  String get statusTitle => 'Žurnālfaili';

  @override
  String get saveButton => 'Saglabāt';

  @override
  String get cancelButton => 'Atcelt';

  @override
  String get okButton => 'Labi';

  @override
  String get locationButton => 'Nosūtīt atrašanās vietu';

  @override
  String get statusButton => 'Rādīt statusu';

  @override
  String get settingsButton => 'Mainīt iestatījumus';

  @override
  String get invalidValue => 'Nepareiza vērtība';

  @override
  String get disabledValue => 'Bloķēts';

  @override
  String get idLabel => 'Ierīces identifikators';

  @override
  String get urlLabel => 'Servera URL';

  @override
  String get accuracyLabel => 'Atrašanās vietas precizitāte';

  @override
  String get highestAccuracyLabel => 'Viss augstākā';

  @override
  String get highAccuracyLabel => 'Augsta';

  @override
  String get mediumAccuracyLabel => 'Vidēja';

  @override
  String get lowAccuracyLabel => 'Zema';

  @override
  String get intervalLabel => 'Intervāls (sekundēs)';

  @override
  String get fastestIntervalLabel => 'Ātrākais intervāls (sekundēs)';

  @override
  String get distanceLabel => 'Attālums (metros)';

  @override
  String get angleLabel => 'Leņķis (grādi)';

  @override
  String get heartbeatLabel => 'Stationary heartbeat (seconds)';

  @override
  String get bufferLabel => 'Bezsaistes buferizācija';

  @override
  String get wakelockLabel => 'Wake lock';

  @override
  String get stopDetectionLabel => 'Apstāšanās noteikšana';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Nepārtraukta izsekošana';

  @override
  String get advancedLabel => 'Papildus iestatījumi';

  @override
  String get passwordLabel => 'Parole';

  @override
  String get optimizationMessage =>
      'Lai nodrošinātu uzticamu izsekošanu, lūdzu, atspējojiet šīs lietotnes akumulatora optimizāciju.';

  @override
  String get passwordError => 'Nepareiza parole';

  @override
  String get startAction => 'Startēt servisu';

  @override
  String get stopAction => 'Apturēt servisu';

  @override
  String get sosAction => 'Sūtīt SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
