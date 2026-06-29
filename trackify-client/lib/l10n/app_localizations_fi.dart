// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Finnish (`fi`).
class AppLocalizationsFi extends AppLocalizations {
  AppLocalizationsFi([String locale = 'fi']) : super(locale);

  @override
  String get trackingTitle => 'Seuranta';

  @override
  String get settingsTitle => 'Asetukset';

  @override
  String get statusTitle => 'Lokit';

  @override
  String get saveButton => 'Tallenna';

  @override
  String get cancelButton => 'Peruuta';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Lähetä sijainti';

  @override
  String get statusButton => 'Näytä tila';

  @override
  String get settingsButton => 'Muuta asetuksia';

  @override
  String get invalidValue => 'Virheellinen arvo';

  @override
  String get disabledValue => 'Poistettu käytöstä';

  @override
  String get idLabel => 'Laitteen tunniste';

  @override
  String get urlLabel => 'Palvelimen URL';

  @override
  String get accuracyLabel => 'Paikannuksen tarkkuus';

  @override
  String get highestAccuracyLabel => 'Korkein';

  @override
  String get highAccuracyLabel => 'Korkea';

  @override
  String get mediumAccuracyLabel => 'Normaali';

  @override
  String get lowAccuracyLabel => 'Matala';

  @override
  String get intervalLabel => 'Aikaväli (sekuntia)';

  @override
  String get fastestIntervalLabel => 'Nopein aikaväli (sekuntia)';

  @override
  String get distanceLabel => 'Matka (metriä)';

  @override
  String get angleLabel => 'Kulma (astetta)';

  @override
  String get heartbeatLabel => 'Paikallaolon elossaoloviesti (sekuntia)';

  @override
  String get bufferLabel => 'Offline puskuri';

  @override
  String get wakelockLabel => 'Pakota päälläolo';

  @override
  String get stopDetectionLabel => 'Pysähdyksissä olon tunnistus';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Jatkuva paikannus';

  @override
  String get advancedLabel => 'Lisäasetukset';

  @override
  String get passwordLabel => 'Salasana';

  @override
  String get optimizationMessage =>
      'Luotettavan paikannuksen varmistamiseksi, poista akun optimointi käytöstä tältä sovellukselta.';

  @override
  String get passwordError => 'Väärä salasana';

  @override
  String get startAction => 'Käynnistä seuranta';

  @override
  String get stopAction => 'Lopeta seuranta';

  @override
  String get sosAction => 'Lähetä SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
